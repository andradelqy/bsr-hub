'use strict';

const PACKETS = Object.freeze({ NEW_SESSION:50, NEW_CONNECTION:51, CONNECTION_CLOSED:52, CAR_UPDATE:53, CAR_INFO:54, END_SESSION:55, SESSION_INFO:59, LAP_COMPLETED:73, CLIENT_EVENT:130 });
const EVENTS = Object.freeze({ COLLISION_WITH_CAR:10, COLLISION_WITH_ENV:11 });

function requireBytes(buffer, offset, length, field) {
  if (!Buffer.isBuffer(buffer) || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new RangeError('Pacote UDP AC fora do formato: ' + field);
  }
}
function readU8(b, o, f) { requireBytes(b,o,1,f); return { value:b.readUInt8(o), offset:o+1 }; }
function readU16(b, o, f) { requireBytes(b,o,2,f); return { value:b.readUInt16LE(o), offset:o+2 }; }
function readU32(b, o, f) { requireBytes(b,o,4,f); return { value:b.readUInt32LE(o), offset:o+4 }; }
function readFloat(b, o, f) {
  requireBytes(b,o,4,f);
  const value=b.readFloatLE(o);
  if (!Number.isFinite(value)) throw new RangeError('Valor não finito no pacote UDP AC: ' + f);
  return { value, offset:o+4 };
}
function readString(b, o, wide, f) {
  const n=readU8(b,o,f+'.length'), bytes=n.value*(wide?4:1);
  requireBytes(b,n.offset,bytes,f);
  const raw=b.subarray(n.offset,n.offset+bytes);
  return { value:wide?raw.toString('utf16le').replace(/\u0000/g,''):raw.toString('utf8'), offset:n.offset+bytes };
}
function readVector3(b,o,f) {
  const x=readFloat(b,o,f+'.x'), y=readFloat(b,x.offset,f+'.y'), z=readFloat(b,y.offset,f+'.z');
  return { value:{x:x.value,y:y.value,z:z.value}, offset:z.offset };
}

function parseAcspPacket(b) {
  if (!Buffer.isBuffer(b) || b.length<1 || b.length>4096) return null;
  const first=readU8(b,0,'packetId'), id=first.value;
  let o=first.offset;
  switch(id) {
    case PACKETS.NEW_SESSION:
    case PACKETS.SESSION_INFO: {
      const version=readU8(b,o,'version'); o=version.offset;
      const sessionIndex=readU8(b,o,'sessionIndex'); o=sessionIndex.offset;
      const currentSessionIndex=readU8(b,o,'currentSessionIndex'); o=currentSessionIndex.offset;
      const sessionCount=readU8(b,o,'sessionCount'); o=sessionCount.offset;
      const serverName=readString(b,o,true,'serverName'); o=serverName.offset;
      const track=readString(b,o,false,'track'); o=track.offset;
      const trackConfig=readString(b,o,false,'trackConfig'); o=trackConfig.offset;
      const sessionName=readString(b,o,false,'sessionName'); o=sessionName.offset;
      const sessionType=readU8(b,o,'sessionType'); o=sessionType.offset;
      const sessionTime=readU16(b,o,'sessionTime'); o=sessionTime.offset;
      const laps=readU16(b,o,'laps'); o=laps.offset;
      const waitTime=readU16(b,o,'waitTime'); o=waitTime.offset;
      const ambientTemp=readU8(b,o,'ambientTemp'); o=ambientTemp.offset;
      const roadTemp=readU8(b,o,'roadTemp'); o=roadTemp.offset;
      const weather=readString(b,o,false,'weather'); o=weather.offset;
      const elapsedMs=readU32(b,o,'elapsedMs');
      return { type:id===PACKETS.NEW_SESSION?'new_session':'session_info', packetId:id, version:version.value, sessionIndex:sessionIndex.value,
        currentSessionIndex:currentSessionIndex.value, sessionCount:sessionCount.value, serverName:serverName.value, track:track.value,
        trackConfig:trackConfig.value, sessionName:sessionName.value, sessionType:sessionType.value, sessionTime:sessionTime.value,
        laps:laps.value, waitTime:waitTime.value, ambientTemp:ambientTemp.value, roadTemp:roadTemp.value, weather:weather.value, elapsedMs:elapsedMs.value };
    }
    case PACKETS.NEW_CONNECTION:
    case PACKETS.CONNECTION_CLOSED: {
      const driverName=readString(b,o,true,'driverName'); o=driverName.offset;
      const driverGuid=readString(b,o,true,'driverGuid'); o=driverGuid.offset;
      const carId=readU8(b,o,'carId'); o=carId.offset;
      const carModel=readString(b,o,false,'carModel'); o=carModel.offset;
      const carSkin=readString(b,o,false,'carSkin');
      return { type:id===PACKETS.NEW_CONNECTION?'new_connection':'connection_closed', packetId:id, driverName:driverName.value,
        driverGuid:driverGuid.value, carId:carId.value, carModel:carModel.value, carSkin:carSkin.value };
    }
    case PACKETS.CLIENT_EVENT: {
      const eventType=readU8(b,o,'eventType'); o=eventType.offset;
      const carId=readU8(b,o,'carId'); o=carId.offset;
      if (![EVENTS.COLLISION_WITH_CAR,EVENTS.COLLISION_WITH_ENV].includes(eventType.value)) return null;
      let otherCarId=null;
      if (eventType.value===EVENTS.COLLISION_WITH_CAR) { const other=readU8(b,o,'otherCarId'); otherCarId=other.value; o=other.offset; }
      const speed=readFloat(b,o,'collisionSpeed'); o=speed.offset;
      const worldPosition=readVector3(b,o,'worldPosition'); o=worldPosition.offset;
      const relativePosition=readVector3(b,o,'relativePosition');
      return { type:eventType.value===EVENTS.COLLISION_WITH_CAR?'collide_car':'collide_env', packetId:id, eventType:eventType.value,
        carId:carId.value, otherCarId, reportedSpeed:speed.value, worldPosition:worldPosition.value, relativePosition:relativePosition.value };
    }
    case PACKETS.CAR_UPDATE: {
      const carId=readU8(b,o,'carId'); o=carId.offset;
      const position=readVector3(b,o,'position'); o=position.offset;
      const velocity=readVector3(b,o,'velocity'); o=velocity.offset;
      const gear=readU8(b,o,'gear'); o=gear.offset;
      const rpm=readU16(b,o,'rpm'); o=rpm.offset;
      const spline=readFloat(b,o,'normalizedSplinePosition');
      return { type:'car_update', packetId:id, carId:carId.value, position:position.value, velocity:velocity.value, gear:gear.value, rpm:rpm.value, normalizedSplinePosition:spline.value };
    }
    case PACKETS.END_SESSION: {
      const filename=readString(b,o,true,'resultFilename');
      return { type:'end_session', packetId:id, filename:filename.value };
    }
    case PACKETS.LAP_COMPLETED: {
      const carId=readU8(b,o,'carId'); o=carId.offset;
      const lapTime=readU32(b,o,'lapTime'); o=lapTime.offset;
      const cuts=readU8(b,o,'cuts'); o=cuts.offset;
      const carsCount=readU8(b,o,'carsCount'); o=carsCount.offset;
      if (carsCount.value>128) throw new RangeError('Leaderboard AC excede o limite esperado.');
      const leaderboard=[];
      for(let i=0;i<carsCount.value;i++) {
        const rcarId=readU8(b,o,'leaderboard.carId'); o=rcarId.offset;
        const rtime=readU32(b,o,'leaderboard.lapTime'); o=rtime.offset;
        const rlaps=readU8(b,o,'leaderboard.laps'); o=rlaps.offset;
        leaderboard.push({carId:rcarId.value,lapTime:rtime.value,laps:rlaps.value});
      }
      const grip=readFloat(b,o,'gripLevel');
      return { type:'lap_completed', packetId:id, carId:carId.value, lapTime:lapTime.value, cuts:cuts.value, leaderboard, gripLevel:grip.value };
    }
    default: return null;
  }
}
module.exports = { PACKETS, EVENTS, parseAcspPacket };
