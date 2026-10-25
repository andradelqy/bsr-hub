// Runs the real Cloud handlers and rating engine against an isolated Parse
// adapter. No network and no production database writes.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const database = new Map();
const handlers = {};
let sequence = 0;
let failDriver = '';
let failed = false;
let failPlan = false;
const clone = value => {
  if (value instanceof Record) return value;
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,clone(v)]));
  return value;
};
const key = (cls,id) => `${cls}/${id}`;
class Record {
  constructor(className, attrs = {}) { this.className = className; this.id = attrs.objectId; this.attrs = {}; this.delta = {}; this.removed = []; this.set(attrs); }
  get(name) { return this.attrs[name]; }
  set(name,value) { if (typeof name === 'object') Object.assign(this.attrs,clone(name)); else this.attrs[name] = clone(value); return this; }
  unset(name) { delete this.attrs[name]; this.removed.push(name); return this; }
  increment(name,value) { this.delta[name] = (this.delta[name] || 0) + value; }
  setACL() {}
  getUsername() { return 'admin-test'; }
  getSessionToken() { return 'test-session'; }
  toJSON() { return { objectId:this.id,...clone(this.attrs) }; }
  async save() {
    if (this.className === 'RaceImports' && failPlan) { failPlan = false; throw Error('simulated plan write failure'); }
    if (this.className === 'Driver' && this.id === failDriver && !failed) { failed = true; throw Error('simulated driver write failure'); }
    this.id ||= `id${++sequence}`;
    const prior = database.get(key(this.className,this.id));
    for (const [name,amount] of Object.entries(this.delta)) this.attrs[name] = (prior?.attrs[name] || 0) + amount;
    this.delta = {};
    this.createdAt = prior?.createdAt || new Date();
    this.updatedAt = new Date();
    database.set(key(this.className,this.id),{ attrs:clone(this.attrs),createdAt:this.createdAt,updatedAt:this.updatedAt });
    return this;
  }
}
const valueOf = value => value instanceof Record ? `${value.className}/${value.id}` : value instanceof Date ? value.getTime() : value;
class Query {
  constructor(cls) { this.cls = typeof cls === 'string' ? cls : '_User'; this.filters = []; this.maximum = 1000; }
  equalTo(k,v) { this.filters.push(o => valueOf(k === 'objectId' ? o.id : o.get(k)) === valueOf(v)); return this; }
  notEqualTo(k,v) { this.filters.push(o => valueOf(k === 'objectId' ? o.id : o.get(k)) !== valueOf(v)); return this; }
  containedIn(k,list) { this.filters.push(o => list.map(valueOf).includes(valueOf(o.get(k)))); return this; }
  greaterThan(k,v) { this.filters.push(o => valueOf(o.get(k)) > valueOf(v)); return this; }
  lessThanOrEqualTo(k,v) { this.filters.push(o => valueOf(o.get(k)) <= valueOf(v)); return this; }
  descending(field) { this.sort = field; return this; }
  ascending() { return this; }
  include() { return this; }
  limit(n) { this.maximum = n; return this; }
  async get(id) {
    const data = database.get(key(this.cls,id));
    if (!data) throw Error(`Missing ${this.cls}/${id}`);
    const item = new Record(this.cls,{ ...clone(data.attrs),objectId:id });
    item.createdAt = data.createdAt; item.updatedAt = data.updatedAt;
    return item;
  }
  async find() {
    const rows = [];
    for (const entry of database.keys()) {
      const [cls,id] = entry.split('/');
      if (cls !== this.cls) continue;
      const object = await this.get(id);
      if (this.filters.every(fn => fn(object))) rows.push(object);
    }
    if (this.sort) rows.sort((a,b) => valueOf(b.get(this.sort) || b[this.sort]) - valueOf(a.get(this.sort) || a[this.sort]));
    return rows.slice(0,this.maximum);
  }
  async first() { return (await this.find())[0]; }
  async count() { return (await this.find()).length; }
  static or(...queries) {
    const q = new Query(queries[0].cls); q.filters.push(o => queries.some(candidate => candidate.filters.every(fn => fn(o)))); return q;
  }
}
Record.saveAll = async rows => { for (const row of rows) await row.save(); return rows; };
Record.destroyAll = async rows => rows.forEach(row => database.delete(key(row.className,row.id)));
const admin = new Record('_User',{ objectId:'admin' });
const Parse = { Object:Record, Query, ACL:class {}, User:class {}, Role:class {}, Error,
  Config:{ get:async () => ({ get:field => field === 'BSR_RATING_GATE_ID' ? 'gate' : undefined }) },
  Cloud:{ define:(name,fn) => { handlers[name] = fn; }, job:() => {}, beforeSave:() => {}, beforeFind:() => {}, beforeDelete:() => {},
    run:(name,params) => handlers[name]({ params,user:admin }) } };
const context = vm.createContext({ Parse, console, URL, Date, setTimeout, clearTimeout, AbortController,
  require:name => name.startsWith('./') ? require(path.join(root,'cloud',name)) : require(name) });
vm.runInContext(fs.readFileSync(path.join(root,'cloud/main.js'),'utf8') +
  '\nrequireAdmin = async () => Parse.testAdmin; requireHubAccess = async () => ({});', context);
Parse.testAdmin = admin;
const invoke = (name,params) => handlers[name]({ params,user:admin });
(async () => {
  await new Record('RatingPublicationGate',{ objectId:'gate',workers:0 }).save();
  await new Record('Races',{ objectId:'race',title:'Test',track:'test',startAt:new Date('2026-01-01'),ratingPolicy:{ minimumStarters:4,minimumClassStarters:3 } }).save();
  for (let i = 1; i <= 4; i++) await new Record('Driver',{ objectId:`driver${i}`,steamGUID:`7656119800000000${i}`,name:`Driver ${i}`,irating:1600,safetyRating:2.5,licenseClass:'R',totalRaces:0 }).save();
  const payload = { raceId:'race',track:'test',sessionType:'RACE',sessionDate:'2026-10-20T20:00:00Z',heat:'1',sourceHash:'a'.repeat(64),official:true,distanceValid:true,cornersPerLap:10,
    drivers:Array.from({ length:4 },(_,i) => ({ name:`Driver ${i+1}`,steamGUID:`7656119800000000${i+1}`,finishPosition:i+1,lapsCompleted:20,carClass:'GT3',incidentPoints:2,totalTimeMs:100000+i*1000 })) };
  let preview = await invoke('previewRaceImport',{ payload });
  assert.equal(preview.rows.length,4);
  assert.ok(preview.previewToken);
  await assert.rejects(invoke('commitRaceImport',{ payload:{ ...payload,previewToken:'stale' } }),/prévia/);
  assert.equal((await new Query('RatingPublicationGate').get('gate')).get('activeImport'),undefined);
  failPlan = true;
  await assert.rejects(invoke('commitRaceImport',{ payload:{ ...payload,previewToken:preview.previewToken } }),/plan write failure/);
  assert.equal(await new Query('RaceImports').count(),0);
  assert.ok((await new Query('RatingPublicationGate').get('gate')).get('activeImport'));
  await assert.rejects(invoke('commitRaceImport',{ payload:{ ...payload,heat:'2',previewToken:preview.previewToken } }),/pendente/);
  failDriver = 'driver2';
  await assert.rejects(invoke('commitRaceImport',{ payload:{ ...payload,previewToken:preview.previewToken } }),/simulated/);
  assert.equal((await new Query('Driver').get('driver1')).get('totalRaces'),1);
  assert.equal((await new Query('Driver').get('driver2')).get('totalRaces'),0);
  await assert.rejects(invoke('getPublicDrivers',{}),/atualização/);
  const batch = await new Query('RaceImports').first();
  assert.equal(batch.get('status'),'failed');
  const resumed = await invoke('resumeRaceImport',{ importId:batch.id });
  assert.equal(resumed.results,4);
  for (let i=1;i<=4;i++) assert.equal((await new Query('Driver').get(`driver${i}`)).get('totalRaces'),1);
  assert.equal(await new Query('RatingLedger').count(),4);
  assert.equal(await new Query('RaceResult').count(),4);
  const again = await invoke('commitRaceImport',{ payload:{ ...payload,previewToken:preview.previewToken } });
  assert.equal(again.alreadyCompleted,true);
  assert.equal(await new Query('RatingLedger').count(),4);
  await invoke('voidLatestRaceImport',{ importId:batch.id,reason:'Correção de classificação de teste' });
  for (let i=1;i<=4;i++) assert.equal((await new Query('Driver').get(`driver${i}`)).get('totalRaces'),0);
  assert.equal((await invoke('getRaceResults',{ raceId:'race' })).length,0);
  preview = await invoke('previewRaceImport',{ payload });
  assert.equal(preview.duplicate,false);
  await invoke('commitRaceImport',{ payload:{ ...payload,previewToken:preview.previewToken } });
  for (let i=1;i<=4;i++) assert.equal((await new Query('Driver').get(`driver${i}`)).get('totalRaces'),1);
  assert.equal(await new Query('RaceImports').count(),2);
  assert.equal((await invoke('getRaceResults',{ raceId:'race' })).length,4);
  const corrupt = await new Query('Driver').get('driver1'); corrupt.set('irating',9999); await corrupt.save();
  const rebuilt = await invoke('rebuildRatingsFromLedger',{});
  assert.equal(rebuilt.repaired,1);
  assert.equal((await new Query('Driver').get('driver1')).get('irating'),preview.rows[0].newIRating);
  console.log('Real Cloud handlers: preview expiry, partial failure, recovery, duplicate, void and republication passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
