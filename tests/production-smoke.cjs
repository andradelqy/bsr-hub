const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'config.js'), 'utf8'), context);
const { APP_ID, REST_API_KEY, BASE_URL } = context.window;
const headers = {
  'X-Parse-Application-Id': APP_ID,
  'X-Parse-REST-API-Key': REST_API_KEY,
  'Content-Type': 'application/json'
};

async function request(endpoint, options = {}) {
  const response = await fetch(BASE_URL + endpoint, { ...options, headers: { ...headers, ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

(async () => {
  const challenge = await request('/functions/beginSteamAuth', { method: 'POST', body: '{}' });
  assert.equal(challenge.response.ok, true, challenge.payload.error);
  assert.match(challenge.payload.result?.state || '', /^[A-Za-z0-9_-]{40,128}$/);

  const accessCall = await request('/functions/getHubAccessStatus', { method:'POST', body:'{}' });
  const legacyOpen = !accessCall.response.ok && accessCall.payload.code === 141 && /function|função/i.test(accessCall.payload.error || '');
  if (!legacyOpen) {
    assert.equal(accessCall.response.ok, true, accessCall.payload.error);
    assert.ok(['open', 'invite'].includes(accessCall.payload.result?.mode), 'invalid hub access mode');
    console.log(`Hub access mode: ${accessCall.payload.result.mode}`);
  }
  const anonymousHubAllowed = legacyOpen || accessCall.payload.result?.allowed === true;

  let publicDrivers = [];
  for (const functionName of ['getPublicDrivers', 'getPublicStandings', 'getNotifications', 'getContentCatalog']) {
    const call = await request(`/functions/${functionName}`, { method: 'POST', body: '{}' });
    if (!anonymousHubAllowed) {
      assert.equal(call.response.ok, false, `${functionName} unexpectedly bypassed invite-only mode`);
      assert.equal(call.payload.code, 206, `${functionName} should require a session in invite-only mode`);
      continue;
    }
    assert.equal(call.response.ok, true, `${functionName}: ${call.payload.error}`);
    assert.ok(Array.isArray(call.payload.result), `${functionName} should return an array`);
    if (functionName === 'getPublicDrivers') {
      publicDrivers = call.payload.result;
      for (const driver of publicDrivers) {
        assert.equal('steamGUID' in driver, false, 'public standings expose SteamID');
        assert.doesNotMatch(String(driver.name || ''), /^piloto(?:[_\s-]*\d+)?$/i, 'placeholder driver reached the public standings');
      }
    }
  }

  if (publicDrivers[0]?.objectId) {
    const profile = await request('/functions/getPublicDriverProfile', { method: 'POST', body: JSON.stringify({ driverId:publicDrivers[0].objectId }) });
    assert.equal(profile.response.ok, true, `getPublicDriverProfile: ${profile.payload.error}`);
    assert.equal(profile.payload.result?.objectId, publicDrivers[0].objectId);
    assert.equal('steamGUID' in profile.payload.result, false, 'public profile exposes SteamID');
    assert.equal('user' in profile.payload.result, false, 'public profile exposes account relation');
  }

  const races = await request('/classes/Races?limit=1');
  if (anonymousHubAllowed) {
    assert.equal(races.response.ok, true, races.payload.error);
    for (const race of races.payload.results || []) assert.equal('serverPassword' in race, false, 'public Races exposes a server password');
  } else {
    assert.equal(races.response.ok, false, 'Races unexpectedly bypasses invite-only mode');
    assert.equal(races.payload.code, 206, 'Races should require a session in invite-only mode');
  }

  const protectedFunctions = ['getRaceProcessorContext', 'previewRaceImport', 'commitRaceImport', 'getRatingPublicationStatus', 'initializeRatingPublication', 'refreshSteamProfile', 'updateMyDriverProfile', 'repairDriverIdentities', 'getContentAdminContext', 'upsertContentPackage', 'setContentServerProfile', 'setRaceContentConfig', 'getRaceLaunchConfig'];
  if (!legacyOpen) protectedFunctions.push('getHubAccessAdminContext', 'setHubAccessMode', 'setHubAccessGrant');
  for (const functionName of protectedFunctions) {
    const call = await request(`/functions/${functionName}`, { method: 'POST', body: '{}' });
    assert.equal(call.response.ok, false, `${functionName} unexpectedly allows anonymous use`);
    assert.equal(call.payload.code, 206, `${functionName} should require a session before processing data`);
  }

  const protectedClasses = ['Driver', 'CarReservations', 'Reports', 'AuditLog', 'RaceImports', 'ContentPackage', 'RaceConnection', 'ServerProfile', '_Role', '_Session'];
  if (!legacyOpen) protectedClasses.push('HubAccessPolicy', 'HubAccessGrant');
  for (const className of protectedClasses) {
    const direct = await request(`/classes/${className}?limit=1`);
    if (className === '_Role') {
      // Parse applies each role object's ACL after accepting the collection query.
      // A secured role therefore returns HTTP 200 with no rows instead of HTTP 403.
      assert.equal(direct.response.ok, true, direct.payload.error);
      assert.deepEqual(direct.payload.results, [], '_Role unexpectedly exposes anonymous rows');
      continue;
    }

    assert.equal(direct.response.ok, false, `${className} unexpectedly allows anonymous direct reads`);
  }

  console.log('Production Back4App smoke checks passed.');
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
