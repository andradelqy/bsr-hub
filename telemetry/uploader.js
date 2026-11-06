'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const API_HOST = 'parseapi.back4app.com';
const CHUNK_BYTES = 8 * 1024 * 1024;

function requestParse(route, method, headers, body) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: API_HOST,
      port: 443,
      path: route,
      method,
      headers: {
        '[REDACTED_BACK4APP_SECRET]': headers.appId,
        'X-Parse-Client-Key': headers.clientKey,
        'X-Parse-Session-Token': headers.sessionToken,
        ...(headers.contentType ? { 'Content-Type': headers.contentType } : {}),
        ...(body ? { 'Content-Length': body.length } : {})
      }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let payload = {};
        try { payload = text ? JSON.parse(text) : {}; } catch (_) { payload = { error:text }; }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(payload.error || payload.message || ('Back4App HTTP ' + response.statusCode)));
          return;
        }
        resolve(payload);
      });
    });
    request.setTimeout(45000, () => request.destroy(new Error('Timeout ao sincronizar evidência com o BSR.')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function fileIdentity(filePath, stat) {
  return path.resolve(filePath) + '|' + String(stat.size) + '|' + String(stat.mtimeMs);
}

function parseTelemetryLog(text) {
  const records = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch (_) {}
  }
  const start = records.find(item => item.type === 'session_start');
  const end = [...records].reverse().find(item => item.type === 'session_end');
  if (!start || !end || !start.sessionId) return null;
  return {
    sessionId: String(start.sessionId),
    raceId: String(start.raceId || ''),
    steamId: String(start.steamId || ''),
    driverName: String(start.driverName || ''),
    serverHost: String(start.serverHost || ''),
    serverPort: Number(start.serverPort || 0),
    track: String(start.track || ''),
    carModel: String(start.carModel || ''),
    startedAt: Number(start.startedAt || 0),
    endedAt: Number(end.endedAt || 0),
    samples: Number(end.samples || 0),
    events: Number(end.events || 0)
  };
}

class BsrTelemetryUploader {
  constructor(options = {}) {
    this.appId = options.appId || '';
    this.clientKey = options.clientKey || '';
    this.documentsDir = options.documentsDir || '';
    this.userData = options.userData || process.cwd();
    this.intervalMs = Number(options.intervalMs || 12000);
    this.chunkBytes = Number(options.chunkBytes || CHUNK_BYTES);
    this.sessionToken = '';
    this.timer = null;
    this.processing = new Set();
    this.stability = new Map();
    this.sessions = [];
    this.statePath = path.join(this.userData, 'telemetry-upload-state.json');
    this.state = { version:1, uploaded:[], sessions:[] };
    this.started = false;
    this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  }

  async initialize() {
    await fsp.mkdir(this.userData, { recursive:true });
    try {
      const parsed = JSON.parse(await fsp.readFile(this.statePath, 'utf8'));
      this.state = { version:1, uploaded:Array.isArray(parsed.uploaded) ? parsed.uploaded.slice(-1000) : [], sessions:Array.isArray(parsed.sessions) ? parsed.sessions.slice(-50) : [] };
      this.sessions = this.state.sessions;
    } catch (_) {}
  }

  setSessionToken(token) {
    this.sessionToken = typeof token === 'string' && token.length >= 10 ? token : '';
    if (this.sessionToken && !this.timer) {
      this.timer = setInterval(() => this.scanNow().catch(error => this.onStatus({ type:'error', message:error.message })), this.intervalMs);
      this.timer.unref?.();
      this.scanNow().catch(error => this.onStatus({ type:'error', message:error.message }));
    } else if (!this.sessionToken && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return { active:Boolean(this.sessionToken) };
  }

  async _saveState() {
    const temporary = this.statePath + '.tmp';
    this.state.sessions = this.sessions.slice(-50);
    await fsp.writeFile(temporary, JSON.stringify(this.state), 'utf8');
    await fsp.copyFile(temporary, this.statePath);
    await fsp.unlink(temporary).catch(() => {});
  }

  _isUploaded(identity) {
    return this.state.uploaded.includes(identity);
  }

  async _markUploaded(identity) {
    this.state.uploaded.push(identity);
    this.state.uploaded = this.state.uploaded.slice(-1000);
    await this._saveState();
  }

  async _listFiles(directory, extensions) {
    try {
      const entries = await fsp.readdir(directory, { withFileTypes:true });
      const result = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const extension = path.extname(entry.name).toLowerCase();
        if (extensions.has(extension)) result.push(path.join(directory, entry.name));
      }
      return result;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async _isStable(filePath, stat) {
    const identity = fileIdentity(filePath, stat);
    const now = Date.now();
    const previous = this.stability.get(filePath);
    if (!previous || previous.identity !== identity) {
      this.stability.set(filePath, { identity, firstSeenAt:now, stableScans:0 });
      return false;
    }
    previous.stableScans += 1;
    return previous.stableScans >= 2 && now - previous.firstSeenAt >= 20000 && now - stat.mtimeMs >= 15000;
  }

  async scanNow() {
    if (!this.sessionToken || !this.appId || !this.clientKey || !this.documentsDir || this.started) return;
    this.started = true;
    try {
      const acRoot = path.join(this.documentsDir, 'Assetto Corsa');
      const logs = await this._listFiles(path.join(acRoot, 'logs', 'BSR'), new Set(['.jsonl']));
      const replays = await this._listFiles(path.join(acRoot, 'replay'), new Set(['.acreplay', '.rpl']));
      for (const filePath of logs) await this._considerTelemetry(filePath);
      for (const filePath of replays) await this._considerReplay(filePath);
    } finally {
      this.started = false;
    }
  }

  async _considerTelemetry(filePath) {
    if (this.processing.has(filePath)) return;
    const stat = await fsp.stat(filePath);
    const identity = fileIdentity(filePath, stat);
    if (this._isUploaded(identity) || !(await this._isStable(filePath, stat))) return;
    this.processing.add(filePath);
    try {
      const text = await fsp.readFile(filePath, 'utf8');
      const session = parseTelemetryLog(text);
      if (!session || !session.serverHost) return;
      await this._uploadFile(filePath, 'telemetry', session);
      this.sessions = this.sessions.filter(item => item.sessionId !== session.sessionId);
      this.sessions.push({ ...session, logPath:filePath, uploadedAt:Date.now() });
      this.sessions = this.sessions.slice(-50);
      await this._markUploaded(identity);
      this.onStatus({ type:'uploaded', kind:'telemetry', file:path.basename(filePath), sessionId:session.sessionId });
    } finally {
      this.processing.delete(filePath);
    }
  }

  async _considerReplay(filePath) {
    if (this.processing.has(filePath)) return;
    const stat = await fsp.stat(filePath);
    const identity = fileIdentity(filePath, stat);
    if (this._isUploaded(identity) || !(await this._isStable(filePath, stat))) return;
    const session = this.sessions
      .filter(item => item.endedAt > 0 && Math.abs(stat.mtimeMs - item.endedAt * 1000) <= 30 * 60 * 1000)
      .sort((a,b) => Math.abs(stat.mtimeMs - a.endedAt * 1000) - Math.abs(stat.mtimeMs - b.endedAt * 1000))[0];
    if (!session) return;
    this.processing.add(filePath);
    try {
      await this._uploadFile(filePath, 'replay', session);
      await this._markUploaded(identity);
      this.onStatus({ type:'uploaded', kind:'replay', file:path.basename(filePath), sessionId:session.sessionId });
    } finally {
      this.processing.delete(filePath);
    }
  }

  async _uploadChunk(buffer, originalName, kind, session, index, count, totalBytes) {
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const safeSession = session.sessionId.replace(/[^a-z0-9_-]/gi, '').slice(0,48) || 'session';
    const fileName = 'bsr_' + safeSession + '_' + kind + '_' + String(index + 1).padStart(4,'0') + '_' + crypto.randomBytes(6).toString('hex') + '.bin';
    const uploaded = await requestParse('/files/' + encodeURIComponent(fileName), 'POST', {
      appId:this.appId, clientKey:this.clientKey, sessionToken:this.sessionToken, contentType:'application/octet-stream'
    }, buffer);
    await requestParse('/functions/registerRaceTelemetryEvidence', 'POST', {
      appId:this.appId, clientKey:this.clientKey, sessionToken:this.sessionToken, contentType:'application/json'
    }, Buffer.from(JSON.stringify({
      kind, sessionId:session.sessionId, raceId:session.raceId || '',
      steamId:session.steamId || '', driverName:session.driverName || '',
      track:session.track || '', carModel:session.carModel || '',
      serverHost:session.serverHost || '', serverPort:session.serverPort || 0,
      fileName:uploaded.name, fileUrl:uploaded.url,
      originalName:path.basename(originalName), chunkIndex:index, chunkCount:count,
      totalBytes, chunkBytes:buffer.length, sha256
    })));
  }

  async _uploadFile(filePath, kind, session) {
    const stat = await fsp.stat(filePath);
    const count = Math.max(1, Math.ceil(stat.size / this.chunkBytes));
    const handle = await fsp.open(filePath, 'r');
    try {
      for (let index = 0; index < count; index += 1) {
        if (!this.sessionToken) throw new Error('Sessão BSR encerrada durante upload.');
        const length = Math.min(this.chunkBytes, stat.size - index * this.chunkBytes);
        const buffer = Buffer.alloc(length);
        const read = await handle.read(buffer, 0, length, index * this.chunkBytes);
        if (read.bytesRead !== length) throw new Error('O arquivo mudou durante a sincronização.');
        await this._uploadChunk(buffer, filePath, kind, session, index, count, stat.size);
      }
    } finally {
      await handle.close();
    }
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.sessionToken = '';
  }
}

module.exports = { BsrTelemetryUploader, parseTelemetryLog, fileIdentity, CHUNK_BYTES };
