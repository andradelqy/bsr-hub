const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const {
  BSRContentManager,
  sanitizePackageMetadata,
  validateArchiveEntry,
  detectArchiveLayout,
  isOptionalArchiveMetadata,
  isInside,
  parseSteamLibraries,
  updateIniSections,
  cleanSessionToken,
  detectArchiveFormat,
  resolveServerTrack,
  normalizeOnlineServerInformation,
  googleDriveFileId,
  canonicalGoogleDriveUrl,
  googleDriveConfirmationUrl
} = require('../content-manager');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(nameValue, contentValue) {
  const name = Buffer.from(nameValue.replaceAll('\\', '/'));
  const content = Buffer.from(contentValue);
  const checksum = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(content.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(content.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(name.length, 28);
  const directoryOffset = local.length + name.length + content.length;
  const directorySize = central.length + name.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([local, name, content, central, name, end]);
}

const valid = sanitizePackageMetadata({
  objectId:'abc123', slug:'bsr-gt3', name:'BSR GT3', version:'1.2.0', type:'car', targetId:'bsr_gt3',
  downloadUrl:'https://cdn.example.com/bsr-gt3.zip', sha256:'a'.repeat(64), sizeBytes:1024, dependencies:['base-pack']
});
assert.equal(valid.slug, 'bsr-gt3');
assert.equal(valid.type, 'car');
assert.deepEqual(valid.dependencies, ['base-pack']);
assert.throws(() => sanitizePackageMetadata({ ...valid, downloadUrl:'http://example.com/file.zip' }), /HTTPS/);
assert.throws(() => sanitizePackageMetadata({ ...valid, sha256:'1234' }), /SHA-256/);
assert.throws(() => sanitizePackageMetadata({ ...valid, type:'root' }), /não permitido/);

assert.equal(validateArchiveEntry('content/cars/bsr/file.kn5'), 'content/cars/bsr/file.kn5');
assert.throws(() => validateArchiveEntry('../outside.exe'), /fora/);
assert.throws(() => validateArchiveEntry('C:\\Windows\\file.dll'), /absoluto/);
assert.equal(isInside('C:\\Games\\AC', 'C:\\Games\\AC\\content\\cars'), true);
assert.equal(isInside('C:\\Games\\AC', 'C:\\Games\\Other'), false);
assert.equal(isOptionalArchiveMetadata('content/tracks/test/ui/Thumbs.db'), true);
assert.equal(isOptionalArchiveMetadata('content\\tracks\\test\\desktop.ini'), true);
assert.equal(isOptionalArchiveMetadata('__MACOSX/content/track/._models.ini'), true);
assert.equal(isOptionalArchiveMetadata('content/tracks/test/test.kn5'), false);
assert.equal(cleanSessionToken('r:valid_session-token-12345'), 'r:valid_session-token-12345');
assert.throws(() => cleanSessionToken('short'), /Sessão/);

const detectedCar = detectArchiveLayout([
  'content/cars/bsr_gt3/data.acd',
  'content/cars/bsr_gt3/ui/ui_car.json',
  'content/cars/bsr_gt3/bsr_gt3.kn5'
]);
assert.equal(detectedCar.type, 'car');
assert.equal(detectedCar.targetId, 'bsr_gt3');
assert.equal(detectedCar.slug, 'bsr-gt3');
assert.equal(detectedCar.confidence, 'high');

const detectedSkin = detectArchiveLayout([
  'content/cars/ks_ferrari_488_gt3/skins/bsr_21/ui_skin.json',
  'content/cars/ks_ferrari_488_gt3/skins/bsr_21/livery.png'
]);
assert.equal(detectedSkin.type, 'skin');
assert.equal(detectedSkin.targetId, 'ks_ferrari_488_gt3');
assert.equal(detectedSkin.name, 'Bsr 21');

const detectedTrack = detectArchiveLayout([
  'interlagos/ui/ui_track.json',
  'interlagos/models.ini',
  'interlagos/interlagos.kn5'
]);
assert.equal(detectedTrack.type, 'track');
assert.equal(detectedTrack.targetId, 'interlagos');
assert.equal(detectedTrack.contentPath, 'interlagos');
assert.equal(detectedTrack.confidence, 'medium');

const libraries = parseSteamLibraries('"path" "D:\\\\SteamLibrary"\n"path" "E:\\\\Games"');
assert.deepEqual(libraries, ['D:\\SteamLibrary', 'E:\\Games']);

const ini = updateIniSections('[RACE]\r\nMODEL=car\r\n\r\n[REMOTE]\r\nACTIVE=0\r\nSERVER_IP=old', {
  REMOTE:{ SERVER_IP:'race.bsr.com.br', SERVER_PORT:9600, ACTIVE:1 }, AUTOSPAWN:{ ACTIVE:1 }
});
assert.match(ini, /\[RACE\][\s\S]*MODEL=car/);
assert.match(ini, /\[REMOTE\]\r\nSERVER_IP=race\.bsr\.com\.br\r\nSERVER_PORT=9600\r\nACTIVE=1/);
assert.match(ini, /\[AUTOSPAWN\]\r\nACTIVE=1/);
assert.equal((ini.match(/\[REMOTE\]/g) || []).length, 1);
const correctedJoinIni = updateIniSections('[RACE]\r\nMODEL=old_car\r\nTRACK=rt_daytona\r\nCONFIG_TRACK=sportscar_m4x\r\n\r\n[REMOTE]\r\nSERVER_PORT=8847', {
  RACE:{ MODEL:'urd_radical_sr10xxr_2023', SKIN:'default', TRACK:'zw_midohio', CONFIG_TRACK:'c', CARS:1 },
  REMOTE:{ SERVER_PORT:9847, SERVER_HTTP_PORT:8847, REQUESTED_CAR:'urd_radical_sr10xxr_2023', ACTIVE:1 }
});
assert.doesNotMatch(correctedJoinIni, /rt_daytona|sportscar_m4x|MODEL=old_car/, 'joining must replace stale local race metadata');
assert.match(correctedJoinIni, /\[RACE\]\r\nMODEL=urd_radical_sr10xxr_2023[\s\S]*TRACK=zw_midohio\r\nCONFIG_TRACK=c/);
assert.match(correctedJoinIni, /\[REMOTE\][\s\S]*SERVER_PORT=9847\r\nSERVER_HTTP_PORT=8847/);

assert.deepEqual(resolveServerTrack('zw_midohio', 'zw_midohio-c'), {
  matches:true, track:'zw_midohio', layout:'c', actual:'zw_midohio-c', expected:'zw_midohio'
});
assert.equal(resolveServerTrack('zw_midohio', 'rt_daytona-sportscar_m4x').matches, false);
const onlineSession = normalizeOnlineServerInformation({ track:'zw_midohio-c', cars:['urd_radical_sr10xxr_2023'], port:9847, cport:8847, name:'BSR Radical' }, 8847);
assert.equal(onlineSession.gamePort, 9847, 'the game port must be discovered from the live server instead of reusing the HTTP port');
assert.equal(onlineSession.httpPort, 8847);
assert.deepEqual(onlineSession.cars, ['urd_radical_sr10xxr_2023']);
assert.throws(() => normalizeOnlineServerInformation({ track:'zw_midohio', cars:[], port:9847 }, 8847), /não informou os carros/);

const driveShare = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view?usp=sharing';
assert.equal(googleDriveFileId(driveShare), '1AbCdEfGhIjKlMnOpQrStUvWxYz12345');
assert.match(canonicalGoogleDriveUrl(driveShare), /^https:\/\/drive\.usercontent\.google\.com\/download\?/);
assert.doesNotMatch(canonicalGoogleDriveUrl(driveShare), /authuser/);
const driveGate = '<html><form action="https://drive.usercontent.google.com/download"><input type="hidden" name="id" value="1AbCdEfGhIjKlMnOpQrStUvWxYz12345"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="gate-token"></form></html>';
assert.match(googleDriveConfirmationUrl(driveGate, driveShare), /uuid=gate-token/);

const preload = fs.readFileSync(path.resolve(__dirname, '..', 'preload.js'), 'utf8');
assert.match(preload, /content:\s*Object\.freeze/);
assert.match(preload, /inspectPackage:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('content:inspect-package'\)/);
assert.match(preload, /download:\s*\(pkg, sessionToken\)/);
assert.match(preload, /cancelDownload:\s*slug\s*=>\s*ipcRenderer\.invoke\('content:cancel-download', slug\)/);
assert.match(preload, /cancelInstall:\s*slug\s*=>\s*ipcRenderer\.invoke\('content:cancel-install', slug\)/);
assert.match(preload, /repair:\s*\(pkg, sessionToken\)/);
assert.match(preload, /audit:\s*packages/);
assert.doesNotMatch(preload, /actools:install|actools:inspect/, 'renderer must not bypass the canonical BSR content flow');
assert.doesNotMatch(preload, /writeFile|readFile|exec|spawn/, 'renderer must not receive generic filesystem or process capabilities');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsr-content-test-'));
  try {
    let catalogRequest = null;
    const catalogNet = { fetch:async (_url, options) => {
      catalogRequest = options;
      return { ok:true, json:async () => ({ result:[valid] }) };
    } };
    const catalogManager = new BSRContentManager({ app:{ getPath:() => path.join(root, 'catalog-state') }, dialog:{}, net:catalogNet, BrowserWindow:{} });
    await catalogManager.canonicalPackage({ objectId:valid.objectId }, 'r:valid-session-token-12345');
    assert.equal(catalogRequest.headers['X-Parse-Session-Token'], 'r:valid-session-token-12345', 'catalog validation must forward the authenticated Parse session');

    const userData = path.join(root, 'user-data');
    const documents = path.join(root, 'documents');
    const gamePath = path.join(root, 'assettocorsa');
    fs.mkdirSync(path.join(gamePath, 'content', 'cars', 'bsr_test_car'), { recursive:true });
    fs.writeFileSync(path.join(gamePath, 'AssettoCorsa.exe'), 'test executable');
    fs.writeFileSync(path.join(gamePath, 'content', 'cars', 'bsr_test_car', 'data.acd'), 'original');
    const zipPath = path.join(root, 'bsr-test-car.zip');
    fs.writeFileSync(zipPath, storedZip('bsr_test_car/data.acd', 'installed by BSR'));
    assert.equal(await detectArchiveFormat(zipPath), 'zip');
    assert.equal(await detectArchiveFormat(path.resolve(__dirname, '..', 'native', 'bsr-actools-bridge', 'fixtures', 'bsr_test_car.rar')), 'rar');
    assert.equal(await detectArchiveFormat(path.resolve(__dirname, '..', 'native', 'bsr-actools-bridge', 'fixtures', 'bsr_test_track.7z')), '7z');
    const archive = fs.readFileSync(zipPath);
    const pkg = sanitizePackageMetadata({
      objectId:'pkg123', slug:'bsr-test-car', name:'BSR Test Car', version:'1.0.0', type:'car', targetId:'bsr_test_car',
      downloadUrl:'https://cdn.example.com/bsr-test-car.zip', sha256:crypto.createHash('sha256').update(archive).digest('hex'), sizeBytes:archive.length
    });
    const fakeApp = { getPath:name => name === 'userData' ? userData : documents };

    const mismatchPkg = sanitizePackageMetadata({ ...pkg, objectId:'size123', slug:'size-mismatch', sizeBytes:archive.length - 7 });
    const downloadManager = new BSRContentManager({
      app:{ getPath:name => name === 'userData' ? path.join(root, 'download-state') : documents }, dialog:{}, BrowserWindow:{},
      net:{ fetch:async () => new Response(archive, { status:200, headers:{ 'content-length':String(archive.length) } }) }
    });
    await downloadManager.initialize();
    const progressEvents = [];
    const progressSender = { isDestroyed:() => false, send:(channel, payload) => progressEvents.push({ channel, ...payload }) };
    const tolerantDownload = await downloadManager.downloadCanonical(mismatchPkg, progressSender);
    assert.equal(tolerantDownload.sizeMismatch, true, 'catalog size is informational when the approved SHA-256 matches');
    assert.equal(tolerantDownload.sizeBytes, archive.length);
    assert.equal(downloadManager.state.downloads[mismatchPkg.slug].sizeBytes, archive.length);
    assert.equal(progressEvents[0].phase, 'download');
    assert.equal(progressEvents[0].name, mismatchPkg.name);
    assert.equal(progressEvents.at(-1).phase, 'downloaded');
    assert.equal(progressEvents.at(-1).percent, 100);
    const badHashPkg = sanitizePackageMetadata({ ...pkg, objectId:'hash123', slug:'hash-mismatch', sha256:'b'.repeat(64), sizeBytes:archive.length - 7 });
    await assert.rejects(downloadManager.downloadCanonical(badHashPkg, null), /SHA-256 falhou/, 'a size mismatch must never bypass the approved hash');

    const driveRequests = [];
    const drivePkg = sanitizePackageMetadata({ ...pkg, objectId:'drive123', slug:'drive-confirmation', downloadUrl:driveShare });
    const driveManager = new BSRContentManager({
      app:{ getPath:name => name === 'userData' ? path.join(root, 'drive-state') : documents }, dialog:{}, BrowserWindow:{},
      net:{ fetch:async url => {
        driveRequests.push(String(url));
        return driveRequests.length === 1
          ? new Response(driveGate, { status:200, headers:{ 'content-type':'text/html; charset=utf-8' } })
          : new Response(archive, { status:200, headers:{ 'content-type':'application/octet-stream', 'content-length':String(archive.length) } });
      } }
    });
    await driveManager.initialize();
    const driveDownload = await driveManager.downloadCanonical(drivePkg, null);
    assert.equal(driveDownload.ok, true, 'Google Drive confirmation must resolve to the approved archive');
    assert.equal(driveRequests.length, 2);
    assert.match(driveRequests[1], /uuid=gate-token/);

    const cancelPkg = sanitizePackageMetadata({ ...pkg, objectId:'cancel123', slug:'cancel-test' });
    const cancelEvents = [];
    let readIndex = 0;
    const cancelManager = new BSRContentManager({
      app:{ getPath:name => name === 'userData' ? path.join(root, 'cancel-state') : documents }, dialog:{}, BrowserWindow:{},
      net:{ fetch:async () => ({
        ok:true, status:200, headers:new Headers({ 'content-length':String(archive.length) }),
        body:{ getReader:() => ({
          read:async () => {
            if (readIndex++ === 0) return { done:false, value:archive.subarray(0, Math.max(1, Math.floor(archive.length / 2))) };
            await new Promise(resolve => setTimeout(resolve, 30));
            return { done:false, value:archive.subarray(Math.max(1, Math.floor(archive.length / 2))) };
          },
          cancel:async () => {}
        }) }
      }) }
    });
    await cancelManager.initialize();
    cancelManager.canonicalPackage = async () => cancelPkg;
    const cancelSender = { isDestroyed:() => false, send:(_channel, payload) => cancelEvents.push(payload) };
    const cancelPromise = cancelManager.download({ objectId:cancelPkg.objectId }, cancelSender);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(await cancelManager.cancelDownload(cancelPkg.slug), { ok:true, canceled:true, slug:cancelPkg.slug });
    await assert.rejects(cancelPromise, /cancelado pelo usuário/);
    assert.equal(cancelEvents.at(-1).phase, 'cancelled');
    assert.equal(fs.existsSync(path.join(root, 'cancel-state', 'content-packages', `${cancelPkg.slug}-${cancelPkg.version}.download.part`)), false, 'cancel must remove the partial archive');

    const manager = new BSRContentManager({ app:fakeApp, dialog:{}, net:{}, BrowserWindow:{} });
    await manager.initialize();
    assert.throws(() => manager.validateAcToolsInspection(
      { type:'car', targetId:'ac_friends_renault_rs01_16' },
      { entries:[{ kind:'CarContentEntry', id:'ac_friends_reanult_rs01_16' }] }
    ), /catálogo é “ac_friends_renault_rs01_16”[\s\S]*pacote contém “ac_friends_reanult_rs01_16”/, 'the mismatch must identify both the catalog and archive IDs');
    manager.state.gamePath = gamePath;
    manager.state.downloads[pkg.slug] = { version:pkg.version, path:zipPath, sha256:pkg.sha256, sizeBytes:pkg.sizeBytes };
    manager.canonicalPackage = async () => pkg;
    const installed = await manager.install({ objectId:pkg.objectId });
    assert.equal(installed.files, 1);
    assert.equal(fs.readFileSync(path.join(gamePath, 'content', 'cars', 'bsr_test_car', 'data.acd'), 'utf8'), 'installed by BSR');
    assert.deepEqual(await manager.verify(pkg.slug), { installed:true, valid:true, missing:[], changed:[] });

    fs.writeFileSync(path.join(gamePath, 'content', 'cars', 'bsr_test_car', 'data.acd'), 'modified outside BSR');
    const damaged = await manager.audit([{ slug:pkg.slug, version:pkg.version }]);
    assert.equal(damaged.statuses[pkg.slug].damaged, true, 'audit must detect locally changed files');
    const repaired = await manager.repair({ objectId:pkg.objectId }, null, 'r:valid-session-token-12345');
    assert.equal(repaired.repaired, true);
    assert.equal(fs.readFileSync(path.join(gamePath, 'content', 'cars', 'bsr_test_car', 'data.acd'), 'utf8'), 'installed by BSR');
    assert.equal((await manager.audit([{ slug:pkg.slug, version:pkg.version }])).statuses[pkg.slug].valid, true, 'repair must restore the verified package');

    const conflictZip = path.join(root, 'bsr-conflict.zip');
    fs.writeFileSync(conflictZip, storedZip('bsr_test_car/data.acd', 'conflicting package'));
    const conflictArchive = fs.readFileSync(conflictZip);
    const conflictPkg = sanitizePackageMetadata({
      objectId:'pkg456', slug:'bsr-conflict', name:'BSR Conflict', version:'1.0.0', type:'car', targetId:'bsr_test_car',
      downloadUrl:'https://cdn.example.com/bsr-conflict.zip', sha256:crypto.createHash('sha256').update(conflictArchive).digest('hex'), sizeBytes:conflictArchive.length
    });
    manager.state.downloads[conflictPkg.slug] = { version:conflictPkg.version, path:conflictZip, sha256:conflictPkg.sha256, sizeBytes:conflictPkg.sizeBytes };
    manager.canonicalPackage = async reference => reference.objectId === conflictPkg.objectId ? conflictPkg : pkg;
    await assert.rejects(manager.install({ objectId:conflictPkg.objectId }), /Conflito com outro pacote instalado/);

    await manager.uninstall(pkg.slug, true);
    assert.equal(fs.readFileSync(path.join(gamePath, 'content', 'cars', 'bsr_test_car', 'data.acd'), 'utf8'), 'original', 'uninstall must restore overwritten files');
    console.log('Content manager security and install/uninstall checks passed.');
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
