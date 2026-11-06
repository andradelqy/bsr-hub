'use strict';
const dgram=require('dgram'),fs=require('fs'),path=require('path'),{EventEmitter}=require('events');
const {parseAcspPacket}=require('./acsp-protocol');
const {IncidentEngine}=require('./incident-engine');
function normalizeAddress(v){return String(v||'').replace(/^::ffff:/i,'').trim();}
class AcTelemetryCollector extends EventEmitter{
  constructor(options={}){
    super();this.host=options.host||process.env.BSR_TELEMETRY_UDP_HOST||'0.0.0.0';
    this.port=options.port!==undefined?Number(options.port):Number(process.env.BSR_TELEMETRY_UDP_PORT||12001);
    this.dataDir=path.resolve(options.dataDir||process.env.BSR_TELEMETRY_DIR||path.join(process.cwd(),'telemetry-data'));
    const raw=options.allowedIps??process.env.BSR_TELEMETRY_ALLOWED_IPS??'';
    this.allowedIps=new Set(String(raw).split(',').map(normalizeAddress).filter(Boolean));
    this.socket=null;this.streams=new Map();this.engine=options.engine||new IncidentEngine(options.engineOptions);
    this.stats={received:0,parsed:0,ignored:0,malformed:0,rejected:0,incidents:0,lastPacketAt:null};
    this.engine.on('incident',item=>{this.stats.incidents++;this.emit('incident',item);this._append('incidents',item);});
    this.engine.on('session',item=>this.emit('session',item));
  }
  async start(){
    if(this.socket)return this.getStatus();
    if(!Number.isInteger(this.port)||this.port<0||this.port>65535)throw new Error('Porta UDP inválida.');
    await fs.promises.mkdir(this.dataDir,{recursive:true});
    this.socket=dgram.createSocket('udp4');
    this.socket.on('error',error=>this.emit('error',error));
    this.socket.on('message',(buffer,remote)=>this._handleMessage(buffer,remote));
    await new Promise((resolve,reject)=>{
      const onError=error=>{this.socket?.removeListener('listening',onListening);reject(error);};
      const onListening=()=>{this.socket?.removeListener('error',onError);resolve();};
      this.socket.once('error',onError);this.socket.once('listening',onListening);this.socket.bind(this.port,this.host);
    });
    this.port=this.socket.address().port;this.emit('listening',{host:this.host,port:this.port});return this.getStatus();
  }
  _handleMessage(buffer,remote){
    this.stats.received++;this.stats.lastPacketAt=new Date().toISOString();const ip=normalizeAddress(remote.address);
    if(this.allowedIps.size&&!this.allowedIps.has(ip)){this.stats.rejected++;this.emit('rejected',{address:ip,port:remote.port});return;}
    let event;try{event=parseAcspPacket(buffer);}catch(error){this.stats.malformed++;this.emit('malformed',{error:error.message,address:ip,port:remote.port});return;}
    if(!event){this.stats.ignored++;return;}this.stats.parsed++;
    const envelope={receivedAt:this.stats.lastPacketAt,source:{address:ip,port:remote.port},event};
    this._append('events',envelope);
    const result=this.engine.process(event,{address:ip,port:remote.port});
    if(result?.kind==='incident')this.emit('candidate',result.data);
    this.emit('packet',envelope);
  }
  _append(kind,record){
    const day=new Date().toISOString().slice(0,10),file=path.join(this.dataDir,kind+'-'+day+'.jsonl');
    if(!this.streams.has(file)){const stream=fs.createWriteStream(file,{flags:'a',encoding:'utf8'});stream.on('error',e=>this.emit('error',e));this.streams.set(file,stream);}
    this.streams.get(file).write(JSON.stringify(record)+'\n');
  }
  getStatus(){return{running:Boolean(this.socket),host:this.host,port:this.port,dataDir:this.dataDir,allowListEnabled:this.allowedIps.size>0,stats:{...this.stats},engine:this.engine.getStatus()};}
  async close(){const socket=this.socket;this.socket=null;if(socket)await new Promise(resolve=>socket.close(()=>resolve()));await Promise.all([...this.streams.values()].map(s=>new Promise(resolve=>s.end(resolve))));this.streams.clear();this.emit('closed');}
}
function createAcTelemetryCollector(options){return new AcTelemetryCollector(options);}
module.exports={AcTelemetryCollector,createAcTelemetryCollector};
if(require.main===module){
  const c=createAcTelemetryCollector();
  c.on('listening',info=>{console.log('[BSR Race Telemetry] UDP em '+info.host+':'+info.port);console.log('[BSR Race Telemetry] Dados: '+c.dataDir);if(!c.allowedIps.size)console.warn('[BSR Race Telemetry] AVISO: allow-list desativada; configure BSR_TELEMETRY_ALLOWED_IPS após identificar o IP do alojamento.');});
  c.on('incident',i=>console.log('[BSR Race Telemetry] Candidato '+i.incidentId+' | carros '+i.cars.map(x=>x.carId).join(' x ')));
  c.on('malformed',x=>console.warn('[BSR Race Telemetry] Pacote inválido de '+x.address+': '+x.error));
  c.on('rejected',x=>console.warn('[BSR Race Telemetry] IP não autorizado: '+x.address));
  c.on('error',e=>console.error('[BSR Race Telemetry] Erro:',e.message));
  c.start().catch(e=>{console.error('[BSR Race Telemetry] Não iniciou:',e.message);process.exitCode=1;});
  const stop=()=>c.close().finally(()=>process.exit());process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
