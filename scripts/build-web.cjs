const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const output = path.join(root, 'web-dist');
const entries = ['index.html','login.html','steam_callback.html','admin.html','api.js','config.js','_headers','app'];
const assetFiles = [
  'assets/foto/favicon.png',
  'assets/foto/bsr.png',
  'assets/foto/fundo2.png',
  'assets/video/stockcar.png',
  'assets/historia/assetto.jpg'
];

fs.rmSync(output, { recursive:true, force:true });
fs.mkdirSync(output, { recursive:true });
for (const entry of entries) {
  fs.cpSync(path.join(root, entry), path.join(output, entry), { recursive:true });
}
for (const entry of assetFiles) {
  const destination = path.join(output, entry);
  fs.mkdirSync(path.dirname(destination), { recursive:true });
  fs.copyFileSync(path.join(root, entry), destination);
}

const archive = path.join(root, 'dist', `BSR-Hub-Web-${version}.zip`);
fs.mkdirSync(path.dirname(archive), { recursive:true });
if (process.platform === 'win32') {
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -Path (Join-Path ${quote(output)} '*') -DestinationPath ${quote(archive)} -Force`
  ], { stdio:'inherit' });
}

console.log(`Site preparado em ${output}`);
if (process.platform === 'win32') console.log(`Pacote preparado em ${archive}`);
