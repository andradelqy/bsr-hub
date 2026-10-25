const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class MemoryStorage {
  constructor(seed = {}) { this.data = new Map(Object.entries(seed)); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();
const requests = [];
let nextResponse = { ok: true, status: 200, payload: { objectId: 'user-1', username: 'admin', sessionToken: 'session-1' } };
const responseQueue = [];

const context = {
  window: {
    APP_ID: 'test-app',
    REST_API_KEY: 'test-client-key',
    BASE_URL: 'https://parseapi.back4app.com'
  },
  localStorage,
  sessionStorage,
  console,
  fetch: async (url, options) => {
    requests.push({ url, options });
    const response = responseQueue.length ? responseQueue.shift() : nextResponse;
    return {
      ok: response.ok,
      status: response.status,
      text: async () => JSON.stringify(response.payload)
    };
  },
  Date,
  JSON,
  Error
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'api.js' });

(async () => {
  const api = context.window.BSR_API;
  assert.ok(api, 'API client should initialize');
  assert.equal(api.getSessionToken(), null, 'a session must not exist before login');

  const login = await api.login('admin', 'password');
  assert.equal(login.sessionToken, 'session-1');
  assert.equal(requests.at(-1).options.method, 'POST', 'login credentials must not be sent in the URL');
  assert.equal(requests.at(-1).url, 'https://parseapi.back4app.com/login');
  assert.equal(requests.at(-1).options.headers['X-Parse-Revocable-Session'], '1');
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { username: 'admin', password: 'password' });

  api.saveSession(login, true, 'admin');
  const persisted = JSON.parse(localStorage.getItem('bsr_parse_session'));
  assert.equal(persisted.sessionToken, 'session-1', 'persistent session must be stored locally');
  assert.ok(persisted.expiresAt > Date.now() + 29 * 24 * 60 * 60 * 1000, 'persistent session should last about 30 days');
  assert.equal(sessionStorage.getItem('bsr_parse_session'), null, 'persistent session must have a single storage source');
  assert.equal(api.getSessionToken(), 'session-1');

  nextResponse = { ok: false, status: 400, payload: { code: 209, error: 'invalid session token' } };
  await assert.rejects(() => api.fetch('/classes/Races'), /invalid session token/);
  assert.equal(api.getSessionToken(), null, 'invalid server session must clear local auth state');

  api.saveSession({ objectId:'driver-user', username:'steam:76561198000000000', sessionToken:'driver-token' }, true, 'driver');
  responseQueue.push(
    { ok:true, status:200, payload:{ objectId:'admin-user', username:'organizador', sessionToken:'admin-token' } },
    { ok:true, status:200, payload:{ result:{ isAdmin:true, objectId:'admin-user', username:'organizador' } } }
  );
  const adminMode = await api.enterAdminMode('organizador', 'senha-segura', true);
  assert.equal(adminMode.isAdmin, true, 'valid role verification must unlock admin mode');
  assert.equal(api.readSession().kind, 'admin', 'active session must become administrative');
  assert.equal(api.getSessionToken(), 'admin-token');
  assert.equal(JSON.parse(localStorage.getItem('bsr_pre_admin_session')).sessionToken, 'driver-token', 'driver session must be preserved before switching accounts');

  responseQueue.push({ ok:true, status:200, payload:{} });
  const restored = await api.leaveAdminMode();
  assert.equal(restored.sessionToken, 'driver-token', 'leaving admin mode must restore the prior driver session');
  assert.equal(api.readSession().kind, 'driver');
  assert.equal(localStorage.getItem('bsr_pre_admin_session'), null, 'temporary return session must be removed after restoration');

  responseQueue.push({ ok:true, status:201, payload:{ objectId:'race-1' } });
  await api.saveAdminRace({ title:'GT3 Sprint', duration:45 });
  const savedRace = JSON.parse(requests.at(-1).options.body);
  assert.equal(savedRace.duration, '45', 'race duration must respect the historical String schema');
  assert.equal(requests.at(-1).options.method, 'POST');

  for (const file of ['index.html', 'login.html', 'steam_callback.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /Content-Security-Policy/i, `${file} must declare a CSP`);
  }

  const callback = fs.readFileSync(path.join(root, 'steam_callback.html'), 'utf8');
  assert.match(callback, /received!==expected/, 'browser callback must verify its state');

  const apiClient = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
  const components = fs.readFileSync(path.join(root, 'app', 'components.js'), 'utf8');
  assert.match(apiClient, /async getRaceResults\(sessionId, raceId\)[\s\S]*?cloud\('getRaceResults',[\s\S]*?raceId:/, 'the launcher must query published results by session and race id');
  assert.match(components, /race\.resultsSessionId \|\| race\.sessionId[\s\S]*?getRaceResults\(resultsKey, race\.id\)/, 'the results drawer must prefer the canonical publication link');

  const cloud = fs.readFileSync(path.join(root, 'cloud', 'main.js'), 'utf8');
  assert.doesNotMatch(cloud, /Parse\.Cloud\.httpRequest/, 'removed Parse API must not be used');
  assert.match(cloud, /check_authentication/, 'Steam response must be verified server-side');
  assert.match(cloud, /AuthChallenge/, 'Steam login must use a one-time challenge');
  assert.match(cloud, /beforeFind\(className, requireAdminAccess\)/, 'sensitive direct reads must be guarded');
  assert.match(cloud, /Parse\.Cloud\.define\('previewRaceImport',[\s\S]*?requireAdmin\(request\)/, 'race import preview must require an admin');
  assert.match(cloud, /Parse\.Cloud\.define\('commitRaceImport',[\s\S]*?requireAdmin\(request\)/, 'race import commit must require an admin');
  assert.match(cloud, /Parse\.Cloud\.define\('getRaceResults',[\s\S]*?request\.params\.raceId[\s\S]*?equalTo\('raceId', raceId\)/, 'published results must be retrievable through the selected race id');
  assert.match(cloud, /race\.set\(\{ status:'encerrada', resultsPublished:true, sessionId:payload\.importKey, resultsSessionId:payload\.importKey/, 'published imports must persist both legacy and canonical result links');
  assert.match(cloud, /missingWithSteam[\s\S]*?reconcileSteamDriver\(entry\.item\.steamGUID/, 'unknown race participants must receive an idempotent Steam-linked rating profile');
  assert.match(cloud, /driver:item\.steamGUID \? \(bySteam\.get\(item\.steamGUID\)/, 'official imports must resolve identities by SteamID instead of matching another driver by name');
  assert.doesNotMatch(cloud, /Pilotos sem cadastro:/, 'valid server results must not be blocked only because a Driver profile does not exist yet');
  const classificationComparator = cloud.match(/function compareClassification\([\s\S]*?\n}/)?.[0] || '';
  assert.match(classificationComparator, /finishPosition - right\.finishPosition/, 'the backend must preserve the reviewed official finishing order');
  assert.doesNotMatch(classificationComparator, /totalTimeMs|lapsCompleted|statusOrder/, 'elapsed time, lap count or status must not silently replace an official position');
  assert.match(cloud, /entry\.officialPosition = entry\.item\.finishPosition/, 'the published overall position must equal the reviewed imported position');
  assert.match(cloud, /Parse\.Cloud\.define\('migrateRatingsV2',[\s\S]*?requireAdmin\(request\)/, 'interactive rating migration must require an admin');
  assert.match(cloud, /Parse\.Cloud\.job\('migrateRatingsV2Job'/, 'rating migration must expose a dashboard-only Cloud Job fallback');
  assert.match(cloud, /Parse\.Cloud\.define\('migrateRatingsV3',[\s\S]*?requireAdmin\(request\)/, 'v3 rating migration must require an admin');
  assert.match(cloud, /Parse\.Cloud\.job\('migrateRatingsV3Job'/, 'v3 rating migration must expose a dashboard-only Cloud Job fallback');
  assert.match(cloud, /Parse\.Cloud\.define\('refreshSteamProfile',[\s\S]*?requireUser\(request\)/, 'Steam profile refresh must require a session');
  assert.match(cloud, /Parse\.Cloud\.define\('updateMyDriverProfile',[\s\S]*?requireUser\(request\)/, 'profile editing must require a session');
  assert.match(cloud, /Parse\.Cloud\.define\('getPublicDriverProfile'/, 'public driver profiles must use a sanitized Cloud function');
  assert.match(cloud, /Parse\.Cloud\.define\('getHubAccessStatus'/, 'hub access must be validated by Cloud Code');
  assert.match(cloud, /Parse\.Cloud\.define\('setHubAccessMode',[\s\S]*?requireAdmin\(request\)/, 'only admins may change the hub access mode');
  assert.match(cloud, /Parse\.Cloud\.define\('setHubAccessGrant',[\s\S]*?requireAdmin\(request\)/, 'only admins may change the invite list');
  assert.match(cloud, /Parse\.Cloud\.define\('getPublicDrivers',[\s\S]*?requireHubAccess\(request\)/, 'public driver data must obey the hub access policy');
  assert.match(cloud, /Parse\.Cloud\.beforeFind\(className, requireHubReadAccess\)/, 'direct race and championship reads must obey the hub access policy');
  assert.match(cloud, /HubAccessPolicy[\s\S]*?HubAccessGrant/, 'access policy and grants must be protected classes');
  assert.doesNotMatch(cloud.match(/Parse\.Cloud\.define\('getPublicDriverProfile',[\s\S]*?\n}\);/)?.[0] || '', /steamGUID|\buser\b/, 'public profile DTO must not expose account identifiers');
  assert.match(cloud, /RaceImports/, 'race imports must have a protected audit class');
  assert.match(cloud, /Parse\.Cloud\.define\('getContentCatalog'/, 'content catalog must use a sanitized Cloud function');
  assert.match(cloud, /Parse\.Cloud\.define\('getRaceLaunchConfig',[\s\S]*?requireHubUser\(request\)/, 'server credentials must require an authorized user session');
  assert.match(cloud, /new Parse\.Query\('RaceConnection'\)/, 'server credentials must live in the protected RaceConnection class');
  assert.doesNotMatch(cloud, /race\.set\(\{[^}]*serverPassword/, 'server password must not be written to the public race object');
  assert.match(cloud, /requiresRegistration = race\.get\('requiresRegistration'\) !== false/, 'launch authorization must respect the per-race registration flag');
  assert.match(cloud, /requiresRegistration && !reservation/, 'only registration-required races may block unregistered drivers');
  assert.match(cloud, /race\.get\('requiresRegistration'\) === false[\s\S]*?não aceita inscrições/, 'free-access races must reject unnecessary reservations');
  assert.match(cloud, /Parse\.Cloud\.define\('upsertContentPackage',[\s\S]*?requireAdmin\(request\)/, 'content publishing must require an admin');
  assert.match(cloud, /Parse\.Cloud\.define\('setContentServerProfile',[\s\S]*?requireAdmin\(request\)/, 'primary server changes must require an admin');
  assert.match(cloud, /new Parse\.Object\('ServerProfile'\)/, 'the single server profile must use a private class');
  assert.match(cloud, /ServerProfile'[\s\S]*?beforeFind\(className, requireAdminAccess\)/, 'the server profile must reject public direct reads');
  assert.match(cloud, /setRaceContentConfig'[\s\S]*?Configure o servidor principal antes/, 'race requirements must not be saved before the single server is configured');
  assert.match(cloud, /ensurePrimaryServerProfile/, 'legacy per-race connection must migrate to the shared server profile');
  assert.match(cloud, /getRaceLaunchConfig'[\s\S]*?primaryServerProfile\(\)/, 'race launches must resolve the shared primary server');
  assert.match(cloud, /requiredCarTargets[\s\S]*?approvedConfiguredCar[\s\S]*?approvedHint/, 'race launch must ignore stale car IDs that no longer belong to the required packages');
  assert.match(cloud, /inferRequestedCar\(race, requiredPackages/, 'race launches must infer the local car id from approved requirements');
  assert.match(cloud, /approvedHint = requiredCarTargets\.find/, 'renderer car hints must be restricted to approved race requirements');
  assert.match(cloud, /beforeFind\(className, requireAdminAccess\)/, 'content records must not allow direct public reads');
  assert.match(cloud, /reconcileSteamDriver/, 'Steam identities must be reconciled to one canonical driver');
  assert.match(cloud, /hiddenFromPublic/, 'merged driver records must be hidden from public listings');
  assert.doesNotMatch(cloud, /\.map\(driverDTO\)/, 'public DTO callbacks must not accidentally receive the array index as a privacy flag');

  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(main, /127\.0\.0\.1/, 'desktop callback must bind to loopback');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'preload.js'), 'utf8'), /openExternal\s*:/, 'renderer must not expose arbitrary external navigation');
  const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  assert.match(admin, /index\.html#\/admin/, 'legacy admin URL must redirect into the launcher');
  const views = fs.readFileSync(path.join(root, 'app', 'views.js'), 'utf8');
  assert.match(views, /id="adminRaceRegistration"/, 'integrated race editor must expose the registration option');
  assert.match(views, /requiresRegistration:document\.getElementById\('adminRaceRegistration'\)\.checked/, 'integrated admin must persist the selected registration mode');
  assert.match(views, /duration:document\.getElementById\('adminRaceDuration'\)\.value\.trim\(\)/, 'race editor must send duration as a String');
  assert.doesNotMatch(views, /duration:Number\(document\.getElementById\('adminRaceDuration'\)/, 'race editor must not recreate the duration schema mismatch');
  assert.match(views, /launcherAdminLogin/, 'launcher must contain an integrated administrative login');
  const apiSource = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
  assert.match(apiSource, /enterAdminMode/, 'API must support entering admin mode inside the launcher');
  assert.match(apiSource, /ADMIN_RETURN_KEY/, 'admin mode must preserve the previous driver session');
  assert.match(apiSource, /setContentServerProfile/, 'admin API must expose the single server profile operation');
  assert.match(apiSource, /getHubAccessStatus/, 'API must expose the server-validated access status');
  assert.match(apiSource, /setHubAccessGrant/, 'admin API must expose invite management');

  const appSource = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  assert.match(appSource, /renderAccessGate/, 'launcher must render a dedicated invite-only gate');
  assert.match(appSource, /name !== 'admin'/, 'organization login must remain reachable while the public hub is restricted');

  const contentView = fs.readFileSync(path.join(root, 'app', 'content.js'), 'utf8');
  assert.match(contentView, /Assistente de publicação/, 'content administration must use the guided publisher');
  assert.match(contentView, /SERVIDOR ÚNICO/, 'content administration must expose one shared server');
  assert.match(contentView, /packages\.filter\(item => item\.approved && item\.enabled !== false\)/, 'race requirements must only list published packages');
  assert.match(contentView, /recommendedRaceCar/, 'race requirements must suggest the playable car from package metadata');

  console.log('Security/auth checks passed.');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
