'use strict';
const assert=require('assert'),dgram=require('dgram'),fs=require('fs'),os=require('os'),path=require('path');
const {parseAcspPacket}=require('../telemetry/acsp-protocol');
const {IncidentEngine}=require('../telemetry/incident-engine');
const {createAcTelemetryCollector}=require('../telemetry/collector');
function narrow(v){const b=Buffer.from(v,'utf8');return Buffer.concat([Buffer.from([b.length]),b]);}
function wide(v){const b=Buffer.alloc(v.length*4);for(let i=0;i<v.length;i++)b.writeUInt16LE(v.charCodeAt(i),i*4);return Buffer.concat([Buffer.from([v.length]),b]);}
function f32(v){const b=Buffer.alloc(4);b.writeFloatLE(v);return b;}
function vec3(x,y,z){return Buffer.concat([f32(x),f32(y),f32(z)]);}
const carHit=Buffer.concat([Buffer.from([130,10,4,9]),f32(22.5),vec3(10,1,20),vec3(.2,0,-.1)]);
const parsed=parseAcspPacket(carHit);
assert.strictEqual(parsed.type,'collide_car');assert.strictEqual(parsed.carId,4);assert.strictEqual(parsed.otherCarId,9);assert.strictEqual(parsed.reportedSpeed,22.5);
assert.deepStrictEqual(parsed.worldPosition,{x:10,y:1,z:20});
const envHit=Buffer.concat([Buffer.from([130,11,2]),f32(8.75),vec3(3,0,4),vec3(0,0,0)]);
assert.strictEqual(parseAcspPacket(envHit).type,'collide_env');
const connectionPacket=Buffer.concat([Buffer.from([51]),wide('Piloto BSR'),wide('76561198000000000'),Buffer.from([4]),narrow('ks_ferrari_f40'),narrow('red')]);
const connection=parseAcspPacket(connectionPacket);assert.strictEqual(connection.driverName,'Piloto BSR');assert.strictEqual(connection.carId,4);
let time=100000,id=0;
const engine=new IncidentEngine({clock:()=>time,idFactory:()=>'test-'+(++id),dedupeWindowMs:1500});
engine.process({type:'new_connection',carId:4,driverName:'Piloto A',driverGuid:'guid-a',carModel:'car-a'});
engine.process({type:'new_connection',carId:9,driverName:'Piloto B',driverGuid:'guid-b',carModel:'car-b'});
const result=engine.process(parsed,{address:'203.0.113.10',port:1234});
assert.strictEqual(result.kind,'incident');assert.strictEqual(result.data.classification,'INCIDENT_CANDIDATE');
assert.strictEqual(result.data.harmfulness,'UNASSESSED');assert.strictEqual(result.data.policy.affectsSafety,false);
assert.strictEqual(result.data.cars[0].driverName,'Piloto A');assert.strictEqual(result.data.cars[1].driverName,'Piloto B');
time+=500;assert.strictEqual(engine.process(parsed),null,'Colisão duplicada deve ser deduplicada.');
time+=2000;assert.strictEqual(engine.process(parsed).kind,'incident','Nova colisão posterior deve ser registada.');
assert.throws(()=>parseAcspPacket(Buffer.from([130,11,2,0,0])),/Pacote UDP AC fora do formato/);
assert.strictEqual(parseAcspPacket(Buffer.from([255])),null);

(async()=>{
  const dataDir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'bsr-telemetry-'));
  const collector=createAcTelemetryCollector({host:'127.0.0.1',port:0,dataDir,allowedIps:['127.0.0.1']});
  collector.on('error',error=>{throw error;});
  const status=await collector.start();
  const sender=dgram.createSocket('udp4');
  const candidate=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Timeout aguardando evento UDP')),2000);
    collector.once('candidate',item=>{clearTimeout(timer);resolve(item);});
  });
  await new Promise((resolve,reject)=>sender.send(carHit,status.port,'127.0.0.1',error=>error?reject(error):resolve()));
  const incident=await candidate;
  assert.strictEqual(incident.classification,'INCIDENT_CANDIDATE');
  assert.strictEqual(collector.getStatus().stats.incidents,1);
  sender.close();
  await collector.close();
  const names=await fs.promises.readdir(dataDir);
  assert(names.some(name=>name.startsWith('events-')&&name.endsWith('.jsonl')));
  assert(names.some(name=>name.startsWith('incidents-')&&name.endsWith('.jsonl')));
  await fs.promises.rm(dataDir,{recursive:true,force:true});
  console.log('BSR Race Telemetry: parser, incident engine e recepção UDP OK.');
})().catch(error=>{console.error(error);process.exitCode=1;});
