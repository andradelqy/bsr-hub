const assert = require('node:assert/strict');
const Policy = require('../cloud/rating-policy');
const Coordinator = require('../cloud/rating-publication');
const base = { raceId:'race', sessionType:'RACE', sessionDate:'2026-10-20T20:00:00Z', track:'track', heat:'1' };
assert.equal(Policy.sessionIdentity(base), Policy.sessionIdentity({ ...base, sourceHash:'another' }));
assert.notEqual(Policy.sessionIdentity(base), Policy.sessionIdentity({ ...base, heat:'2' }));
assert.notEqual(Policy.sessionIdentity(base), Policy.sessionIdentity({ ...base, sessionDate:'2026-10-20T21:00:00Z' }));
assert.throws(() => Policy.sessionIdentity({ ...base, sessionDate:'invalid' }));
assert.equal(Policy.hash({ b:2, a:1 }), Policy.hash({ a:1, b:2 }));
const mpr = { rated:true, driver:{}, corners:300, incidents:2, completion:1, license:'R' };
assert.equal(Policy.mprDecision(mpr).eligible, true);
for (const override of [{ corners:20 }, { incidents:90 }, { completion:0.2 }, { driver:{ didNotStart:true } }, { driver:{ disconnected:true } }]) {
  assert.equal(Policy.mprDecision({ ...mpr, ...override }).eligible, false);
}
assert.equal(Policy.mprDecision({ ...mpr, license:'A' }).eligible, false);
assert.equal(Policy.mprDecision({ ...mpr, license:'A', policy:{ minimumLicense:'A' } }).eligible, true);

// Shared storage with atomic increments, independent objects per reader.
const storage = { workers:0 };
class Record {
  constructor() { this.values = { ...storage }; this.delta = {}; this.sets = {}; this.unsets = []; }
  get(k) { return this.values[k]; }
  set(k,v) { this.sets[k] = v; this.values[k] = v; }
  unset(k) { this.unsets.push(k); delete this.values[k]; }
  increment(k,n) { this.delta[k] = (this.delta[k] || 0) + n; }
  async save() {
    for (const [k,n] of Object.entries(this.delta)) storage[k] = (storage[k] || 0) + n; this.delta = {};
    Object.assign(storage,this.sets); this.sets = {};
    this.unsets.forEach(k => delete storage[k]); this.unsets = [];
    this.values = { ...storage }; return this;
  }
}
const Parse = { Config:{ get:async () => ({ get:() => 'gate' }) }, Query:class { async get() { return new Record(); } } };
(async () => {
  const coordinator = Coordinator(Parse);
  let unblock;
  const suspended = new Promise(resolve => { unblock = resolve; });
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const first = coordinator.run('first', async mark => { await mark(); entered(); await suspended; return 1; });
  await ready;
  await assert.rejects(coordinator.run('second', async () => assert.fail('overlapping writer')), /andamento/);
  unblock(); assert.equal(await first,1);
  assert.equal(storage.workers,0);
  await assert.rejects(coordinator.run('invalid', async () => { throw Error('preview'); }), /preview/);
  assert.equal(storage.activeImport,undefined, 'preflight failure must not poison the gate');
  await assert.rejects(coordinator.run('failed', async mark => { await mark(); throw Error('network'); }), /network/);
  assert.equal(storage.workers,0);
  assert.equal(storage.activeImport,'failed');
  await assert.rejects(coordinator.run('different', async () => assert.fail()), /pendente/);
  await coordinator.run('failed', async () => 'recovered');
  assert.equal(storage.activeImport,undefined);
  assert.equal(storage.workers,0);
  console.log('Rating policy and publication concurrency/recovery checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
