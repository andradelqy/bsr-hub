// Camada única de acesso ao Back4App/Parse.
// Mantém compatibilidade com as páginas legadas e adiciona sessão, Cloud Code e erros consistentes.
(function () {
  'use strict';

  const APP_ID = window.APP_ID;
  const REST_API_KEY = window.REST_API_KEY;
  const BASE_URL = window.BASE_URL;
  const SESSION_KEY = 'bsr_parse_session';
  const ADMIN_RETURN_KEY = 'bsr_pre_admin_session';

  const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

  function clearLocalAuth() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(ADMIN_RETURN_KEY);
    localStorage.removeItem(ADMIN_RETURN_KEY);
    for (const key of ['steamId','steamName','steamAvatar']) {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    }
  }

  function clearSessionOnly() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  }

  function readSessionObject() {
    try {
      const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
      const session = raw ? JSON.parse(raw) : null;
      if (session?.expiresAt && session.expiresAt <= Date.now()) {
        clearSessionOnly();
        return null;
      }
      return session;
    } catch (_) {
      clearSessionOnly();
      return null;
    }
  }

  function restoreSession(session) {
    clearSessionOnly();
    if (!session?.sessionToken || (session.expiresAt && session.expiresAt <= Date.now())) return null;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function recoverFromInvalidSession() {
    const current = readSessionObject();
    clearSessionOnly();
    if (current?.kind !== 'admin') return null;
    let previous = null;
    try { previous = JSON.parse(localStorage.getItem(ADMIN_RETURN_KEY) || 'null'); } catch (_) {}
    localStorage.removeItem(ADMIN_RETURN_KEY);
    return restoreSession(previous);
  }

  if (!APP_ID || !REST_API_KEY || !BASE_URL) {
    console.error('[BSR API] Configuração do Back4App ausente.');
    return;
  }

  function getSessionToken() {
    return readSessionObject()?.sessionToken || null;
  }

  function buildHeaders(extraHeaders) {
    const headers = {
      'X-Parse-Application-Id': APP_ID,
      'X-Parse-REST-API-Key': REST_API_KEY,
      'Content-Type': 'application/json',
      ...extraHeaders
    };
    const token = getSessionToken();
    if (token) headers['X-Parse-Session-Token'] = token;
    return headers;
  }

  async function request(path, options = {}) {
    const response = await fetch(BASE_URL + path, {
      method: options.method || 'GET',
      headers: buildHeaders(options.headers),
      body: options.body == null ? undefined : JSON.stringify(options.body),
      signal: options.signal
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch (_) { payload = { error: text }; }
    }
    if (!response.ok) {
      const error = new Error(payload?.error || payload?.message || `Erro HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload?.code;
      error.payload = payload;
      if (payload?.code === 209) {
        recoverFromInvalidSession();
      }
      throw error;
    }
    return payload || {};
  }

  const api = {
    async fetch(url, method = 'GET', body = null) {
      return request(url, { method, body });
    },
    request,
    getSessionToken,

    async cloud(functionName, params = {}) {
      const result = await request(`/functions/${encodeURIComponent(functionName)}`, { method: 'POST', body: params });
      return result.result;
    },

    async getHubAccessStatus() {
      try {
        return await this.cloud('getHubAccessStatus');
      } catch (error) {
        // Compatibilidade durante a publicação coordenada: o front novo pode
        // chegar antes do Cloud Code sem bloquear o hub que ainda está aberto.
        if (error.code === 141 && /function|função/i.test(error.message || '')) {
          return { mode:'open', authenticated:Boolean(getSessionToken()), allowed:true, isAdmin:false, reason:'legacy_open' };
        }
        throw error;
      }
    },

    async getHubAccessAdminContext() {
      return this.cloud('getHubAccessAdminContext');
    },

    async setHubAccessMode(mode) {
      return this.cloud('setHubAccessMode', { mode });
    },

    async setHubAccessGrant(grant) {
      return this.cloud('setHubAccessGrant', { grant });
    },

    async login(username, password) {
      return request('/login', { method: 'POST', body: { username, password }, headers: { 'X-Parse-Revocable-Session': '1' } });
    },

    async enterAdminMode(username, password, persistent = true) {
      const previous = this.readSession();
      const adminUser = await this.login(username, password);
      if (previous?.sessionToken && previous.kind !== 'admin') {
        localStorage.setItem(ADMIN_RETURN_KEY, JSON.stringify(previous));
      }
      this.saveSession(adminUser, persistent, 'admin');
      try {
        const verification = await this.verifyAdminSession();
        return { ...verification, session: this.readSession() };
      } catch (error) {
        await request('/logout', { method: 'POST' }).catch(() => {});
        clearSessionOnly();
        const fallback = previous?.sessionToken ? previous : null;
        if (fallback) restoreSession(fallback);
        localStorage.removeItem(ADMIN_RETURN_KEY);
        throw error;
      }
    },

    async leaveAdminMode() {
      const current = this.readSession();
      if (current?.kind === 'admin' && current.sessionToken) {
        await request('/logout', { method: 'POST' }).catch(() => {});
      }
      clearSessionOnly();
      let previous = null;
      try { previous = JSON.parse(localStorage.getItem(ADMIN_RETURN_KEY) || 'null'); } catch (_) {}
      localStorage.removeItem(ADMIN_RETURN_KEY);
      sessionStorage.removeItem(ADMIN_RETURN_KEY);
      return restoreSession(previous);
    },

    hasDriverSessionToRestore() {
      try {
        const previous = JSON.parse(localStorage.getItem(ADMIN_RETURN_KEY) || 'null');
        return Boolean(previous?.sessionToken && (!previous.expiresAt || previous.expiresAt > Date.now()));
      } catch (_) { return false; }
    },

    async beginSteamAuth() {
      return this.cloud('beginSteamAuth');
    },

    async authenticateSteam(callbackUrl) {
      const user = await this.cloud('authenticateSteam', { callbackUrl });
      this.saveSession(user, true, 'driver');
      return user;
    },

    async logout() {
      if (getSessionToken()) await request('/logout', { method: 'POST' }).catch(() => {});
      clearLocalAuth();
    },

    saveSession(user, persistent = true, kind = 'admin') {
      if (!user?.objectId || !user?.sessionToken) throw new Error('Sessão inválida recebida do servidor.');
      const data = JSON.stringify({ objectId: user.objectId, username: user.username, sessionToken: user.sessionToken, kind, expiresAt: Date.now() + (persistent ? SESSION_TTL : 12 * 60 * 60 * 1000) });
      const target = persistent ? localStorage : sessionStorage;
      const other = persistent ? sessionStorage : localStorage;
      other.removeItem(SESSION_KEY);
      target.setItem(SESSION_KEY, data);
    },

    readSession() {
      return readSessionObject();
    },

    async getDriver(steamId) {
      if (!steamId || !getSessionToken()) return null;
      return this.cloud('getCurrentDriver');
    },

    async getDriverResults(driverId, limit = 100) {
      if (!driverId || !getSessionToken()) return [];
      return this.cloud('getMyDriverResults', { limit: Math.min(limit, 300) });
    },

    async refreshSteamProfile() {
      return this.cloud('refreshSteamProfile');
    },

    async updateMyDriverProfile(profile) {
      return this.cloud('updateMyDriverProfile', { profile });
    },

    async repairDriverIdentities(limit = 12) {
      return this.cloud('repairDriverIdentities', { limit: Math.max(1, Math.min(Number(limit) || 12, 25)) });
    },

    async getPublicDriverProfile(driverId) {
      return this.cloud('getPublicDriverProfile', { driverId });
    },

    async getContentCatalog() {
      return this.cloud('getContentCatalog');
    },

    async getRaceRequirements(raceId) {
      return this.cloud('getRaceRequirements', { raceId });
    },

    async getRaceLaunchConfig(raceId, requestedCarHint = '') {
      return this.cloud('getRaceLaunchConfig', { raceId, requestedCarHint });
    },

    async getContentAdminContext() {
      return this.cloud('getContentAdminContext');
    },

    async upsertContentPackage(contentPackage) {
      return this.cloud('upsertContentPackage', { package:contentPackage });
    },

    async setContentServerProfile(server) {
      return this.cloud('setContentServerProfile', { server });
    },

    async setRaceContentConfig(raceId, requirementSlugs, connection) {
      return this.cloud('setRaceContentConfig', { raceId, requirementSlugs, connection });
    },

    async getRaces(limit = 100, includeChampionships = false) {
      const data = await request(`/classes/Races?order=startAt,date,createdAt&limit=${Math.min(limit, 500)}`);
      const races = data.results || [];
      return includeChampionships ? races : races.filter(race => !race.championshipId && race.raceType !== 'championship');
    },

    async getChampionships(limit = 50) {
      const data = await request(`/classes/Championships?order=-createdAt&limit=${Math.min(limit, 500)}`);
      return data.results || [];
    },

    async getRaceResults(sessionId, raceId) {
      const normalizedSessionId = sessionId == null ? '' : String(sessionId).trim();
      const normalizedRaceId = raceId == null ? '' : String(raceId).trim();
      if (!normalizedSessionId && !normalizedRaceId) return [];
      const results = await this.cloud('getRaceResults', {
        sessionId: normalizedSessionId || undefined,
        raceId: normalizedRaceId || undefined
      });
      return results.sort((a,b) => (Number(a.officialPosition || a.finishPosition) || Infinity) - (Number(b.officialPosition || b.finishPosition) || Infinity));
    },

    // Compatibilidade: a classificação oficial deve vir pronta do Cloud Code.
    applyPenalties(results) {
      return [...(results || [])].sort((a, b) => (a.officialPosition || a.finishPosition || 999) - (b.officialPosition || b.finishPosition || 999));
    },

    async getReservations(raceId) {
      return this.cloud('getRaceReservations', { raceId });
    },

    async reserveCar(raceId, steamId, driverName, carModel) {
      return this.cloud('reserveRaceCar', { raceId, steamId, driverName, carModel });
    },

    async cancelReservation(reservationId) {
      return this.cloud('cancelRaceReservation', { reservationId });
    },

    async submitRaceReport(raceId, againstSteamId, description, videoUrl = '') {
      return this.cloud('submitRaceReport', { raceId, againstSteamId, description, videoUrl });
    },

    async getRace(raceId) {
      return request(`/classes/Races/${encodeURIComponent(raceId)}`);
    },

    async setPenalty(resultId, penaltySeconds, reason = '') {
      return this.cloud('applyRacePenalty', { resultId, penaltySeconds: Number(penaltySeconds), reason });
    },

    async getBroadcast(raceId) {
      const race = await this.getRace(raceId);
      return race.broadcastUrl || null;
    },

    async verifyAdminSession() {
      return this.cloud('verifyAdminSession');
    },

    async saveAdminRace(race, objectId = '') {
      const path = objectId ? `/classes/Races/${encodeURIComponent(objectId)}` : '/classes/Races';
      const payload = { ...race };
      // O schema histórico de Races.duration no Back4App é String.
      // Normalizar aqui protege também futuros formulários e integrações administrativas.
      if (Object.prototype.hasOwnProperty.call(payload, 'duration')) {
        payload.duration = payload.duration == null ? '' : String(payload.duration).trim();
      }
      return request(path, { method: objectId ? 'PUT' : 'POST', body: payload });
    },

    async getAdminAudit(limit = 12) {
      const data = await request(`/classes/AuditLog?order=-timestamp,-createdAt&limit=${Math.min(Math.max(Number(limit) || 12, 1), 100)}`);
      return data.results || [];
    },

    async getAdminReports(limit = 100) {
      const data = await request(`/classes/Reports?order=-submittedAt,-createdAt&limit=${Math.min(Math.max(Number(limit) || 100, 1), 300)}`);
      return data.results || [];
    },

    async getRaceProcessorContext() {
      return this.cloud('getRaceProcessorContext');
    },

    async migrateRatingsV2() {
      return this.cloud('migrateRatingsV3');
    },

    async migrateRatingsV3() {
      return this.cloud('migrateRatingsV3');
    },

    async previewRaceImport(payload) {
      return this.cloud('previewRaceImport', { payload });
    },

    async commitRaceImport(payload) {
      return this.cloud('commitRaceImport', { payload });
    },
    async resumeRaceImport(importId) {
      return this.cloud('resumeRaceImport', { importId });
    },
    async voidLatestRaceImport(importId, reason) {
      return this.cloud('voidLatestRaceImport', { importId, reason });
    },
    async setRaceRatingPolicy(raceId, policy) {
      return this.cloud('setRaceRatingPolicy', { raceId, policy });
    },
    async getRatingPublicationStatus() {
      return this.cloud('getRatingPublicationStatus');
    },
    async initializeRatingPublication() {
      return this.cloud('initializeRatingPublication');
    },
    async getRatingCalibration() {
      return this.cloud('getRatingCalibration');
    },
    async rebuildRatingsFromLedger() {
      return this.cloud('rebuildRatingsFromLedger');
    }
  };

  window.BSR_API = api;
})();
