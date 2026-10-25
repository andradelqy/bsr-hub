/*
 * BSR Racing Hub — Back4App Cloud Code
 * Publique este arquivo em Cloud Code > main.js no Back4App.
 * Crie uma Role chamada "admin" e associe os usuários administrativos a ela.
 */

const crypto = require('crypto');
const RatingEngine = require('./rating-engine');
const RatingPolicy = require('./rating-policy');
const RatingPublication = require('./rating-publication')(Parse);
const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const DEFAULT_STEAM_CALLBACK = 'https://bsrracing2.netlify.app/steam_callback.html';

async function requireUser(request) {
  if (!request.user) throw new Parse.Error(Parse.Error.SESSION_MISSING, 'Sessão obrigatória.');
  return request.user;
}

async function userHasRole(user, roleName) {
  if (!user) return false;
  const roleQuery = new Parse.Query(Parse.Role);
  roleQuery.equalTo('name', roleName);
  const role = await roleQuery.first({ useMasterKey: true });
  if (!role) return false;
  const memberQuery = role.getUsers().query();
  memberQuery.equalTo('objectId', user.id);
  return Boolean(await memberQuery.first({ useMasterKey: true }));
}

async function requireAdmin(request) {
  const user = await requireUser(request);
  if (!(await userHasRole(user, 'admin'))) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Permissão administrativa necessária.');
  }
  return user;
}

const HUB_ACCESS_POLICY_KEY = 'primary';

async function hubAccessPolicy() {
  const policy = await new Parse.Query('HubAccessPolicy').equalTo('key', HUB_ACCESS_POLICY_KEY).first({ useMasterKey:true });
  const mode = policy?.get('mode') === 'invite' ? 'invite' : 'open';
  return { policy, mode };
}

async function resolveHubAccess(user) {
  const { mode } = await hubAccessPolicy();
  const isAdmin = Boolean(user && await userHasRole(user, 'admin'));
  const steamId = cleanText(user?.get('steamId'), 30);
  const displayName = cleanText(user?.get('displayName') || user?.getUsername(), 100);
  if (isAdmin) return { mode, authenticated:true, allowed:true, isAdmin:true, steamId, displayName, reason:'admin' };
  if (mode === 'open') return { mode, authenticated:Boolean(user), allowed:true, isAdmin:false, steamId, displayName, reason:'open' };
  if (!user) return { mode, authenticated:false, allowed:false, isAdmin:false, steamId:'', displayName:'', reason:'login_required' };
  const grant = steamId
    ? await new Parse.Query('HubAccessGrant').equalTo('steamId', steamId).notEqualTo('enabled', false).first({ useMasterKey:true })
    : null;
  return { mode, authenticated:true, allowed:Boolean(grant), isAdmin:false, steamId, displayName, reason:grant ? 'granted' : 'not_invited' };
}

async function requireHubAccess(request) {
  if (request.master) return { mode:'open', authenticated:true, allowed:true, isAdmin:true, reason:'master' };
  const access = await resolveHubAccess(request.user);
  if (!access.allowed) {
    const code = request.user ? Parse.Error.OPERATION_FORBIDDEN : Parse.Error.SESSION_MISSING;
    throw new Parse.Error(code, request.user ? 'Seu acesso ao BSR Hub ainda não foi liberado.' : 'Entre com a Steam para acessar o BSR Hub.');
  }
  return access;
}

async function requireHubUser(request) {
  const user = await requireUser(request);
  await requireHubAccess(request);
  return user;
}

function cleanText(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function isAllowedSteamReturnTo(value) {
  let target;
  try { target = new URL(value); } catch (_) { return false; }
  const configured = process.env.STEAM_ALLOWED_CALLBACKS || DEFAULT_STEAM_CALLBACK;
  const allowed = configured.split(',').map(item => item.trim()).filter(Boolean).some(item => {
    try {
      const candidate = new URL(item);
      return target.protocol === candidate.protocol && target.host === candidate.host && target.pathname === candidate.pathname;
    } catch (_) { return false; }
  });
  const loopback = target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && ['/steam/callback', '/steam_callback.html'].includes(target.pathname);
  return allowed || loopback;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function decodeSteamXml(value) {
  return String(value || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

async function fetchSteamProfile(steamId) {
  let displayName = null;
  let avatar = null;
  try {
    const config = await Parse.Config.get({ useMasterKey: true });
    const apiKey = config.get('STEAM_API_KEY');
    if (apiKey) {
      const response = await fetchWithTimeout(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(apiKey)}&steamids=${steamId}`);
      const player = response.ok ? (await response.json())?.response?.players?.[0] : null;
      if (player?.personaname) displayName = cleanText(player.personaname, 100);
      if (player?.avatarfull) avatar = cleanText(player.avatarfull, 1000);
    }
  } catch (_) {}
  // O perfil XML público mantém o nome e o avatar funcionais mesmo quando a
  // STEAM_API_KEY ainda não foi cadastrada no Parse Config.
  if (!displayName || !avatar) {
    try {
      const response = await fetchWithTimeout(`https://steamcommunity.com/profiles/${steamId}/?xml=1`);
      const xml = response.ok ? await response.text() : '';
      const nameMatch = xml.match(/<steamID>([\s\S]*?)<\/steamID>/i);
      const avatarMatch = xml.match(/<avatarFull>([\s\S]*?)<\/avatarFull>/i);
      if (!displayName && nameMatch) displayName = cleanText(decodeSteamXml(nameMatch[1]), 100);
      if (!avatar && avatarMatch) avatar = cleanText(decodeSteamXml(avatarMatch[1]), 1000);
    } catch (_) {}
  }
  return { displayName, avatar };
}

function isPlaceholderDriverName(value) {
  const name = cleanText(value, 100);
  return !name || /^piloto(?:[_\s-]*\d+)?$/i.test(name) || /^driver(?:[_\s-]*\d+)?$/i.test(name) || name.toLowerCase() === 'piloto não identificado';
}

function firstNumber(values, fallback = 0) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return fallback;
}

function normalizedDriverValues(driver) {
  const irating = Math.round(firstNumber([driver.get('irating'), driver.get('iRating'), driver.get('rating')], 1600));
  const skillRatings = driver.get('skillRatings') || {};
  const primaryDiscipline = cleanText(driver.get('primaryDiscipline') || 'road', 20).toLowerCase();
  const primarySkill = RatingEngine.normalizeSkillProfile(skillRatings[primaryDiscipline], irating);
  const safetyRatings = driver.get('safetyRatings') || {};
  const legacySafety = Math.round(firstNumber([driver.get('safetyRating'), driver.get('safety'), driver.get('sr')], 2.5) * 100) / 100;
  const legacyLicense = cleanText(driver.get('licenseClass') || driver.get('license') || 'R', 8).toUpperCase();
  const primarySafety = RatingEngine.normalizeSafetyProfile(safetyRatings[primaryDiscipline], legacySafety, legacyLicense, driver.get('licenseMPR'));
  return {
    irating:primarySkill.display,
    safetyRating:primarySafety.rating,
    licenseClass:primarySafety.license,
    totalRaces:Math.max(0, Math.round(firstNumber([driver.get('totalRaces'), driver.get('races')], 0))),
    totalCorners:Math.max(0, Math.round(firstNumber([driver.get('totalCorners')], 0))),
    totalIncidents:Math.max(0, Math.round(firstNumber([driver.get('totalIncidents')], 0))),
    skillRatings,
    safetyRatings,
    primaryDiscipline,
    ratingConfidence:Math.round(firstNumber([driver.get('ratingConfidence'), primarySkill.confidence], primarySkill.confidence)),
    ratingProvisional:driver.get('ratingProvisional') !== undefined ? Boolean(driver.get('ratingProvisional')) : primarySkill.provisional,
    reliability:Math.round(firstNumber([driver.get('reliability')], 90)),
    reliabilityStarts:Math.max(0, Math.round(firstNumber([driver.get('reliabilityStarts')], 0))),
    reliabilityCompleted:Math.max(0, Math.round(firstNumber([driver.get('reliabilityCompleted')], 0))),
    contactBadge:cleanText(driver.get('contactBadge') || primarySafety.badge || 'Rookie', 20),
    safetyCpi:Math.round(firstNumber([driver.get('safetyCpi'), primarySafety.cpi], primarySafety.cpi) * 100) / 100,
    licenseMPR:primarySafety.mpr,
    ratingVersion:cleanText(driver.get('ratingVersion') || RatingEngine.VERSION, 40)
  };
}

function driverDTO(driver, includePrivate = false) {
  const values = normalizedDriverValues(driver);
  const dto = {
    objectId:driver.id, name:driver.get('customDisplayName') || driver.get('steamName') || driver.get('name') || 'Piloto BSR',
    steamName:driver.get('steamName'), customDisplayName:driver.get('customDisplayName'), bio:driver.get('bio'), location:driver.get('location'),
    favoriteCar:driver.get('favoriteCar'), favoriteTrack:driver.get('favoriteTrack'), customAvatar:driver.get('customAvatar'), steamAvatar:driver.get('steamAvatar'),
    ...values, driverRank:driver.get('driverRank') || values.licenseClass, points:firstNumber([driver.get('points')], 0)
  };
  if (includePrivate) dto.steamGUID = driver.get('steamGUID') || driver.get('steamId');
  return dto;
}

async function saveAllBatched(objects, size = 50) {
  const unique = [...new Map((objects || []).filter(Boolean).map(object => [`${object.className}:${object.id || object.cid}`, object])).values()];
  for (let index = 0; index < unique.length; index += size) await Parse.Object.saveAll(unique.slice(index, index + size), { useMasterKey:true });
}

async function findSteamDrivers(steamId, user) {
  const byGuid = new Parse.Query('Driver'); byGuid.equalTo('steamGUID', steamId);
  const byLegacyId = new Parse.Query('Driver'); byLegacyId.equalTo('steamId', steamId);
  const drivers = await Parse.Query.or(byGuid, byLegacyId).limit(1000).find({ useMasterKey:true });
  const linked = user?.get('driver');
  if (linked?.id && !drivers.some(driver => driver.id === linked.id)) {
    const full = await new Parse.Query('Driver').get(linked.id, { useMasterKey:true }).catch(() => null);
    if (full) drivers.push(full);
  }
  return drivers;
}

async function reconcileSteamDriver(steamId, user = null, profile = {}, force = false) {
  const linked = user?.get('driver');
  if (!force && linked?.id) {
    const current = await new Parse.Query('Driver').get(linked.id, { useMasterKey:true }).catch(() => null);
    if (current?.get('identityVersion') === 2 && String(current.get('steamGUID') || current.get('steamId')) === steamId) return current;
  }
  let drivers = await findSteamDrivers(steamId, user);
  if (!drivers.length) drivers = [new Parse.Object('Driver')];

  const resultBySteam = new Parse.Query('RaceResult'); resultBySteam.equalTo('steamGUID', steamId);
  const persistedDrivers = drivers.filter(driver => driver.id);
  let resultsQuery = resultBySteam;
  if (persistedDrivers.length) {
    const resultByPointer = new Parse.Query('RaceResult'); resultByPointer.containedIn('driver', persistedDrivers);
    resultsQuery = Parse.Query.or(resultByPointer, resultBySteam);
  }
  const results = await resultsQuery.descending('createdAt').limit(1000).find({ useMasterKey:true }).catch(() => []);
  const resultCounts = new Map();
  results.forEach(result => { const id = result.get('driver')?.id; if (id) resultCounts.set(id, (resultCounts.get(id) || 0) + 1); });
  const linkedId = linked?.id;
  const score = driver => {
    const values = normalizedDriverValues(driver);
    const usefulName = !isPlaceholderDriverName(driver.get('customDisplayName') || driver.get('steamName') || driver.get('name'));
    return (resultCounts.get(driver.id) || 0) * 100000 + values.totalRaces * 1000 + (usefulName ? 100 : 0) + (driver.id === linkedId ? 10 : 0) + Math.abs(values.irating - 1600);
  };
  drivers.sort((a,b) => score(b) - score(a));
  const canonical = drivers[0];
  const canonicalValues = normalizedDriverValues(canonical);
  const maxValues = drivers.reduce((best, driver) => {
    const values = normalizedDriverValues(driver);
    return {
      totalRaces:Math.max(best.totalRaces, values.totalRaces), totalCorners:Math.max(best.totalCorners, values.totalCorners),
      totalIncidents:Math.max(best.totalIncidents, values.totalIncidents)
    };
  }, canonicalValues);
  const bestNamed = drivers.find(driver => !isPlaceholderDriverName(driver.get('customDisplayName') || driver.get('steamName') || driver.get('name')));
  const steamName = cleanText(profile.displayName || canonical.get('steamName') || bestNamed?.get('steamName') || bestNamed?.get('name'), 100);
  const customDisplayName = drivers.map(driver => driver.get('customDisplayName')).find(Boolean) || null;
  const publicName = customDisplayName || steamName || cleanText(bestNamed?.get('name'), 100) || `Piloto_${steamId.slice(-6)}`;
  const newestResult = results[0];
  const hasCanonicalIR = canonical.get('irating') !== undefined || canonical.get('iRating') !== undefined || canonical.get('rating') !== undefined;
  const hasCanonicalSR = canonical.get('safetyRating') !== undefined || canonical.get('safety') !== undefined || canonical.get('sr') !== undefined;
  canonical.set({
    steamGUID:steamId, steamName:steamName || null, name:publicName,
    steamAvatar:profile.avatar || canonical.get('steamAvatar') || drivers.map(driver => driver.get('steamAvatar')).find(Boolean) || null,
    customDisplayName,
    customAvatar:drivers.map(driver => driver.get('customAvatar')).find(Boolean) || null,
    bio:drivers.map(driver => driver.get('bio')).find(Boolean) || '', location:drivers.map(driver => driver.get('location')).find(Boolean) || '',
    favoriteCar:drivers.map(driver => driver.get('favoriteCar')).find(Boolean) || '', favoriteTrack:drivers.map(driver => driver.get('favoriteTrack')).find(Boolean) || '',
    irating:hasCanonicalIR ? canonicalValues.irating : firstNumber([newestResult?.get('newIRating')], canonicalValues.irating),
    safetyRating:hasCanonicalSR ? canonicalValues.safetyRating : firstNumber([newestResult?.get('newSafetyRating')], canonicalValues.safetyRating),
    licenseClass:canonicalValues.licenseClass, driverRank:canonical.get('driverRank') || canonicalValues.licenseClass,
    totalRaces:Math.max(maxValues.totalRaces, results.length), totalCorners:maxValues.totalCorners, totalIncidents:maxValues.totalIncidents,
    identityVersion:2, identityReconciledAt:new Date(), hiddenFromPublic:false
  });
  if (user) canonical.set('user', user);
  await canonical.save(null, { useMasterKey:true });

  const canonicalName = canonical.get('name');
  const changedResults = results.filter(result => result.get('driver')?.id !== canonical.id || result.get('driverName') !== canonicalName);
  changedResults.forEach(result => result.set({ driver:canonical, driverName:canonicalName, steamGUID:steamId }));
  await saveAllBatched(changedResults);

  const standingByPointer = new Parse.Query('ChampionshipStandings'); standingByPointer.containedIn('driver', drivers);
  const standingBySteam = new Parse.Query('ChampionshipStandings'); standingBySteam.equalTo('steamGUID', steamId);
  const standings = await Parse.Query.or(standingByPointer, standingBySteam).limit(1000).find({ useMasterKey:true }).catch(() => []);
  standings.forEach(row => row.set({ driver:canonical, driverId:canonical.id, driverName:canonicalName, steamGUID:steamId }));
  await saveAllBatched(standings);

  const users = await new Parse.Query(Parse.User).equalTo('steamId', steamId).limit(20).find({ useMasterKey:true }).catch(() => []);
  users.forEach(account => account.set('driver', canonical));
  if (user && !users.some(account => account.id === user.id)) { user.set('driver', canonical); users.push(user); }
  await saveAllBatched(users);

  const duplicates = drivers.filter(driver => driver.id && driver.id !== canonical.id);
  duplicates.forEach(driver => driver.set({ mergedInto:canonical, hiddenFromPublic:true, identityVersion:2, identityReconciledAt:new Date() }));
  await saveAllBatched(duplicates);
  return canonical;
}

async function repairDriverIdentityBatch(limit = 12) {
  const drivers = await new Parse.Query('Driver').ascending('createdAt').limit(1000).find({ useMasterKey:true });
  const steamIds = [...new Set(drivers.filter(driver => !driver.get('hiddenFromPublic') && isPlaceholderDriverName(driver.get('customDisplayName') || driver.get('steamName') || driver.get('name')))
    .map(driver => cleanText(driver.get('steamGUID') || driver.get('steamId'), 30)).filter(Boolean))];
  const selected = steamIds.slice(0, Math.max(1, Math.min(Number(limit) || 12, 25)));
  const repaired = [];
  for (let index = 0; index < selected.length; index += 4) {
    const batch = selected.slice(index, index + 4);
    const outcomes = await Promise.all(batch.map(async steamId => {
      const profile = await fetchSteamProfile(steamId);
      if (!profile.displayName) return { steamId, repaired:false, reason:'Steam não retornou o perfil' };
      const user = await new Parse.Query(Parse.User).equalTo('steamId', steamId).first({ useMasterKey:true }).catch(() => null);
      const driver = await reconcileSteamDriver(steamId, user, profile, true);
      return { steamId, repaired:true, driverId:driver.id, name:driver.get('name') };
    }));
    repaired.push(...outcomes);
  }
  return { processed:repaired.length, repaired:repaired.filter(item => item.repaired).length, remaining:Math.max(0, steamIds.length - selected.length), items:repaired };
}

Parse.Cloud.define('repairDriverIdentities', async request => {
  await requireAdmin(request);
  return repairDriverIdentityBatch(request.params.limit);
});

Parse.Cloud.job('repairDriverIdentities', async request => {
  const totals = { processed:0, repaired:0, remaining:0, items:[] };
  for (let batch = 0; batch < 20; batch += 1) {
    const result = await repairDriverIdentityBatch(request.params?.limit || 20);
    totals.processed += result.processed;
    totals.repaired += result.repaired;
    totals.remaining = result.remaining;
    totals.items.push(...result.items);
    if (!result.remaining || !result.repaired) break;
  }
  if (typeof request.message === 'function') request.message(`Identidades reparadas: ${totals.repaired}; restantes: ${totals.remaining}.`);
  return totals;
});

Parse.Cloud.define('beginSteamAuth', async request => {
  const ip = cleanText(request.ip, 100);
  const ipHash = ip ? hashToken(ip) : null;
  if (ipHash) {
    const recent = new Parse.Query('AuthChallenge');
    recent.equalTo('ipHash', ipHash); recent.greaterThan('createdAt', new Date(Date.now() - 10 * 60 * 1000));
    if (await recent.count({ useMasterKey: true }) >= 10) throw new Parse.Error(155, 'Muitas tentativas de login. Aguarde alguns minutos.');
  }
  const state = crypto.randomBytes(32).toString('base64url');
  const challenge = new Parse.Object('AuthChallenge');
  challenge.set({ stateHash: hashToken(state), provider: 'steam', expiresAt: new Date(Date.now() + 5 * 60 * 1000), used: false, ...(ipHash ? { ipHash } : {}) });
  challenge.setACL(new Parse.ACL());
  await challenge.save(null, { useMasterKey: true });
  const expired = new Parse.Query('AuthChallenge'); expired.lessThan('expiresAt', new Date()); expired.limit(100);
  expired.find({ useMasterKey: true })
    .then(objects => objects.length ? Parse.Object.destroyAll(objects, { useMasterKey: true }) : null)
    .catch(() => {});
  return { state, expiresIn: 300 };
});

Parse.Cloud.define('authenticateSteam', async request => {
  const callbackUrl = cleanText(request.params.callbackUrl, 8000);
  if (!callbackUrl) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Retorno da Steam ausente.');
  let url;
  try { url = new URL(callbackUrl); } catch (_) { throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Retorno da Steam inválido.'); }
  const openId = {};
  for (const [key, value] of url.searchParams.entries()) if (key.startsWith('openid.')) openId[key] = value;
  if (!openId['openid.claimed_id'] || openId['openid.mode'] !== 'id_res') {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Autenticação Steam não concluída.');
  }
  const returnTo = openId['openid.return_to'];
  if (!isAllowedSteamReturnTo(returnTo)) throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Endereço de retorno não autorizado.');
  const returnUrl = new URL(returnTo);
  const state = cleanText(returnUrl.searchParams.get('state'), 128);
  if (!state || url.searchParams.get('state') !== state) throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Estado da autenticação inválido.');
  const challenge = await new Parse.Query('AuthChallenge').equalTo('stateHash', hashToken(state)).equalTo('provider', 'steam').first({ useMasterKey: true });
  if (!challenge || challenge.get('used') || challenge.get('expiresAt') < new Date()) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Esta tentativa de login expirou ou já foi utilizada.');
  }
  // Consome o desafio antes da chamada externa para que duas requisições concorrentes
  // nunca consigam trocar o mesmo retorno OpenID por mais de uma sessão.
  challenge.set({ used: true, usedAt: new Date() });
  await challenge.save(null, { useMasterKey: true });
  if (openId['openid.op_endpoint'] && openId['openid.op_endpoint'] !== STEAM_OPENID_ENDPOINT) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Provedor OpenID inválido.');
  }
  openId['openid.mode'] = 'check_authentication';
  const verificationBody = Object.entries(openId).map(([key,value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  const verification = await fetchWithTimeout(STEAM_OPENID_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: verificationBody
  });
  const verificationText = await verification.text();
  if (!verification.ok || !/(^|\r?\n)is_valid:true(\r?\n|$)/.test(verificationText)) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'A Steam recusou a autenticação.');
  }
  const match = String(openId['openid.claimed_id']).match(/\/openid\/id\/(\d{17})$/);
  if (!match) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'SteamID inválido.');
  if (openId['openid.identity'] && openId['openid.identity'] !== openId['openid.claimed_id']) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Identidade Steam inconsistente.');
  const steamId = match[1];
  const username = `steam:${steamId}`;
  let user = await new Parse.Query(Parse.User).equalTo('username', username).first({ useMasterKey: true });
  const temporaryPassword = crypto.randomBytes(32).toString('hex');
  if (!user) {
    user = new Parse.User();
    user.setUsername(username);
    user.set('steamId', steamId);
  }
  user.setPassword(temporaryPassword);
  user.set('lastSteamLoginAt', new Date());

  const steamProfile = await fetchSteamProfile(steamId);
  const displayName = steamProfile.displayName || `Piloto_${steamId.slice(-6)}`;
  const avatar = steamProfile.avatar;
  user.set('displayName', displayName);
  if (avatar) user.set('avatarUrl', avatar);
  await user.save(null, { useMasterKey: true });

  const driver = await reconcileSteamDriver(steamId, user, { displayName, avatar }, true);
  user.set('driver', driver);
  await user.save(null, { useMasterKey: true });

  const loggedIn = await Parse.User.logIn(username, temporaryPassword);
  return { objectId: loggedIn.id, username, sessionToken: loggedIn.getSessionToken(), steamId, displayName, avatar, driverId: driver.id };
});

function hubAccessGrantDTO(item) {
  return {
    objectId:item.id,
    steamId:item.get('steamId'),
    label:item.get('label') || '',
    note:item.get('note') || '',
    enabled:item.get('enabled') !== false,
    updatedAt:item.updatedAt,
    createdAt:item.createdAt
  };
}

Parse.Cloud.define('getHubAccessStatus', async request => {
  const access = await resolveHubAccess(request.user);
  return {
    mode:access.mode,
    authenticated:access.authenticated,
    allowed:access.allowed,
    isAdmin:access.isAdmin,
    steamId:access.steamId,
    displayName:access.displayName,
    reason:access.reason
  };
});

Parse.Cloud.define('getHubAccessAdminContext', async request => {
  await requireAdmin(request);
  const [{ mode }, grants, drivers] = await Promise.all([
    hubAccessPolicy(),
    new Parse.Query('HubAccessGrant').ascending('label').limit(1000).find({ useMasterKey:true }),
    new Parse.Query('Driver').limit(1000).find({ useMasterKey:true })
  ]);
  const candidates = [];
  const seen = new Set();
  for (const driver of drivers) {
    const steamId = cleanText(driver.get('steamGUID') || driver.get('steamId'), 30);
    if (!/^\d{17}$/.test(steamId) || seen.has(steamId) || driver.get('hiddenFromPublic')) continue;
    seen.add(steamId);
    candidates.push({
      steamId,
      name:driver.get('customDisplayName') || driver.get('steamName') || driver.get('name') || `Piloto ${steamId.slice(-6)}`,
      avatar:driver.get('customAvatar') || driver.get('steamAvatar') || ''
    });
  }
  candidates.sort((a,b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  return { mode, grants:grants.map(hubAccessGrantDTO), candidates };
});

Parse.Cloud.define('setHubAccessMode', async request => {
  const admin = await requireAdmin(request);
  const mode = cleanText(request.params.mode, 20).toLowerCase();
  if (!['open', 'invite'].includes(mode)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Modo de acesso inválido.');
  if (mode === 'invite') {
    const activeGrants = new Parse.Query('HubAccessGrant'); activeGrants.notEqualTo('enabled', false);
    if (await activeGrants.count({ useMasterKey:true }) < 1) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Libere pelo menos um piloto antes de ativar o acesso restrito.');
    }
  }
  let policy = (await hubAccessPolicy()).policy;
  if (!policy) policy = new Parse.Object('HubAccessPolicy');
  policy.set({ key:HUB_ACCESS_POLICY_KEY, mode, updatedBy:admin, updatedAt:new Date() });
  const acl = new Parse.ACL(); acl.setRoleReadAccess('admin', true); acl.setRoleWriteAccess('admin', true); policy.setACL(acl);
  await policy.save(null, { useMasterKey:true });
  const audit = new Parse.Object('AuditLog');
  audit.set({ action:'set_hub_access_mode', target:mode, admin:admin.getUsername(), metadata:{ mode }, timestamp:new Date() });
  await audit.save(null, { useMasterKey:true });
  return { mode };
});

Parse.Cloud.define('setHubAccessGrant', async request => {
  const admin = await requireAdmin(request);
  const value = request.params.grant && typeof request.params.grant === 'object' ? request.params.grant : {};
  const steamId = cleanText(value.steamId, 30);
  if (!/^\d{17}$/.test(steamId)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Informe um SteamID64 válido com 17 dígitos.');
  let grant = await new Parse.Query('HubAccessGrant').equalTo('steamId', steamId).first({ useMasterKey:true });
  if (!grant) grant = new Parse.Object('HubAccessGrant');
  const enabled = value.enabled !== false;
  grant.set({ steamId, label:cleanText(value.label, 100), note:cleanText(value.note, 240), enabled, updatedBy:admin, updatedAt:new Date() });
  const acl = new Parse.ACL(); acl.setRoleReadAccess('admin', true); acl.setRoleWriteAccess('admin', true); grant.setACL(acl);
  await grant.save(null, { useMasterKey:true });
  const audit = new Parse.Object('AuditLog');
  audit.set({ action:enabled ? 'grant_hub_access' : 'revoke_hub_access', target:steamId, admin:admin.getUsername(), metadata:{ label:grant.get('label') }, timestamp:new Date() });
  await audit.save(null, { useMasterKey:true });
  return hubAccessGrantDTO(grant);
});

Parse.Cloud.define('getCurrentDriver', async request => {
  await RatingPublication.assertReadable();
  const user = await requireHubUser(request);
  const steamId = cleanText(user.get('steamId'), 30);
  const driver = steamId
    ? await reconcileSteamDriver(steamId, user, { displayName:user.get('displayName'), avatar:user.get('avatarUrl') })
    : user.get('driver') || await new Parse.Query('Driver').equalTo('user', user).first({ useMasterKey: true });
  if (!driver) return null;
  return driverDTO(driver, true);
});

Parse.Cloud.define('refreshSteamProfile', async request => {
  const user = await requireHubUser(request);
  const steamId = cleanText(user.get('steamId'), 30);
  if (!steamId) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Esta conta não possui uma identidade Steam vinculada.');
  const profile = await fetchSteamProfile(steamId);
  if (!profile.displayName) throw new Parse.Error(Parse.Error.CONNECTION_FAILED, 'A Steam não disponibilizou o perfil agora. Verifique se o perfil está público e tente novamente.');
  const driver = await reconcileSteamDriver(steamId, user, profile, true);
  user.set('displayName', profile.displayName);
  if (profile.avatar) user.set('avatarUrl', profile.avatar);
  await Promise.all([user.save(null, { useMasterKey:true }), driver.save(null, { useMasterKey:true })]);
  return driverDTO(driver, true);
});

Parse.Cloud.define('updateMyDriverProfile', async request => {
  const user = await requireHubUser(request);
  const driver = user.get('driver') || await new Parse.Query('Driver').equalTo('user', user).first({ useMasterKey:true });
  if (!driver) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Piloto não encontrado.');
  const profile = request.params.profile && typeof request.params.profile === 'object' ? request.params.profile : {};
  const customDisplayName = cleanText(profile.displayName, 40);
  if (customDisplayName && customDisplayName.length < 2) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'O nome público precisa ter pelo menos 2 caracteres.');
  const customAvatar = cleanText(profile.customAvatar, 1000);
  if (customAvatar && !/^https:\/\/[a-z0-9.-]+(?::\d+)?\//i.test(customAvatar)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Use uma URL HTTPS válida para o avatar.');
  driver.set({
    customDisplayName:customDisplayName || null,
    name:customDisplayName || driver.get('steamName') || user.get('displayName') || driver.get('name'),
    bio:cleanText(profile.bio, 300), location:cleanText(profile.location, 60),
    favoriteCar:cleanText(profile.favoriteCar, 80), favoriteTrack:cleanText(profile.favoriteTrack, 80),
    customAvatar:customAvatar || null, profileUpdatedAt:new Date()
  });
  await driver.save(null, { useMasterKey:true });
  return driverDTO(driver, true);
});

Parse.Cloud.define('getPublicDriverProfile', async request => {
  await RatingPublication.assertReadable();
  await requireHubAccess(request);
  const driverId = cleanText(request.params.driverId, 40);
  if (!driverId) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Piloto não informado.');
  let driver = await new Parse.Query('Driver').get(driverId, { useMasterKey:true });
  const mergedInto = driver.get('mergedInto');
  if (mergedInto?.id) driver = await new Parse.Query('Driver').get(mergedInto.id, { useMasterKey:true });
  const resultsQuery = new Parse.Query('RaceResult'); resultsQuery.equalTo('driver', driver); resultsQuery.notEqualTo('classificationStatus','voided'); resultsQuery.notEqualTo('classificationStatus','pending'); resultsQuery.descending('sessionDate'); resultsQuery.limit(12);
  const results = await resultsQuery.find({ useMasterKey:true });
  return {
    ...driverDTO(driver), results:results.map(result => ({ raceTitle:result.get('raceTitle'), track:result.get('track'),
      officialPosition:result.get('officialPosition'), classPosition:result.get('classPosition'), carClass:result.get('carClass'), carModel:result.get('carModel'),
      championshipPoints:result.get('championshipPoints'), sessionDate:result.get('sessionDate'), status:result.get('status'),
      deltaIRating:result.get('deltaIRating'), deltaSafetyRating:result.get('deltaSafetyRating'), strengthOfField:result.get('strengthOfField'),
      ratingEligible:result.get('ratingEligible'), discipline:result.get('discipline'), contactBadge:result.get('contactBadge'),
      oldLicense:result.get('oldLicense'), newLicense:result.get('newLicense'), ratingVersion:result.get('ratingVersion') }))
  };
});

Parse.Cloud.define('getPublicDrivers', async request => {
  await RatingPublication.assertReadable();
  await requireHubAccess(request);
  const query = new Parse.Query('Driver'); query.descending('irating'); query.limit(1000);
  const drivers = await query.find({ useMasterKey: true });
  const groups = new Map();
  for (const driver of drivers) {
    if (driver.get('hiddenFromPublic')) continue;
    const key = String(driver.get('steamGUID') || driver.get('steamId') || driver.id);
    const current = groups.get(key);
    const currentScore = current ? normalizedDriverValues(current).totalRaces * 1000 + (!isPlaceholderDriverName(current.get('name')) ? 100 : 0) + Math.abs(normalizedDriverValues(current).irating - 1600) : -1;
    const candidateScore = normalizedDriverValues(driver).totalRaces * 1000 + (!isPlaceholderDriverName(driver.get('customDisplayName') || driver.get('steamName') || driver.get('name')) ? 100 : 0) + Math.abs(normalizedDriverValues(driver).irating - 1600);
    if (!current || candidateScore > currentScore) groups.set(key, driver);
  }
  return [...groups.values()].map(driver => driverDTO(driver)).filter(driver => !isPlaceholderDriverName(driver.name)).sort((a,b) => b.irating - a.irating);
});

Parse.Cloud.define('getMyDriverResults', async request => {
  await RatingPublication.assertReadable();
  const user = await requireHubUser(request);
  const driver = user.get('driver') || await new Parse.Query('Driver').equalTo('user', user).first({ useMasterKey: true });
  if (!driver) return [];
  const query = new Parse.Query('RaceResult'); query.equalTo('driver', driver); query.notEqualTo('classificationStatus','voided'); query.notEqualTo('classificationStatus','pending'); query.descending('sessionDate'); query.limit(300);
  return (await query.find({ useMasterKey: true })).map(result => result.toJSON());
});

Parse.Cloud.define('getRaceResults', async request => {
  await RatingPublication.assertReadable();
  await requireHubAccess(request);
  const sessionId = cleanText(request.params.sessionId, 160);
  const raceId = cleanText(request.params.raceId, 40);
  if (!sessionId && !raceId) return [];
  const queries = [];
  if (sessionId) {
    queries.push(new Parse.Query('RaceResult').equalTo('sessionId', sessionId));
    queries.push(new Parse.Query('RaceResult').equalTo('importKey', sessionId));
  }
  if (raceId) {
    queries.push(new Parse.Query('RaceResult').equalTo('raceId', raceId));
    queries.push(new Parse.Query('RaceResult').equalTo('race', new Parse.Object('Races', { objectId:raceId })));
  }
  const query = queries.length === 1 ? queries[0] : Parse.Query.or(...queries);
  query.notEqualTo('classificationStatus', 'pending'); query.notEqualTo('classificationStatus', 'voided');
  query.include('driver'); query.limit(500);
  const results = await query.find({ useMasterKey: true });
  return results.map(result => {
    const driver = result.get('driver');
    const race = result.get('race');
    return {
      objectId: result.id,
      raceId: result.get('raceId') || race?.id || null,
      importKey: result.get('importKey'),
      race: race ? { objectId:race.id } : null,
      track: result.get('track'),
      finishPosition: result.get('finishPosition'),
      officialPosition: result.get('officialPosition'),
      classPosition: result.get('classPosition'),
      championshipPoints: result.get('championshipPoints'),
      points: result.get('points'),
      lapsCompleted: result.get('lapsCompleted'),
      carModel: result.get('carModel'),
      carClass: result.get('carClass'),
      isDNF: result.get('isDNF'),
      isDSQ: result.get('isDSQ'),
      status: result.get('status'),
      classificationStatus: result.get('classificationStatus'),
      penaltySeconds: result.get('penaltySeconds'),
      incidentPoints: result.get('incidentPoints'),
      oldIRating: result.get('oldIRating'),
      newIRating: result.get('newIRating'),
      deltaIRating: result.get('deltaIRating'),
      oldSafetyRating: result.get('oldSafetyRating'),
      newSafetyRating: result.get('newSafetyRating'),
      deltaSafetyRating: result.get('deltaSafetyRating'),
      oldReliability: result.get('oldReliability'),
      newReliability: result.get('newReliability'),
      expectedFinish: result.get('expectedFinish'),
      strengthOfField: result.get('strengthOfField'),
      ratingEligible: result.get('ratingEligible'),
      ratingReason: result.get('ratingReason'),
      discipline: result.get('discipline'),
      contactBadge: result.get('contactBadge'),
      oldLicense: result.get('oldLicense'),
      newLicense: result.get('newLicense'),
      ratingVersion: result.get('ratingVersion'),
      sessionId: result.get('sessionId'),
      heat:result.get('heat'),
      sessionDate: result.get('sessionDate'),
      createdAt: result.createdAt,
      driver: driver ? { objectId: driver.id, name: driver.get('name'), customAvatar: driver.get('customAvatar'), steamAvatar: driver.get('steamAvatar') } : null
    };
  });
});

Parse.Cloud.define('getRaceReservations', async request => {
  await requireHubAccess(request);
  const raceId = cleanText(request.params.raceId, 40);
  if (!raceId) return [];
  const query = new Parse.Query('CarReservations'); query.equalTo('raceId', raceId); query.ascending('createdAt'); query.limit(500);
  const reservations = await query.find({ useMasterKey: true });
  return reservations.map(item => ({ objectId: item.id, driverName: item.get('driverName'), carModel: item.get('carModel'), status: item.get('status'), isMine: Boolean(request.user && item.get('user')?.id === request.user.id) }));
});

Parse.Cloud.define('getPublicStandings', async request => {
  await RatingPublication.assertReadable();
  await requireHubAccess(request);
  const query = new Parse.Query('ChampionshipStandings'); query.descending('points'); query.include('driver'); query.limit(500);
  const [rows, drivers] = await Promise.all([
    query.find({ useMasterKey: true }),
    new Parse.Query('Driver').limit(1000).find({ useMasterKey: true })
  ]);
  const lookupKey = value => String(value || '').trim().toLocaleLowerCase('pt-BR');
  const visibleDrivers = drivers.filter(driver => !driver.get('hiddenFromPublic'));
  const driversById = new Map(visibleDrivers.map(driver => [driver.id, driver]));
  const driversBySteam = new Map(visibleDrivers.map(driver => [String(driver.get('steamGUID') || driver.get('steamId') || ''), driver]).filter(([key]) => key));
  const driversByName = new Map(visibleDrivers.map(driver => [lookupKey(driver.get('customDisplayName') || driver.get('steamName') || driver.get('name')), driver]).filter(([key]) => key));

  return rows.map(row => {
    const storedDriver = row.get('driver');
    const storedName = row.get('driverName') || row.get('name');
    const storedSteam = row.get('steamId') || row.get('steamGUID');
    const storedId = row.get('driverId') || row.get('driverObjectId');
    const driver = storedDriver
      || driversById.get(String(storedId || ''))
      || driversBySteam.get(String(storedSteam || ''))
      || driversByName.get(lookupKey(storedName));
    return {
      objectId: row.id,
      position: row.get('position'),
      points: row.get('points'),
      wins: row.get('wins'),
      podiums: row.get('podiums'),
      races: row.get('races'),
      championshipId: row.get('championshipId'),
      category: row.get('category'),
      driverName: driver?.get('name') || storedName || null,
      driverId: driver?.id || storedId || null,
      driver: driver ? driverDTO(driver) : null
    };
  });
});

Parse.Cloud.define('getNotifications', async request => {
  await requireHubAccess(request);
  const steamId = request.user?.get('steamId');
  const publicQuery = new Parse.Query('Notifications'); publicQuery.doesNotExist('steamGUID');
  const query = steamId ? Parse.Query.or(publicQuery, new Parse.Query('Notifications').equalTo('steamGUID', steamId)) : publicQuery;
  query.descending('timestamp'); query.limit(30);
  return (await query.find({ useMasterKey: true })).map(item => ({ objectId: item.id, title: item.get('title'), message: item.get('message'), timestamp: item.get('timestamp'), createdAt: item.createdAt, seen: item.get('seen') }));
});

Parse.Cloud.define('verifyAdminSession', async request => {
  const user = await requireUser(request);
  const isAdmin = await userHasRole(user, 'admin');
  if (!isAdmin) throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Conta sem permissão administrativa.');
  return { isAdmin: true, objectId: user.id, username: user.getUsername() };
});

const CONTENT_TYPES = new Set(['car', 'track', 'skin', 'app', 'extension', 'showroom']);

function contentPackageDTO(item, includeAdmin = false) {
  const dto = {
    objectId:item.id, slug:item.get('slug'), name:item.get('name'), version:item.get('version'), type:item.get('type'), game:item.get('game') || 'assetto-corsa',
    description:item.get('description') || '', author:item.get('author') || 'Comunidade BSR', imageUrl:item.get('imageUrl') || '', downloadUrl:item.get('downloadUrl'),
    sha256:item.get('sha256'), sizeBytes:Number(item.get('sizeBytes') || 0), targetId:item.get('targetId') || '', contentPath:item.get('contentPath') || '',
    dependencies:Array.isArray(item.get('dependencies')) ? item.get('dependencies') : [], tags:Array.isArray(item.get('tags')) ? item.get('tags') : [],
    approved:Boolean(item.get('approved')), enabled:item.get('enabled') !== false, community:Boolean(item.get('community')), updatedAt:item.updatedAt, createdAt:item.createdAt
  };
  if (includeAdmin) dto.raceIds = Array.isArray(item.get('raceIds')) ? item.get('raceIds') : [];
  return dto;
}

function normalizeContentPackage(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const slug = cleanText(value.slug, 120).toLowerCase();
  const version = cleanText(value.version, 40);
  const type = cleanText(value.type, 20).toLowerCase();
  const downloadUrl = cleanText(value.downloadUrl, 1500);
  const sha256 = cleanText(value.sha256, 64).toLowerCase();
  const sizeBytes = Number(value.sizeBytes);
  if (!/^[a-z0-9][a-z0-9_.-]{0,119}$/.test(slug) || !/^[a-z0-9][a-z0-9_.-]{0,39}$/i.test(version)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Slug ou versão inválidos.');
  if (!CONTENT_TYPES.has(type)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Tipo de conteúdo inválido.');
  if (!/^https:\/\//i.test(downloadUrl) || !/^[a-f0-9]{64}$/.test(sha256)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'URL HTTPS e SHA-256 são obrigatórios.');
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 25 * 1024 * 1024 * 1024) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Tamanho do pacote inválido.');
  const targetId = cleanText(value.targetId, 120);
  if (targetId && !/^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(targetId)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Destino inválido.');
  const contentPath = cleanText(value.contentPath, 300).replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (contentPath.split('/').some(part => part === '..')) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Caminho interno inválido.');
  return {
    slug, version, type, targetId, contentPath, downloadUrl, sha256, sizeBytes,
    name:cleanText(value.name, 120) || slug, description:cleanText(value.description, 1000), author:cleanText(value.author, 100) || 'Comunidade BSR',
    imageUrl:cleanText(value.imageUrl, 1500), game:'assetto-corsa', dependencies:Array.isArray(value.dependencies) ? value.dependencies.map(item => cleanText(item, 120).toLowerCase()).filter(item => /^[a-z0-9][a-z0-9_.-]{0,119}$/.test(item)).slice(0, 50) : [],
    tags:Array.isArray(value.tags) ? value.tags.map(item => cleanText(item, 40)).filter(Boolean).slice(0, 30) : [], approved:value.approved !== false,
    enabled:value.enabled !== false, community:Boolean(value.community)
  };
}

async function raceContentPackages(race) {
  const raceId = race.id;
  const slugs = Array.isArray(race.get('requirementSlugs')) ? race.get('requirementSlugs').map(item => cleanText(item, 120).toLowerCase()).filter(Boolean) : [];
  const byRace = new Parse.Query('ContentPackage'); byRace.equalTo('raceIds', raceId);
  let query = byRace;
  if (slugs.length) { const bySlug = new Parse.Query('ContentPackage'); bySlug.containedIn('slug', slugs); query = Parse.Query.or(byRace, bySlug); }
  query.equalTo('approved', true); query.notEqualTo('enabled', false); query.ascending('name'); query.limit(500);
  return query.find({ useMasterKey:true });
}

function contentSearchText(item) {
  return [item.get('name'), item.get('slug'), item.get('targetId'), ...(Array.isArray(item.get('tags')) ? item.get('tags') : [])]
    .map(value => cleanText(value, 160).toLowerCase()).filter(Boolean).join(' ');
}

function isSafetyCarPackage(item) {
  return /(?:^|[\s_.-])safety(?:[\s_.-]|$)|safety\s*car/i.test(contentSearchText(item));
}

function searchableTokens(value) {
  const ignored = new Set(['assetto','corsa','bsr','brasil','cup','race','racing','series','sprint','min','minutos','the','car']);
  return cleanText(value, 300).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter(token => token.length >= 3 && !ignored.has(token));
}

function inferRequestedCar(race, packages, preferredName = '') {
  const candidates = (packages || []).filter(item => item.get('type') === 'car' && /^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(cleanText(item.get('targetId'), 120)));
  if (!candidates.length) return '';
  const primary = candidates.filter(item => !isSafetyCarPackage(item));
  const pool = primary.length ? primary : candidates;
  if (pool.length === 1) return cleanText(pool[0].get('targetId'), 120);
  const wanted = searchableTokens(preferredName || race.get('title') || race.get('name'));
  if (!wanted.length) return '';
  const ranked = pool.map(item => {
    const text = searchableTokens(contentSearchText(item));
    return { item, score:wanted.reduce((score, token) => score + (text.some(part => part === token || part.includes(token) || token.includes(part)) ? 1 : 0), 0) };
  }).sort((a, b) => b.score - a.score);
  if (!ranked[0]?.score || ranked[0].score === ranked[1]?.score) return '';
  return cleanText(ranked[0].item.get('targetId'), 120);
}

const PRIMARY_SERVER_KEY = 'assetto-corsa-primary';

function serverProfileDTO(profile, fallback = null) {
  const source = profile || fallback;
  return {
    configured:Boolean(source?.get('serverHost')),
    serverHost:source?.get('serverHost') || '',
    serverPort:Number(source?.get('serverPort') || 9600),
    serverHttpPort:Number(source?.get('serverHttpPort') || 8081),
    serverPassword:source?.get('serverPassword') || '',
    updatedAt:source?.updatedAt || null
  };
}

async function primaryServerProfile() {
  return new Parse.Query('ServerProfile').equalTo('key', PRIMARY_SERVER_KEY).first({ useMasterKey:true });
}

async function ensurePrimaryServerProfile(admin) {
  let profile = await primaryServerProfile();
  if (profile) return profile;
  const legacyQuery = new Parse.Query('RaceConnection');
  legacyQuery.exists('serverHost'); legacyQuery.descending('updatedAt');
  const legacy = await legacyQuery.first({ useMasterKey:true });
  if (!legacy?.get('serverHost')) return null;
  const data = normalizeServerProfile({
    serverHost:legacy.get('serverHost'), serverPort:legacy.get('serverPort'),
    serverHttpPort:legacy.get('serverHttpPort'), serverPassword:legacy.get('serverPassword')
  });
  profile = new Parse.Object('ServerProfile');
  profile.set({ key:PRIMARY_SERVER_KEY, game:'assetto-corsa', ...data, updatedBy:admin });
  const acl = new Parse.ACL(); acl.setRoleReadAccess('admin', true); acl.setRoleWriteAccess('admin', true); profile.setACL(acl);
  await profile.save(null, { useMasterKey:true });
  const audit = new Parse.Object('AuditLog');
  audit.set({ action:'migrate_primary_server', target:profile.id, admin:admin.getUsername(), metadata:{ source:'RaceConnection', serverHost:data.serverHost }, timestamp:new Date() });
  await audit.save(null, { useMasterKey:true });
  return profile;
}

function normalizeServerProfile(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const serverHost = cleanText(value.serverHost, 253).toLowerCase();
  const serverPort = Number(value.serverPort || 9600);
  const serverHttpPort = Number(value.serverHttpPort || 8081);
  if (!serverHost || !/^[a-z0-9.-]+$/.test(serverHost)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Informe o domínio ou IP do servidor principal.');
  if (![serverPort, serverHttpPort].every(port => Number.isInteger(port) && port > 0 && port <= 65535)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Portas do servidor inválidas.');
  return { serverHost, serverPort, serverHttpPort, serverPassword:cleanText(value.serverPassword, 100) };
}

Parse.Cloud.define('getContentCatalog', async request => {
  await requireHubAccess(request);
  const query = new Parse.Query('ContentPackage'); query.equalTo('approved', true); query.notEqualTo('enabled', false); query.ascending('name'); query.limit(1000);
  return (await query.find({ useMasterKey:true })).map(item => contentPackageDTO(item));
});

Parse.Cloud.define('getRaceRequirements', async request => {
  await requireHubAccess(request);
  const raceId = cleanText(request.params.raceId, 40);
  if (!raceId) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Corrida não informada.');
  const race = await new Parse.Query('Races').get(raceId, { useMasterKey:true });
  return (await raceContentPackages(race)).map(item => contentPackageDTO(item));
});

Parse.Cloud.define('getContentAdminContext', async request => {
  await requireAdmin(request);
  const packages = new Parse.Query('ContentPackage'); packages.ascending('name'); packages.limit(1000);
  const races = new Parse.Query('Races'); races.descending('startAt'); races.limit(500);
  const connections = new Parse.Query('RaceConnection'); connections.limit(1000);
  const [content, events, privateConnections, serverProfile] = await Promise.all([packages.find({ useMasterKey:true }), races.find({ useMasterKey:true }), connections.find({ useMasterKey:true }), primaryServerProfile()]);
  const connectionByRace = new Map(privateConnections.map(item => [item.get('raceId'), item]));
  const legacyServer = privateConnections.find(item => item.get('serverHost')) || null;
  return {
    packages:content.map(item => contentPackageDTO(item, true)),
    server:serverProfileDTO(serverProfile, legacyServer),
    races:events.map(race => {
      const connection = connectionByRace.get(race.id);
      const requirementSlugs = race.get('requirementSlugs') || [];
      const required = content.filter(item => requirementSlugs.includes(item.get('slug')) || (item.get('raceIds') || []).includes(race.id));
      return { objectId:race.id, title:race.get('title') || race.get('name'), track:race.get('track'), startAt:race.get('startAt'), requirementSlugs, requestedCar:connection?.get('requestedCar') || race.get('carContentId') || inferRequestedCar(race, required) || '' };
    })
  };
});

Parse.Cloud.define('setContentServerProfile', async request => {
  const admin = await requireAdmin(request);
  const data = normalizeServerProfile(request.params.server);
  let profile = await primaryServerProfile();
  if (!profile) profile = new Parse.Object('ServerProfile');
  profile.set({ key:PRIMARY_SERVER_KEY, game:'assetto-corsa', ...data, updatedBy:admin });
  const acl = new Parse.ACL(); acl.setRoleReadAccess('admin', true); acl.setRoleWriteAccess('admin', true); profile.setACL(acl);
  await profile.save(null, { useMasterKey:true });
  const audit = new Parse.Object('AuditLog');
  audit.set({ action:'update_primary_server', target:profile.id, admin:admin.getUsername(), metadata:{ serverHost:data.serverHost, serverPort:data.serverPort, serverHttpPort:data.serverHttpPort }, timestamp:new Date() });
  await audit.save(null, { useMasterKey:true });
  return serverProfileDTO(profile);
});

Parse.Cloud.define('upsertContentPackage', async request => {
  const admin = await requireAdmin(request);
  const data = normalizeContentPackage(request.params.package);
  const objectId = cleanText(request.params.package?.objectId, 40);
  let item = objectId ? await new Parse.Query('ContentPackage').get(objectId, { useMasterKey:true }) : await new Parse.Query('ContentPackage').equalTo('slug', data.slug).first({ useMasterKey:true });
  if (!item) item = new Parse.Object('ContentPackage');
  item.set({ ...data, updatedBy:admin, publishedAt:data.approved ? new Date() : null });
  const acl = new Parse.ACL(); acl.setRoleReadAccess('admin', true); acl.setRoleWriteAccess('admin', true); item.setACL(acl);
  await item.save(null, { useMasterKey:true });
  return contentPackageDTO(item, true);
});

Parse.Cloud.define('setRaceContentConfig', async request => {
  const admin = await requireAdmin(request);
  const serverProfile = await ensurePrimaryServerProfile(admin);
  if (!serverProfile?.get('serverHost')) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Configure o servidor principal antes de salvar os requisitos da corrida.');
  }
  const raceId = cleanText(request.params.raceId, 40);
  const slugs = Array.isArray(request.params.requirementSlugs) ? [...new Set(request.params.requirementSlugs.map(item => cleanText(item, 120).toLowerCase()).filter(item => /^[a-z0-9][a-z0-9_.-]{0,119}$/.test(item)))].slice(0, 100) : [];
  const connection = request.params.connection && typeof request.params.connection === 'object' ? request.params.connection : {};
  let requestedCar = cleanText(connection.requestedCar, 120);
  if (requestedCar && !/^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(requestedCar)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Carro solicitado inválido.');
  const race = await new Parse.Query('Races').get(raceId, { useMasterKey:true });
  if (!requestedCar && slugs.length) {
    const packagesQuery = new Parse.Query('ContentPackage');
    packagesQuery.containedIn('slug', slugs); packagesQuery.equalTo('approved', true); packagesQuery.notEqualTo('enabled', false); packagesQuery.limit(100);
    requestedCar = inferRequestedCar(race, await packagesQuery.find({ useMasterKey:true }));
  }
  race.set({ requirementSlugs:slugs, contentUpdatedAt:new Date(), contentUpdatedBy:admin });
  // Credenciais nunca permanecem no objeto público da corrida.
  for (const field of ['serverHost', 'serverIp', 'serverPort', 'serverHttpPort', 'httpPort', 'serverPassword', 'requestedCar']) race.unset(field);
  let privateConnection = await new Parse.Query('RaceConnection').equalTo('raceId', raceId).first({ useMasterKey:true });
  if (!privateConnection) privateConnection = new Parse.Object('RaceConnection');
  privateConnection.set({ raceId, race, requestedCar, updatedBy:admin });
  for (const field of ['serverHost', 'serverPort', 'serverHttpPort', 'serverPassword']) privateConnection.unset(field);
  const acl = new Parse.ACL(); acl.setRoleReadAccess('admin', true); acl.setRoleWriteAccess('admin', true); privateConnection.setACL(acl);
  await Promise.all([race.save(null, { useMasterKey:true }), privateConnection.save(null, { useMasterKey:true })]);
  return { objectId:race.id, requirementSlugs:slugs, configured:Boolean(serverProfile.get('serverHost') && requestedCar) };
});

Parse.Cloud.define('getRaceLaunchConfig', async request => {
  const user = await requireHubUser(request);
  const raceId = cleanText(request.params.raceId, 40);
  const race = await new Parse.Query('Races').get(raceId, { useMasterKey:true });
  const [connection, serverProfile, requiredPackages] = await Promise.all([new Parse.Query('RaceConnection').equalTo('raceId', raceId).first({ useMasterKey:true }), primaryServerProfile(), raceContentPackages(race)]);
  const isAdmin = await userHasRole(user, 'admin');
  const requiresRegistration = race.get('requiresRegistration') !== false;
  const reservation = requiresRegistration
    ? await new Parse.Query('CarReservations').equalTo('raceId', raceId).equalTo('steamId', user.get('steamId')).first({ useMasterKey:true })
    : null;
  if (!isAdmin && requiresRegistration && !reservation) throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Confirme sua inscrição antes de entrar no servidor.');
  const host = cleanText(serverProfile?.get('serverHost') || connection?.get('serverHost'), 253).toLowerCase();
  if (!host) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'O servidor ainda não foi liberado pela organização.');
  const cars = Array.isArray(race.get('cars')) ? race.get('cars') : [];
  const reservedCar = reservation?.get('carModel');
  const car = cars.find(item => (item.name || item.nome) === reservedCar);
  const requestedCarHint = cleanText(request.params.requestedCarHint, 120);
  const requiredCarTargets = [...new Set(requiredPackages.filter(item => item.get('type') === 'car').map(item => cleanText(item.get('targetId'), 120)).filter(item => /^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(item)))];
  const approvedHint = requiredCarTargets.find(item => item.toLowerCase() === requestedCarHint.toLowerCase()) || '';
  const configuredCandidates = [connection?.get('requestedCar'), race.get('carContentId')].map(item => cleanText(item, 120)).filter(Boolean);
  const approvedConfiguredCar = requiredCarTargets.length
    ? configuredCandidates.find(candidate => requiredCarTargets.some(target => target.toLowerCase() === candidate.toLowerCase())) || ''
    : configuredCandidates[0] || '';
  const requestedCar = cleanText(car?.contentId || car?.folder || car?.id || approvedConfiguredCar || approvedHint || inferRequestedCar(race, requiredPackages, reservedCar), 120);
  if (!requestedCar) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Selecione no painel administrativo qual carro desta corrida será usado para entrar no servidor.');
  return { host, serverPort:Number(serverProfile?.get('serverPort') || connection?.get('serverPort') || 9600), httpPort:Number(serverProfile?.get('serverHttpPort') || connection?.get('serverHttpPort') || 8081), password:serverProfile?.get('serverPassword') || connection?.get('serverPassword') || '', serverName:race.get('title') || race.get('name') || 'Brasil Sim Racing', requestedCar };
});

Parse.Cloud.define('reserveRaceCar', async request => {
  const user = await requireHubUser(request);
  const raceId = cleanText(request.params.raceId, 40);
  const carModel = cleanText(request.params.carModel, 120);
  const userSteamId = cleanText(user.get('steamId'), 30);
  if (!raceId || !carModel || !userSteamId) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Corrida, carro e conta Steam validada são obrigatórios.');
  }

  const race = await new Parse.Query('Races').get(raceId, { useMasterKey: true });
  if (race.get('requiresRegistration') === false) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Esta corrida possui acesso livre e não aceita inscrições.');
  }
  if (['encerrada', 'fechada', 'cancelada'].includes(race.get('status'))) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'As inscrições desta corrida estão fechadas.');
  }

  const duplicateQuery = new Parse.Query('CarReservations');
  duplicateQuery.equalTo('raceId', raceId);
  duplicateQuery.equalTo('steamId', userSteamId);
  if (await duplicateQuery.first({ useMasterKey: true })) {
    throw new Parse.Error(Parse.Error.DUPLICATE_VALUE, 'Você já está inscrito nesta corrida.');
  }

  const cars = race.get('cars') || [];
  const selectedCar = cars.find(car => (car.nome || car.name) === carModel);
  if (!selectedCar) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Carro não disponível nesta corrida.');

  const capacity = Number(selectedCar.max || selectedCar.slots || race.get('maxDrivers') || 0);
  if (capacity > 0) {
    const capacityQuery = new Parse.Query('CarReservations');
    capacityQuery.equalTo('raceId', raceId);
    capacityQuery.equalTo('carModel', carModel);
    const occupied = await capacityQuery.count({ useMasterKey: true });
    if (occupied >= capacity) throw new Parse.Error(141, 'Não há mais vagas para este carro.');
  }

  const reservation = new Parse.Object('CarReservations');
  reservation.set({
    raceId,
    steamId: userSteamId,
    driverName: cleanText(user.get('displayName') || request.params.driverName || user.getUsername(), 100),
    carModel,
    user,
    reservedAt: new Date(),
    status: 'confirmed'
  });
  const acl = new Parse.ACL(user);
  acl.setPublicReadAccess(true);
  reservation.setACL(acl);
  await reservation.save(null, { useMasterKey: true });
  return { objectId: reservation.id, status: 'confirmed' };
});

Parse.Cloud.define('cancelRaceReservation', async request => {
  const user = await requireHubUser(request);
  const reservationId = cleanText(request.params.reservationId, 40);
  const reservation = await new Parse.Query('CarReservations').get(reservationId, { useMasterKey: true });
  const isOwner = reservation.get('user')?.id === user.id || reservation.get('steamId') === user.get('steamId');
  const isAdmin = await userHasRole(user, 'admin');
  if (!isOwner && !isAdmin) throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Esta reserva não pertence a você.');
  await reservation.destroy({ useMasterKey: true });
  return { cancelled: true };
});

Parse.Cloud.define('submitRaceReport', async request => {
  const user = await requireHubUser(request);
  const raceId = cleanText(request.params.raceId, 40);
  const againstSteamId = cleanText(request.params.againstSteamId, 30);
  const description = cleanText(request.params.description, 2000);
  const videoUrl = cleanText(request.params.videoUrl, 1000);
  if (!raceId || !againstSteamId || description.length < 20) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Informe corrida, piloto e uma descrição detalhada.');
  }
  if (againstSteamId === user.get('steamId')) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Você não pode protestar contra si mesmo.');
  const fromDriver = user.get('driver') || await new Parse.Query('Driver').equalTo('steamGUID', user.get('steamId')).first({ useMasterKey: true });
  const againstDriver = await new Parse.Query('Driver').equalTo('steamGUID', againstSteamId).first({ useMasterKey: true });
  if (!fromDriver || !againstDriver) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Piloto não encontrado.');
  await new Parse.Query('Races').get(raceId, { useMasterKey: true });
  const report = new Parse.Object('Reports');
  report.set({ fromDriver, againstDriver, raceId, description, videoUrl, status: 'pending', submittedAt: new Date(), submittedBy: user });
  const acl = new Parse.ACL(user); acl.setRoleReadAccess('admin', true); acl.setRoleWriteAccess('admin', true); report.setACL(acl);
  await report.save(null, { useMasterKey: true });
  return { objectId: report.id, status: 'pending' };
});

Parse.Cloud.define('applyRacePenalty', async request => {
  const admin = await requireAdmin(request);
  const resultId = cleanText(request.params.resultId, 40);
  const penaltySeconds = Number(request.params.penaltySeconds);
  if (!Number.isFinite(penaltySeconds) || penaltySeconds < 0 || penaltySeconds > 3600) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Penalidade inválida.');
  }

  const result = await new Parse.Query('RaceResult').get(resultId, { useMasterKey: true });
  if (result.get('ratingVersion')) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'O resultado já possui rating oficial. Revise a penalidade antes da publicação para manter o cálculo íntegro.');
  }
  result.set('penaltySeconds', penaltySeconds);
  result.set('penaltyReason', cleanText(request.params.reason, 500));
  result.set('reviewedBy', admin);
  result.set('reviewedAt', new Date());
  await result.save(null, { useMasterKey: true });

  const audit = new Parse.Object('AuditLog');
  audit.set({ action: 'apply_penalty', target: resultId, admin: admin.getUsername(), metadata: { penaltySeconds }, timestamp: new Date() });
  await audit.save(null, { useMasterKey: true });
  return { objectId: result.id, penaltySeconds };
});

Parse.Cloud.define('publishOfficialResults', async request => {
  const admin = await requireAdmin(request);
  const sessionId = cleanText(request.params.sessionId, 80);
  const query = new Parse.Query('RaceResult');
  query.equalTo('sessionId', sessionId);
  query.limit(500);
  const results = await query.find({ useMasterKey: true });
  if (results.some(result => result.get('ratingVersion'))) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Esta sessão já foi calculada pelo motor de ratings. A classificação precisa ser revisada no processador antes da publicação.');
  }
  const sorted = results.sort((a, b) => {
    const aStatus = a.get('status') === 'finished' ? 0 : 1;
    const bStatus = b.get('status') === 'finished' ? 0 : 1;
    if (aStatus !== bStatus) return aStatus - bStatus;
    const aTime = Number(a.get('totalTimeMs') || Number.MAX_SAFE_INTEGER) + Number(a.get('penaltySeconds') || 0) * 1000;
    const bTime = Number(b.get('totalTimeMs') || Number.MAX_SAFE_INTEGER) + Number(b.get('penaltySeconds') || 0) * 1000;
    return aTime - bTime;
  });
  sorted.forEach((result, index) => {
    result.set('officialPosition', index + 1);
    result.set('classificationStatus', 'official');
    result.set('publishedAt', new Date());
    result.set('publishedBy', admin);
  });
  await Parse.Object.saveAll(sorted, { useMasterKey: true });
  return { published: sorted.length };
});

function importNumber(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeImportPayload(raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const raceId = cleanText(payload.raceId, 40);
  const sessionType = cleanText(payload.sessionType || 'RACE', 20).toUpperCase();
  const track = cleanText(payload.track, 160);
  const sessionDate = new Date(payload.sessionDate?.iso || payload.sessionDate || Date.now());
  if (!raceId || !track || Number.isNaN(sessionDate.getTime())) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Corrida, pista e data são obrigatórias.');
  if (!['RACE', 'SPRINT', 'FEATURE'].includes(sessionType)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Tipo de sessão inválido.');
  if (!Array.isArray(payload.drivers) || payload.drivers.length < 2 || payload.drivers.length > 300) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Informe entre 2 e 300 pilotos.');
  const seen = new Map();
  const positions = new Set();
  const drivers = payload.drivers.map((rawDriver, index) => {
    const name = cleanText(rawDriver.name, 100);
    const steamGUID = cleanText(rawDriver.steamGUID, 30);
    const identity = steamGUID ? `steam:${steamGUID}` : `name:${name.toLocaleLowerCase('pt-BR')}`;
    if (!name) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `Nome do piloto ausente na linha ${index + 1}.`);
    if (seen.has(identity)) {
      const previous = seen.get(identity);
      const label = steamGUID ? `SteamID ${steamGUID}` : `nome ${name}`;
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${label} duplicado nas linhas ${previous.index + 1} (${previous.name}) e ${index + 1} (${name}). Revise o arquivo antes de publicar.`);
    }
    if (steamGUID && !/^\d{17}$/.test(steamGUID)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `SteamID inválido na linha ${index + 1}.`);
    seen.set(identity, { index, name });
    const finishPosition = Math.round(importNumber(rawDriver.finishPosition, 1, 300));
    if (positions.has(finishPosition)) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `Posição final duplicada: P${finishPosition}.`);
    positions.add(finishPosition);
    return {
      name, steamGUID, finishPosition,
      lapsCompleted: Math.round(importNumber(rawDriver.lapsCompleted, 0, 100000)), cornersCompleted: Math.round(importNumber(rawDriver.cornersCompleted, 0, 1000000)),
      incidents: importNumber(rawDriver.incidents, 0, 10000), incidentPoints:rawDriver.incidentPoints === undefined ? undefined : importNumber(rawDriver.incidentPoints, 0, 10000),
      offTracks:importNumber(rawDriver.offTracks, 0, 10000), lossOfControl:importNumber(rawDriver.lossOfControl, 0, 10000),
      lightContacts:importNumber(rawDriver.lightContacts, 0, 10000), heavyContacts:importNumber(rawDriver.heavyContacts, 0, 10000),
      carModel: cleanText(rawDriver.carModel, 160),
      carClass: cleanText(rawDriver.carClass || 'Unknown', 80), bestLapMs: importNumber(rawDriver.bestLapMs), totalTimeMs: importNumber(rawDriver.totalTimeMs),
      discipline:RatingEngine.disciplineFor(rawDriver.carClass, rawDriver.discipline),
      isDNF: Boolean(rawDriver.isDNF), isRageQuit: Boolean(rawDriver.isRageQuit), disconnected:Boolean(rawDriver.disconnected || rawDriver.isRageQuit), isDSQ: Boolean(rawDriver.isDSQ),
      didNotStart:Boolean(rawDriver.didNotStart), serverFailure:Boolean(rawDriver.serverFailure),
      incidentEvidence:cleanText(rawDriver.incidentEvidence || 'reviewed', 20),
      penaltySeconds: importNumber(rawDriver.penaltySeconds, 0, 3600), penaltyIncidents: Math.round(importNumber(rawDriver.penaltyIncidents, 0, 1000)),
      penaltyReason: cleanText(rawDriver.penaltyReason, 500)
    };
  });
  const cornersPerLap = Math.round(importNumber(payload.cornersPerLap, 0, 1000));
  const missingSteamIds = drivers.filter(driver => !driver.steamGUID).map(driver => driver.name);
  if (payload.official !== false && missingSteamIds.length) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `SteamID ausente em sessão oficial: ${missingSteamIds.slice(0, 6).join(', ')}${missingSteamIds.length > 6 ? '…' : ''}.`);
  }
  if (payload.official !== false && !cornersPerLap && drivers.some(driver => !driver.cornersCompleted && driver.lapsCompleted > 0)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Informe as curvas por volta para calcular o Safety Rating desta sessão.');
  }
  return {
    raceId, sessionType, track, sessionDate,
    official:payload.official !== false,
    distanceValid:payload.distanceValid !== false,
    minimumStarters:Math.round(importNumber(payload.minimumStarters || 4, 2, 100)),
    minimumClassStarters:Math.round(importNumber(payload.minimumClassStarters || 3, 2, 100)),
    heat:cleanText(payload.heat || '1', 32), sourceHash:cleanText(payload.sourceHash, 64),
    previewToken:cleanText(payload.previewToken, 64),
    cornersPerLap, drivers, importKey:`${raceId}:${sessionType}`
  };
}

function resultStatus(item) {
  return item.didNotStart ? 'dns' : item.isDSQ ? 'dsq' : item.isDNF ? 'dnf' : 'finished';
}

function compareClassification(a, b) {
  const left = a.item || a;
  const right = b.item || b;
  // finishPosition já representa a classificação oficial importada e pode ser
  // revisada pelo diretor de prova. TotalTime não é comparável entre pilotos
  // com quantidades diferentes de voltas: usá-lo aqui fazia retardatários com
  // poucas voltas aparecerem à frente do vencedor.
  return left.finishPosition - right.finishPosition;
}

function classifyEntries(entries) {
  const penalized = entries.some(entry => entry.item.penaltySeconds > 0);
  if (penalized && entries.some(entry => !entry.item.didNotStart && !entry.item.isDSQ && entry.item.lapsCompleted > 0 && !entry.item.totalTimeMs)) {
    throw new Error('Penalidades de tempo exigem tempos totais válidos para ordenar a classificação. Revise a classificação oficial.');
  }
  const ordered = [...entries].sort((a,b) => {
    const unavailable = item => item.didNotStart ? 2 : item.isDSQ ? 1 : 0;
    const status = unavailable(a.item) - unavailable(b.item);
    if (status) return status;
    if (!penalized || unavailable(a.item)) return compareClassification(a,b);
    return b.item.lapsCompleted - a.item.lapsCompleted ||
      (a.item.totalTimeMs + a.item.penaltySeconds * 1000) - (b.item.totalTimeMs + b.item.penaltySeconds * 1000) ||
      compareClassification(a,b);
  });
  const requiresReclassification = penalized || entries.some(entry => entry.item.isDSQ || entry.item.didNotStart);
  ordered.forEach((entry,index) => {
    if (requiresReclassification) entry.officialPosition = index + 1;
    else entry.officialPosition = entry.item.finishPosition;
  });
  const classes = new Map();
  entries.forEach(entry => {
    const key = `${entry.item.discipline}:` + String(entry.item.carClass || 'Unknown').trim().toLocaleLowerCase('pt-BR');
    if (!classes.has(key)) classes.set(key, []);
    classes.get(key).push(entry);
  });
  classes.forEach(group => [...group].sort((a,b) => a.officialPosition - b.officialPosition).forEach((entry, index) => { entry.classPosition = index + 1; }));
  return classes;
}

async function calculateRaceImport(payload) {
  const allDrivers = await new Parse.Query('Driver').containedIn('steamGUID', payload.drivers.map(item => item.steamGUID).filter(Boolean)).limit(1000).find({ useMasterKey:true });
  const unnamedIds = payload.drivers.filter(item => !item.steamGUID).map(item => item.name);
  if (unnamedIds.length) {
    const queries = ['name','customDisplayName','steamName'].map(field => new Parse.Query('Driver').containedIn(field,unnamedIds));
    allDrivers.push(...await Parse.Query.or(...queries).limit(1000).find({ useMasterKey:true }));
  }
  const activeDrivers = allDrivers.filter(driver => !driver.get('hiddenFromPublic'));
  const bySteam = new Map(activeDrivers.map(driver => [String(driver.get('steamGUID') || ''), driver]).filter(([key]) => key));
  const byName = new Map(activeDrivers.map(driver => [String(driver.get('customDisplayName') || driver.get('steamName') || driver.get('name') || '').trim().toLocaleLowerCase('pt-BR'), driver]));
  const entries = payload.drivers.map(item => ({
    item,
    // Em sessões oficiais o SteamID é a identidade canônica. Um nome igual
    // nunca pode vincular acidentalmente o resultado a outra conta.
    driver:item.steamGUID ? (bySteam.get(item.steamGUID) || null) : (byName.get(item.name.toLocaleLowerCase('pt-BR')) || null)
  }));
  const provisionedDrivers = [];
  const missingWithSteam = entries.filter(entry => !entry.driver && entry.item.steamGUID);
  // O resultado oficial do servidor também é uma fonte válida de cadastro de
  // piloto. Criamos somente o perfil de rating (não uma conta de acesso) e o
  // reconcileSteamDriver garante idempotência por SteamID e futura vinculação
  // quando o participante entrar no Hub pela Steam.
  for (let index = 0; index < missingWithSteam.length; index += 4) {
    const batch = missingWithSteam.slice(index, index + 4);
    const reconciled = await Promise.all(batch.map(async entry => {
      const driver = await reconcileSteamDriver(entry.item.steamGUID, null, { displayName:entry.item.name }, true);
      return { entry, driver };
    }));
    reconciled.forEach(({ entry, driver }) => {
      entry.driver = driver;
      provisionedDrivers.push({ steamGUID:entry.item.steamGUID, name:driver.get('name') || entry.item.name });
    });
  }
  const unresolved = entries.filter(entry => !entry.driver).map(entry => entry.item.name);
  if (unresolved.length) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, `Não foi possível identificar: ${unresolved.slice(0, 8).join(', ')}${unresolved.length > 8 ? '…' : ''}. Informe o SteamID desses participantes.`);
  const groups = classifyEntries(entries);
  const rows = [];
  groups.forEach(group => {
    const sorted = [...group].sort((a,b) => a.officialPosition - b.officialPosition);
    const starters = sorted.filter(entry => !entry.item.didNotStart);
    const rated = payload.official && payload.distanceValid && !payload.drivers.some(driver => driver.serverFailure) &&
      payload.drivers.filter(driver => !driver.didNotStart).length >= payload.minimumStarters && starters.length >= payload.minimumClassStarters;
    const ratingReason = !payload.official ? 'Sessão não oficial' : !payload.distanceValid ? 'Distância mínima não atingida' : payload.drivers.length < payload.minimumStarters ? `Grid geral abaixo de ${payload.minimumStarters} pilotos` : sorted.length < payload.minimumClassStarters ? `Classe abaixo de ${payload.minimumClassStarters} pilotos` : 'Válida para rating';
    const skillRows = starters.map(entry => {
      const oldIRating = Math.round(importNumber(entry.driver.get('irating') || 1600, 100, 10000));
      const profiles = entry.driver.get('skillRatings') || {};
      const discipline = entry.item.discipline || RatingEngine.disciplineFor(entry.item.carClass);
      return { entry, discipline, legacyRating:oldIRating, profile:profiles[discipline], rank:entry.classPosition };
    });
    const updatedSkills = rated ? RatingEngine.updateSkillGrid(skillRows, { eventAt:payload.sessionDate.toISOString() }) : skillRows.map(item => {
      const profile = RatingEngine.normalizeSkillProfile(item.profile, item.legacyRating);
      return { ...item, before:profile, after:profile, delta:0, expectedFinish:item.rank, performance:0 };
    });
    sorted.filter(entry => entry.item.didNotStart).forEach(entry => {
      const discipline = entry.item.discipline || RatingEngine.disciplineFor(entry.item.carClass);
      const profile = RatingEngine.normalizeSkillProfile((entry.driver.get('skillRatings') || {})[discipline], entry.driver.get('irating') || 1600);
      updatedSkills.push({ entry, discipline, before:profile, after:profile, delta:0, expectedFinish:0, performance:0 });
    });
    const strengthOfField = Math.round(updatedSkills.filter(item => !item.entry.item.didNotStart).reduce((sum, item) => sum + item.before.display, 0) / Math.max(1,starters.length));
    const classWinnerLaps = Math.max(0, ...sorted.map(item => item.item.lapsCompleted));
    updatedSkills.forEach(skill => {
      const entry = skill.entry;
      const oldIRating = skill.before.display;
      const newIRating = skill.after.display;
      const races = Math.round(importNumber(entry.driver.get('totalRaces')));
      const safetyRatings = entry.driver.get('safetyRatings') || {};
      const rawLegacySafety = entry.driver.get('safetyRating');
      const legacySafety = rawLegacySafety === undefined || rawLegacySafety === null || rawLegacySafety === ''
        ? 2.5
        : importNumber(rawLegacySafety, 0, 4.99);
      const legacyLicense = entry.driver.get('licenseClass') || 'R';
      const legacyMpr = entry.driver.get('licenseMPR');
      const safetyBefore = RatingEngine.normalizeSafetyProfile(safetyRatings[skill.discipline], legacySafety, legacyLicense, legacyMpr);
      const oldSafetyRating = safetyBefore.rating;
      const previousCorners = importNumber(entry.driver.get('totalCorners'));
      const previousIncidents = importNumber(entry.driver.get('totalIncidents'));
      const raceCorners = entry.item.cornersCompleted || entry.item.lapsCompleted * payload.cornersPerLap;
      const raceIncidents = RatingEngine.incidentPoints({ ...entry.item, stewardIncidentPoints:entry.item.penaltyIncidents });
      const totalCorners = previousCorners + raceCorners;
      const totalIncidents = previousIncidents + raceIncidents;
      const safetyEligible = payload.official && payload.distanceValid && !entry.item.didNotStart &&
        !payload.drivers.some(driver => driver.serverFailure) &&
        entry.item.incidentEvidence !== 'missing' && (raceCorners > 0 || raceIncidents > 0);
      const safety = safetyEligible
        ? RatingEngine.updateSafety(safetyBefore.history, oldSafetyRating, { corners:raceCorners, incidentPoints:raceIncidents, sessionType:payload.sessionType, at:payload.sessionDate.toISOString(), source:payload.importKey })
        : { history:safetyBefore.history, oldSafety:oldSafetyRating, safety:oldSafetyRating, delta:0, cpi:safetyBefore.cpi, windowCorners:0, windowIncidents:0, multiplier:0 };
      const reliability = payload.official
        ? RatingEngine.updateReliability(entry.driver.get('reliabilityHistory'), { dnf:entry.item.isDNF, rageQuit:entry.item.isRageQuit, disconnected:entry.item.disconnected, serverFailure:entry.item.serverFailure, didNotStart:entry.item.didNotStart, status:resultStatus(entry.item), at:payload.sessionDate.toISOString() })
        : { history:entry.driver.get('reliabilityHistory') || [], reliability:Math.round(importNumber(entry.driver.get('reliability') || 90, 0, 100)), starts:Math.round(importNumber(entry.driver.get('reliabilityStarts'))), completed:Math.round(importNumber(entry.driver.get('reliabilityCompleted'))) };
      const completionRatio = classWinnerLaps > 0 ? entry.item.lapsCompleted / classWinnerLaps : 1;
      const mpr = RatingPolicy.mprDecision({ policy:payload.ratingPolicy, rated, driver:entry.item, corners:raceCorners,
        incidents:raceIncidents, completion:completionRatio, license:safetyBefore.license });
      const mprEligible = mpr.eligible;
      const oldLicense = safetyBefore.license;
      const license = safetyEligible
        ? RatingEngine.nextLicense(oldLicense, safety.safety, safetyBefore.mpr, { mprEligible })
        : { license:oldLicense, mpr:safetyBefore.mpr, reason:'maintained', targetSafety:null, targetMpr:null };
      const safetyStarts = safetyBefore.starts + (safetyEligible ? 1 : 0);
      const contactBadge = RatingEngine.contactBadge({ cpi:safety.cpi, starts:safetyStarts, reliability:reliability.reliability });
      const safetyAfter = { rating:safety.safety, license:license.license, mpr:license.mpr, history:safety.history, cpi:safety.cpi, badge:contactBadge, starts:safetyStarts, version:RatingEngine.VERSION };
      const points = RatingEngine.championshipPoints(entry.classPosition, resultStatus(entry.item), strengthOfField, sorted.length);
      const totalRaces = races + (payload.official && !entry.item.didNotStart ? 1 : 0);
      rows.push({ ...entry.item, driver:entry.driver, driverId:entry.driver.id, oldIRating, newIRating, deltaIRating:newIRating-oldIRating,
        skillBefore:skill.before, skillAfter:skill.after, expectedFinish:skill.expectedFinish, ratingPerformance:skill.performance, strengthOfField,
        rated:rated && !entry.item.didNotStart, ratingReason:entry.item.didNotStart ? 'Não largou' : entry.item.serverFailure ? 'Falha do servidor' : ratingReason,
        mprReasons:mpr.reasons, reliabilityReason:reliability.reason || '', countedCorners:raceCorners,
        oldSafetyRating, newSafetyRating:safety.safety, deltaSafetyRating:safety.delta, safetyHistory:safety.history, safetyCpi:safety.cpi,
        safetyBefore, safetyAfter, safetyEligible, safetyMultiplier:safety.multiplier, safetyWindowCorners:safety.windowCorners, safetyWindowIncidents:safety.windowIncidents, incidentPoints:raceIncidents,
        reliability:reliability.reliability, reliabilityHistory:reliability.history, reliabilityStarts:reliability.starts, reliabilityCompleted:reliability.completed,
        contactBadge, safetyStarts, totalCorners, totalIncidents, totalRaces, oldLicense, newLicense:license.license, licenseMPR:license.mpr, licenseChange:license.reason,
        licenseTargetSafety:license.targetSafety, licenseTargetMpr:license.targetMpr, mprEligible, completionRatio:Math.round(completionRatio * 100) / 100,
        officialPosition:entry.officialPosition, classPosition:entry.classPosition, points, ratingVersion:RatingEngine.VERSION });
    });
  });
  rows.sort((a,b) => a.officialPosition - b.officialPosition);
  rows.provisionedDrivers = provisionedDrivers.sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));
  return rows;
}

function publicImportRows(rows) {
  return rows.map(({ driver, ...row }) => row);
}

Parse.Cloud.define('getRaceProcessorContext', async request => {
  await requireAdmin(request);
  const raceQuery = new Parse.Query('Races'); raceQuery.descending('startAt'); raceQuery.limit(300);
  const importQuery = new Parse.Query('RaceImports'); importQuery.descending('createdAt'); importQuery.limit(30);
  const [races, imports] = await Promise.all([raceQuery.find({ useMasterKey:true }), importQuery.find({ useMasterKey:true })]);
  return { races:races.map(race => ({ objectId:race.id, title:race.get('title') || race.get('name'), track:race.get('track') || race.get('circuit'), startAt:race.get('startAt'), date:race.get('date'), status:race.get('status'), ratingPolicy:RatingPolicy.normalizedPolicy(race.get('ratingPolicy')) })), imports:imports.map(batch => ({ objectId:batch.id, importKey:batch.get('importKey'), raceId:batch.get('raceId'), status:batch.get('status'), driverCount:batch.get('driverCount'), createdAt:batch.createdAt })) };
});

async function migrateRatingsV3Profiles(actor = 'back4app_job') {
  const query = new Parse.Query('Driver');
  query.ascending('objectId');
  query.limit(1000);
  const drivers = await query.find({ useMasterKey:true });
  let migrated = 0;
  drivers.forEach(driver => {
    const values = normalizedDriverValues(driver);
    const primaryDiscipline = driver.get('primaryDiscipline') || 'road';
    const skillRatings = { ...(driver.get('skillRatings') || {}) };
    const safetyRatings = { ...(driver.get('safetyRatings') || {}) };
    const before = skillRatings[primaryDiscipline];
    const disciplines = new Set([...Object.keys(skillRatings), ...Object.keys(safetyRatings), primaryDiscipline]);
    disciplines.forEach(discipline => {
      skillRatings[discipline] = RatingEngine.normalizeSkillProfile(skillRatings[discipline], discipline === primaryDiscipline ? values.irating : 1600);
      safetyRatings[discipline] = RatingEngine.normalizeSafetyProfile(
        safetyRatings[discipline], discipline === primaryDiscipline ? values.safetyRating : 2.5,
        discipline === primaryDiscipline ? values.licenseClass : 'R', discipline === primaryDiscipline ? driver.get('licenseMPR') : 0
      );
    });
    if (!before || !driver.get('safetyRatings') || driver.get('ratingVersion') !== RatingEngine.VERSION) migrated += 1;
    const primarySkill = skillRatings[primaryDiscipline];
    const primarySafety = safetyRatings[primaryDiscipline];
    driver.set({
      skillRatings,
      safetyRatings,
      primaryDiscipline,
      irating:primarySkill.display,
      ratingConfidence:primarySkill.confidence,
      ratingProvisional:primarySkill.provisional,
      ratingVersion:RatingEngine.VERSION,
      safetyRating:primarySafety.rating,
      safetyHistory:primarySafety.history,
      safetyCpi:primarySafety.cpi,
      licenseClass:primarySafety.license,
      driverRank:primarySafety.license,
      contactBadge:primarySafety.badge,
      reliability:Math.round(importNumber(driver.get('reliability') || 90, 0, 100)),
      reliabilityHistory:driver.get('reliabilityHistory') || [],
      reliabilityStarts:Math.round(importNumber(driver.get('reliabilityStarts'))),
      reliabilityCompleted:Math.round(importNumber(driver.get('reliabilityCompleted'))),
      licenseMPR:primarySafety.mpr
    });
  });
  await saveAllBatched(drivers);
  const audit = new Parse.Object('AuditLog');
  audit.set({ action:'migrate_ratings_v3', target:RatingEngine.VERSION, admin:cleanText(actor, 100) || 'back4app_job', metadata:{ inspected:drivers.length, migrated }, timestamp:new Date() });
  await audit.save(null, { useMasterKey:true });
  return { inspected:drivers.length, migrated, version:RatingEngine.VERSION };
}

Parse.Cloud.define('migrateRatingsV3', async request => {
  const admin = await requireAdmin(request);
  return migrateRatingsV3Profiles(admin.getUsername());
});

// Alias temporário para launchers v2 já instalados. Executa a migração atual.
Parse.Cloud.define('migrateRatingsV2', async request => {
  const admin = await requireAdmin(request);
  return migrateRatingsV3Profiles(admin.getUsername());
});

// Fallback operacional seguro: Cloud Jobs só podem ser disparados pelo
// dashboard ou com a Master Key. Isso permite inicializar o motor sem expor
// credenciais de uma conta administrativa do launcher.
Parse.Cloud.job('migrateRatingsV3Job', async request => {
  if (typeof request.message === 'function') request.message('Inicializando perfis do BSR Rating v3...');
  const result = await migrateRatingsV3Profiles('back4app_job');
  if (typeof request.message === 'function') request.message(`${result.migrated} de ${result.inspected} perfis preparados.`);
  return result;
});

Parse.Cloud.job('migrateRatingsV2Job', async request => {
  if (typeof request.message === 'function') request.message('Atualizando perfis para o BSR Rating v3...');
  return migrateRatingsV3Profiles('back4app_job');
});

async function prepareRatingPayload(raw) {
  const payload = normalizeImportPayload(raw);
  const race = await new Parse.Query('Races').get(payload.raceId, { useMasterKey:true });
  payload.ratingPolicy = RatingPolicy.normalizedPolicy(race.get('ratingPolicy'));
  payload.minimumStarters = payload.ratingPolicy.minimumStarters;
  payload.minimumClassStarters = payload.ratingPolicy.minimumClassStarters;
  payload.official = payload.official && payload.ratingPolicy.official;
  if (payload.official && !/^[a-f0-9]{64}$/i.test(payload.sourceHash)) throw new Error('Reimporte o arquivo de origem para registrar seu SHA-256.');
  payload.sessionIdentity = RatingPolicy.sessionIdentity(payload);
  payload.fieldFingerprint = RatingPolicy.hash(payload.drivers.map(driver => driver.steamGUID).sort());
  const previous = await new Parse.Query('RaceImports').equalTo('sessionIdentity',payload.sessionIdentity).descending('revision').first({ useMasterKey:true });
  payload.revision = previous ? (previous.get('revision') || 1) + (previous.get('status') === 'voided' ? 1 : 0) : 1;
  payload.importKey = `${payload.raceId}:${payload.sessionIdentity}:${payload.revision}`;
  return { payload, race };
}

Parse.Cloud.define('setRaceRatingPolicy', async request => {
  const admin = await requireAdmin(request);
  const race = await new Parse.Query('Races').get(cleanText(request.params.raceId,40), { useMasterKey:true });
  const start = new Date(race.get('startAt') || race.get('date'));
  if (!Number.isFinite(start.getTime()) || start <= new Date()) throw new Error('O regulamento precisa ser definido antes da largada, com data válida no evento.');
  const policy = RatingPolicy.normalizedPolicy(request.params.policy);
  race.set({ ratingPolicy:policy, ratingPolicySetAt:new Date(), ratingPolicySetBy:admin.id });
  await race.save(null,{ useMasterKey:true });
  return policy;
});

Parse.Cloud.define('getRatingPublicationStatus', async request => {
  await requireAdmin(request);
  const config = await Parse.Config.get({ useMasterKey:true });
  const id = config.get('BSR_RATING_GATE_ID');
  if (!id) return { initialized:false };
  const gate = await new Parse.Query('RatingPublicationGate').get(id,{ useMasterKey:true });
  return { initialized:true, workers:gate.get('workers'), pendingImport:gate.get('activeImport') || null };
});

Parse.Cloud.define('initializeRatingPublication', async request => {
  await requireAdmin(request);
  return RatingPublication.initialize();
});

Parse.Cloud.define('getRatingCalibration', async request => {
  await requireAdmin(request);
  await RatingPublication.assertReadable();
  const query = new Parse.Query('RaceResult').equalTo('classificationStatus','official').descending('sessionDate').limit(1000);
  const results = await query.find({ useMasterKey:true });
  const summary = require('./rating-calibration').summarize(results.map(row => row.toJSON()));
  return { sampledResults:results.length, limit:1000, groups:summary, parametersChanged:false };
});

function ratingPreviewToken(payload, rows) {
  const { previewToken, ...input } = payload;
  return RatingPolicy.hash({ input, engine:RatingEngine.VERSION,
    rows:rows.map(({ driver, ...row }) => row) });
}

Parse.Cloud.job('initializeRatingPublication', async () => RatingPublication.initialize());

Parse.Cloud.define('previewRaceImport', async request => {
  await requireAdmin(request);
  const { payload } = await prepareRatingPayload(request.params.payload);
  const existing = await new Parse.Query('RaceImports').equalTo('importKey', payload.importKey).equalTo('status', 'completed').first({ useMasterKey:true });
  const rows = await calculateRaceImport(payload);
  const repeated = await new Parse.Query('RaceImports').equalTo('fieldFingerprint',payload.fieldFingerprint)
    .equalTo('status','completed').greaterThan('sessionDate',new Date(payload.sessionDate.getTime() - 7 * 86400000))
    .lessThanOrEqualTo('sessionDate',payload.sessionDate).count({ useMasterKey:true });
  const warnings = RatingPolicy.integrityWarnings(payload);
  if (repeated >= 3 && payload.drivers.length < 8) warnings.push(`Grid pequeno repetido ${repeated} vezes em sete dias. Revisão administrativa recomendada; não é prova de manipulação.`);
  return {
    importKey:payload.importKey,
    duplicate:Boolean(existing),
    previewToken:ratingPreviewToken(payload, rows),
    policy:payload.ratingPolicy,
    warnings,
    engineVersion:RatingEngine.VERSION,
    provisionedDrivers:rows.provisionedDrivers || [],
    rows:publicImportRows(rows),
    totals:{
      drivers:rows.length,
      provisionedDrivers:(rows.provisionedDrivers || []).length,
      classes:new Set(rows.map(row => row.carClass)).size,
      incidents:rows.reduce((sum,row) => sum + row.incidentPoints, 0),
      rated:rows.filter(row => row.rated).length,
      strengthOfField:rows.length ? Math.round(rows.reduce((sum,row) => sum + row.strengthOfField, 0) / rows.length) : 0
    }
  };
});

function applyRatingResultToDriver(result) {
  const driver = result.get('driver');
  if (!driver) return null;
  const discipline = result.get('discipline') || 'road';
  const skillRatings = { ...(driver.get('skillRatings') || {}) };
  const safetyRatings = { ...(driver.get('safetyRatings') || {}) };
  const skillAfter = result.get('skillAfter');
  const safetyAfter = result.get('safetyProfileAfter');
  if (skillAfter) skillRatings[discipline] = skillAfter;
  if (safetyAfter) safetyRatings[discipline] = safetyAfter;
  const previousPrimary = driver.get('primaryDiscipline') || discipline;
  const primaryDiscipline = RatingEngine.primaryDiscipline(skillRatings, previousPrimary);
  const primarySkill = RatingEngine.normalizeSkillProfile(skillRatings[primaryDiscipline], result.get('newIRating') || driver.get('irating') || 1600);
  const primarySafety = RatingEngine.normalizeSafetyProfile(
    safetyRatings[primaryDiscipline],
    primaryDiscipline === discipline ? result.get('newSafetyRating') : (driver.get('safetyRating') || 2.5),
    primaryDiscipline === discipline ? result.get('newLicense') : (driver.get('licenseClass') || 'R'),
    primaryDiscipline === discipline ? result.get('licenseMPR') : driver.get('licenseMPR')
  );
  driver.set({
    skillRatings,
    safetyRatings,
    primaryDiscipline,
    irating:primarySkill.display,
    ratingConfidence:primarySkill.confidence,
    ratingProvisional:primarySkill.provisional,
    ratingVersion:result.get('ratingVersion') || RatingEngine.VERSION,
    safetyRating:primarySafety.rating,
    safetyHistory:primarySafety.history,
    safetyCpi:primarySafety.cpi,
    reliability:result.get('newReliability'),
    reliabilityHistory:result.get('reliabilityHistoryAfter') || driver.get('reliabilityHistory') || [],
    reliabilityStarts:result.get('reliabilityStarts'),
    reliabilityCompleted:result.get('reliabilityCompleted'),
    contactBadge:primarySafety.badge,
    licenseClass:primarySafety.license,
    driverRank:primarySafety.license,
    licenseMPR:primarySafety.mpr,
    totalRaces:result.get('totalRaces'),
    totalCorners:result.get('totalCorners'),
    totalIncidents:result.get('totalIncidents')
  });
  return driver;
}

const RATING_FIELDS = ['skillRatings','safetyRatings','primaryDiscipline','irating','ratingConfidence','ratingProvisional',
  'ratingVersion','safetyRating','safetyHistory','safetyCpi','reliability','reliabilityHistory','reliabilityStarts',
  'reliabilityCompleted','contactBadge','licenseClass','driverRank','licenseMPR','totalRaces','totalCorners','totalIncidents'];
function ratingSnapshot(driver) {
  return Object.fromEntries(RATING_FIELDS.map(field => [field, driver.get(field) === undefined ? null : driver.get(field)]));
}
function restoreRatingSnapshot(driver, snapshot) {
  for (const field of RATING_FIELDS) {
    if (snapshot[field] === null || snapshot[field] === undefined) driver.unset(field);
    else driver.set(field, snapshot[field]);
  }
}

async function rebuildChampionshipStanding(driver, race, fallback = {}) {
  const championshipId = String(race.get('championshipId') || 'geral');
  const query = new Parse.Query('RaceResult');
  query.equalTo('driver', driver);
  query.include('race');
  query.limit(1000);
  const all = await query.find({ useMasterKey:true });
  const relevant = all.filter(result => result.get('classificationStatus') !== 'voided' && String(result.get('championshipId') || result.get('race')?.get('championshipId') || 'geral') === championshipId);
  const standingQuery = new Parse.Query('ChampionshipStandings');
  standingQuery.equalTo('driver', driver);
  standingQuery.equalTo('championshipId', championshipId);
  let standing = await standingQuery.first({ useMasterKey:true });
  if (!standing) standing = new Parse.Object('ChampionshipStandings');
  const points = relevant.reduce((sum, result) => sum + importNumber(result.get('championshipPoints') ?? result.get('points')), 0);
  standing.set({
    driver,
    driverId:driver.id,
    driverName:fallback.name || driver.get('name'),
    steamGUID:fallback.steamGUID || driver.get('steamGUID'),
    championshipId,
    category:fallback.carClass || relevant[0]?.get('carClass') || 'Geral',
    points,
    races:relevant.length,
    wins:relevant.filter(result => result.get('classPosition') === 1 && result.get('status') === 'finished').length,
    podiums:relevant.filter(result => result.get('classPosition') <= 3 && result.get('status') === 'finished').length
  });
  await standing.save(null, { useMasterKey:true });
}

Parse.Cloud.define('commitRaceImport', async request => {
  const admin = await requireAdmin(request);
  const { payload, race } = await prepareRatingPayload(request.params.payload);
  return RatingPublication.run(payload.importKey, async (markPending,sequence) => {
  let batch = await new Parse.Query('RaceImports').equalTo('importKey', payload.importKey).first({ useMasterKey:true });
  if (batch?.get('status') === 'completed') return { committed:true, alreadyCompleted:true, importId:batch.id, results:batch.get('driverCount'), ratingVersion:batch.get('ratingVersion') };
  // A legacy import is not silently republished under a new identity scheme.
  const legacy = await new Parse.Query('RaceImports').equalTo('importKey', `${payload.raceId}:${payload.sessionType}`).equalTo('status', 'completed').first({ useMasterKey:true });
  if (legacy) throw new Error('Esta corrida possui uma importação legada. Revise o histórico antes de cadastrar outra bateria.');
  if (payload.sourceHash) {
    const sameSource = await new Parse.Query('RaceImports').equalTo('sourceHash',payload.sourceHash).equalTo('status','completed').notEqualTo('importKey',payload.importKey).first({ useMasterKey:true });
    if (sameSource) throw new Error('Este arquivo já foi publicado em outra sessão. Verifique a corrida e a bateria selecionadas.');
  }
  let rows;
  if (batch?.get('publicationPlan')) {
    if (batch.get('payloadHash') !== RatingPolicy.hash({ ...payload, previewToken:'' })) throw new Error('Retomada exige os mesmos dados da publicação interrompida.');
    rows = await Promise.all(batch.get('publicationPlan').map(async row => ({
      ...row, driver:await new Parse.Query('Driver').get(row.driverId, { useMasterKey:true })
    })));
  } else {
    rows = await calculateRaceImport(payload);
    if (!payload.previewToken || payload.previewToken !== ratingPreviewToken(payload, rows)) throw new Error('A prévia mudou ou expirou. Calcule novamente antes de publicar.');
    rows.forEach(row => { row.driverStateBefore = ratingSnapshot(row.driver); });
    for (const row of rows) {
      const dates = [row.skillBefore.lastRatedAt, ...(row.safetyBefore.history || []).map(entry => entry.at)];
      if (dates.some(date => date && new Date(date) > payload.sessionDate)) throw new Error('Importação fora de ordem cronológica. Anule as publicações posteriores em ordem inversa antes de publicar.');
    }
  }
  if (!batch) { batch = new Parse.Object('RaceImports'); batch.setACL(new Parse.ACL()); }
  batch.set({ importKey:payload.importKey, raceId:payload.raceId, sessionType:payload.sessionType, ratingVersion:RatingEngine.VERSION, status:'processing', driverCount:rows.length, createdBy:admin, startedAt:new Date(),
    payloadHash:RatingPolicy.hash({ ...payload, previewToken:'' }), sourceHash:payload.sourceHash, sessionDate:payload.sessionDate,
    sessionIdentity:payload.sessionIdentity, revision:payload.revision,
    ledgerSequence:batch.get('ledgerSequence') || sequence,
    fieldFingerprint:payload.fieldFingerprint,
    policySnapshot:payload.ratingPolicy, publicationPayload:payload, publicationPlan:rows.map(({ driver, ...row }) => row) });
  // Reserve before persisting a resumable plan. Otherwise a failed gate save
  // could leave a stale plan that is resumed after a different race commits.
  await markPending();
  await batch.save(null, { useMasterKey:true });
  try {
    const existingQuery = new Parse.Query('RaceResult'); existingQuery.equalTo('importKey', payload.importKey); existingQuery.include('driver'); existingQuery.limit(500);
    let results = await existingQuery.find({ useMasterKey:true });
    const persisted = new Set(results.map(result => result.get('steamGUID')));
    rows.filter(row => !persisted.has(row.steamGUID)).forEach(row => {
      const result = new Parse.Object('RaceResult');
      result.set({ importKey:payload.importKey, importBatch:batch, race, raceId:payload.raceId, raceTitle:race.get('title') || race.get('name'), sessionId:payload.importKey, sessionType:payload.sessionType, heat:payload.heat,
        championshipId:String(race.get('championshipId') || 'geral'), officialSession:payload.official, ratingEligible:row.rated, ratingReason:row.ratingReason,
        sessionDate:payload.sessionDate, track:payload.track, driver:row.driver, driverName:row.name, steamGUID:row.steamGUID, finishPosition:row.finishPosition,
        officialPosition:row.officialPosition, classPosition:row.classPosition, lapsCompleted:row.lapsCompleted, cornersCompleted:row.cornersCompleted,
        incidents:row.incidentPoints, incidentPoints:row.incidentPoints, carModel:row.carModel, carClass:row.carClass, discipline:row.discipline, bestLapMs:row.bestLapMs, totalTimeMs:row.totalTimeMs,
        isDNF:row.isDNF, isRageQuit:row.isRageQuit, disconnected:row.disconnected, isDSQ:row.isDSQ, status:resultStatus(row), classificationStatus:'pending',
        penaltySeconds:row.penaltySeconds, penaltyReason:row.penaltyReason, oldIRating:row.oldIRating, newIRating:row.newIRating,
        deltaIRating:row.deltaIRating, expectedFinish:row.expectedFinish, strengthOfField:row.strengthOfField,
        ratingPerformance:row.ratingPerformance, skillBefore:row.skillBefore, skillAfter:row.skillAfter, ratingVersion:row.ratingVersion,
        oldSafetyRating:row.oldSafetyRating, newSafetyRating:row.newSafetyRating, deltaSafetyRating:row.deltaSafetyRating, safetyCpi:row.safetyCpi,
        safetyEligible:row.safetyEligible, safetyMultiplier:row.safetyMultiplier, safetyWindowCorners:row.safetyWindowCorners, safetyWindowIncidents:row.safetyWindowIncidents,
        safetyProfileBefore:row.safetyBefore, safetyProfileAfter:row.safetyAfter, safetyHistoryAfter:row.safetyHistory,
        oldReliability:row.driver.get('reliability') || 90, newReliability:row.reliability, reliabilityStarts:row.reliabilityStarts,
        reliabilityCompleted:row.reliabilityCompleted, reliabilityHistoryAfter:row.reliabilityHistory,
        contactBadge:row.contactBadge, safetyStarts:row.safetyStarts, oldLicense:row.oldLicense, newLicense:row.newLicense, licenseMPR:row.licenseMPR, licenseChange:row.licenseChange,
        licenseTargetSafety:row.licenseTargetSafety, licenseTargetMpr:row.licenseTargetMpr, mprEligible:row.mprEligible, completionRatio:row.completionRatio,
        totalRaces:row.totalRaces, totalCorners:row.totalCorners, totalIncidents:row.totalIncidents,
        championshipPoints:row.points, points:row.points, publishedAt:new Date(), publishedBy:admin });
      results.push(result);
    });
    if (results.some(result => !result.id)) await Parse.Object.saveAll(results, { useMasterKey:true });
    const drivers = results.map(applyRatingResultToDriver).filter(Boolean);
    await saveAllBatched(drivers);
    for (const result of results) {
      await rebuildChampionshipStanding(result.get('driver'), race, { name:result.get('driverName'), steamGUID:result.get('steamGUID'), carClass:result.get('carClass') });
      const existingLedger = await new Parse.Query('RatingLedger').equalTo('importKey', payload.importKey).equalTo('driverId', result.get('driver')?.id).first({ useMasterKey:true });
      if (!existingLedger) {
        const ledger = new Parse.Object('RatingLedger');
        ledger.set({ importKey:payload.importKey, raceId:payload.raceId, result, driver:result.get('driver'), driverId:result.get('driver')?.id,
          discipline:result.get('discipline'), ratingVersion:result.get('ratingVersion'), oldIRating:result.get('oldIRating'), newIRating:result.get('newIRating'),
          oldSafetyRating:result.get('oldSafetyRating'), newSafetyRating:result.get('newSafetyRating'), oldReliability:result.get('oldReliability'),
          newReliability:result.get('newReliability'), expectedFinish:result.get('expectedFinish'), ratingPerformance:result.get('ratingPerformance'),
          officialPosition:result.get('officialPosition'), oldLicense:result.get('oldLicense'), newLicense:result.get('newLicense'),
          contactBadge:result.get('contactBadge'), createdBy:admin, timestamp:new Date(),
          skillBefore:result.get('skillBefore'), skillAfter:result.get('skillAfter'),
          safetyBefore:result.get('safetyProfileBefore'), safetyAfter:result.get('safetyProfileAfter'),
          reliabilityHistoryAfter:result.get('reliabilityHistoryAfter'), policySnapshot:payload.ratingPolicy,
          sourceHash:payload.sourceHash, sessionDate:payload.sessionDate });
        const planned = rows.find(row => row.driverId === result.get('driver')?.id);
        ledger.set({ driverStateBefore:planned.driverStateBefore, driverStateAfter:ratingSnapshot(result.get('driver')), sequence:batch.get('ledgerSequence') });
        ledger.setACL(new Parse.ACL());
        await ledger.save(null, { useMasterKey:true });
      }
    }
    const reservations = await new Parse.Query('CarReservations').equalTo('raceId', payload.raceId).limit(1000).find({ useMasterKey:true });
    if (reservations.length) await Parse.Object.destroyAll(reservations, { useMasterKey:true });
    results.forEach(result => result.set('classificationStatus', 'official'));
    await saveAllBatched(results);
    race.set({ status:'encerrada', resultsPublished:true, sessionId:payload.importKey, resultsSessionId:payload.importKey, resultsPublishedAt:new Date() }); await race.save(null, { useMasterKey:true });
    batch.set({ status:'completed', completedAt:new Date() }); await batch.save(null, { useMasterKey:true });
    const notification = new Parse.Object('Notifications'); notification.set({ title:'Resultados oficiais publicados', message:`${race.get('title') || race.get('name')}: ${rows.length} pilotos classificados.`, timestamp:new Date() }); await notification.save(null, { useMasterKey:true }).catch(() => {});
    const audit = new Parse.Object('AuditLog'); audit.set({ action:'commit_race_import', target:batch.id, admin:admin.getUsername(), metadata:{ importKey:payload.importKey, driverCount:rows.length, ratingVersion:RatingEngine.VERSION, ratedDrivers:rows.filter(row => row.rated).length }, timestamp:new Date() }); await audit.save(null, { useMasterKey:true }).catch(() => {});
    return { committed:true, importId:batch.id, results:results.length, ratingVersion:RatingEngine.VERSION };
  } catch (error) {
    batch.set({ status:'failed', error:cleanText(error.message, 500), failedAt:new Date() }); await batch.save(null, { useMasterKey:true }).catch(() => {}); throw error;
  }
  });
});

Parse.Cloud.define('resumeRaceImport', async request => {
  await requireAdmin(request);
  const batch = await new Parse.Query('RaceImports').get(cleanText(request.params.importId, 40), { useMasterKey:true });
  if (!batch.get('publicationPayload')) throw new Error('Esta importação não possui plano de recuperação.');
  return Parse.Cloud.run('commitRaceImport', { payload:batch.get('publicationPayload') }, { sessionToken:request.user.getSessionToken() });
});

Parse.Cloud.define('voidLatestRaceImport', async request => {
  const admin = await requireAdmin(request);
  const reason = cleanText(request.params.reason, 500);
  if (reason.length < 10) throw new Error('Descreva o motivo da anulação (mínimo de 10 caracteres).');
  const id = cleanText(request.params.importId, 40);
  return RatingPublication.run(`void:${id}`, async (markPending,sequence) => {
    const batch = await new Parse.Query('RaceImports').get(id, { useMasterKey:true });
    if (batch.get('status') === 'voided') return { voided:true, alreadyCompleted:true };
    const latest = await new Parse.Query('RaceImports').equalTo('status','completed').descending('ledgerSequence').first({ useMasterKey:true });
    if (latest?.id !== id) throw new Error('Anule as publicações da mais recente para a mais antiga. Há resultados posteriores dependentes destes ratings.');
    const plan = batch.get('publicationPlan');
    if (!plan?.length || plan.some(row => !row.driverStateBefore)) throw new Error('Importação legada sem snapshot completo. Anulação automática indisponível.');
    await markPending();
    const race = await new Parse.Query('Races').get(batch.get('raceId'), { useMasterKey:true });
    const results = await new Parse.Query('RaceResult').equalTo('importKey',batch.get('importKey')).limit(500).find({ useMasterKey:true });
    for (const row of plan) {
      const driver = await new Parse.Query('Driver').get(row.driverId, { useMasterKey:true });
      restoreRatingSnapshot(driver, row.driverStateBefore);
      await driver.save(null, { useMasterKey:true });
    }
    results.forEach(result => result.set('classificationStatus','voided'));
    await saveAllBatched(results);
    for (const row of plan) {
      const driver = await new Parse.Query('Driver').get(row.driverId, { useMasterKey:true });
      await rebuildChampionshipStanding(driver, race);
      const key = `void:${id}`;
      const existing = await new Parse.Query('RatingLedger').equalTo('importKey',key).equalTo('driverId',driver.id).first({ useMasterKey:true });
      if (!existing) {
        const ledger = new Parse.Object('RatingLedger');
        ledger.set({ importKey:key, driverId:driver.id, driver, raceId:race.id, reversesImport:batch.id,
          driverStateAfter:row.driverStateBefore, reason, createdBy:admin, timestamp:new Date(), sequence });
        ledger.setACL(new Parse.ACL()); await ledger.save(null, { useMasterKey:true });
      }
    }
    const previous = await new Parse.Query('RaceImports').equalTo('raceId',race.id).equalTo('status','completed').notEqualTo('objectId',id).descending('completedAt').first({ useMasterKey:true });
    race.set({ resultsPublished:Boolean(previous), resultsSessionId:previous?.get('importKey') || '', sessionId:previous?.get('importKey') || '' });
    await race.save(null, { useMasterKey:true });
    batch.set({ status:'voided', voidReason:reason, voidedAt:new Date(), voidedBy:admin });
    await batch.save(null, { useMasterKey:true });
    return { voided:true, drivers:plan.length };
  });
});

Parse.Cloud.define('rebuildRatingsFromLedger', async request => {
  const admin = await requireAdmin(request);
  return RatingPublication.run('rebuild-ledger', async markPending => {
    const latest = new Map();
    let afterId = '';
    // Pagination is by immutable objectId; timestamps order candidate snapshots.
    for (;;) {
      const query = new Parse.Query('RatingLedger').ascending('objectId').limit(500);
      if (afterId) query.greaterThan('objectId',afterId);
      const page = await query.find({ useMasterKey:true });
      for (const entry of page) {
        if (!entry.get('driverStateAfter')) continue;
        const driverId = entry.get('driverId');
        const prior = latest.get(driverId);
        if (!prior || Number(entry.get('sequence') || 0) > Number(prior.get('sequence') || 0)) latest.set(driverId,entry);
      }
      if (page.length < 500) break;
      afterId = page[page.length-1].id;
    }
    await markPending();
    let repaired = 0;
    for (const [id,entry] of latest) {
      const driver = await new Parse.Query('Driver').get(id,{ useMasterKey:true });
      if (RatingPolicy.hash(ratingSnapshot(driver)) === RatingPolicy.hash(entry.get('driverStateAfter'))) continue;
      restoreRatingSnapshot(driver,entry.get('driverStateAfter'));
      await driver.save(null,{ useMasterKey:true }); repaired++;
    }
    const audit = new Parse.Object('AuditLog');
    audit.set({ action:'rebuild_ratings_from_ledger',admin:admin.getUsername(),timestamp:new Date(),metadata:{ inspected:latest.size,repaired } });
    await audit.save(null,{ useMasterKey:true });
    return { inspected:latest.size,repaired, legacyExcluded:true };
  });
});

async function requireAdminAccess(request) {
  if (request.master) return;
  await requireAdmin(request);
  if (request.object?.className === 'RatingPublicationGate') throw new Error('Estado interno de publicação protegido.');
  if (request.object?.className === 'Races' && request.original &&
      RatingPolicy.hash(request.object.get('ratingPolicy') || {}) !== RatingPolicy.hash(request.original.get('ratingPolicy') || {})) {
    const start = request.original.get('startAt') || request.original.get('date');
    if (!start || new Date(start) <= new Date()) throw new Error('O regulamento de rating só pode ser alterado antes da largada.');
    RatingPolicy.normalizedPolicy(request.object.get('ratingPolicy'));
  }
}

async function requireHubReadAccess(request) {
  if (request.master) return;
  await requireHubAccess(request);
}

Parse.Cloud.beforeFind('RatingPublicationGate', requireAdminAccess);
Parse.Cloud.beforeSave('RatingPublicationGate', requireAdminAccess);
Parse.Cloud.beforeDelete('RatingPublicationGate', requireAdminAccess);

Parse.Cloud.beforeSave(Parse.User, request => {
  if (request.master) return;
  if (!request.original) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Criação direta de contas desativada. Use o login Steam.');
  }
  const protectedFields = ['username', 'steamId', 'driver', 'displayName', 'avatarUrl', 'lastSteamLoginAt'];
  const changedProtectedField = protectedFields.some(field => {
    const before = request.original.get(field);
    const after = request.object.get(field);
    const beforeId = before?.id || before;
    const afterId = after?.id || after;
    return beforeId !== afterId;
  });
  if (changedProtectedField) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Campos de identidade só podem ser alterados pelo servidor.');
  }
});

for (const className of ['Driver', 'CarReservations', 'RaceResult', 'ChampionshipStandings', 'Notifications', 'Reports', 'AuditLog', 'AuthChallenge', 'RaceImports', 'RatingLedger', 'ContentPackage', 'RaceConnection', 'ServerProfile', 'HubAccessPolicy', 'HubAccessGrant']) {
  Parse.Cloud.beforeFind(className, requireAdminAccess);
}

for (const className of ['Races', 'Championships', 'Categories', 'Dependencies']) {
  Parse.Cloud.beforeFind(className, requireHubReadAccess);
}

for (const className of ['Races', 'Championships', 'Categories', 'Dependencies', 'Driver', 'CarReservations', 'RaceResult', 'ChampionshipStandings', 'Notifications', 'Reports', 'AuditLog', 'AuthChallenge', 'RaceImports', 'ContentPackage', 'RaceConnection', 'ServerProfile', 'HubAccessPolicy', 'HubAccessGrant', 'Teams', 'TeamMembers', 'CarPresets', 'ChampionshipCarReservations', 'SeasonArchive']) {
  Parse.Cloud.beforeSave(className, requireAdminAccess);
  Parse.Cloud.beforeDelete(className, requireAdminAccess);
}

Parse.Cloud.beforeSave('RatingLedger', async request => {
  if (request.original) throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'O ledger de ratings é imutável.');
  await requireAdminAccess(request);
});

Parse.Cloud.beforeDelete('RatingLedger', () => {
  throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'O ledger de ratings não pode ser removido.');
});
