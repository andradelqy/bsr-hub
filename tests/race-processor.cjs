const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'app', 'race-processor.js'), 'utf8');
const context = { window:{}, JSON, Error, Number, String, Map, Boolean, Math };
vm.createContext(context);
vm.runInContext(source, context);
const processor = context.window.BSRRaceProcessor;
assert.ok(processor, 'race processor should initialize');
assert.equal(processor.classifyCar('rss_gtm_mercer_v8'), 'GT3');
assert.equal(processor.classifyCar('porsche_963_lmdh'), 'Hypercar');
assert.equal(processor.classifyCar('f1_2024_mod'), 'Formula');
assert.equal(processor.classifyCar('nascar_cup_nextgen'), 'Oval');
assert.equal(processor.classifyCar('gtd_ferrari_296'), 'GT3');
assert.equal(processor.classifyCar('tcr_honda_civic'), 'TCR');
assert.equal(processor.classifyCarMetadata('my_custom_ferrari', { id:'my_custom_ferrari', carClass:'GT3' }).carClass, 'GT3');
assert.equal(processor.classifyCarMetadata('my_custom_touring', { id:'my_custom_touring', tags:['touring'] }).carClass, 'Touring');
assert.equal(processor.classifyCarMetadata('mod_without_ui', null).carClass, 'Unknown');
assert.equal(processor.classifyCarMetadata('honda_acty_ha3', { id:'honda_acty_ha3', carClass:'stock' }).carClass, 'Stock');
assert.equal(processor.classifyCarMetadata('traffic_aegis_taxi', { id:'traffic_aegis_taxi', carClass:'traffic', tags:['traffic'] }).carClass, 'Traffic');
assert.equal(processor.classifyCarMetadata('ddm_custom_shuto', { id:'ddm_custom_shuto', carClass:'shuto', tags:['wangan'], description:'Engine 3S-GTE and GT35R turbo' }).carClass, 'Shuto', 'engine names in technical descriptions must not create false GTE classifications');
assert.equal(processor.classifyCarMetadata('my_mod_2026', { id:'my_mod_2026', carClass:'GT4 Cup Pro' }).carClass, 'GT4');
assert.equal(processor.classifyCarMetadata('my_mod_2026', null, 'Club Racer').carClass, 'Club Racer', 'explicit custom result classes must be preserved rather than discarded');

const catalogMatched = processor.parseResultsJson(String.fromCharCode(0xFEFF) + JSON.stringify({
  TrackName:'Interlagos', Type:'RACE', Cars:[{ CarId:14, Model:'my_custom_ferrari', DriverName:'Piloto Mod', DriverGuid:'76561198000000014' }],
  Result:[{ CarId:14, Car:14, DriverName:'Piloto Mod', DriverGuid:'76561198000000014', Position:1, NumLaps:10 }]
}), [{ id:'my_custom_ferrari', name:'Ferrari Custom', brand:'Modder', carClass:'GT3' }]);
assert.equal(catalogMatched.drivers[0].carModel, 'my_custom_ferrari', 'numeric Result.Car must not hide the model from Cars[]');
assert.equal(catalogMatched.drivers[0].carClass, 'GT3', 'installed ui_car.json metadata must classify unknown custom mods');
assert.equal(catalogMatched.drivers[0].carClassSource, 'installed-metadata');
assert.equal(catalogMatched.warnings.length, 0);

const unknown = processor.parseResultsJson(JSON.stringify({
  Cars:[{ CarId:2, Model:'my_unlisted_car', DriverName:'Piloto sem mod', DriverGuid:'76561198000000015' }],
  Result:[{ CarId:2, DriverName:'Piloto sem mod', DriverGuid:'76561198000000015', Position:1 }]
}));
assert.equal(unknown.drivers[0].carClass, 'Unknown');
assert.match(unknown.warnings.join(' '), /categoria reconhecida/);

const eventOverridesReportedZero = processor.parseResultsJson(JSON.stringify({
  Cars:[{ CarId:0, Model:'rss_gtm_mercer_v8', DriverName:'Piloto Evento', DriverGuid:'76561198000000016' }],
  Result:[{ CarId:0, DriverName:'Piloto Evento', DriverGuid:'76561198000000016', Position:1, IncidentPoints:0 }],
  Events:[{ Type:'COLLISION_WITH_ENV', CarId:0, Time:1000, ImpactSpeed:25 }]
}));
assert.equal(eventOverridesReportedZero.drivers[0].incidentPoints, 4, 'zero reported incidents must not hide collision events');

const parsed = processor.parseResultsJson(JSON.stringify({
  TrackName:'Interlagos', Type:'RACE', Date:'2026-10-01T22:00:00Z',
  Cars:[
    { CarId:0, DriverName:'Piloto Um', DriverGuid:'76561198000000001', Model:'rss_gtm_mercer_v8' },
    { CarId:1, DriverName:'Piloto Dois', DriverGuid:'76561198000000002', Model:'rss_gtm_mercer_v8' }
  ],
  Result:[
    { CarId:0, Position:1, NumLaps:20, TotalTimeMs:3600000 },
    { CarId:1, Position:2, NumLaps:8, TotalTimeMs:3700000, ConnectionLost:true }
  ],
  Events:[
    { Type:'COLLISION_WITH_CAR', CarId:1, OtherCarId:0, Time:1000, ImpactSpeed:25 },
    { Type:'COLLISION_WITH_CAR', CarId:0, OtherCarId:1, Time:1001, ImpactSpeed:25 }
  ]
}));
assert.equal(parsed.drivers.length, 2);
assert.equal(parsed.drivers[0].carClass, 'GT3');
assert.equal(parsed.drivers[0].incidentPoints, 4, 'both drivers receive no-fault contact points');
assert.equal(parsed.drivers[1].incidentPoints, 4, 'duplicate contact events are debounced');
assert.equal(parsed.drivers[1].isDNF, true);
assert.equal(parsed.drivers[1].isRageQuit, false, 'connection loss is not automatically labelled rage quit');
assert.equal(parsed.drivers[1].disconnected, true);
const clustered = processor.collectIncidents([
  { Type:'CONTACT', CarId:0, OtherCarId:1, Time:2999, ImpactSpeed:5 },
  { Type:'CONTACT_HEAVY', CarId:1, OtherCarId:0, Time:3001, ImpactSpeed:30 }
]);
assert.equal(clustered.get('0').lightContacts, 0, 'a contact cluster must not count both 2x and 4x');
assert.equal(clustered.get('0').heavyContacts, 1, 'the highest severity inside three seconds must win across bucket boundaries');
const shortRace = processor.detectDNF([{ carClass:'GT3', lapsCompleted:2 }, { carClass:'GT3', lapsCompleted:20 }]);
assert.equal(shortRace[0].isDNF, false, 'lap percentage alone must never infer a DNF');
const reusedSlot = processor.parseResultsJson(JSON.stringify({
  TrackName:'Kazan Ring', Type:'RACE',
  Cars:[
    { CarId:14, Driver:{ Name:'Primeiro Piloto', Guid:'76561198000000011' }, Model:'ag_stcc_corolla' },
    { CarId:14, Driver:{ Name:'Segundo Piloto', Guid:'76561198000000012' }, Model:'ag_stcc_corolla' }
  ],
  Result:[
    { CarId:14, DriverName:'Primeiro Piloto', DriverGuid:'76561198000000011', NumLaps:20 },
    { CarId:14, DriverName:'Segundo Piloto', DriverGuid:'76561198000000012', NumLaps:2 }
  ],
  Events:[
    { Type:'COLLISION_WITH_ENV', CarId:14, Driver:{ Guid:'76561198000000011' }, Time:1000, ImpactSpeed:25 },
    { Type:'COLLISION_WITH_ENV', CarId:14, Driver:{ Guid:'76561198000000012' }, Time:5000, ImpactSpeed:5 }
  ]
}));
assert.equal(reusedSlot.drivers.length, 2, 'a reused car slot must keep both drivers');
assert.deepEqual(reusedSlot.drivers.map(driver => driver.steamGUID), ['76561198000000011','76561198000000012']);
assert.deepEqual(reusedSlot.drivers.map(driver => driver.name), ['Primeiro Piloto','Segundo Piloto']);
assert.deepEqual(reusedSlot.drivers.map(driver => driver.finishPosition), [1,2], 'the JSON Result order must be preserved when Position is omitted');
assert.deepEqual(reusedSlot.drivers.map(driver => driver.incidentPoints), [4,2], 'incidents must follow the event SteamID instead of the reused CarId');
assert.equal(reusedSlot.reusedSlots.length, 1);
assert.throws(() => processor.parseResultsJson('{'), /JSON válido/);

const serverLog = [
  'Track: interlagos',
  'content/cars/my_custom_server_mod',
  'Name: Piloto Log, GUID: 76561198000000017',
  '1. Piloto Log - CarID: 0, Time: 1:00.000, NumLaps: 12'
].join('\n');
const parsedServerLog = processor.parseServerLog(serverLog, '', [
  { id:'my_custom_server_mod', carClass:'GT3', tags:['GT3'] }
]);
assert.equal(parsedServerLog.drivers[0].carClass, 'GT3', 'server log model IDs must use the installed metadata catalogue');
assert.equal(parsedServerLog.drivers[0].incidentEvidence, 'missing', 'a plain leaderboard must not count as verified incident telemetry');
const parsedPluginLog = processor.parseServerLog(serverLog, 'Name: Piloto Log - Cutting warning: 0', [
  { id:'my_custom_server_mod', carClass:'GT3' }
]);
assert.equal(parsedPluginLog.drivers[0].incidentEvidence, 'events', 'an explicit plugin telemetry record is evidence even when its count is zero');
console.log('Race processor checks passed.');
