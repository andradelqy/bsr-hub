'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const views = fs.readFileSync(path.join(root, 'app', 'views.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const cloud = fs.readFileSync(path.join(root, 'cloud', 'main.js'), 'utf8');

assert.match(views, /const form = event\.currentTarget;/, 'capture the form before awaiting');
assert.match(views, /await window\.BSR_API\.submitRaceReport[\s\S]*?form\.reset\(\)/, 'reset the captured form after successful submission');
assert.doesNotMatch(views, /event\.currentTarget\.reset\(\)/, 'currentTarget must not be accessed after await');
assert.match(views, /id="reportedPilotName" maxlength="100" required/, 'reporter must be able to provide a free-form pilot name');
assert.match(views, /id="reportedSteamId" inputmode="numeric" maxlength="17" pattern="\[0-9\]\{17\}"/, 'SteamID input must be optional and validated when supplied');
assert.doesNotMatch(views, /id="reportedSteamId"[^>]*\srequired/, 'SteamID must not be mandatory');
assert.match(api, /reportedPilotName, reportedSteamId/, 'API must send free-form name and optional SteamID separately');
assert.match(cloud, /reportedPilotName:targetName, reportedSteamId:againstSteamId/, 'Cloud Code must persist the reporter-entered target identity');
assert.match(cloud, /const againstDriver = uniqueTargets\.length === 1/, 'profile linking must only happen when the target can be identified safely');
assert.match(views, /report\.reportedPilotName \|\|/, 'administration must display the original entered nickname');
assert.match(views, /B\.escape\(againstName\)/, 'entered nickname must be escaped in the admin view');

console.log('Stewarding form, optional target identity and async reset checks passed.');
