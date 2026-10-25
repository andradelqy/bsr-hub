'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const extractZip = require('extract-zip');

const APP_ID = '1CJSJppMYYgI6hEPLag7diConyKxOirJ3UPFB7QP';
const REST_API_KEY = 'veaMfzjbxUsM0aOYZimasiOucPZnIwC7lpEhDWD7';
const API_URL = 'https://parseapi.back4app.com';
const MAX_PACKAGE_BYTES = 25 * 1024 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 60 * 1024 * 1024 * 1024;
const MAX_DOWNLOAD_GATE_BYTES = 1024 * 1024;
const GOOGLE_DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com']);
const ALLOWED_TYPES = new Set(['car', 'track', 'skin', 'app', 'extension', 'showroom']);
const TARGET_ROOTS = {
  car: ['content', 'cars'],
  track: ['content', 'tracks'],
  app: ['apps', 'python'],
  extension: ['extension'],
  showroom: ['content', 'showroom']
};

const GENERIC_TARGET_IDS = {
  car: new Set(['car','cars']), track: new Set(['track','tracks']), app: new Set(['app','apps','python']),
  extension: new Set(['extension','extensions']), showroom: new Set(['showroom','showrooms']), skin: new Set(['skin','skins'])
};

function isGenericTargetId(type, value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || GENERIC_TARGET_IDS[type]?.has(normalized) === true;
}

function isOptionalArchiveMetadata(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  const parts = normalized.split('/').filter(Boolean);
  const basename = String(parts.at(-1) || '').toLowerCase();
  return basename === 'thumbs.db'
    || basename === 'desktop.ini'
    || basename === '.ds_store'
    || basename.startsWith('._')
    || parts.some(part => part.toLowerCase() === '__macosx');
}

function abortError(message = 'Instalação cancelada pelo usuário.') {
  return Object.assign(new Error(message), { name:'AbortError' });
}

function ensureNotAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function cleanId(value, label = 'identificador') {
  const result = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(result)) throw new Error(`${label} inválido.`);
  return result;
}

function cleanText(value, max = 200) {
  return String(value || '').replace(/[\0\r\n]/g, ' ').trim().slice(0, max);
}

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function googleDriveFileId(value) {
  let url;
  try { url = new URL(String(value || '')); } catch (_) { return ''; }
  if (!GOOGLE_DRIVE_HOSTS.has(url.hostname.toLowerCase())) return '';
  const pathMatch = url.pathname.match(/\/file\/d\/([a-z0-9_-]{10,200})(?:\/|$)/i);
  const id = pathMatch?.[1] || url.searchParams.get('id') || '';
  return /^[a-z0-9_-]{10,200}$/i.test(id) ? id : '';
}

function canonicalGoogleDriveUrl(value) {
  const id = googleDriveFileId(value);
  if (!id) return String(value || '');
  const original = new URL(String(value));
  const direct = new URL('https://drive.usercontent.google.com/download');
  direct.searchParams.set('id', id);
  direct.searchParams.set('export', 'download');
  direct.searchParams.set('confirm', 't');
  const resourceKey = original.searchParams.get('resourcekey');
  if (resourceKey) direct.searchParams.set('resourcekey', resourceKey);
  return direct.href;
}

function googleDriveConfirmationUrl(htmlValue, baseValue) {
  const html = String(htmlValue || '');
  const form = html.match(/<form\b[^>]*\baction\s*=\s*(["'])(.*?)\1[^>]*>/i);
  if (!form) return '';
  let action;
  try { action = new URL(decodeHtmlAttribute(form[2]), baseValue); } catch (_) { return ''; }
  if (action.protocol !== 'https:' || !GOOGLE_DRIVE_HOSTS.has(action.hostname.toLowerCase())) return '';
  for (const input of html.match(/<input\b[^>]*>/gi) || []) {
    const attributes = {};
    for (const match of input.matchAll(/([a-z_:][-a-z0-9_:.]*)\s*=\s*(["'])(.*?)\2/gi)) attributes[match[1].toLowerCase()] = decodeHtmlAttribute(match[3]);
    if (attributes.name && attributes.value !== undefined) action.searchParams.set(attributes.name, attributes.value);
  }
  const id = googleDriveFileId(action.href);
  return id && action.searchParams.get('confirm') ? action.href : '';
}

function normalizeServerTrack(value) {
  const normalized = String(value || '').trim().toLowerCase().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || !/^[a-z0-9][a-z0-9_.-]{0,119}(?:\/[a-z0-9][a-z0-9_.-]{0,119})?$/i.test(normalized)) {
    throw new Error('O servidor retornou um identificador de pista inválido.');
  }
  return normalized;
}

function resolveServerTrack(expectedValue, actualValue) {
  const actual = normalizeServerTrack(actualValue);
  const expected = expectedValue ? cleanId(expectedValue, 'Pista').toLowerCase() : '';
  if (!expected) return { matches:true, track:actual, layout:'', actual, expected:'' };
  if (actual === expected) return { matches:true, track:expected, layout:'', actual, expected };
  for (const separator of ['-', '/']) {
    const prefix = `${expected}${separator}`;
    if (actual.startsWith(prefix)) {
      const layout = actual.slice(prefix.length);
      if (layout && /^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(layout)) return { matches:true, track:expected, layout, actual, expected };
    }
  }
  return { matches:false, track:expected, layout:'', actual, expected };
}

function normalizeOnlineServerInformation(payload, queriedHttpPort) {
  if (!payload || typeof payload !== 'object') throw new Error('O servidor retornou uma resposta de sessão inválida.');
  const track = normalizeServerTrack(payload.track);
  const cars = [...new Set((Array.isArray(payload.cars) ? payload.cars : [])
    .map(item => String(item || '').trim().toLowerCase())
    .filter(item => /^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(item)))];
  if (!cars.length) throw new Error('O servidor não informou os carros permitidos na sessão ativa.');
  const gamePort = Number(payload.port || payload.tport);
  const httpPort = Number(payload.cport || queriedHttpPort);
  if (![gamePort, httpPort].every(port => Number.isInteger(port) && port > 0 && port <= 65535)) {
    throw new Error('O servidor retornou portas de conexão inválidas.');
  }
  return { track, cars, gamePort, httpPort, name:cleanText(payload.name, 100) };
}

function cleanSessionToken(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (!/^[a-z0-9:_-]{10,255}$/i.test(token)) throw new Error('Sessão do BSR Hub inválida. Entre novamente com a Steam.');
  return token;
}

function friendlyName(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
    .trim();
}

function slugFromName(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

function detectArchiveLayout(rawEntries) {
  const entries = [...new Set((rawEntries || []).map(validateArchiveEntry).map(item => item.replace(/\/$/, '')).filter(Boolean))];
  const split = entries.map(item => item.split('/').filter(Boolean));
  const detected = { type:'', targetId:'', contentPath:'', name:'', slug:'', confidence:'low', warnings:[] };
  const locate = segments => {
    for (const parts of split) {
      for (let index = 0; index <= parts.length - segments.length; index += 1) {
        if (segments.every((segment, offset) => String(parts[index + offset] || '').toLowerCase() === segment)) {
          return { parts, index };
        }
      }
    }
    return null;
  };
  const skin = locate(['content','cars']);
  const hasCarSignature = entries.some(item => /(^|\/)content\/cars\/[^/]+\/(?:data\.acd|ui\/ui_car\.json)$/i.test(item));
  if (!hasCarSignature && skin && String(skin.parts[skin.index + 3] || '').toLowerCase() === 'skins' && skin.parts[skin.index + 4]) {
    detected.type = 'skin'; detected.targetId = skin.parts[skin.index + 2]; detected.name = friendlyName(skin.parts[skin.index + 4]); detected.confidence = 'high';
  } else {
    const patterns = [
      ['car',['content','cars']], ['track',['content','tracks']], ['app',['apps','python']],
      ['extension',['extension']], ['showroom',['content','showroom']]
    ];
    for (const [type, pattern] of patterns) {
      const match = locate(pattern);
      const target = match?.parts[match.index + pattern.length];
      if (!target) continue;
      detected.type = type; detected.targetId = target; detected.name = friendlyName(target); detected.confidence = 'high'; break;
    }
  }
  if (!detected.type) {
    const roots = [...new Set(split.map(parts => parts[0]).filter(Boolean))];
    const root = roots.length === 1 ? roots[0] : '';
    const lower = entries.map(item => item.toLowerCase());
    if (lower.some(item => /(^|\/)ui_skin\.json$/.test(item))) detected.type = 'skin';
    else if (lower.some(item => /(^|\/)ui_track\.json$|(^|\/)models(?:_\w+)?\.ini$/.test(item))) detected.type = 'track';
    else if (lower.some(item => /(^|\/)ui_car\.json$|(^|\/)data\.acd$/.test(item))) detected.type = 'car';
    if (detected.type && root) {
      detected.contentPath = root; detected.name = friendlyName(root);
      if (detected.type !== 'skin') detected.targetId = root;
      detected.confidence = 'medium';
    }
  }
  if (!detected.type) detected.warnings.push('A estrutura não identifica automaticamente carro, pista, skin ou aplicativo. Confirme o tipo manualmente.');
  if (detected.type === 'skin' && !detected.targetId) detected.warnings.push('Informe o carro de destino desta skin.');
  if (entries.some(item => /\.(?:exe|msi|bat|cmd|ps1)$/i.test(item))) detected.warnings.push('O ZIP contém executáveis ou scripts. Revise o pacote antes de publicar.');
  detected.name ||= friendlyName(detected.targetId) || 'Novo conteúdo';
  detected.slug = slugFromName(detected.name) || 'novo-conteudo';
  return detected;
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateArchiveEntry(entryName) {
  const normalized = String(entryName || '').replaceAll('\\', '/');
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) throw new Error('O pacote contém um caminho absoluto inválido.');
  if (normalized.split('/').some(part => part === '..')) throw new Error('O pacote tentou gravar fora da pasta autorizada.');
  return normalized;
}

function sanitizePackageMetadata(raw) {
  const type = cleanId(raw?.type || '', 'Tipo').toLowerCase();
  if (!ALLOWED_TYPES.has(type)) throw new Error('Tipo de conteúdo não permitido.');
  const downloadUrl = new URL(String(raw?.downloadUrl || ''));
  if (downloadUrl.protocol !== 'https:') throw new Error('O download precisa usar HTTPS.');
  const sha256 = String(raw?.sha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Hash SHA-256 inválido.');
  const sizeBytes = Number(raw?.sizeBytes || 0);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_PACKAGE_BYTES) throw new Error('Tamanho do pacote inválido.');
  return {
    objectId: cleanId(raw.objectId, 'Pacote'),
    slug: cleanId(raw.slug, 'Slug').toLowerCase(),
    name: cleanText(raw.name, 120),
    version: cleanId(raw.version, 'Versão'),
    type,
    targetId: raw.targetId ? cleanId(raw.targetId, 'Destino') : '',
    contentPath: String(raw.contentPath || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''),
    downloadUrl: downloadUrl.href,
    sha256,
    sizeBytes,
    author: cleanText(raw.author, 100),
    dependencies: Array.isArray(raw.dependencies) ? raw.dependencies.map(item => cleanId(item, 'Dependência').toLowerCase()).slice(0, 50) : []
  };
}

function parseSteamLibraries(vdf) {
  const paths = [];
  for (const match of String(vdf || '').matchAll(/"path"\s+"([^"]+)"/gi)) {
    const candidate = match[1].replaceAll('\\\\', '\\');
    if (candidate && !paths.includes(candidate)) paths.push(candidate);
  }
  return paths;
}

function updateIniSections(source, sections) {
  let output = String(source || '').replace(/\r\n/g, '\n');
  for (const [section, values] of Object.entries(sections)) {
    const body = Object.entries(values).map(([key, value]) => `${key}=${cleanText(value, 300)}`).join('\n');
    const block = `[${section}]\n${body}`;
    const matcher = new RegExp(`(^|\\n)\\[${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][\\s\\S]*?(?=\\n\\[[^\\]]+\\]|$)`, 'i');
    output = matcher.test(output) ? output.replace(matcher, (_, prefix) => `${prefix}${block}`) : `${output.trimEnd()}${output.trim() ? '\n\n' : ''}${block}\n`;
  }
  return output.replace(/\n/g, '\r\n');
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject); stream.on('data', chunk => hash.update(chunk)); stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function detectArchiveFormat(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const signature = Buffer.alloc(8);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    if (bytesRead >= 4 && [0x04034b50, 0x06054b50, 0x08074b50].includes(signature.readUInt32LE(0))) return 'zip';
    if (bytesRead >= 6 && signature.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return '7z';
    if (bytesRead >= 7 && signature.subarray(0, 7).equals(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]))) return 'rar';
    if (bytesRead >= 8 && signature.equals(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]))) return 'rar';
    throw new Error('O arquivo aprovado não é um pacote ZIP, RAR ou 7z reconhecido.');
  } finally {
    await handle.close();
  }
}

async function exists(candidate) {
  try { await fsp.access(candidate); return true; } catch (_) { return false; }
}

async function listFiles(root, relative = '', output = []) {
  const directory = path.join(root, relative);
  for (const entry of await fsp.readdir(directory, { withFileTypes:true })) {
    const childRelative = path.join(relative, entry.name);
    const child = path.join(root, childRelative);
    const stat = await fsp.lstat(child);
    if (stat.isSymbolicLink()) throw new Error('Links simbólicos não são permitidos em pacotes.');
    if (stat.isDirectory()) await listFiles(root, childRelative, output);
    else if (stat.isFile()) output.push(childRelative);
    if (output.length > 100000) throw new Error('O pacote possui arquivos demais.');
  }
  return output;
}

async function findNestedDirectory(root, segments, depth = 0) {
  const direct = path.join(root, ...segments);
  if (await exists(direct)) return direct;
  if (depth >= 3) return null;
  const children = (await fsp.readdir(root, { withFileTypes:true })).filter(item => item.isDirectory());
  for (const child of children) {
    const found = await findNestedDirectory(path.join(root, child.name), segments, depth + 1);
    if (found) return found;
  }
  return null;
}

async function findDirectoryNamed(root, expectedName, depth = 0) {
  if (!expectedName || depth > 8) return null;
  const children = (await fsp.readdir(root, { withFileTypes:true })).filter(item => item.isDirectory() && item.name !== '__MACOSX');
  const direct = children.find(item => item.name.toLowerCase() === String(expectedName).toLowerCase());
  if (direct) return path.join(root, direct.name);
  for (const child of children) {
    const found = await findDirectoryNamed(path.join(root, child.name), expectedName, depth + 1);
    if (found) return found;
  }
  return null;
}

async function removeEmptyParents(start, stop) {
  let current = path.dirname(start);
  while (isInside(stop, current) && path.resolve(current) !== path.resolve(stop)) {
    try {
      if ((await fsp.readdir(current)).length) break;
      await fsp.rmdir(current);
    } catch (_) { break; }
    current = path.dirname(current);
  }
}

class BSRContentManager {
  constructor({ app, dialog, net, BrowserWindow, actools = null }) {
    this.app = app;
    this.dialog = dialog;
    this.net = net;
    this.BrowserWindow = BrowserWindow;
    this.actools = actools;
    this.statePath = path.join(app.getPath('userData'), 'content-manager.json');
    this.downloadRoot = path.join(app.getPath('userData'), 'content-packages');
    this.backupRoot = path.join(app.getPath('userData'), 'content-backups');
    this.state = { version:2, gamePath:'', installs:{}, downloads:{}, history:[] };
    this.busy = new Map();
    this.activeDownloads = new Map();
    this.activeInstalls = new Map();
  }

  async initialize() {
    await Promise.all([fsp.mkdir(this.downloadRoot, { recursive:true }), fsp.mkdir(this.backupRoot, { recursive:true })]);
    try {
      const parsed = JSON.parse(await fsp.readFile(this.statePath, 'utf8'));
      this.state = { ...this.state, ...parsed, version:2, installs:parsed.installs || {}, downloads:parsed.downloads || {}, history:parsed.history || [] };
    } catch (_) {}
    if (!(await this.isGameDirectory(this.state.gamePath))) this.state.gamePath = await this.detectGamePath();
    await this.saveState();
    return this.summary();
  }

  async saveState() {
    const temporary = `${this.statePath}.tmp`;
    await fsp.mkdir(path.dirname(this.statePath), { recursive:true });
    await fsp.writeFile(temporary, JSON.stringify(this.state, null, 2), 'utf8');
    await fsp.copyFile(temporary, this.statePath);
    await fsp.unlink(temporary).catch(() => {});
  }

  recordHistory(action, pkg, details = {}) {
    this.state.history = [{ action, slug:pkg.slug, name:pkg.name, version:pkg.version, at:new Date().toISOString(), ...details }, ...(this.state.history || [])].slice(0, 100);
  }

  async isGameDirectory(candidate) {
    if (!candidate || !path.isAbsolute(candidate)) return false;
    return (await exists(path.join(candidate, 'content'))) && ((await exists(path.join(candidate, 'AssettoCorsa.exe'))) || (await exists(path.join(candidate, 'acs.exe'))));
  }

  async detectGamePath() {
    const roots = [];
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
      if (base) roots.push(path.join(base, 'Steam'));
    }
    const candidates = [];
    for (const steam of [...new Set(roots)]) {
      candidates.push(path.join(steam, 'steamapps', 'common', 'assettocorsa'));
      const librariesFile = path.join(steam, 'steamapps', 'libraryfolders.vdf');
      if (await exists(librariesFile)) {
        const libraries = parseSteamLibraries(await fsp.readFile(librariesFile, 'utf8').catch(() => ''));
        libraries.forEach(library => candidates.push(path.join(library, 'steamapps', 'common', 'assettocorsa')));
      }
    }
    for (const candidate of [...new Set(candidates)]) if (await this.isGameDirectory(candidate)) return path.resolve(candidate);
    return '';
  }

  async chooseGamePath(window) {
    const result = await this.dialog.showOpenDialog(window, { title:'Selecione a pasta do Assetto Corsa', properties:['openDirectory'], buttonLabel:'Usar esta pasta' });
    if (result.canceled || !result.filePaths[0]) return this.summary();
    if (!(await this.isGameDirectory(result.filePaths[0]))) throw new Error('A pasta selecionada não contém uma instalação válida do Assetto Corsa.');
    this.state.gamePath = path.resolve(result.filePaths[0]);
    await this.saveState();
    return this.summary();
  }

  async inspectPackage(window) {
    const selection = await this.dialog.showOpenDialog(window, {
      title:'Selecione o pacote do conteúdo', buttonLabel:'Analisar conteúdo', properties:['openFile'],
      filters:[{ name:'Pacote de conteúdo', extensions:['zip', 'rar', '7z'] }]
    });
    if (selection.canceled || !selection.filePaths[0]) return { canceled:true };
    const archivePath = path.resolve(selection.filePaths[0]);
    if (!['.zip', '.rar', '.7z'].includes(path.extname(archivePath).toLowerCase())) throw new Error('Selecione um pacote ZIP, RAR ou 7z válido.');
    const stat = await fsp.stat(archivePath);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_PACKAGE_BYTES) throw new Error('O tamanho do pacote é inválido.');
    const archiveFormat = await detectArchiveFormat(archivePath);
    const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'bsr-inspect-'));
    const entries = [];
    let expandedBytes = 0;
    try {
      if (this.actools) {
        const extracted = await this.actools.request('extract', { archive:archivePath, destination:staging });
        expandedBytes = Number(extracted.expandedBytes || 0);
        entries.push(...(extracted.files || []).map(validateArchiveEntry));
      } else {
        if (archiveFormat !== 'zip') throw new Error('A análise de RAR e 7z exige o motor AcTools incluído no launcher.');
        await extractZip(archivePath, { dir:staging, onEntry:entry => {
          const entryName = validateArchiveEntry(entry.fileName);
          entries.push(entryName);
          const entryBytes = Number(entry.uncompressedSize || 0);
          if (!Number.isSafeInteger(entryBytes) || entryBytes < 0) throw new Error('O pacote contém um tamanho de arquivo inválido.');
          expandedBytes += entryBytes;
          if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error('O conteúdo expandido excede o limite de segurança.');
        } });
      }
      const files = await listFiles(staging);
      if (!files.length) throw new Error('O pacote não contém arquivos instaláveis.');
      const layout = detectArchiveLayout(entries);
      return {
        canceled:false, archiveName:path.basename(archivePath), sha256:await hashFile(archivePath), sizeBytes:stat.size,
        archiveFormat, expandedBytes, fileCount:files.length, ...layout
      };
    } finally {
      await fsp.rm(staging, { recursive:true, force:true }).catch(() => {});
    }
  }

  summary(packages = []) {
    const statuses = {};
    for (const raw of packages || []) {
      const slug = String(raw.slug || '').toLowerCase();
      if (!slug) continue;
      const installed = this.state.installs[slug];
      const downloaded = this.state.downloads[slug];
      statuses[slug] = {
        installed:Boolean(installed), installedVersion:installed?.version || null,
        downloaded:Boolean(downloaded && downloaded.version === raw.version), downloadedVersion:downloaded?.version || null,
        updateAvailable:Boolean(installed && installed.version !== raw.version)
      };
    }
    return { desktop:true, game:'assetto-corsa', gamePath:this.state.gamePath, detected:Boolean(this.state.gamePath), statuses };
  }

  async fetchCatalog(sessionToken = '') {
    const token = cleanSessionToken(sessionToken);
    const headers = { 'X-Parse-Application-Id':APP_ID, 'X-Parse-REST-API-Key':REST_API_KEY, 'Content-Type':'application/json' };
    if (token) headers['X-Parse-Session-Token'] = token;
    const response = await this.net.fetch(`${API_URL}/functions/getContentCatalog`, {
      method:'POST', headers, body:'{}'
    });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.result)) throw new Error(payload.error || 'Não foi possível validar o catálogo oficial.');
    return payload.result;
  }

  async canonicalPackage(reference, sessionToken = '') {
    const objectId = cleanId(reference?.objectId, 'Pacote');
    const raw = (await this.fetchCatalog(sessionToken)).find(item => item.objectId === objectId);
    if (!raw) throw new Error('O pacote não está mais disponível no catálogo oficial.');
    return sanitizePackageMetadata(raw);
  }

  emitProgress(sender, payload) {
    if (sender && !sender.isDestroyed()) sender.send('content:progress', payload);
  }

  async download(reference, sender, sessionToken = '') {
    const pkg = await this.canonicalPackage(reference, sessionToken);
    if (this.busy.has(pkg.slug)) return this.busy.get(pkg.slug);
    const controller = new AbortController();
    this.activeDownloads.set(pkg.slug, { controller, sender, startedAt:Date.now() });
    const operation = this.downloadCanonical(pkg, sender, controller.signal).finally(() => {
      this.activeDownloads.delete(pkg.slug);
      this.busy.delete(pkg.slug);
    });
    this.busy.set(pkg.slug, operation);
    return operation;
  }

  async cancelDownload(slugValue) {
    const slug = cleanId(slugValue, 'Pacote').toLowerCase();
    const active = this.activeDownloads.get(slug);
    if (!active) return { ok:true, canceled:false, slug };
    active.controller.abort();
    return { ok:true, canceled:true, slug };
  }

  async readDownloadGate(response, signal) {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        if (signal?.aborted) throw abortError('Download cancelado pelo usuário.');
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_DOWNLOAD_GATE_BYTES) throw new Error('A página intermediária de download excedeu o limite de segurança.');
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  async fetchPackageResponse(downloadUrl, signal) {
    let currentUrl = canonicalGoogleDriveUrl(downloadUrl);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.net.fetch(currentUrl, { redirect:'follow', signal:signal || undefined, headers:{ Accept:'application/octet-stream,text/html;q=0.8' } });
      if (!response.ok || !response.body) throw new Error(`Download recusado pelo servidor (${response.status}).`);
      const finalUrl = response.url || currentUrl;
      const isGoogleDrive = Boolean(googleDriveFileId(finalUrl) || googleDriveFileId(currentUrl));
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('text/html')) return response;
      const html = await this.readDownloadGate(response, signal);
      if (!isGoogleDrive) throw new Error('A URL cadastrada entregou uma página HTML em vez do arquivo do conteúdo. Use uma URL HTTPS de download direto.');
      const confirmedUrl = googleDriveConfirmationUrl(html, finalUrl);
      if (!confirmedUrl) {
        throw new Error('O Google Drive não liberou o arquivo. Configure o compartilhamento como “Qualquer pessoa com o link” e atualize a URL no catálogo.');
      }
      currentUrl = confirmedUrl;
    }
    throw new Error('O Google Drive repetiu a página de confirmação e não iniciou o download do arquivo.');
  }

  async downloadCanonical(pkg, sender, signal = null) {
    const archiveBase = path.join(this.downloadRoot, `${pkg.slug}-${pkg.version}`);
    const partPath = `${archiveBase}.download.part`;
    const remembered = this.state.downloads[pkg.slug];
    const candidates = [...new Set([
      remembered?.version === pkg.version && remembered?.path && isInside(this.downloadRoot, remembered.path) ? path.resolve(remembered.path) : '',
      ...['zip', 'rar', '7z'].map(extension => `${archiveBase}.${extension}`)
    ].filter(Boolean))];
    for (const candidate of candidates) {
      if (!(await exists(candidate))) continue;
      if ((await hashFile(candidate)) === pkg.sha256) {
        const format = await detectArchiveFormat(candidate);
        const finalPath = `${archiveBase}.${format}`;
        if (path.resolve(candidate) !== path.resolve(finalPath)) {
          await fsp.unlink(finalPath).catch(() => {});
          await fsp.rename(candidate, finalPath);
        }
        const cachedSize = (await fsp.stat(finalPath)).size;
        this.state.downloads[pkg.slug] = { version:pkg.version, path:finalPath, format, sha256:pkg.sha256, sizeBytes:cachedSize, catalogSizeBytes:pkg.sizeBytes, sizeMismatch:cachedSize !== pkg.sizeBytes, downloadedAt:new Date().toISOString() };
        this.recordHistory('download-cache', pkg);
        await this.saveState(); return { ok:true, cached:true, slug:pkg.slug, sizeBytes:cachedSize, catalogSizeBytes:pkg.sizeBytes, sizeMismatch:cachedSize !== pkg.sizeBytes };
      }
      await fsp.unlink(candidate).catch(() => {});
    }
    await fsp.unlink(partPath).catch(() => {});
    let handle = null;
    let reader = null;
    let received = 0;
    try {
      if (signal?.aborted) throw Object.assign(new Error('Download cancelado.'), { name:'AbortError' });
      const response = await this.fetchPackageResponse(pkg.downloadUrl, signal);
      const advertisedHeader = response.headers.get('content-length');
      const advertised = advertisedHeader ? Number(advertisedHeader) : 0;
      if (advertisedHeader && (!Number.isSafeInteger(advertised) || advertised < 0)) throw new Error('O servidor informou um tamanho de download inválido.');
      if (advertised > MAX_PACKAGE_BYTES) throw new Error('O pacote excede o limite de segurança.');
      const progressTotal = advertised > 0 ? advertised : pkg.sizeBytes;
      handle = await fsp.open(partPath, 'w');
      reader = response.body.getReader();
      const hash = crypto.createHash('sha256');
      const startedAt = Date.now();
      let lastEventAt = startedAt;
      let lastSampleAt = startedAt;
      let lastSampleBytes = 0;
      let smoothedSpeed = 0;
      this.emitProgress(sender, { slug:pkg.slug, name:pkg.name, version:pkg.version, phase:'download', received:0, total:progressTotal, percent:0, bytesPerSecond:0, etaSeconds:null });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal?.aborted) throw Object.assign(new Error('Download cancelado.'), { name:'AbortError' });
        received += value.byteLength;
        if (received > MAX_PACKAGE_BYTES) throw new Error('O pacote excede o limite de segurança durante o download.');
        hash.update(value); await handle.write(value);
        const now = Date.now();
        if (now - lastEventAt >= 180 || received >= progressTotal) {
          const elapsed = Math.max(1, now - lastSampleAt) / 1000;
          const instantSpeed = Math.max(0, received - lastSampleBytes) / elapsed;
          smoothedSpeed = smoothedSpeed ? (smoothedSpeed * 0.72) + (instantSpeed * 0.28) : instantSpeed;
          const remaining = Math.max(0, progressTotal - received);
          this.emitProgress(sender, {
            slug:pkg.slug, name:pkg.name, version:pkg.version, phase:'download', received, total:progressTotal,
            percent:Math.min(99, Math.round(received / progressTotal * 100)), bytesPerSecond:Math.round(smoothedSpeed),
            etaSeconds:smoothedSpeed > 0 ? Math.ceil(remaining / smoothedSpeed) : null
          });
          lastEventAt = now; lastSampleAt = now; lastSampleBytes = received;
        }
      }
      await handle.close(); handle = null;
      if (received < 1) throw new Error('O servidor retornou um arquivo vazio.');
      const digest = hash.digest('hex');
      if (digest !== pkg.sha256) {
        const sizeDetail = received !== pkg.sizeBytes ? ` O servidor entregou ${received} bytes, enquanto o catálogo informa ${pkg.sizeBytes}.` : '';
        throw new Error(`A URL não entregou o mesmo arquivo aprovado no catálogo: a verificação SHA-256 falhou.${sizeDetail}`);
      }
      const sizeMismatch = received !== pkg.sizeBytes;
      const format = await detectArchiveFormat(partPath);
      const finalPath = `${archiveBase}.${format}`;
      for (const extension of ['zip', 'rar', '7z']) {
        const stale = `${archiveBase}.${extension}`;
        if (path.resolve(stale) !== path.resolve(finalPath)) await fsp.unlink(stale).catch(() => {});
      }
      await fsp.unlink(finalPath).catch(() => {});
      await fsp.rename(partPath, finalPath);
      this.state.downloads[pkg.slug] = { version:pkg.version, path:finalPath, format, sha256:pkg.sha256, sizeBytes:received, catalogSizeBytes:pkg.sizeBytes, sizeMismatch, downloadedAt:new Date().toISOString() };
      this.recordHistory('download', pkg, { sizeBytes:received, catalogSizeBytes:pkg.sizeBytes, sizeMismatch, format });
      await this.saveState();
      this.emitProgress(sender, { slug:pkg.slug, name:pkg.name, version:pkg.version, phase:'downloaded', received, total:received, percent:100, bytesPerSecond:0, etaSeconds:0 });
      return { ok:true, slug:pkg.slug, sizeBytes:received, catalogSizeBytes:pkg.sizeBytes, sizeMismatch };
    } catch (error) {
      await reader?.cancel().catch(() => {});
      await handle?.close().catch(() => {});
      await fsp.unlink(partPath).catch(() => {});
      if (signal?.aborted || error?.name === 'AbortError') {
        this.emitProgress(sender, { slug:pkg.slug, name:pkg.name, version:pkg.version, phase:'cancelled', received, total:pkg.sizeBytes, percent:0, bytesPerSecond:0, etaSeconds:null });
        throw new Error('Download cancelado pelo usuário.');
      }
      this.emitProgress(sender, { slug:pkg.slug, name:pkg.name, version:pkg.version, phase:'error', received, total:pkg.sizeBytes, percent:0, bytesPerSecond:0, etaSeconds:null, message:cleanText(error?.message || 'Falha no download.', 240) });
      throw error;
    }
  }

  targetSegments(pkg) {
    if (pkg.type === 'skin') {
      if (!pkg.targetId) throw new Error('A skin não informa o carro de destino.');
      return ['content', 'cars', pkg.targetId, 'skins'];
    }
    return TARGET_ROOTS[pkg.type];
  }

  async payloadPlan(extractedRoot, pkg, detectedEntries = []) {
    const targetSegments = this.targetSegments(pkg);
    const targetRoot = path.join(this.state.gamePath, ...targetSegments);
    if (!isInside(this.state.gamePath, targetRoot)) throw new Error('Destino de instalação inválido.');
    if (pkg.contentPath) {
      validateArchiveEntry(pkg.contentPath);
      const source = path.resolve(extractedRoot, ...pkg.contentPath.split('/'));
      if (isInside(extractedRoot, source) && await exists(source)) {
        const destinationName = pkg.type === 'skin' ? path.basename(source) : (pkg.targetId || path.basename(source));
        return { source, destination:path.join(targetRoot, cleanId(destinationName, 'Pasta do conteúdo')), container:false, sourceStrategy:'catalog' };
      }
    }
    const preferredEntry = detectedEntries.find(entry => {
      const kind = String(entry?.kind || '');
      if (pkg.type === 'car') return kind === 'CarContentEntry' && (!pkg.targetId || String(entry.id || '').toLowerCase() === pkg.targetId.toLowerCase());
      if (pkg.type === 'track') return kind === 'TrackContentEntry' && (!pkg.targetId || String(entry.id || '').toLowerCase() === pkg.targetId.toLowerCase());
      if (pkg.type === 'skin') return ['CarSkinContentEntry','TrackSkinContentEntry'].includes(kind);
      return Boolean(entry?.entryPath);
    });
    if (preferredEntry?.entryPath) {
      const detectedPath = validateArchiveEntry(String(preferredEntry.entryPath).replaceAll('\\', '/'));
      const source = path.resolve(extractedRoot, ...detectedPath.split('/'));
      if (isInside(extractedRoot, source) && await exists(source)) {
        const destinationName = pkg.type === 'skin' ? path.basename(source) : (pkg.targetId || path.basename(source));
        return { source, destination:path.join(targetRoot, cleanId(destinationName, 'Pasta do conteúdo')), container:false, sourceStrategy:'actools' };
      }
    }
    const structured = await findNestedDirectory(extractedRoot, targetSegments);
    if (structured) return { source:structured, destination:targetRoot, container:true, sourceStrategy:'structured' };
    if (pkg.type !== 'skin' && pkg.targetId) {
      const named = await findDirectoryNamed(extractedRoot, pkg.targetId);
      if (named) return { source:named, destination:path.join(targetRoot, pkg.targetId), container:false, sourceStrategy:'target-id' };
    }
    let entries = (await fsp.readdir(extractedRoot, { withFileTypes:true })).filter(entry => entry.name !== '__MACOSX');
    let source = extractedRoot;
    while (entries.length === 1 && entries[0].isDirectory() && !pkg.targetId) {
      source = path.join(source, entries[0].name);
      const next = (await fsp.readdir(source, { withFileTypes:true })).filter(entry => entry.name !== '__MACOSX');
      if (next.length !== 1 || !next[0].isDirectory()) break;
      entries = next;
    }
    const destinationName = pkg.targetId || (entries.length === 1 && entries[0].isDirectory() ? entries[0].name : pkg.slug);
    if (entries.length === 1 && entries[0].isDirectory() && path.resolve(source) === path.resolve(extractedRoot)) source = path.join(source, entries[0].name);
    return { source, destination:path.join(targetRoot, cleanId(destinationName, 'Pasta do conteúdo')), container:false, sourceStrategy:'fallback' };
  }

  validateAcToolsInspection(pkg, inspection) {
    const entries = Array.isArray(inspection?.entries) ? inspection.entries : [];
    if (!entries.length) throw new Error('O motor AcTools não identificou conteúdo instalável neste pacote.');
    const expectedKinds = {
      car:['CarContentEntry'], track:['TrackContentEntry','TrackContentLayoutEntry'], skin:['CarSkinContentEntry','TrackSkinContentEntry'],
      app:['PythonAppContentEntry','LuaAppContentEntry'], showroom:['ShowroomContentEntry'], extension:['ShadersPatchEntry','PatchPluginEntry','CustomFolderEntry']
    }[pkg.type] || [];
    if (expectedKinds.length && entries.some(entry => !expectedKinds.includes(String(entry.kind || '')))) {
      throw new Error(`O catálogo declara ${pkg.type}, mas o AcTools detectou ${entries.map(entry => entry.kind).filter(Boolean).join(', ') || 'outro conteúdo'}.`);
    }
    if (['car','track'].includes(pkg.type) && !isGenericTargetId(pkg.type, pkg.targetId) && entries.some(entry => ['CarContentEntry','TrackContentEntry'].includes(String(entry.kind || '')) && String(entry.id || '').toLowerCase() !== pkg.targetId.toLowerCase())) {
      const detectedIds = [...new Set(entries.filter(entry => ['CarContentEntry','TrackContentEntry'].includes(String(entry.kind || ''))).map(entry => String(entry.id || '').trim()).filter(Boolean))];
      throw new Error(`O ID cadastrado no catálogo é “${pkg.targetId}”, mas o pacote contém “${detectedIds.join(', ') || 'um destino diferente'}”. Edite o conteúdo e use exatamente o ID detectado pelo AcTools.`);
    }
    if (pkg.type === 'skin' && pkg.targetId) {
      const marker = `content\\cars\\${pkg.targetId.toLowerCase()}\\skins\\`;
      if (entries.some(entry => !String(entry.entryPath || '').replaceAll('/', '\\').toLowerCase().includes(marker))) {
        throw new Error(`A skin detectada pelo AcTools não pertence ao carro ${pkg.targetId}.`);
      }
    }
  }

  async secureRootFallbackPlan(extractedRoot, pkg) {
    if (!['app','extension'].includes(pkg.type)) return null;
    let marker = null;
    if (pkg.type === 'app') {
      marker = await findNestedDirectory(extractedRoot, ['apps','python']);
      if (!marker) return null;
      const apps = (await fsp.readdir(marker, { withFileTypes:true })).filter(entry => entry.isDirectory());
      if (!apps.length) return null;
      if (!isGenericTargetId(pkg.type, pkg.targetId) && !apps.some(entry => entry.name.toLowerCase() === pkg.targetId.toLowerCase())) return null;
      marker = path.dirname(path.dirname(marker));
    } else {
      const extension = await findNestedDirectory(extractedRoot, ['extension']);
      if (!extension) return null;
      marker = path.dirname(extension);
    }
    if (!isInside(extractedRoot, marker)) return null;
    const allowedTopLevel = pkg.type === 'app' ? ['apps','content','extension'] : ['extension','content','apps'];
    const roots = (await fsp.readdir(marker, { withFileTypes:true })).filter(entry => entry.isDirectory()).map(entry => entry.name.toLowerCase());
    if (!roots.some(root => allowedTopLevel.includes(root))) return null;
    return { source:marker, destination:this.state.gamePath, container:true, allowedTopLevel, sourceStrategy:'secure-game-root' };
  }

  async install(reference, sender, sessionToken = '') {
    const pkg = await this.canonicalPackage(reference, sessionToken);
    if (this.busy.has(pkg.slug)) return this.busy.get(pkg.slug);
    const controller = new AbortController();
    this.activeInstalls.set(pkg.slug, { controller, sender, startedAt:Date.now() });
    const operation = this.installCanonical(pkg, sender, controller.signal).finally(() => {
      this.activeInstalls.delete(pkg.slug);
      this.busy.delete(pkg.slug);
    });
    this.busy.set(pkg.slug, operation);
    return operation;
  }

  async cancelInstall(slugValue) {
    const slug = cleanId(slugValue, 'Pacote').toLowerCase();
    const active = this.activeInstalls.get(slug);
    if (!active) return { ok:true, canceled:false, slug };
    active.controller.abort();
    return { ok:true, canceled:true, slug };
  }

  async installCanonical(pkg, sender, signal = null) {
    ensureNotAborted(signal);
    if (!(await this.isGameDirectory(this.state.gamePath))) throw new Error('Localize a instalação do Assetto Corsa antes de instalar conteúdo.');
    const download = this.state.downloads[pkg.slug];
    if (!download || download.version !== pkg.version || !(await exists(download.path))) throw new Error('Baixe esta versão antes de instalar.');
    if ((await hashFile(download.path)) !== pkg.sha256) throw new Error('O arquivo baixado foi alterado e não pode ser instalado.');
    const archiveFormat = await detectArchiveFormat(download.path);
    const expectedArchivePath = path.join(this.downloadRoot, `${pkg.slug}-${pkg.version}.${archiveFormat}`);
    if (isInside(this.downloadRoot, download.path) && path.resolve(download.path) !== path.resolve(expectedArchivePath)) {
      await fsp.unlink(expectedArchivePath).catch(() => {});
      await fsp.rename(download.path, expectedArchivePath);
      download.path = expectedArchivePath;
      download.format = archiveFormat;
      await this.saveState();
    }
    if (this.state.installs[pkg.slug]) await this.uninstall(pkg.slug, true);
    const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'bsr-content-'));
    const installedFiles = [];
    const rollbackFiles = [];
    const rollbackSnapshots = [];
    const backupDirectory = path.join(this.backupRoot, `${pkg.slug}-${pkg.version}`);
    try {
      const progressBase = { slug:pkg.slug, name:pkg.name, version:pkg.version, operation:'install' };
      this.emitProgress(sender, { ...progressBase, phase:'validate', percent:0, message:'Validando pacote…' });
      ensureNotAborted(signal);
      let expandedBytes = 0;
      if (this.actools) {
        const extracted = await this.actools.request('extract', { archive:download.path, destination:staging }, progress => {
          this.emitProgress(sender, { ...progressBase, phase:'validate', percent:Math.max(1, Math.round(Number(progress.progress || 0) * 5)), current:Number(progress.current || 0), total:Number(progress.total || 0), message:progress.message || '', engine:'actools' });
        }, signal);
        expandedBytes = Number(extracted.expandedBytes || 0);
        if (!Number.isSafeInteger(expandedBytes) || expandedBytes < 0 || expandedBytes > MAX_EXPANDED_BYTES) throw new Error('O conteúdo expandido excede o limite de segurança.');
        for (const entry of extracted.files || []) validateArchiveEntry(entry);
      } else {
        if (archiveFormat !== 'zip') throw new Error('Pacotes RAR e 7z exigem o motor AcTools incluído no launcher. Reinstale a versão atual do BSR Hub.');
        await extractZip(download.path, { dir:staging, onEntry:entry => {
          validateArchiveEntry(entry.fileName);
          const entryBytes = Number(entry.uncompressedSize || 0);
          if (!Number.isSafeInteger(entryBytes) || entryBytes < 0) throw new Error('O pacote contém um tamanho de arquivo inválido.');
          expandedBytes += entryBytes;
          if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error('O conteúdo expandido excede o limite de segurança.');
        } });
      }
      await listFiles(staging);
      ensureNotAborted(signal);
      let inspection = null;
      let installWithAcTools = false;
      if (this.actools) {
        this.emitProgress(sender, { ...progressBase, phase:'inspect', percent:6, message:'Identificando o conteúdo…', engine:'actools' });
        try {
          inspection = await this.actools.request('inspect', { archive:download.path, acRoot:this.state.gamePath }, progress => {
            this.emitProgress(sender, { ...progressBase, phase:'inspect', percent:Math.max(6, 6 + Math.round(Number(progress.progress || 0) * 14)), message:progress.message || 'Identificando o conteúdo…', engine:'actools' });
          }, signal);
          this.validateAcToolsInspection(pkg, inspection);
          const detectedTarget = inspection.entries.find(entry => ['CarContentEntry','TrackContentEntry'].includes(String(entry.kind || '')))?.id;
          if (detectedTarget && isGenericTargetId(pkg.type, pkg.targetId)) pkg.targetId = cleanId(detectedTarget, 'Destino detectado');
          // Python apps and CSP extensions use the Hub's restricted game-root copier:
          // AcTools can identify some of them without copying every declared file.
          installWithAcTools = !['app','extension'].includes(pkg.type);
        } catch (error) {
          const rejectedEntries = error?.details?.entries;
          if (!Array.isArray(rejectedEntries) || rejectedEntries.length || !['app','extension'].includes(pkg.type)) throw error;
          inspection = { ...error.details, entries:[], fallback:true };
        }
      }
      let plan = !installWithAcTools && this.actools ? await this.secureRootFallbackPlan(staging, pkg) : null;
      if (!plan) {
        if (this.actools && !installWithAcTools) throw new Error('O AcTools não reconheceu este pacote e sua estrutura não é compatível com a instalação segura do BSR Hub.');
        plan = await this.payloadPlan(staging, pkg, inspection?.entries || []);
      }
      let files = await listFiles(plan.source);
      if (plan.allowedTopLevel) {
        files = files.filter(relative => plan.allowedTopLevel.includes(relative.split(path.sep)[0].toLowerCase()));
      }
      if (!files.length) throw new Error('O pacote não contém arquivos instaláveis.');
      ensureNotAborted(signal);
      const plannedFiles = [];
      const ownedByOthers = new Map();
      for (const [otherSlug, otherInstall] of Object.entries(this.state.installs)) {
        if (otherSlug === pkg.slug) continue;
        for (const file of otherInstall.files || []) ownedByOthers.set(String(file.path).toLowerCase(), { slug:otherSlug, file });
      }
      const conflicts = [];
      for (const relativeSource of files) {
        const destination = path.resolve(plan.destination, relativeSource);
        if (!isInside(this.state.gamePath, destination)) throw new Error('O pacote tentou sair da pasta do jogo.');
        const relativeGame = path.relative(this.state.gamePath, destination);
        const source = path.join(plan.source, relativeSource);
        const sourceSha256 = await hashFile(source);
        const owner = ownedByOthers.get(relativeGame.toLowerCase());
        if (owner && owner.file.sha256 !== sourceSha256) conflicts.push({ path:relativeGame, owner:owner.slug });
        plannedFiles.push({ relativeSource, source, destination, relativeGame, sourceSha256, backup:null });
      }
      if (conflicts.length) {
        const preview = conflicts.slice(0, 3).map(item => `${item.path} (${item.owner})`).join(', ');
        throw new Error(`Conflito com outro pacote instalado: ${preview}${conflicts.length > 3 ? ` e mais ${conflicts.length - 3}` : ''}. Desinstale o pacote conflitante primeiro.`);
      }
      this.emitProgress(sender, { ...progressBase, phase:'backup', percent:22, message:'Preparando backup e manifesto…' });
      if (installWithAcTools) {
        const managedBase = path.resolve(this.state.gamePath, ...this.targetSegments(pkg));
        const snapshotDirectory = path.join(staging, '.bsr-actools-rollback');
        const contentRoots = new Map();
        for (const file of plannedFiles) {
          const relativeManaged = path.relative(managedBase, file.destination);
          const top = relativeManaged.split(path.sep)[0];
          if (!top || top === '..' || path.isAbsolute(relativeManaged)) continue;
          contentRoots.set(top.toLowerCase(), path.join(managedBase, top));
        }
        for (const [key, target] of contentRoots) {
          ensureNotAborted(signal);
          const snapshot = path.join(snapshotDirectory, key);
          const wasPresent = await exists(target);
          if (wasPresent) await fsp.cp(target, snapshot, { recursive:true, force:true, errorOnExist:false });
          rollbackSnapshots.push({ target, snapshot, wasPresent });
        }
      }

      for (const file of plannedFiles) {
        ensureNotAborted(signal);
        const backup = path.join(backupDirectory, file.relativeGame);
        if (await exists(file.destination)) {
          await fsp.mkdir(path.dirname(backup), { recursive:true });
          await fsp.copyFile(file.destination, backup);
          file.backup = path.relative(this.backupRoot, backup);
        }
        rollbackFiles.push({ path:file.relativeGame, backup:file.backup });
      }

      const installEngine = installWithAcTools ? 'actools' : (this.actools ? 'bsr-secure-copy' : 'legacy');
      if (installWithAcTools) {
        this.emitProgress(sender, { ...progressBase, phase:'install', percent:25, message:'Iniciando instalação…', engine:'actools' });
        let currentInstallPercent = 25;
        const result = await this.actools.request('install', { archive:download.path, acRoot:this.state.gamePath }, progress => {
          const reported = Number(progress.progress);
          if (Number.isFinite(reported) && reported >= 0) currentInstallPercent = 25 + Math.round(Math.max(0, Math.min(1, reported)) * 70);
          this.emitProgress(sender, { ...progressBase, phase:'install', percent:currentInstallPercent, current:Number(progress.current || 0), total:Number(progress.total || 0), message:progress.message || 'Instalando conteúdo…', engine:'actools' });
        }, signal);
        const actualFiles = [...new Set((result.installedFiles || []).map(file => {
          const absolute = path.resolve(String(file || ''));
          if (!isInside(this.state.gamePath, absolute)) throw new Error('O AcTools reportou um arquivo fora da pasta do jogo.');
          return path.relative(this.state.gamePath, absolute);
        }))];
        const expectedByPath = new Map(plannedFiles.map(file => [file.relativeGame.toLowerCase(), file]));
        const unexpected = actualFiles.filter(file => !expectedByPath.has(file.toLowerCase()));
        const missing = plannedFiles.filter(file => !isOptionalArchiveMetadata(file.relativeGame)
          && !actualFiles.some(actual => actual.toLowerCase() === file.relativeGame.toLowerCase()));
        if (unexpected.length || missing.length) {
          const details = [...unexpected.slice(0, 2).map(file => `inesperado: ${file}`), ...missing.slice(0, 2).map(file => `ausente: ${file.relativeGame}`)].join('; ');
          throw new Error(`A instalação do AcTools divergiu do manifesto validado (${details}). A operação foi revertida.`);
        }
        for (const relativeGame of actualFiles) {
          const planned = expectedByPath.get(relativeGame.toLowerCase());
          const destination = path.resolve(this.state.gamePath, relativeGame);
          if (!(await exists(destination))) throw new Error(`O AcTools não concluiu a gravação de ${relativeGame}.`);
          installedFiles.push({ path:relativeGame, sha256:await hashFile(destination), backup:planned.backup });
        }
      } else {
        for (let index = 0; index < plannedFiles.length; index += 1) {
          ensureNotAborted(signal);
          const file = plannedFiles[index];
          await fsp.mkdir(path.dirname(file.destination), { recursive:true });
          await fsp.copyFile(file.source, file.destination);
          installedFiles.push({ path:file.relativeGame, sha256:await hashFile(file.destination), backup:file.backup });
          this.emitProgress(sender, { ...progressBase, phase:'install', current:index + 1, total:plannedFiles.length, percent:25 + Math.round((index + 1) / plannedFiles.length * 70), message:file.relativeGame, engine:installEngine });
        }
      }
      this.state.installs[pkg.slug] = { objectId:pkg.objectId, name:pkg.name, version:pkg.version, type:pkg.type, installedAt:new Date().toISOString(), engine:installEngine, sourceStrategy:plan.sourceStrategy, detectedEntries:inspection?.entries || [], files:installedFiles };
      this.recordHistory('install', pkg, { files:installedFiles.length, engine:installEngine, sourceStrategy:plan.sourceStrategy });
      await this.saveState();
      this.emitProgress(sender, { ...progressBase, phase:'installed', percent:100, message:'Instalação concluída.', engine:installEngine });
      return { ok:true, slug:pkg.slug, files:installedFiles.length, engine:installEngine, entries:inspection?.entries || [] };
    } catch (error) {
      for (const file of [...rollbackFiles].reverse()) {
        const destination = path.resolve(this.state.gamePath, file.path);
        const backup = file.backup ? path.resolve(this.backupRoot, file.backup) : null;
        if (!isInside(this.state.gamePath, destination)) continue;
        if (backup && isInside(this.backupRoot, backup) && await exists(backup)) {
          await fsp.mkdir(path.dirname(destination), { recursive:true }).catch(() => {});
          await fsp.copyFile(backup, destination).catch(() => {});
        }
        else await fsp.unlink(destination).catch(() => {});
      }
      for (const snapshot of rollbackSnapshots) {
        if (!isInside(this.state.gamePath, snapshot.target)) continue;
        await fsp.rm(snapshot.target, { recursive:true, force:true }).catch(() => {});
        if (snapshot.wasPresent && isInside(staging, snapshot.snapshot) && await exists(snapshot.snapshot)) {
          await fsp.mkdir(path.dirname(snapshot.target), { recursive:true }).catch(() => {});
          await fsp.cp(snapshot.snapshot, snapshot.target, { recursive:true, force:true, errorOnExist:false }).catch(() => {});
        }
      }
      await fsp.rm(backupDirectory, { recursive:true, force:true }).catch(() => {});
      if (signal?.aborted || error?.name === 'AbortError') {
        this.emitProgress(sender, { slug:pkg.slug, name:pkg.name, version:pkg.version, operation:'install', phase:'install-cancelled', percent:0, message:'Instalação cancelada e alterações revertidas.' });
        throw new Error('Instalação cancelada pelo usuário. As alterações foram revertidas.');
      }
      throw error;
    } finally { await fsp.rm(staging, { recursive:true, force:true }).catch(() => {}); }
  }

  async uninstall(slugValue, preserveDownload = false) {
    const slug = cleanId(slugValue, 'Pacote').toLowerCase();
    const install = this.state.installs[slug];
    if (!install) return { ok:true, removed:0 };
    if (!(await this.isGameDirectory(this.state.gamePath))) throw new Error('A instalação do Assetto Corsa não foi localizada.');
    const otherPaths = new Set(Object.entries(this.state.installs).filter(([key]) => key !== slug).flatMap(([, item]) => (item.files || []).map(file => file.path.toLowerCase())));
    let removed = 0;
    for (const file of [...(install.files || [])].reverse()) {
      if (otherPaths.has(String(file.path).toLowerCase())) continue;
      const destination = path.resolve(this.state.gamePath, file.path);
      if (!isInside(this.state.gamePath, destination)) continue;
      const backup = file.backup ? path.resolve(this.backupRoot, file.backup) : null;
      if (backup && isInside(this.backupRoot, backup) && await exists(backup)) {
        await fsp.mkdir(path.dirname(destination), { recursive:true }); await fsp.copyFile(backup, destination); await fsp.unlink(backup).catch(() => {});
      } else await fsp.unlink(destination).catch(() => {});
      await removeEmptyParents(destination, this.state.gamePath); removed += 1;
    }
    delete this.state.installs[slug];
    if (!preserveDownload) {
      const download = this.state.downloads[slug];
      if (download?.path && isInside(this.downloadRoot, download.path)) await fsp.unlink(download.path).catch(() => {});
      delete this.state.downloads[slug];
    }
    this.recordHistory('uninstall', { slug, name:install.name, version:install.version }, { files:removed });
    await this.saveState(); return { ok:true, removed };
  }

  async verify(slugValue) {
    const slug = cleanId(slugValue, 'Pacote').toLowerCase();
    const install = this.state.installs[slug];
    if (!install) return { installed:false, valid:false, missing:[] };
    const missing = []; const changed = [];
    for (const file of install.files || []) {
      const destination = path.resolve(this.state.gamePath, file.path);
      if (!isInside(this.state.gamePath, destination) || !(await exists(destination))) missing.push(file.path);
      else if ((await hashFile(destination)) !== file.sha256) changed.push(file.path);
    }
    return { installed:true, valid:!missing.length && !changed.length, missing, changed };
  }

  async audit(packages = []) {
    const result = this.summary(packages);
    for (const raw of packages || []) {
      const slug = String(raw.slug || '').toLowerCase();
      const status = result.statuses[slug];
      if (!slug || !status) continue;
      if (status.installed) {
        const verification = await this.verify(slug);
        status.valid = verification.valid;
        status.damaged = !verification.valid;
        status.missingFiles = verification.missing.length;
        status.changedFiles = verification.changed.length;
      }
      const download = this.state.downloads[slug];
      if (status.downloaded && download?.path) {
        const present = isInside(this.downloadRoot, download.path) && await exists(download.path);
        status.downloadValid = Boolean(present && await hashFile(download.path) === download.sha256);
        if (!status.downloadValid) status.downloaded = false;
      }
    }
    result.history = (this.state.history || []).slice(0, 20);
    return result;
  }

  async repair(reference, sender, sessionToken = '') {
    const pkg = await this.canonicalPackage(reference, sessionToken);
    if (this.busy.has(pkg.slug)) return this.busy.get(pkg.slug);
    const controller = new AbortController();
    this.activeInstalls.set(pkg.slug, { controller, sender, startedAt:Date.now(), repair:true });
    const operation = (async () => {
      const download = this.state.downloads[pkg.slug];
      const archiveValid = Boolean(download && download.version === pkg.version && await exists(download.path) && await hashFile(download.path) === pkg.sha256);
      if (!archiveValid) await this.downloadCanonical(pkg, sender, controller.signal);
      const result = await this.installCanonical(pkg, sender, controller.signal);
      this.recordHistory('repair', pkg, { files:result.files });
      await this.saveState();
      return { ...result, repaired:true };
    })().finally(() => { this.activeInstalls.delete(pkg.slug); this.busy.delete(pkg.slug); });
    this.busy.set(pkg.slug, operation);
    return operation;
  }

  async clearDownload(slugValue) {
    const slug = cleanId(slugValue, 'Pacote').toLowerCase();
    if (this.busy.has(slug)) throw new Error('Aguarde a operação atual terminar.');
    const download = this.state.downloads[slug];
    if (download?.path && isInside(this.downloadRoot, download.path)) await fsp.unlink(download.path).catch(() => {});
    delete this.state.downloads[slug];
    await this.saveState();
    return { ok:true };
  }

  async serverInformation(host, ports) {
    const attempted = [];
    let lastError = null;
    for (const port of [...new Set(ports)]) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      attempted.push(port);
      try {
        const response = await this.net.fetch(`http://${host}:${port}/INFO`, { signal:controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        return normalizeOnlineServerInformation(payload, port);
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }
    const detail = lastError?.name === 'AbortError' ? 'tempo limite excedido' : cleanText(lastError?.message, 120);
    throw new Error(`Não foi possível confirmar a sessão ativa do servidor nas portas ${attempted.join(' ou ')}${detail ? ` (${detail})` : ''}. Verifique o endereço e a porta HTTP no painel administrativo.`);
  }

  async firstCarSkin(carId) {
    const skins = path.join(this.state.gamePath, 'content', 'cars', carId, 'skins');
    try {
      const entries = await fsp.readdir(skins, { withFileTypes:true });
      return entries.filter(item => item.isDirectory() && /^[a-z0-9][a-z0-9_. -]{0,119}$/i.test(item.name)).map(item => item.name).sort()[0] || '';
    } catch (_) {
      return '';
    }
  }

  async joinServer(raw) {
    if (!(await this.isGameDirectory(this.state.gamePath))) throw new Error('Localize a instalação do Assetto Corsa antes de entrar no servidor.');
    const host = String(raw?.host || '').trim().toLowerCase();
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$|^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) throw new Error('Endereço do servidor inválido.');
    const serverPort = Number(raw.serverPort); const httpPort = Number(raw.httpPort);
    if (![serverPort, httpPort].every(port => Number.isInteger(port) && port > 0 && port <= 65535)) throw new Error('Portas do servidor inválidas.');
    const requestedCar = cleanId(raw.requestedCar, 'Carro');
    const expectedTrack = raw.expectedTrack ? cleanId(raw.expectedTrack, 'Pista').toLowerCase() : '';
    const steamGuid = String(raw.steamGUID || '').trim();
    if (!/^\d{17}$/.test(steamGuid)) throw new Error('Entre com a Steam antes de iniciar a corrida.');
    const server = await this.serverInformation(host, [httpPort, serverPort]);
    const track = resolveServerTrack(expectedTrack, server.track);
    if (!track.matches) {
      const expectedName = cleanText(raw.expectedTrackName, 100) || track.expected;
      throw new Error(`O servidor está rodando a pista “${server.track}”, mas esta corrida exige “${expectedName}” (${track.expected}). Ative o preset correto no AssettoHosting e tente novamente.`);
    }
    if (!server.cars.includes(requestedCar.toLowerCase())) {
      throw new Error(`O servidor ativo não permite o carro “${requestedCar}”. Ele está configurado para outro evento. Ative o preset correto no AssettoHosting e tente novamente.`);
    }
    const carDirectory = path.join(this.state.gamePath, 'content', 'cars', requestedCar);
    const trackDirectory = path.join(this.state.gamePath, 'content', 'tracks', track.track);
    if (!(await exists(carDirectory))) throw new Error(`O carro exigido pelo servidor não está instalado: ${requestedCar}.`);
    if (!(await exists(trackDirectory))) throw new Error(`A pista exigida pelo servidor não está instalada: ${track.track}.`);
    if (track.layout && !(await exists(path.join(trackDirectory, track.layout)))) throw new Error(`O layout exigido pelo servidor não está instalado: ${track.track}/${track.layout}.`);
    const selectedSkin = await this.firstCarSkin(requestedCar);
    const executable = ['AssettoCorsa.exe', 'acs.exe'].map(name => path.join(this.state.gamePath, name)).find(candidate => fs.existsSync(candidate));
    if (!executable) throw new Error('Executável do Assetto Corsa não encontrado.');
    const configDirectory = path.join(this.app.getPath('documents'), 'Assetto Corsa', 'cfg');
    const raceIni = path.join(configDirectory, 'race.ini');
    await fsp.mkdir(configDirectory, { recursive:true });
    const original = await fsp.readFile(raceIni, 'utf8').catch(() => '');
    const backup = `${raceIni}.bsr-backup`;
    if (original && !(await exists(backup))) await fsp.writeFile(backup, original, 'utf8');
    const updated = updateIniSections(original, {
      RACE:{ MODEL:requestedCar, MODEL_CONFIG:'', SKIN:selectedSkin, TRACK:track.track, CONFIG_TRACK:track.layout, CARS:1, AI_LEVEL:100, FIXED_SETUP:0, PENALTIES:1, JUMP_START_PENALTY:0, DRIFT_MODE:0, RACE_LAPS:0 },
      CAR_0:{ MODEL:'-', MODEL_CONFIG:'', SKIN:'', DRIVER_NAME:cleanText(raw.driverName || 'Piloto BSR', 100), NATIONALITY:'', NATION_CODE:'', TEAM:'', SETUP:'', BALLAST:0, RESTRICTOR:0 },
      REMOTE:{ SERVER_IP:host, SERVER_PORT:server.gamePort, SERVER_HTTP_PORT:server.httpPort, SERVER_NAME:server.name || cleanText(raw.serverName || 'Brasil Sim Racing', 100), REQUESTED_CAR:requestedCar, NAME:cleanText(raw.driverName || 'Piloto BSR', 100), TEAM:'', PASSWORD:cleanText(raw.password, 100), GUID:steamGuid, ACTIVE:1 },
      AUTOSPAWN:{ ACTIVE:1 }
    });
    const temporary = `${raceIni}.bsr-tmp`;
    await fsp.writeFile(temporary, updated, 'utf8'); await fsp.copyFile(temporary, raceIni); await fsp.unlink(temporary).catch(() => {});
    const child = spawn(executable, ['/spawn'], { cwd:this.state.gamePath, detached:true, stdio:'ignore', windowsHide:false });
    child.unref();
    return { ok:true, pid:child.pid, executable:path.basename(executable), track:track.actual, car:requestedCar, serverPort:server.gamePort, httpPort:server.httpPort };
  }
}

function registerContentManager({ app, dialog, net, BrowserWindow, ipcMain, getMainWindow, actools = null }) {
  const manager = new BSRContentManager({ app, dialog, net, BrowserWindow, actools });
  const trusted = event => {
    const window = getMainWindow();
    if (!window || event.sender !== window.webContents) throw new Error('Origem não autorizada.');
    return window;
  };
  ipcMain.handle('content:initialize', event => { trusted(event); return manager.initialize(); });
  ipcMain.handle('content:status', (event, packages) => { trusted(event); return manager.summary(Array.isArray(packages) ? packages : []); });
  ipcMain.handle('content:choose-game', event => manager.chooseGamePath(trusted(event)));
  ipcMain.handle('content:inspect-package', event => manager.inspectPackage(trusted(event)));
  ipcMain.handle('content:download', (event, pkg, sessionToken) => { trusted(event); return manager.download(pkg, event.sender, sessionToken); });
  ipcMain.handle('content:cancel-download', (event, slug) => { trusted(event); return manager.cancelDownload(slug); });
  ipcMain.handle('content:cancel-install', (event, slug) => { trusted(event); return manager.cancelInstall(slug); });
  ipcMain.handle('content:install', (event, pkg, sessionToken) => { trusted(event); return manager.install(pkg, event.sender, sessionToken); });
  ipcMain.handle('content:uninstall', (event, slug) => { trusted(event); return manager.uninstall(slug); });
  ipcMain.handle('content:verify', (event, slug) => { trusted(event); return manager.verify(slug); });
  ipcMain.handle('content:audit', (event, packages) => { trusted(event); return manager.audit(Array.isArray(packages) ? packages : []); });
  ipcMain.handle('content:repair', (event, pkg, sessionToken) => { trusted(event); return manager.repair(pkg, event.sender, sessionToken); });
  ipcMain.handle('content:clear-download', (event, slug) => { trusted(event); return manager.clearDownload(slug); });
  ipcMain.handle('content:join', (event, config) => { trusted(event); return manager.joinServer(config); });
  return manager;
}

module.exports = { BSRContentManager, registerContentManager, sanitizePackageMetadata, validateArchiveEntry, detectArchiveLayout, detectArchiveFormat, isOptionalArchiveMetadata, isInside, parseSteamLibraries, updateIniSections, cleanSessionToken, normalizeServerTrack, resolveServerTrack, normalizeOnlineServerInformation, googleDriveFileId, canonicalGoogleDriveUrl, googleDriveConfirmationUrl };
