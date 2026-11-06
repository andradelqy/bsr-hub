'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const configPath = process.env.BSR_CONFIG_PATH
  ? path.resolve(process.env.BSR_CONFIG_PATH)
  : path.join(root, 'config.js');

function fail(message) {
  console.error('[BSR Config] ' + message);
  process.exit(1);
}

if (!fs.existsSync(configPath)) fail('config.js não foi encontrado.');

const source = fs.readFileSync(configPath, 'utf8');
if (/window\.(?:REST_API_KEY|MASTER_KEY)\s*=|X-Parse-REST-API-Key/i.test(source)) {
  fail('REST_API_KEY e MASTER_KEY não podem constar da configuração cliente.');
}

function valueOf(name) {
  const match = source.match(new RegExp('window\\.' + name + '\\s*=\\s*[\'"]([^\'"]*)[\'"]'));
  return match ? match[1].trim() : '';
}

for (const name of ['APP_ID', 'CLIENT_KEY', 'JAVASCRIPT_KEY', 'BASE_URL']) {
  const value = valueOf(name);
  if (!value || /^(YOUR_|PREENCHER|CHANGE_ME)/i.test(value)) {
    fail('Configure ' + name + ' em config.js antes de gerar uma distribuição.');
  }
}

if (!/^https:\/\//i.test(valueOf('BASE_URL'))) {
  fail('BASE_URL deve usar HTTPS.');
}

console.log('Back4App client config validated (key values were not printed).');
