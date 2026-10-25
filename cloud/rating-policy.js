'use strict';

const crypto = require('crypto');
const VERSION = 'bsr-policy-v3.1.0';
const DEFAULTS = Object.freeze({
  version:VERSION, minimumStarters:4, minimumClassStarters:3,
  minimumMprCorners:100, minimumCompletion:0.5, maximumMprIncidentsPer100Corners:4,
  minimumLicense:'R', official:true
});
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value instanceof Date ? value.toISOString() : value;
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
function sessionIdentity(payload) {
  const at = new Date(payload.sessionDate);
  if (!Number.isFinite(at.getTime())) throw new Error('Data real da sessão inválida.');
  const heat = String(payload.heat || '1').trim();
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(heat)) throw new Error('Identificador de bateria inválido.');
  // Hash do arquivo é evidência, não identidade: exportações corrigidas da mesma
  // sessão precisam permanecer vinculadas à mesma sessão.
  return hash({ raceId:payload.raceId, sessionType:payload.sessionType,
    at:at.toISOString(), track:String(payload.track).trim().toLowerCase(), heat });
}
function sourceDigest(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function normalizedPolicy(raw = {}) {
  const result = { ...DEFAULTS };
  for (const key of ['minimumStarters','minimumClassStarters','minimumMprCorners','minimumCompletion','maximumMprIncidentsPer100Corners']) {
    if (raw[key] !== undefined) {
      const value = Number(raw[key]);
      if (!Number.isFinite(value) || value < 0) throw new Error(`Regra inválida: ${key}.`);
      result[key] = value;
    }
  }
  if (result.minimumStarters < 2 || result.minimumClassStarters < 2 ||
      result.minimumCompletion > 1 || result.minimumMprCorners < 1) throw new Error('Regulamento fora dos limites permitidos.');
  result.minimumLicense = String(raw.minimumLicense || 'R').toUpperCase();
  if (!['R','D','C','B','A','S'].includes(result.minimumLicense)) throw new Error('Carteira mínima inválida.');
  result.official = raw.official !== false;
  return result;
}
function participation(driver) {
  if (driver.didNotStart) return 'dns';
  if (driver.isDSQ) return 'dsq';
  if (driver.serverFailure) return 'server_failure';
  if (driver.isRageQuit) return 'withdrawn';
  if (driver.disconnected) return 'disconnected';
  if (driver.isDNF) return 'dnf';
  return 'finished';
}
function mprDecision({ policy, rated, driver, corners, incidents, completion, license }) {
  const rules = normalizedPolicy(policy);
  const order = ['R','D','C','B','A','S'];
  const reasons = [];
  if (!rated) reasons.push('Sessão sem elegibilidade para habilidade');
  if (participation(driver) !== 'finished') reasons.push('Conclusão válida necessária');
  if (corners < rules.minimumMprCorners) reasons.push(`Mínimo de ${rules.minimumMprCorners} curvas`);
  if (completion < rules.minimumCompletion) reasons.push(`Mínimo de ${rules.minimumCompletion * 100}% da distância`);
  if (incidents * 100 / Math.max(1, corners) > rules.maximumMprIncidentsPer100Corners) reasons.push('Limite de incidentes para MPR excedido');
  if (order.indexOf(rules.minimumLicense) < order.indexOf(license || 'R')) reasons.push('Evento abaixo da carteira atual');
  return { eligible:reasons.length === 0, reasons };
}
function integrityWarnings(payload) {
  const warnings = [];
  if (!payload.sourceHash) warnings.push('Arquivo sem hash de origem; integridade documental não comprovada.');
  if (payload.drivers.some(driver => !driver.carClass || driver.carClass === 'Unknown')) warnings.push('Classe não identificada; confirme antes de publicar.');
  if (payload.drivers.some(driver => driver.incidentEvidence === 'missing')) warnings.push('Incidentes sem evidência: SR deve ficar suspenso para esses pilotos.');
  if (payload.drivers.filter(driver => driver.disconnected).length >= Math.ceil(payload.drivers.length / 2)) warnings.push('Desconexão coletiva: revise possível falha do servidor.');
  return warnings;
}
module.exports = { VERSION, DEFAULTS, hash, stable, sourceDigest, sessionIdentity, normalizedPolicy, participation, mprDecision, integrityWarnings };
