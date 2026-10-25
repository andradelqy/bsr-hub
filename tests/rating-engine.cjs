const assert = require('node:assert/strict');
const Rating = require('../cloud/rating-engine');

assert.equal(Rating.VERSION, 'bsr-rating-v3.1.0');
assert.equal(Rating.seedSkillProfile(1842).display, 1842, 'migration must preserve the visible rating');
assert.equal(Rating.normalizeSkillProfile({ ...Rating.seedSkillProfile(1911), version:'bsr-rating-v2.0.0' }, 1600).display, 1911);
assert.equal(Rating.disciplineFor('Formula 3'), 'formula');
assert.equal(Rating.disciplineFor('NASCAR Cup'), 'oval');
assert.equal(Rating.disciplineFor('GT3'), 'road');
assert.equal(Rating.primaryDiscipline({ road:{ races:0 }, formula:{ races:2 } }, 'road'), 'formula');
assert.equal(Rating.primaryDiscipline({ road:{ races:2 }, formula:{ races:2 } }, 'road'), 'road');

const grid = Array.from({ length:10 }, (_, index) => ({ id:`driver-${index + 1}`, legacyRating:1600, rank:index + 1 }));
const updated = Rating.updateSkillGrid(grid, { eventAt:'2026-10-01T00:00:00Z' });
assert.equal(updated.length, 10);
assert.ok(updated[0].delta > 0, 'winner should gain rating');
assert.ok(updated.at(-1).delta < 0, 'last place should lose rating');
assert.equal(updated.reduce((sum, row) => sum + row.delta, 0), 0, 'rating transfers must be exactly zero-sum after rounding');
assert.ok(updated.every(row => row.after.races === 1 && row.after.version === Rating.VERSION));
for (let index = 1; index < updated.length; index += 1) assert.ok(updated[index - 1].delta >= updated[index].delta, 'equal drivers must receive monotonic deltas by finish');

const favoriteWins = Rating.updateSkillGrid([
  { id:'favorite', legacyRating:2200, rank:1 },
  { id:'underdog', legacyRating:1200, rank:2 }
]);
const underdogWins = Rating.updateSkillGrid([
  { id:'favorite', legacyRating:2200, rank:2 },
  { id:'underdog', legacyRating:1200, rank:1 }
]);
assert.ok(underdogWins[1].delta > favoriteWins[0].delta, 'an upset must be worth more than an expected win');
assert.equal(underdogWins[0].delta + underdogWins[1].delta, 0);

let establishedA = Rating.seedSkillProfile(1600); let establishedB = Rating.seedSkillProfile(1600);
for (let race = 0; race < 12; race += 1) {
  const pair = Rating.updateSkillGrid([{ profile:establishedA, rank:1 }, { profile:establishedB, rank:2 }], { eventAt:`2026-09-${String(race + 1).padStart(2,'0')}T00:00:00Z` });
  establishedA = pair[0].after; establishedB = pair[1].after;
}
const establishedDelta = Rating.updateSkillGrid([{ profile:establishedA, rank:2 }, { profile:establishedB, rank:1 }])[0].delta;
const provisionalDelta = Rating.updateSkillGrid([{ legacyRating:establishedA.display, rank:2 }, { legacyRating:establishedB.display, rank:1 }])[0].delta;
assert.ok(Math.abs(provisionalDelta) > Math.abs(establishedDelta), 'provisional ratings must react more strongly than established profiles');

assert.equal(Rating.incidentPoints({ offTracks:2, lossOfControl:1, lightContacts:1, heavyContacts:1 }), 10);
assert.equal(Rating.incidentPoints({ incidentPoints:3, heavyContacts:4, stewardIncidentPoints:2 }), 5, 'reviewed total overrides automatic breakdown');
assert.equal(Rating.sessionMultiplier('TIME_TRIAL'), 0.35);
assert.equal(Rating.sessionMultiplier('RACE'), 1);

const seededSafety = Rating.seedSafetyProfile(2.5, 'R', 0);
assert.equal(seededSafety.rating, 2.5);
assert.equal(seededSafety.license, 'R');
const clean = Rating.updateSafety(seededSafety.history, seededSafety.rating, { corners:500, incidentPoints:0, sessionType:'RACE', at:'2026-01-01T00:00:00Z' });
const dirty = Rating.updateSafety(clean.history, clean.safety, { corners:300, incidentPoints:20, sessionType:'RACE', at:'2026-01-02T00:00:00Z' });
assert.ok(clean.safety > 2.5, 'a clean run should improve safety');
assert.ok(dirty.safety < clean.safety, 'a dirty run should lower safety');
let safety = dirty;
for (let index = 0; index < 12; index += 1) safety = Rating.updateSafety(safety.history, safety.safety, { corners:300, incidentPoints:1, at:`2026-02-${String(index + 1).padStart(2, '0')}T00:00:00Z` });
assert.ok(safety.windowCorners <= Rating.constants.SAFETY_WINDOW_CORNERS, 'safety must use only the recent corner window');
assert.equal(Rating.updateSafety([], 2.5, { corners:100, incidentPoints:4, sessionType:'TIME_TRIAL' }).multiplier, 0.35);
const raceInfluence = Rating.updateSafety(seededSafety.history, seededSafety.rating, { corners:300, incidentPoints:0, sessionType:'RACE' });
const qualifyingInfluence = Rating.updateSafety(seededSafety.history, seededSafety.rating, { corners:300, incidentPoints:0, sessionType:'QUALIFY' });
assert.ok(Math.abs(qualifyingInfluence.delta) < Math.abs(raceInfluence.delta), 'session weight must reduce influence without distorting the session CPI');
for (const value of [0.5, 1.5, 2.5, 3.5, 4.5]) {
  assert.ok(Math.abs(Rating.safetyFromCpi(Rating.cpiFromSafety(value)) - value) <= 0.01, `SR/CPI conversion should remain stable at ${value}`);
}

let reliability = { history:[] };
for (let index = 0; index < 25; index += 1) reliability = Rating.updateReliability(reliability.history, { disconnected:index % 5 === 0, rageQuit:index % 5 === 0 });
assert.equal(reliability.history.length, 20);
assert.ok(reliability.reliability >= 70 && reliability.reliability <= 95);
assert.deepEqual(Rating.updateReliability(reliability.history, { disconnected:true }).history, reliability.history);
assert.deepEqual(Rating.updateReliability(reliability.history, { serverFailure:true }).history, reliability.history);
const openingLapCrash = Rating.updateSafety(seededSafety.history, seededSafety.rating, { corners:0, incidentPoints:4 });
assert.ok(openingLapCrash.safety < seededSafety.rating, 'first-lap incidents must count even without a completed lap');
assert.equal(Rating.contactBadge({ cpi:120, starts:25, reliability:98 }), 'Trusted');
assert.equal(Rating.contactBadge({ cpi:6, starts:15, reliability:60 }), 'Probation');
assert.equal(Rating.contactBadge({ cpi:200, starts:3, reliability:100 }), 'Rookie', 'badges require a sustained history');

assert.deepEqual(Rating.nextLicense('R', 3.2, 3, { mprEligible:true }), { license:'D', mpr:0, reason:'promoted', targetSafety:3.5, targetMpr:4 });
assert.equal(Rating.nextLicense('D', 3.8, 3, { mprEligible:false }).mpr, 3, 'invalid sessions must not advance MPR');
assert.equal(Rating.nextLicense('C', 0.9, 5, { mprEligible:true }).license, 'D', 'only critically low SR causes immediate demotion');
assert.equal(Rating.nextLicense('C', 1.5, 5, { mprEligible:true }).license, 'C');
assert.ok(Rating.championshipPoints(1, 'finished', 2200, 30) > Rating.championshipPoints(1, 'finished', 1200, 5));
assert.equal(Rating.championshipPoints(1, 'dnf', 2200, 30), 0);

// Simulação determinística de uma temporada extensa: valida conservação,
// limites, incerteza e ausência de NaN em grids de tamanhos variados.
let randomState = 0x425352;
const random = () => {
  randomState = (1664525 * randomState + 1013904223) >>> 0;
  return randomState / 0x100000000;
};
const simulated = Array.from({ length:32 }, (_, index) => Rating.seedSkillProfile(600 + index * 250));
for (let race = 0; race < 500; race += 1) {
  const selected = simulated.map((profile, index) => ({ profile, index, key:random() }))
    .sort((left, right) => left.key - right.key)
    .slice(0, 2 + Math.floor(random() * 23));
  const finish = selected.map(item => ({ ...item, key:random() })).sort((left, right) => left.key - right.key);
  const rankByIndex = new Map(finish.map((item, index) => [item.index, index + 1]));
  const beforeTotal = selected.reduce((sum, item) => sum + item.profile.display, 0);
  const result = Rating.updateSkillGrid(selected.map(item => ({ profile:item.profile, rank:rankByIndex.get(item.index) })), { eventAt:new Date(Date.UTC(2025, 0, race + 1)).toISOString() });
  const afterTotal = result.reduce((sum, item) => sum + item.after.display, 0);
  assert.equal(afterTotal, beforeTotal, `race ${race} must conserve the grid rating pool`);
  result.forEach((item, index) => {
    assert.ok(Number.isFinite(item.after.mu) && Number.isFinite(item.after.sigma) && Number.isFinite(item.after.display));
    assert.ok(item.after.display >= Rating.constants.DISPLAY_MIN && item.after.display <= Rating.constants.DISPLAY_MAX);
    assert.ok(item.after.sigma >= Rating.constants.MIN_SIGMA && item.after.sigma <= Rating.constants.INITIAL_SIGMA);
    simulated[selected[index].index] = item.after;
  });
}

console.log('BSR Rating v3 fairness, Safety and license checks passed.');
