'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { AcToolsBridge } = require('../actools-bridge');
const { BSRContentManager, sanitizePackageMetadata } = require('../content-manager');

(async () => {
  const base = path.resolve(__dirname, '..', 'native', 'bsr-actools-bridge');
  const executable = path.join(base, 'dist', 'bsr-actools-bridge.exe');
  const internalRuntime = path.join(base, 'dist', 'AcManager.Internal.dll');
  const archive = path.join(base, 'fixtures', 'bsr_test_car.zip');
  const rarArchive = path.join(base, 'fixtures', 'bsr_test_car.rar');
  const sevenZipArchive = path.join(base, 'fixtures', 'bsr_test_track.7z');
  const trackArchive = path.join(base, 'fixtures', 'bsr_test_track.zip');
  const legacyAppArchive = path.join(base, 'fixtures', 'bsr_test_legacy_app.zip');
  const acRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsr-actools-ipc-'));
  fs.mkdirSync(path.join(acRoot, 'apps'), { recursive:true });
  fs.mkdirSync(path.join(acRoot, 'content', 'cars'), { recursive:true });
  fs.mkdirSync(path.join(acRoot, 'content', 'tracks'), { recursive:true });
  fs.writeFileSync(path.join(acRoot, 'acs.exe'), '');
  fs.writeFileSync(path.join(acRoot, 'AssettoCorsa.exe'), '');
  assert.ok(fs.existsSync(executable), 'compile o bridge antes do teste');
  assert.ok(fs.existsSync(internalRuntime), 'AcManager.Internal.dll deve acompanhar o bridge');
  assert.ok(fs.existsSync(archive), 'fixture ZIP ausente');

  const bridge = new AcToolsBridge({ executable, timeoutMs: 30000 });
  const progress = [];
  bridge.on('progress', value => progress.push(value));
  try {
    const ready = await bridge.start();
    assert.equal(ready.processArchitecture, 'x86', 'o bridge deve usar a arquitetura do AcManager.Internal original');
    assert.equal(ready.encoding, 'utf-8', 'o protocolo IPC deve preservar mensagens em português');
    const result = await bridge.request('inspect', { archive, acRoot });
    assert.equal(result.ok, true);
    assert.equal(result.entries[0].kind, 'CarContentEntry');
    assert.equal(result.entries[0].id, 'bsr_test_car');
    assert.ok(progress.length > 0, 'o bridge deve transmitir progresso');

    for (const candidate of [rarArchive, sevenZipArchive]) {
      const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'bsr-actools-extract-'));
      try {
        const extracted = await bridge.request('extract', { archive:candidate, destination });
        assert.equal(extracted.ok, true);
        assert.ok(extracted.files.length > 0, `${path.extname(candidate)} deve ser extraído pelo SharpCompress do AcTools`);
        assert.ok(extracted.files.every(file => fs.existsSync(path.join(destination, ...file.split('/')))));
      } finally {
        fs.rmSync(destination, { recursive:true, force:true });
      }
    }
    const abortedDestination = fs.mkdtempSync(path.join(os.tmpdir(), 'bsr-actools-abort-'));
    try {
      const controller = new AbortController(); controller.abort();
      await assert.rejects(bridge.request('extract', { archive, destination:abortedDestination }, null, controller.signal), error => error?.name === 'AbortError');
    } finally {
      fs.rmSync(abortedDestination, { recursive:true, force:true });
    }

    const archiveBuffer = fs.readFileSync(archive);
    const userData = path.join(acRoot, '.bsr-test-state');
    const originalFile = path.join(acRoot, 'content', 'cars', 'bsr_test_car', 'data', 'car.ini');
    fs.mkdirSync(path.dirname(originalFile), { recursive:true });
    fs.writeFileSync(originalFile, 'original local file');
    const pkg = sanitizePackageMetadata({
      objectId:'actoolsPkg1', slug:'bsr-test-car', name:'BSR Test Car', version:'1.0.0', type:'car', targetId:'bsr_test_car',
      downloadUrl:'https://cdn.example.com/bsr_test_car.zip',
      sha256:crypto.createHash('sha256').update(archiveBuffer).digest('hex'), sizeBytes:archiveBuffer.length
    });
    const manager = new BSRContentManager({
      app:{ getPath:name => name === 'userData' ? userData : path.join(acRoot, '.documents') },
      dialog:{}, net:{}, BrowserWindow:{}, actools:bridge
    });
    await manager.initialize();
    manager.state.gamePath = acRoot;
    manager.state.downloads[pkg.slug] = { version:pkg.version, path:archive, sha256:pkg.sha256, sizeBytes:pkg.sizeBytes };
    manager.canonicalPackage = async () => pkg;
    const installed = await manager.install({ objectId:pkg.objectId });
    assert.equal(installed.engine, 'actools');
    assert.equal(installed.files, 3);
    assert.equal(manager.state.installs[pkg.slug].engine, 'actools');
    assert.equal((await manager.verify(pkg.slug)).valid, true);
    assert.notEqual(fs.readFileSync(originalFile, 'utf8'), 'original local file');
    await manager.uninstall(pkg.slug, true);
    assert.equal(fs.readFileSync(originalFile, 'utf8'), 'original local file', 'uninstall must restore pre-AcTools file');

    const rarBuffer = fs.readFileSync(rarArchive);
    const rarPkg = sanitizePackageMetadata({
      objectId:'actoolsRar1', slug:'bsr-test-car-rar', name:'BSR Test Car RAR', version:'1.0.0', type:'car', targetId:'cars', contentPath:'wrong/missing/folder',
      downloadUrl:'https://cdn.example.com/bsr_test_car.rar',
      sha256:crypto.createHash('sha256').update(rarBuffer).digest('hex'), sizeBytes:rarBuffer.length
    });
    const mislabeledRar = path.join(manager.downloadRoot, `${rarPkg.slug}-${rarPkg.version}.zip`);
    fs.copyFileSync(rarArchive, mislabeledRar);
    manager.state.downloads[rarPkg.slug] = { version:rarPkg.version, path:mislabeledRar, sha256:rarPkg.sha256, sizeBytes:rarPkg.sizeBytes };
    manager.canonicalPackage = async () => rarPkg;
    const rarInstalled = await manager.install({ objectId:rarPkg.objectId });
    assert.equal(rarInstalled.engine, 'actools');
    assert.equal(manager.state.installs[rarPkg.slug].detectedEntries[0].id, 'bsr_test_car', 'generic target “cars” must be replaced by the AcTools content ID');
    assert.equal(manager.state.installs[rarPkg.slug].sourceStrategy, 'actools', 'AcTools entryPath must recover an outdated catalog contentPath');
    assert.equal(path.extname(manager.state.downloads[rarPkg.slug].path), '.rar', 'um RAR antigo salvo como ZIP deve ser corrigido pelo conteúdo real');
    assert.equal((await manager.verify(rarPkg.slug)).valid, true);
    await manager.uninstall(rarPkg.slug, true);
    assert.equal(fs.readFileSync(originalFile, 'utf8'), 'original local file', 'RAR uninstall must restore pre-AcTools file');

    const trackBuffer = fs.readFileSync(trackArchive);
    const trackPkg = sanitizePackageMetadata({
      objectId:'actoolsTrack1', slug:'bsr-test-track', name:'BSR Test Track', version:'1.0.0', type:'track', targetId:'tracks', contentPath:'wrong/missing/folder',
      downloadUrl:'https://cdn.example.com/bsr_test_track.zip',
      sha256:crypto.createHash('sha256').update(trackBuffer).digest('hex'), sizeBytes:trackBuffer.length
    });
    manager.state.downloads[trackPkg.slug] = { version:trackPkg.version, path:trackArchive, sha256:trackPkg.sha256, sizeBytes:trackPkg.sizeBytes };
    manager.canonicalPackage = async () => trackPkg;
    const trackInstalled = await manager.install({ objectId:trackPkg.objectId });
    assert.equal(trackInstalled.engine, 'actools');
    assert.equal(manager.state.installs[trackPkg.slug].detectedEntries[0].id, 'bsr_test_track');
    assert.equal((await manager.verify(trackPkg.slug)).valid, true);
    assert.equal(fs.existsSync(path.join(acRoot, 'content', 'tracks', 'bsr_test_track', 'ui', 'Thumbs.db')), false, 'AcTools intentionally ignores Windows metadata');
    await manager.uninstall(trackPkg.slug, true);

    const legacyAppBuffer = fs.readFileSync(legacyAppArchive);
    const legacyAppPkg = sanitizePackageMetadata({
      objectId:'legacyApp1', slug:'bsr-legacy-app', name:'BSR Legacy App', version:'1.0.0', type:'app', targetId:'bsr_legacy_app', contentPath:'wrong/app/path',
      downloadUrl:'https://cdn.example.com/bsr_test_legacy_app.zip',
      sha256:crypto.createHash('sha256').update(legacyAppBuffer).digest('hex'), sizeBytes:legacyAppBuffer.length
    });
    const legacyIcon = path.join(acRoot, 'content', 'gui', 'icons', 'bsr_legacy_app.txt');
    fs.mkdirSync(path.dirname(legacyIcon), { recursive:true });
    fs.writeFileSync(legacyIcon, 'original icon');
    manager.state.downloads[legacyAppPkg.slug] = { version:legacyAppPkg.version, path:legacyAppArchive, sha256:legacyAppPkg.sha256, sizeBytes:legacyAppPkg.sizeBytes };
    manager.canonicalPackage = async () => legacyAppPkg;
    const legacyInstalled = await manager.install({ objectId:legacyAppPkg.objectId });
    assert.equal(legacyInstalled.engine, 'bsr-secure-copy', 'unrecognized but structurally safe apps must use the restricted fallback');
    assert.equal(manager.state.installs[legacyAppPkg.slug].sourceStrategy, 'secure-game-root');
    assert.equal((await manager.verify(legacyAppPkg.slug)).valid, true);
    assert.ok(fs.existsSync(path.join(acRoot, 'apps', 'python', 'bsr_legacy_app', 'bsr_legacy_app.py')));
    assert.notEqual(fs.readFileSync(legacyIcon, 'utf8'), 'original icon');
    await manager.uninstall(legacyAppPkg.slug, true);
    assert.equal(fs.readFileSync(legacyIcon, 'utf8'), 'original icon', 'secure fallback uninstall must restore overwritten files');
    assert.equal(fs.existsSync(path.join(acRoot, 'apps', 'python', 'bsr_legacy_app', 'bsr_legacy_app.py')), false);
  } finally {
    await bridge.close();
    fs.rmSync(acRoot, { recursive:true, force:true });
  }
  console.log('AcTools bridge IPC: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
