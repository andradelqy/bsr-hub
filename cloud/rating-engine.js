'use strict';

// BSR Rating v3: confrontos pareados zero-sum por disciplina. A incerteza
// controla volatilidade e confiança sem criar pontos apenas por participar.
// Safety, carteira e MPR também são isolados por disciplina.

const VERSION = 'bsr-rating-v3.1.0';
const INITIAL_SIGMA = 25 / 3;
const MIN_SIGMA = 1.5;
const TAU = 25 / 300;
const DISPLAY_BASE = 1500;
const DISPLAY_SCALE = 40;
const DISPLAY_MIN = 100;
const DISPLAY_MAX = 10000;
const PROVISIONAL_RACES = 8;
const SAFETY_WINDOW_CORNERS = 2000;
const SAFETY_SEED_CORNERS = 1000;
const RELIABILITY_WINDOW = 20;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const round = (value, digits = 0) => {
  const scale = 10 ** digits;
  return Math.round((finite(value) + Number.EPSILON) * scale) / scale;
};

function disciplineFor(carClass, explicit) {
  const selected = String(explicit || '').trim().toLowerCase();
  if (['road', 'formula', 'oval', 'drift'].includes(selected)) return selected;
  const value = String(carClass || '').toLowerCase();
  if (/\b(f1|f2|f3|f4|formula|indy|super formula|rss fh|vrc formula)\b/.test(value)) return 'formula';
  if (/\b(nascar|oval|stock car|stockcar|arca|truck)\b/.test(value)) return 'oval';
  if (/\b(drift|drifting)\b/.test(value)) return 'drift';
  return 'road';
}

function ordinal(profile) {
  return finite(profile?.mu, 0) - 3 * finite(profile?.sigma, INITIAL_SIGMA);
}

function displayRating(profile) {
  return Math.round(clamp(DISPLAY_BASE + DISPLAY_SCALE * ordinal(profile), DISPLAY_MIN, DISPLAY_MAX));
}

function seedSkillProfile(legacyRating = 1600) {
  const display = Math.round(clamp(finite(legacyRating, 1600), DISPLAY_MIN, DISPLAY_MAX));
  const desiredOrdinal = (display - DISPLAY_BASE) / DISPLAY_SCALE;
  return {
    mu:round(desiredOrdinal + 3 * INITIAL_SIGMA, 6), sigma:round(INITIAL_SIGMA, 6),
    ordinal:round(desiredOrdinal, 6), display, races:0, provisional:true,
    confidence:0, lastRatedAt:null, version:VERSION
  };
}

function normalizeSkillProfile(raw, legacyRating = 1600) {
  if (!raw || !Number.isFinite(Number(raw.mu)) || !Number.isFinite(Number(raw.sigma))) return seedSkillProfile(legacyRating);
  const sigma = clamp(finite(raw.sigma, INITIAL_SIGMA), MIN_SIGMA, INITIAL_SIGMA);
  const races = Math.max(0, Math.round(finite(raw.races)));
  const preservedDisplay = raw.version !== VERSION && Number.isFinite(Number(raw.display))
    ? Math.round(clamp(Number(raw.display), DISPLAY_MIN, DISPLAY_MAX))
    : displayRating({ mu:finite(raw.mu), sigma });
  const desiredOrdinal = (preservedDisplay - DISPLAY_BASE) / DISPLAY_SCALE;
  const profile = {
    mu:round(desiredOrdinal + 3 * sigma, 6), sigma:round(sigma, 6), races,
    lastRatedAt:raw.lastRatedAt || null, version:VERSION
  };
  profile.ordinal = round(ordinal(profile), 6);
  profile.display = displayRating(profile);
  profile.confidence = Math.round(clamp(1 - profile.sigma / INITIAL_SIGMA, 0, 1) * 100);
  profile.provisional = profile.races < PROVISIONAL_RACES || profile.confidence < 40;
  return profile;
}

function primaryDiscipline(skillRatings, previous = 'road') {
  return Object.entries(skillRatings || {}).sort((left, right) => {
    const raceDifference = finite(right[1]?.races) - finite(left[1]?.races);
    if (raceDifference) return raceDifference;
    if (left[0] === previous) return -1;
    if (right[0] === previous) return 1;
    return finite(right[1]?.display) - finite(left[1]?.display) || left[0].localeCompare(right[0]);
  })[0]?.[0] || previous || 'road';
}

function winProbability(a, b) {
  const aDisplay = Number.isFinite(Number(a?.display)) ? Number(a.display) : displayRating(a);
  const bDisplay = Number.isFinite(Number(b?.display)) ? Number(b.display) : displayRating(b);
  return 1 / (1 + 10 ** ((bDisplay - aDisplay) / 400));
}

function inflateSigma(profile, eventAt) {
  const date = new Date(eventAt || Date.now());
  const previous = profile.lastRatedAt ? new Date(profile.lastRatedAt) : null;
  const inactiveDays = previous && !Number.isNaN(previous.getTime()) && !Number.isNaN(date.getTime())
    ? Math.max(0, (date.getTime() - previous.getTime()) / 86400000 - 30)
    : 0;
  const periods = Math.min(12, Math.floor(inactiveDays / 30));
  return clamp(Math.sqrt(profile.sigma ** 2 + TAU ** 2 * (1 + periods)), MIN_SIGMA, INITIAL_SIGMA);
}

function updateSkillGrid(participants, options = {}) {
  if (!Array.isArray(participants) || participants.length < 2) {
    return (participants || []).map((item, index) => {
      const profile = normalizeSkillProfile(item.profile, item.legacyRating);
      return { ...item, before:profile, after:profile, delta:0, expectedFinish:index + 1, performance:0 };
    });
  }
  const eventAt = options.eventAt || new Date().toISOString();
  const prepared = participants.map((item, index) => {
    const before = normalizeSkillProfile(item.profile, item.legacyRating);
    return { ...item, index, before, sigma:inflateSigma(before, eventAt), rank:Math.max(1, finite(item.rank, index + 1)), rawDelta:0, expectedScore:0, actualScore:0, information:0 };
  });
  const opponentCount = prepared.length - 1;
  const gridFactor = clamp(Math.sqrt(prepared.length / 8), 0.8, 1.25);
  for (let leftIndex = 0; leftIndex < prepared.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < prepared.length; rightIndex += 1) {
      const left = prepared[leftIndex]; const right = prepared[rightIndex];
      const expectedLeft = winProbability(left.before, right.before);
      const actualLeft = left.rank < right.rank ? 1 : left.rank > right.rank ? 0 : 0.5;
      const uncertainty = clamp((left.sigma + right.sigma) / (2 * INITIAL_SIGMA), 0.18, 1);
      const provisionalBoost = left.before.races < PROVISIONAL_RACES || right.before.races < PROVISIONAL_RACES ? 1.25 : 1;
      const pairK = clamp(44 * (0.65 + 0.55 * uncertainty) * provisionalBoost * gridFactor, 22, 82);
      const transfer = pairK * (actualLeft - expectedLeft) / opponentCount;
      left.rawDelta += transfer; right.rawDelta -= transfer;
      left.expectedScore += expectedLeft; right.expectedScore += 1 - expectedLeft;
      left.actualScore += actualLeft; right.actualScore += 1 - actualLeft;
      const information = expectedLeft * (1 - expectedLeft);
      left.information += information; right.information += information;
    }
  }

  const roundedDeltas = prepared.map(item => Math.round(clamp(item.rawDelta, -85, 85)));
  let roundingDrift = roundedDeltas.reduce((sum, value) => sum + value, 0);
  const adjustmentOrder = prepared.map((item, index) => ({ index, weight:Math.abs(item.rawDelta) })).sort((a,b) => b.weight - a.weight);
  for (const candidate of adjustmentOrder) {
    if (!roundingDrift) break;
    const correction = Math.sign(roundingDrift);
    if (Math.abs(roundedDeltas[candidate.index] - correction) <= 85) {
      roundedDeltas[candidate.index] -= correction; roundingDrift -= correction;
    }
  }

  // Os limites visuais também precisam respeitar a natureza zero-sum. Depois
  // de limitar cada piloto ao espaço disponível, redistribuímos qualquer
  // diferença de arredondamento sem criar ou destruir pontos no grid.
  prepared.forEach((entry, index) => {
    const minimumDelta = DISPLAY_MIN - entry.before.display;
    const maximumDelta = DISPLAY_MAX - entry.before.display;
    roundedDeltas[index] = Math.round(clamp(roundedDeltas[index], minimumDelta, maximumDelta));
  });
  roundingDrift = roundedDeltas.reduce((sum, value) => sum + value, 0);
  let safetyCounter = prepared.length * (DISPLAY_MAX - DISPLAY_MIN + 1);
  while (roundingDrift && safetyCounter > 0) {
    let changed = false;
    for (const candidate of adjustmentOrder) {
      if (!roundingDrift) break;
      const correction = Math.sign(roundingDrift);
      const entry = prepared[candidate.index];
      const proposed = roundedDeltas[candidate.index] - correction;
      if (proposed >= DISPLAY_MIN - entry.before.display && proposed <= DISPLAY_MAX - entry.before.display) {
        roundedDeltas[candidate.index] = proposed;
        roundingDrift -= correction;
        changed = true;
      }
    }
    if (!changed) break;
    safetyCounter -= 1;
  }

  return prepared.map((entry, index) => {
    const informationRatio = entry.information / opponentCount;
    const shrink = clamp(informationRatio * (0.42 + Math.min(0.13, opponentCount * 0.008)), 0.015, 0.15);
    const sigma = clamp(entry.sigma * Math.sqrt(1 - shrink), MIN_SIGMA, INITIAL_SIGMA);
    const targetDisplay = Math.round(clamp(entry.before.display + roundedDeltas[index], DISPLAY_MIN, DISPLAY_MAX));
    const targetOrdinal = (targetDisplay - DISPLAY_BASE) / DISPLAY_SCALE;
    const after = normalizeSkillProfile({ mu:targetOrdinal + 3 * sigma, sigma, races:entry.before.races + 1, display:targetDisplay, lastRatedAt:eventAt, version:VERSION }, targetDisplay);
    const expectedFinish = 1 + prepared.reduce((sum, opponent) => opponent === entry ? sum : sum + winProbability(opponent.before, entry.before), 0);
    return {
      ...entry, before:entry.before, after, delta:after.display - entry.before.display,
      expectedFinish:round(expectedFinish, 2), performance:round((entry.actualScore - entry.expectedScore) / opponentCount, 4)
    };
  });
}

function safetyFromCpi(cpi) {
  const value = clamp(finite(cpi), 0, 1000);
  return round(clamp(4.99 * value / (value + 30), 0, 4.99), 2);
}

function cpiFromSafety(safety) {
  const value = clamp(finite(safety, 2.5), 0.05, 4.94);
  return clamp(30 * value / (4.99 - value), 1, 1000);
}

function seedSafetyHistory(oldSafety = 2.5) {
  const corners = SAFETY_SEED_CORNERS;
  return [{ corners, incidentPoints:round(corners / cpiFromSafety(oldSafety), 3), source:'migration-v3' }];
}

function trimCornerWindow(entries, maximum = SAFETY_WINDOW_CORNERS) {
  const newestFirst = [...(entries || [])].reverse();
  const kept = []; let remaining = maximum;
  for (const entry of newestFirst) {
    if (remaining <= 0) break;
    const corners = Math.max(0, finite(entry.corners));
    if (!corners) {
      if (remaining > 0 && finite(entry.incidentPoints) > 0) kept.push({ ...entry, corners:0 });
      continue;
    }
    const used = Math.min(corners, remaining); const ratio = used / corners;
    kept.push({ ...entry, corners:round(used, 3), incidentPoints:round(Math.max(0, finite(entry.incidentPoints)) * ratio, 3) });
    remaining -= used;
  }
  return kept.reverse();
}

function sessionMultiplier(sessionType) {
  const type = String(sessionType || 'RACE').trim().toUpperCase();
  return ({ PRACTICE:0.35, WARMUP:0.5, QUALIFY:0.5, QUALIFYING:0.5, TIME_TRIAL:0.35, RACE:1, SPRINT:1, FEATURE:1 })[type] ?? 1;
}

function updateSafety(history, oldSafety, event = {}) {
  const previous = Array.isArray(history) && history.length ? history : seedSafetyHistory(oldSafety);
  const multiplier = clamp(finite(event.sessionMultiplier, sessionMultiplier(event.sessionType)), 0, 1.5);
  const rawCorners = Math.max(0, finite(event.corners));
  const corners = rawCorners * multiplier;
  const effectiveIncidents = Math.max(0, finite(event.incidentPoints)) * multiplier;
  const next = trimCornerWindow([...previous, {
    corners:round(corners, 3), rawCorners:round(rawCorners, 3), incidentPoints:round(effectiveIncidents, 3), rawIncidentPoints:round(Math.max(0, finite(event.incidentPoints)), 3),
    multiplier, at:event.at || new Date().toISOString(), source:event.source || 'race'
  }]);
  const totals = next.reduce((accumulator, item) => ({ corners:accumulator.corners + finite(item.corners), incidents:accumulator.incidents + finite(item.incidentPoints) }), { corners:0, incidents:0 });
  const cpi = totals.incidents > 0 ? totals.corners / totals.incidents : Math.max(300, totals.corners);
  const safety = safetyFromCpi(cpi);
  return {
    history:next, oldSafety:round(finite(oldSafety, 2.5), 2), safety,
    delta:round(safety - finite(oldSafety, 2.5), 2), cpi:round(cpi, 2),
    windowCorners:Math.round(totals.corners), windowIncidents:round(totals.incidents, 2), multiplier
  };
}

function incidentPoints(event = {}) {
  if (event.incidentPoints !== undefined && event.incidentPoints !== null && event.incidentPoints !== '') {
    return round(Math.max(0, finite(event.incidentPoints)) + Math.max(0, finite(event.stewardIncidentPoints)), 2);
  }
  const detailed = finite(event.offTracks) + 2 * finite(event.lossOfControl) + 2 * finite(event.lightContacts) + 4 * finite(event.heavyContacts);
  if (detailed > 0) return round(detailed + Math.max(0, finite(event.stewardIncidentPoints)), 2);
  return round(Math.max(0, finite(event.incidents)) + Math.max(0, finite(event.stewardIncidentPoints)), 2);
}

function updateReliability(history, event = {}) {
  const previous = Array.isArray(history) ? history : [];
  if (event.serverFailure || event.didNotStart || (event.disconnected && !event.rageQuit)) {
    const earned = previous.reduce((sum, item) => sum + clamp(finite(item.score), 0, 1), 0);
    return { history:previous, reliability:Math.round((9 + earned) / (10 + previous.length) * 100),
      starts:previous.length, completed:previous.filter(item => finite(item.score) >= 1).length,
      excluded:true, reason:event.serverFailure ? 'Falha do servidor' : event.didNotStart ? 'Não largou' : 'Desconexão sem abandono confirmado' };
  }
  const score = event.noShow ? 0 : event.disconnected || event.rageQuit ? 0 : event.dnf ? 0.5 : 1;
  const next = [...previous, { score, at:event.at || new Date().toISOString(), status:event.status || (score === 1 ? 'finished' : score === 0 ? 'disconnected' : 'dnf') }].slice(-RELIABILITY_WINDOW);
  const earned = next.reduce((sum, item) => sum + clamp(finite(item.score), 0, 1), 0);
  const reliability = Math.round((9 + earned) / (10 + next.length) * 100);
  return { history:next, reliability, starts:next.length, completed:next.filter(item => finite(item.score) >= 1).length };
}

function contactBadge({ cpi = 0, starts = 0, reliability = 90 } = {}) {
  const races = Math.max(0, Math.round(finite(starts)));
  const cleanRate = Math.max(0, finite(cpi));
  const reliable = clamp(finite(reliability, 90), 0, 100);
  if (races < 5) return 'Rookie';
  if (races >= 12 && cleanRate < 8) return 'Probation';
  if (races >= 8 && cleanRate < 15) return 'Warning';
  if (races >= 20 && cleanRate >= 100 && reliable >= 95) return 'Trusted';
  if (races >= 10 && cleanRate >= 45 && reliable >= 85) return 'Good';
  return 'Rookie';
}

const LICENSE_ORDER = ['R','D','C','B','A','S'];
const LICENSE_RULES = {
  R:{ safety:3, mpr:4 }, D:{ safety:3.5, mpr:4 }, C:{ safety:3.5, mpr:6 },
  B:{ safety:3.75, mpr:8 }, A:{ safety:4, mpr:10 }
};

function nextLicense(current, safety, mpr = 0, options = {}) {
  let index = Math.max(0, LICENSE_ORDER.indexOf(String(current || 'R').toUpperCase()));
  let nextMpr = Math.max(0, Math.round(finite(mpr))) + (options.mprEligible === false ? 0 : 1);
  let reason = 'maintained';
  if (index > 0 && finite(safety) < 1) {
    index -= 1; nextMpr = 0; reason = 'demoted';
  } else if (index < LICENSE_ORDER.length - 1) {
    const rule = LICENSE_RULES[LICENSE_ORDER[index]];
    if (finite(safety) >= rule.safety && nextMpr >= rule.mpr) {
      index += 1; nextMpr = 0; reason = 'promoted';
    } else if (finite(safety) < 2) reason = 'at-risk';
  }
  const nextRule = LICENSE_RULES[LICENSE_ORDER[index]] || null;
  return { license:LICENSE_ORDER[index], mpr:nextMpr, reason, targetSafety:nextRule?.safety ?? null, targetMpr:nextRule?.mpr ?? null };
}

function seedSafetyProfile(oldSafety = 2.5, license = 'R', mpr = 0) {
  return {
    rating:round(clamp(finite(oldSafety, 2.5), 0, 4.99), 2), license:String(license || 'R').toUpperCase(),
    mpr:Math.max(0, Math.round(finite(mpr))), history:seedSafetyHistory(oldSafety), cpi:round(cpiFromSafety(oldSafety), 2),
    badge:'Rookie', starts:0, version:VERSION
  };
}

function normalizeSafetyProfile(raw, oldSafety = 2.5, license = 'R', mpr = 0) {
  if (!raw || typeof raw !== 'object') return seedSafetyProfile(oldSafety, license, mpr);
  const legacyRating = round(clamp(finite(raw.rating, oldSafety), 0, 4.99), 2);
  const history = Array.isArray(raw.history) && raw.history.length ? trimCornerWindow(raw.history) : seedSafetyHistory(legacyRating);
  const totals = history.reduce((sum,item) => ({ corners:sum.corners + finite(item.corners), incidents:sum.incidents + finite(item.incidentPoints) }), { corners:0, incidents:0 });
  const cpi = totals.incidents > 0 ? totals.corners / totals.incidents : Math.max(300, totals.corners);
  const rating = raw.version === VERSION ? safetyFromCpi(cpi) : legacyRating;
  return {
    rating, license:String(raw.license || license || 'R').toUpperCase(), mpr:Math.max(0,Math.round(finite(raw.mpr,mpr))),
    history, cpi:round(cpi,2), badge:String(raw.badge || 'Rookie'), starts:Math.max(0,Math.round(finite(raw.starts))), version:VERSION
  };
}

function championshipPoints(position, status, strengthOfField, fieldSize) {
  const base = [25,18,15,12,10,8,6,4,2,1][Math.max(0, Math.round(finite(position, 999)) - 1)] || 0;
  if (!base || ['dnf','dsq','dns'].includes(String(status || '').toLowerCase())) return 0;
  const strengthFactor = clamp(finite(strengthOfField, 1600) / 1600, 0.75, 1.35);
  const fieldFactor = clamp(Math.sqrt(Math.max(1, finite(fieldSize)) / 10), 0.6, 1.4);
  return Math.max(1, Math.round(base * strengthFactor * fieldFactor));
}

module.exports = {
  VERSION,
  constants:{ INITIAL_SIGMA, MIN_SIGMA, TAU, DISPLAY_BASE, DISPLAY_SCALE, DISPLAY_MIN, DISPLAY_MAX, PROVISIONAL_RACES, SAFETY_WINDOW_CORNERS, SAFETY_SEED_CORNERS, RELIABILITY_WINDOW },
  clamp, disciplineFor, ordinal, displayRating, seedSkillProfile, normalizeSkillProfile, primaryDiscipline,
  winProbability, updateSkillGrid, safetyFromCpi, cpiFromSafety, seedSafetyHistory, trimCornerWindow,
  sessionMultiplier, updateSafety, incidentPoints, updateReliability, contactBadge, nextLicense,
  seedSafetyProfile, normalizeSafetyProfile, championshipPoints
};
