'use strict';

const { randomUUID } = require('crypto');
const { EventEmitter } = require('events');

class IncidentEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.clock = options.clock || (() => Date.now());
    this.idFactory = options.idFactory || randomUUID;
    this.dedupeWindowMs = Number.isFinite(options.dedupeWindowMs) ? options.dedupeWindowMs : 1500;
    this.session = null;
    this.cars = new Map();
    this.lastCollisionKeys = new Map();
    this.incidentCount = 0;
  }

  process(event, source = {}) {
    if (!event || typeof event.type !== 'string') return null;
    const now = this.clock();

    if (event.type === 'new_session') {
      this.session = {
        id: this.idFactory(), track: event.track || '', trackConfig: event.trackConfig || '',
        serverName: event.serverName || '', sessionName: event.sessionName || '',
        sessionType: event.sessionType, startedAt: new Date(now).toISOString()
      };
      this.cars.clear();
      this.lastCollisionKeys.clear();
      this.emit('session', this.session);
      return { kind: 'session', data: this.session };
    }
    if (event.type === 'new_connection') {
      this.cars.set(event.carId, {
        carId:event.carId, driverName:event.driverName || '', driverGuid:event.driverGuid || '',
        carModel:event.carModel || '', carSkin:event.carSkin || '', connectedAt:new Date(now).toISOString()
      });
      return { kind:'connection', data:this.cars.get(event.carId) };
    }
    if (event.type === 'connection_closed') {
      const previous = this.cars.get(event.carId) || {};
      this.cars.set(event.carId, { ...previous, disconnectedAt:new Date(now).toISOString() });
      return { kind:'connection_closed', data:this.cars.get(event.carId) };
    }
    if (event.type === 'lap_completed') return { kind:'lap', data:event };
    if (event.type === 'car_update') return { kind:'car_update', data:event };
    if (!['collide_car','collide_env'].includes(event.type)) return { kind:'event', data:event };

    const pair = event.type === 'collide_car'
      ? [Number(event.carId),Number(event.otherCarId)].sort((a,b)=>a-b).join(':')
      : String(event.carId)+':'+Math.round(event.worldPosition?.x || 0)+':'+Math.round(event.worldPosition?.z || 0);
    const key = event.type+':'+pair;
    const previousTime = this.lastCollisionKeys.get(key);
    if (previousTime != null && now - previousTime <= this.dedupeWindowMs) {
      this.lastCollisionKeys.set(key, now);
      return null;
    }
    this.lastCollisionKeys.set(key, now);
    for (const [oldKey,timestamp] of this.lastCollisionKeys) {
      if (now-timestamp>this.dedupeWindowMs*4) this.lastCollisionKeys.delete(oldKey);
    }

    const car = this.cars.get(event.carId) || null;
    const otherCar = event.otherCarId == null ? null : (this.cars.get(event.otherCarId) || null);
    const incident = {
      incidentId:'BSR-INC-'+this.idFactory(),
      sessionId:this.session?.id || null,
      session:this.session,
      occurredAt:new Date(now).toISOString(),
      source:'assetto_server_udp',
      eventType:event.type,
      classification:'INCIDENT_CANDIDATE',
      harmfulness:'UNASSESSED',
      reviewStatus:'PENDING',
      evidenceLevel:'SERVER_COLLISION_EVENT',
      cars:[
        {carId:event.carId,role:'involved',driverName:car?.driverName || null,driverGuid:car?.driverGuid || null,carModel:car?.carModel || null},
        ...(event.otherCarId==null?[]:[{carId:event.otherCarId,role:'involved',driverName:otherCar?.driverName || null,driverGuid:otherCar?.driverGuid || null,carModel:otherCar?.carModel || null}])
      ],
      reportedSpeed:event.reportedSpeed,
      speedUnit:'UNSPECIFIED_BY_SOURCE',
      worldPosition:event.worldPosition || null,
      relativePosition:event.relativePosition || null,
      replay:{status:'NOT_ATTACHED',uri:null},
      sourceMetadata:{packetId:event.packetId,eventType:event.eventType,sourceAddress:source.address || null,sourcePort:source.port || null},
      policy:{affectsSafety:false,affectsMpr:false,automaticFaultAssignment:false}
    };
    this.incidentCount += 1;
    this.emit('incident',incident);
    return {kind:'incident',data:incident};
  }

  getStatus() {
    return {session:this.session,connectedCars:[...this.cars.values()].filter(car=>!car.disconnectedAt),incidentCount:this.incidentCount};
  }
}
module.exports = { IncidentEngine };
