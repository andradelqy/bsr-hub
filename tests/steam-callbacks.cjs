'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'cloud', 'main.js'), 'utf8');
const match = source.match(/function isAllowedSteamReturnTo\(value\) \{[\s\S]*?\n\}/);
assert.ok(match, 'Steam callback validator must exist');

function validator(env = {}) {
  const context = vm.createContext({
    process:{ env },
    URL,
    DEFAULT_STEAM_CALLBACK:'https://brasilsimracing.com/steam_callback.html',
    LEGACY_STEAM_CALLBACKS:['https://bsrracing2.netlify.app/steam_callback.html']
  });
  return vm.runInContext('(' + match[0] + ')', context);
}

const official = 'https://brasilsimracing.com/steam_callback.html?state=one-time-state';
assert.equal(
  validator({ STEAM_ALLOWED_CALLBACKS:'https://old-domain.example/steam_callback.html' })(official),
  true,
  'new official BSR callback must remain allowed when a stale env list exists'
);
assert.equal(
  validator({})('https://bsrracing2.netlify.app/steam_callback.html?state=legacy'),
  true,
  'legacy BSR callback must remain allowed during migration'
);
assert.equal(
  validator({ STEAM_ALLOWED_CALLBACKS:'https://extra.example/auth/steam, https://another.example/steam_callback.html' })(
    'https://extra.example/auth/steam?state=abc'
  ),
  true,
  'explicit additional exact callback must be allowed'
);
assert.equal(
  validator({ STEAM_ALLOWED_CALLBACKS:'https://extra.example/auth/steam' })(
    'https://evil-extra.example/auth/steam?state=abc'
  ),
  false,
  'similar hostnames must not be accepted'
);
assert.equal(
  validator({ STEAM_ALLOWED_CALLBACKS:'https://extra.example/auth/steam' })(
    'http://bsrracing2.netlify.app/steam_callback.html?state=abc'
  ),
  false,
  'HTTP on a public hostname must not be accepted'
);
assert.equal(
  validator({})('http://127.0.0.1:43122/steam/callback?state=abc'),
  true,
  'desktop loopback callback must remain allowed'
);
assert.equal(
  validator({})('http://192.168.1.20:43122/steam/callback?state=abc'),
  false,
  'LAN callback must not be accepted'
);

console.log('Steam callback allowlist checks passed.');
