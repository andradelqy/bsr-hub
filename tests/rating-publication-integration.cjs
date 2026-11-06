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
  descending(field) { this.sort = field; this.direction = -1; return this; }
  ascending(field) { this.sort = field || this.sort || 'objectId'; this.direction = 1; return this; }
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
    if (this.sort) rows.sort((a,b) => {
      const left = valueOf(this.sort === 'objectId' ? a.id : (a.get(this.sort) ?? a[this.sort]));
      const right = valueOf(this.sort === 'objectId' ? b.id : (b.get(this.sort) ?? b[this.sort]));
      if (left === right) return 0;
      return (left < right ? -1 : 1) * (this.direction || -1);
    });
    return rows.slice(0,this.maximum);
  }
  async first() { return (await this.find())[0]; }
  async count() { const maximum = this.maximum; this.maximum = Number.MAX_SAFE_INTEGER; try { return (await this.find()).length; } finally { this.maximum = maximum; } }
  static or(...queries) {
    const q = new Query(queries[0].cls); q.filters.push(o => queries.some(candidate => candidate.filters.every(fn => fn(o)))); return q;
  }
}
Record.saveAll = async rows => { for (const row of rows) await row.save(); return rows; };
Record.destroyAll = async rows => rows.forEach(row => database.delete(key(row.className,row.id)));
const admin = new Record('_User',{ objectId:'admin' });
class CloudError extends Error { constructor(code,message) { super(message); this.code = code; } }
Object.assign(CloudError,{ SESSION_MISSING:1, OPERATION_FORBIDDEN:2, OBJECT_NOT_FOUND:101, VALIDATION_ERROR:142, DUPLICATE_VALUE:137 });
const Parse = { Object:Record, Query, ACL:class { setRoleReadAccess() {} setRoleWriteAccess() {} }, User:class {}, Role:class {}, Error:CloudError,
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

  // Protest lookup must support both canonical steamGUID and legacy steamId rows.
  const legacyOwnerId = '76561198000000091';
  const legacyTargetId = '76561198000000092';
  await new Record('Driver',{ objectId:'legacy-owner',steamId:legacyOwnerId,name:'Piloto que protesta' }).save();
  await new Record('Driver',{ objectId:'legacy-target',steamId:legacyTargetId,name:'Piloto Legado' }).save();
  const pilotUser = new Record('_User',{ objectId:'pilot-user',steamId:legacyOwnerId });
  const reportBySteam = await handlers.submitRaceReport({ params:{ raceId:'race',againstSteamId:legacyTargetId,description:'Contato evitável na curva três da corrida.' },user:pilotUser });
  assert.equal(reportBySteam.status,'pending');
  const savedSteamReport = await new Query('Reports').get(reportBySteam.objectId);
  assert.equal(savedSteamReport.get('fromDriver').id,'legacy-owner');
  assert.equal(savedSteamReport.get('againstDriver').id,'legacy-target');
  const reportByName = await handlers.submitRaceReport({ params:{ raceId:'race',againstSteamId:'piloto legado',description:'O piloto mudou de linha durante a frenagem.' },user:pilotUser });
  const savedNameReport = await new Query('Reports').get(reportByName.objectId);
  assert.equal(savedNameReport.get('againstDriver').id,'legacy-target');
  assert.equal(savedNameReport.get('reportedPilotName'),'piloto legado');
  await assert.rejects(handlers.submitRaceReport({ params:{ raceId:'race',againstSteamId:legacyOwnerId,description:'Tentativa de protestar contra a própria conta.' },user:pilotUser }),/Você não pode protestar contra si mesmo/);

  const reportForUnregistered = await handlers.submitRaceReport({ params:{
    raceId:'race',reportedPilotName:'Nick novo que ainda não existe no Hub',
    description:'O piloto fechou a trajetória na zona de frenagem e causou contato.'
  },user:pilotUser });
  const savedUnregisteredReport = await new Query('Reports').get(reportForUnregistered.objectId);
  assert.equal(savedUnregisteredReport.get('reportedPilotName'),'Nick novo que ainda não existe no Hub');
  assert.equal(savedUnregisteredReport.get('againstDriver'),undefined,'unregistered target must not require a Driver profile');

  const unknownSteamId = '76561198000000999';
  const reportWithOptionalSteam = await handlers.submitRaceReport({ params:{
    raceId:'race',reportedPilotName:'Apelido informado pelo denunciante',reportedSteamId:unknownSteamId,
    description:'O piloto trocou de nick e não possui perfil cadastrado no BSR Hub.'
  },user:pilotUser });
  const savedOptionalSteamReport = await new Query('Reports').get(reportWithOptionalSteam.objectId);
  assert.equal(savedOptionalSteamReport.get('reportedPilotName'),'Apelido informado pelo denunciante');
  assert.equal(savedOptionalSteamReport.get('reportedSteamId'),unknownSteamId);
  assert.equal(savedOptionalSteamReport.get('againstDriver'),undefined,'unknown Steam ID must be accepted without a Hub profile');

  await new Record('Driver',{ objectId:'duplicate-name-a',steamGUID:'76561198000000093',name:'Nome Ambíguo' }).save();
  await new Record('Driver',{ objectId:'duplicate-name-b',steamGUID:'76561198000000094',name:'Nome Ambíguo' }).save();
  const ambiguousReport = await handlers.submitRaceReport({ params:{
    raceId:'race',reportedPilotName:'Nome Ambíguo',description:'Descrição suficientemente longa para o teste.'
  },user:pilotUser });
  const savedAmbiguousReport = await new Query('Reports').get(ambiguousReport.objectId);
  assert.equal(savedAmbiguousReport.get('reportedPilotName'),'Nome Ambíguo');
  assert.equal(savedAmbiguousReport.get('againstDriver'),undefined,'ambiguous target must be queued for manual identification instead of blocking submission');

  const payload = { raceId:'race',track:'test',sessionType:'RACE',sessionDate:'2026-10-20T20:00:00Z',heat:'1',sourceHash:'a'.repeat(64),official:true,distanceValid:true,cornersPerLap:10,
    drivers:Array.from({ length:4 },(_,i) => ({ name:`Driver ${i+1}`,steamGUID:`7656119800000000${i+1}`,finishPosition:i+1,lapsCompleted:20,carClass:'GT3',incidentPoints:2,totalTimeMs:100000+i*1000,incidentEvidence:'reported' })) };

  await new Record('Races',{ objectId:'formula-race',title:'Formula Test',track:'test',startAt:new Date('2026-01-01'),ratingPolicy:{ minimumStarters:4,minimumClassStarters:3 } }).save();
  for (let i=1;i<=4;i++) await new Record('Driver',{
    objectId:`formula-driver${i}`,steamGUID:`7656119800000010${i}`,name:`Formula Driver ${i}`,irating:2400,safetyRating:4.2,licenseClass:'B',licenseMPR:6,totalRaces:12,primaryDiscipline:'road'
  }).save();
  const formulaPreview = await invoke('previewRaceImport',{ payload:{ ...payload,raceId:'formula-race',sourceHash:'b'.repeat(64),
    drivers:Array.from({ length:4 },(_,i) => ({ name:`Formula Driver ${i+1}`,steamGUID:`7656119800000010${i+1}`,finishPosition:i+1,lapsCompleted:20,cornersCompleted:300,carClass:'Formula',incidentPoints:0,incidentEvidence:'reported' })) } });
  assert.ok(formulaPreview.rows.every(row => row.discipline === 'formula'));
  assert.ok(formulaPreview.rows.every(row => row.oldIRating === 1600), 'a new discipline must start independently instead of inheriting the primary road iRating');
  assert.ok(formulaPreview.rows.every(row => row.oldSafetyRating === 2.5 && row.oldLicense === 'R'), 'a new discipline must seed its own Safety and license history');

  await assert.rejects(
    invoke('previewRaceImport',{ payload:{ ...payload,drivers:payload.drivers.map((driver,index) => index === 0 ? { ...driver,carClass:'Unknown',carModel:'unlisted_mod' } : driver) } }),
    /Categoria de carro não identificada/, 'official publication must not combine unidentified cars into a shared class'
  );
  const serverFailurePreview = await invoke('previewRaceImport',{ payload:{ ...payload,heat:'collective-server-failure',serverFailure:true } });
  assert.ok(serverFailurePreview.rows.every(row => !row.rated && row.deltaIRating === 0 && !row.safetyEligible && row.points === 0));
  assert.ok(serverFailurePreview.rows.every(row => row.ratingReason === 'Falha coletiva do servidor'));
  await new Record('Races',{ objectId:'individual-failure-race',title:'Individual failure',track:'test',startAt:new Date('2026-01-01'),ratingPolicy:{ minimumStarters:3,minimumClassStarters:3 } }).save();
  const individualFailurePreview = await invoke('previewRaceImport',{ payload:{ ...payload,raceId:'individual-failure-race',heat:'individual-failure',drivers:payload.drivers.map((driver,index) => index === 0 ? { ...driver,serverFailure:true,isDNF:true,disconnected:true } : driver) } });
  const failedDriverRow = individualFailurePreview.rows.find(row => row.steamGUID === payload.drivers[0].steamGUID);
  const validDriverRows = individualFailurePreview.rows.filter(row => row.steamGUID !== payload.drivers[0].steamGUID);
  assert.equal(failedDriverRow.rated,false);
  assert.equal(failedDriverRow.deltaIRating,0);
  assert.equal(failedDriverRow.safetyEligible,false);
  assert.equal(failedDriverRow.points,0);
  assert.equal(failedDriverRow.ratingReason,'Falha do servidor');
  assert.ok(validDriverRows.every(row => row.rated && row.ratingReason === 'Válida para rating'), 'one isolated server failure must not invalidate the other drivers');

  const legacyTelemetryPreview = await invoke('previewRaceImport',{ payload:{ ...payload,heat:'legacy-explicit-telemetry',drivers:payload.drivers.map(({ incidentEvidence, ...driver }) => driver) } });
  assert.ok(legacyTelemetryPreview.rows.every(row => row.safetyEligible), 'legacy launchers with explicit incident totals remain eligible for SR/MPR evidence');
  const legacyPreview = await invoke('previewRaceImport',{ payload:{ ...payload,sourceHash:'' } });
  assert.equal(legacyPreview.rows.length,4, 'legacy launchers without a file hash must receive a safe server-generated audit fingerprint');
  assert.match(legacyPreview.warnings.join(' '),/Hash de auditoria gerado/);
  const malformedHashPreview = await invoke('previewRaceImport',{ payload:{ ...payload,sourceHash:'SHA256: not-a-valid-digest' } });
  assert.equal(malformedHashPreview.rows.length,4, 'malformed legacy hashes must be replaced by a deterministic audit fingerprint');
  assert.match(malformedHashPreview.warnings.join(' '),/Hash de auditoria gerado/);
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

  await new Record('Driver',{ objectId:'zero-edge-driver',name:'Zero Edge',irating:1600,safetyRating:0,licenseClass:'R',reliability:0 }).save();
  for (let i=1;i<=1005;i++) await new Record('Driver',{
    objectId:`zz-migration-driver-${String(i).padStart(4,'0')}`,name:`Migration Driver ${i}`,irating:1600,safetyRating:2.5,licenseClass:'R'
  }).save();
  const expectedMigratedProfiles = await new Query('Driver').count();
  const migration = await invoke('migrateRatingsV3',{});
  assert.equal(migration.inspected,expectedMigratedProfiles,'rating profile migration must paginate past the first 1,000 Driver records');
  assert.equal((await new Query('Driver').get('zz-migration-driver-1005')).get('ratingVersion'),migration.version);
  const zeroEdge = await new Query('Driver').get('zero-edge-driver');
  assert.equal(zeroEdge.get('reliability'),0,'migration must preserve a real zero reliability value');
  assert.equal(zeroEdge.get('safetyRating'),0,'migration must not replace a real zero Safety value with a default');
  console.log('Real Cloud handlers: publication recovery, class/discipline safeguards, protest lookup and >1,000-profile migration passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
