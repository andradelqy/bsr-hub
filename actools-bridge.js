'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

class AcToolsBridge extends EventEmitter {
  constructor({ executable, timeoutMs = 120000 } = {}) {
    super();
    this.executable = executable;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.sequence = 0;
    this.pending = new Map();
    this.starting = null;
  }

  start() {
    if (this.child) return Promise.resolve();
    if (this.starting) return this.starting;
    if (!this.executable || !fs.existsSync(this.executable)) {
      return Promise.reject(new Error(`Motor AcTools não encontrado: ${this.executable || '(sem caminho)'}`));
    }

    this.starting = new Promise((resolve, reject) => {
      const child = spawn(this.executable, ['serve'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      this.child = child;
      let settled = false;
      const failStart = error => {
        if (settled) return;
        settled = true;
        this.starting = null;
        reject(error);
      };

      child.once('error', failStart);
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', data => this.emit('diagnostic', String(data)));
      const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on('line', line => {
        let message;
        try { message = JSON.parse(line); }
        catch { this.emit('diagnostic', `Saída AcTools inválida: ${line}`); return; }
        if (message.type === 'ready' && !settled) {
          settled = true;
          this.starting = null;
          resolve(message);
          return;
        }
        if (message.type === 'progress') {
          const pending = this.pending.get(message.id);
          pending?.onProgress?.(message);
          this.emit('progress', message);
          return;
        }
        if (message.type === 'result' && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          pending.cleanup?.();
          if (message.ok) pending.resolve(message);
          else {
            const error = new Error(message.error || 'O motor AcTools recusou a operação.');
            error.details = message;
            pending.reject(error);
          }
          return;
        }
        this.emit('message', message);
      });
      child.once('exit', (code, signal) => {
        this.child = null;
        this.starting = null;
        const error = new Error(`Motor AcTools encerrado (${signal || code}).`);
        failStart(error);
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.cleanup?.();
          pending.reject(error);
        }
        this.pending.clear();
      });
    });
    return this.starting;
  }

  async request(command, { archive, acRoot, destination = '' }, onProgress = null, signal = null) {
    if (!['inspect', 'install', 'extract'].includes(command)) throw new Error('Comando AcTools inválido.');
    const archivePath = path.resolve(String(archive || ''));
    if (!fs.statSync(archivePath, { throwIfNoEntry: false })?.isFile()) throw new Error('Arquivo de conteúdo não encontrado.');
    if (!['.zip', '.7z', '.rar'].includes(path.extname(archivePath).toLowerCase())) throw new Error('Use um pacote ZIP, 7z ou RAR.');
    const rootPath = acRoot ? path.resolve(String(acRoot)) : '';
    if (command !== 'extract' && !fs.statSync(rootPath, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Diretório do Assetto Corsa não encontrado.');
    const destinationPath = destination ? path.resolve(String(destination)) : '';
    if (command === 'extract' && !fs.statSync(destinationPath, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Diretório temporário de extração não encontrado.');
    if (signal?.aborted) throw Object.assign(new Error('Operação cancelada.'), { name:'AbortError' });
    await this.start();

    const id = `bsr-${process.pid}-${Date.now()}-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        pending?.cleanup?.();
        reject(new Error('O motor AcTools excedeu o tempo limite.'));
      }, this.timeoutMs);
      const abort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(timer);
        pending.cleanup?.();
        reject(Object.assign(new Error('Operação cancelada.'), { name:'AbortError' }));
        this.child?.kill();
      };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, { once:true });
      this.pending.set(id, { resolve, reject, timer, cleanup, onProgress:typeof onProgress === 'function' ? onProgress : null });
      this.child.stdin.write(`${JSON.stringify({ id, command, archive: archivePath, acRoot: rootPath, destination: destinationPath })}\n`, error => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        cleanup();
        reject(error);
      });
    });
  }

  async close() {
    if (!this.child) return;
    const child = this.child;
    const id = `shutdown-${process.pid}-${Date.now()}`;
    child.stdin.write(`${JSON.stringify({ id, command: 'shutdown' })}\n`);
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

function resolveBridgeExecutable(app) {
  const relative = path.join('native', 'bsr-actools-bridge', 'dist', 'bsr-actools-bridge.exe');
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', relative)
    : path.join(__dirname, relative);
}

function registerAcToolsBridge({ app }) {
  const bridge = new AcToolsBridge({ executable: resolveBridgeExecutable(app) });
  return bridge;
}

module.exports = { AcToolsBridge, registerAcToolsBridge, resolveBridgeExecutable };
