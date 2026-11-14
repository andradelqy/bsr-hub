'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BsrTelemetryUploader, parseTelemetryLog, fileIdentity, CHUNK_BYTES } = require('../launcher/telemetry/uploader');

(async () => {
  const records = [
    { type:'session_start', sessionId:'12345678-abcd-1234-abcd-1234567890ab', raceId:'race123', steamId:'76561198000000000', driverName:'Pilot BSR', serverHost:'server.example.com', serverPort:9600, track:'spa', carModel:'ks_ferrari_f40', startedAt:1793650000 },
    { type:'sample', speedKmh:203.2, accG:[0.1,0.2,1.0], damage:[0,0,0,0,0] },
    { type:'impact_candidate', classification:'CLIENT_IMPACT_CANDIDATE', affectsSafety:false, affectsMpr:false },
    { type:'session_end', endedAt:1793651200, samples:12000, events:1 }
  ];
  const log = records.map(item => JSON.stringify(item)).join('\n');
  const session = parseTelemetryLog(log);
  assert.equal(session.sessionId, records[0].sessionId);
  assert.equal(session.raceId, 'race123');
  assert.equal(session.steamId, '76561198000000000');
  assert.equal(session.samples, 12000);
  assert.equal(session.events, 1);
  assert.equal(parseTelemetryLog(JSON.stringify(records[0])), null, 'open/incomplete session must not upload');
  assert.equal(parseTelemetryLog('not json\n{}'), null);
  assert.equal(CHUNK_BYTES, 8 * 1024 * 1024);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bsr-uploader-test-'));
  try {
    const docs = path.join(root, 'Documents');
    const acRoot = path.join(docs, 'Assetto Corsa');
    const logDir = path.join(acRoot, 'logs', 'BSR');
    const replayDir = path.join(acRoot, 'replay');
    await fs.mkdir(logDir, { recursive:true });
    await fs.mkdir(replayDir, { recursive:true });
    const logPath = path.join(logDir, 'bsr_telemetry_test.jsonl');
    await fs.writeFile(logPath, log, 'utf8');
    const replayPath = path.join(replayDir, 'session_test.acreplay');
    await fs.writeFile(replayPath, Buffer.from('replay evidence'));

    const uploader = new BsrTelemetryUploader({
      appId:'test-app',
      clientKey:'test-client-key',
      documentsDir:docs,
      userData:path.join(root, 'state'),
      chunkBytes:4
    });
    await uploader.initialize();
    uploader.sessionToken = 'r:test-session-token-12345';
    const uploaded = [];
    uploader._uploadFile = async (filePath, kind, value) => {
      uploaded.push({ filePath, kind, sessionId:value.sessionId });
    };

    const now = Date.now();
    await fs.utimes(logPath, now / 1000 - 30, now / 1000 - 30);
    const logStat = await fs.stat(logPath);
    uploader.stability.set(logPath, {
      identity:fileIdentity(logPath, logStat),
      firstSeenAt:now - 30000,
      stableScans:2
    });
    await uploader._considerTelemetry(logPath);
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].kind, 'telemetry');
    assert.equal(uploader.sessions.length, 1);

    const endTime = session.endedAt * 1000;
    await fs.utimes(replayPath, endTime / 1000, endTime / 1000);
    const replayStat = await fs.stat(replayPath);
    uploader.stability.set(replayPath, {
      identity:fileIdentity(replayPath, replayStat),
      firstSeenAt:now - 30000,
      stableScans:2
    });
    await uploader._considerReplay(replayPath);
    assert.equal(uploaded.length, 2);
    assert.equal(uploaded[1].kind, 'replay');
    assert.equal(uploaded[1].sessionId, session.sessionId);

    const state = JSON.parse(await fs.readFile(path.join(root, 'state', 'telemetry-upload-state.json'), 'utf8'));
    assert.equal(state.uploaded.length, 2);
    assert.equal(state.sessions.length, 1);
    uploader.close();
    console.log('BSR telemetry uploader: parsing, session correlation and replay association OK.');
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
