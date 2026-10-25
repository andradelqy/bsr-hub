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
console.log('Race processor checks passed.');
