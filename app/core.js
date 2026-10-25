(function () {
  'use strict';

  const listeners = new Map();
  const cache = new Map();
  const CACHE_TTL = 90 * 1000;
  const stored = key => localStorage.getItem(key) || sessionStorage.getItem(key);

  const state = {
    loading: true,
    online: false,
    route: 'dashboard',
    races: [],
    championships: [],
    standings: [],
    drivers: [],
    notifications: [],
    access: { mode:'open', authenticated:false, allowed:true, isAdmin:false, reason:'initializing' },
    isAdmin: false,
    admin: null,
    driver: null,
    driverResults: [],
    reservations: new Map(),
    filters: { search: '', category: 'all', status: 'all', sort: 'new' }
  };

  function emit(event, payload) {
    (listeners.get(event) || []).forEach(handler => handler(payload));
  }

  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event)?.delete(handler);
  }

  function escape(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  }

  function cleanUrl(value, fallback = 'assets/video/stockcar.png') {
    const url = String(value || '').trim();
    const candidate = /^(https?:\/\/|assets\/)/i.test(url) ? url : fallback;
    try { return new URL(candidate.replace(/["'\\<>]/g, ''), document.baseURI).href; }
    catch (_) { return fallback; }
  }

  function parseDate(entity) {
    if (!entity) return null;
    const direct = entity.startAt?.iso || entity.startAt || entity.sessionDate?.iso || entity.sessionDate || entity.dateTime;
    if (direct) {
      const value = new Date(direct);
      if (!Number.isNaN(value.getTime())) return value;
    }
    if (!entity.date) return null;
    if (entity.date?.iso) return parseDate({ startAt: entity.date.iso });
    let date = String(entity.date).trim();
    if (date.includes('T')) return parseDate({ startAt: date });
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
      const [day, month, year] = date.split('/');
      date = `${year}-${month}-${day}`;
    }
    const time = String(entity.time || '00:00').trim();
    const value = new Date(`${date}T${time.length === 5 ? time + ':00' : time}`);
    return Number.isNaN(value.getTime()) ? null : value;
  }

  function formatDate(date, options) {
    return date ? date.toLocaleDateString('pt-BR', options || { day: '2-digit', month: 'short' }) : 'A definir';
  }

  function formatTime(date) {
    return date ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  }

  function raceStatus(race) {
    const raw = String(race.status || '').toLowerCase();
    if (['encerrada', 'encerrado', 'finished', 'finalizada'].includes(raw)) return 'finished';
    if (['cancelada', 'cancelado'].includes(raw)) return 'cancelled';
    if (['fechada', 'fechado', 'closed'].includes(raw)) return 'closed';
    const date = parseDate(race);
    if (date && date < new Date()) return 'finished';
    return ['aberta', 'aberto', 'open'].includes(raw) ? 'open' : 'upcoming';
  }

  function normalizeRace(raw) {
    const date = parseDate(raw);
    const rawDuration = raw.duration ?? raw.raceDuration;
    const durationLabel = rawDuration == null || rawDuration === ''
      ? 'Duração a definir'
      : /^\s*\d+(?:[.,]\d+)?\s*$/.test(String(rawDuration))
        ? `${String(rawDuration).trim()} min`
        : String(rawDuration).trim();
    return {
      ...raw,
      id: raw.objectId,
      title: raw.title || raw.name || 'Corrida BSR',
      track: raw.track || raw.circuit || 'Pista a definir',
      category: raw.category || raw.carClass || raw.series || 'BSR Series',
      dateObject: date,
      dateLabel: formatDate(date, { weekday: 'short', day: '2-digit', month: 'short' }),
      timeLabel: date ? formatTime(date) : (/^\d{2}:\d{2}(?::\d{2})?$/.test(String(raw.time || '').trim()) ? raw.time.trim().slice(0,5) : 'Horário a definir'),
      imageUrl: cleanUrl(raw.bannerUrl || raw.image || raw.trackImage),
      statusKey: raceStatus(raw),
      durationLabel,
      requiresRegistration: raw.requiresRegistration !== false,
      maxDrivers: Number(raw.maxDrivers || raw.maxSlots || 0),
      description: raw.description || raw.summary || 'Informações esportivas serão publicadas pela organização.'
    };
  }

  function normalizeChampionship(raw) {
    const rounds = Number(raw.rounds || raw.totalRounds || raw.raceCount || 0);
    const completed = Number(raw.completedRounds || raw.currentRound || 0);
    return {
      ...raw,
      id: raw.objectId,
      title: raw.name || raw.title || 'Campeonato BSR',
      category: raw.category || raw.carClass || 'Brasil Sim Racing',
      imageUrl: cleanUrl(raw.bannerUrl || raw.image, 'assets/foto/fundo2.png'),
      description: raw.description || 'Temporada competitiva oficial da Brasil Sim Racing.',
      rounds,
      completed,
      progress: rounds ? Math.min(100, Math.round(completed / rounds * 100)) : 0,
      statusKey: String(raw.status || 'active').toLowerCase()
    };
  }

  async function cached(key, loader, force = false) {
    const current = cache.get(key);
    if (!force && current && Date.now() - current.timestamp < CACHE_TTL) return current.data;
    const data = await loader();
    cache.set(key, { data, timestamp: Date.now() });
    return data;
  }

  async function loadRaces(force = false) {
    state.races = await cached('races', async () => (await window.BSR_API.getRaces(300, true)).map(normalizeRace), force);
    return state.races;
  }

  async function loadChampionships(force = false) {
    state.championships = await cached('championships', async () => (await window.BSR_API.getChampionships(100)).map(normalizeChampionship), force);
    return state.championships;
  }

  async function loadDrivers(force = false) {
    state.drivers = await cached('drivers', async () => {
      return await window.BSR_API.cloud('getPublicDrivers');
    }, force);
    return state.drivers;
  }

  async function loadStandings(force = false) {
    state.standings = await cached('standings', async () => {
      return await window.BSR_API.cloud('getPublicStandings');
    }, force);
    return state.standings;
  }

  async function loadNotifications(force = false) {
    state.notifications = await cached('notifications', async () => {
      return await window.BSR_API.cloud('getNotifications');
    }, force).catch(() => []);
    return state.notifications;
  }

  async function loadCurrentDriver(force = false) {
    const steamId = stored('steamId');
    if (!steamId) {
      state.driver = null;
      state.driverResults = [];
      return null;
    }
    state.driver = await cached(`driver:${steamId}`, () => window.BSR_API.getDriver(steamId), force);
    state.driverResults = state.driver ? await cached(`results:${state.driver.objectId}`, () => window.BSR_API.getDriverResults(state.driver.objectId, 300), force) : [];
    return state.driver;
  }

  async function loadReservations(raceId, force = false) {
    const reservations = await cached(`reservations:${raceId}`, () => window.BSR_API.getReservations(raceId), force);
    state.reservations.set(raceId, reservations);
    return reservations;
  }

  async function loadAdminAccess() {
    const session = window.BSR_API.readSession();
    if (!session) { state.isAdmin = false; state.admin = null; return false; }
    try {
      const admin = await window.BSR_API.verifyAdminSession();
      state.isAdmin = Boolean(admin?.isAdmin); state.admin = admin;
    } catch (_) { state.isAdmin = false; state.admin = null; }
    return state.isAdmin;
  }

  async function loadHubAccess() {
    state.access = await window.BSR_API.getHubAccessStatus();
    return state.access;
  }

  async function bootstrap(force = false) {
    state.loading = true;
    emit('loading', true);
    try {
      await loadHubAccess();
      state.online = true;
    } catch (error) {
      state.online = false;
      state.loading = false;
      emit('loading', false);
      throw error;
    }
    if (!state.access.allowed) {
      state.races = []; state.championships = []; state.notifications = [];
      state.driver = null; state.driverResults = []; state.isAdmin = false; state.admin = null;
      state.loading = false;
      emit('loading', false);
      emit('synced', state);
      return state;
    }
    const results = await Promise.allSettled([
      loadRaces(force), loadChampionships(force), loadCurrentDriver(force), loadNotifications(force), loadAdminAccess()
    ]);
    state.online = results.slice(0, 2).some(result => result.status === 'fulfilled');
    state.loading = false;
    emit('loading', false);
    emit('synced', state);
    return state;
  }

  function upcomingRaces() {
    return state.races.filter(race => !['finished', 'cancelled'].includes(race.statusKey))
      .sort((a, b) => (a.dateObject?.getTime() || Infinity) - (b.dateObject?.getTime() || Infinity));
  }

  function sortRaces(races, order = 'new') {
    return [...races].sort((a, b) => {
      if (order === 'name') return a.title.localeCompare(b.title, 'pt-BR');
      const aDate = a.dateObject?.getTime();
      const bDate = b.dateObject?.getTime();
      if (aDate == null && bDate != null) return 1;
      if (bDate == null && aDate != null) return -1;
      return (order === 'soon' ? aDate - bDate : bDate - aDate) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  function driverMetrics() {
    const results = state.driverResults || [];
    return {
      races: state.driver?.totalRaces || results.length,
      wins: results.filter(result => Number(result.officialPosition || result.finishPosition) === 1).length,
      podiums: results.filter(result => Number(result.officialPosition || result.finishPosition) <= 3 && Number(result.officialPosition || result.finishPosition) > 0).length,
      rating: Number(state.driver?.irating || 1600),
      safety: Number(state.driver?.safetyRating ?? 2.5),
      reliability: Number(state.driver?.reliability ?? 90),
      confidence: Number(state.driver?.ratingConfidence || 0),
      provisional: state.driver?.ratingProvisional !== false,
      discipline: state.driver?.primaryDiscipline || 'road',
      rank: state.driver?.driverRank || state.driver?.licenseClass || 'Rookie',
      contactBadge: state.driver?.contactBadge || 'Rookie',
      mpr: Number(state.driver?.licenseMPR || 0)
    };
  }

  function avatar(driver) {
    const name = driver?.name || 'Piloto BSR';
    return cleanUrl(driver?.customAvatar || driver?.steamAvatar || stored('steamAvatar'), `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=f4c430&color=111111`);
  }

  window.BSR = {
    state, on, emit, escape, cleanUrl, parseDate, formatDate, formatTime, raceStatus,
    normalizeRace, normalizeChampionship, bootstrap, loadRaces, loadChampionships,
    loadDrivers, loadStandings, loadNotifications, loadCurrentDriver, loadReservations, loadAdminAccess, loadHubAccess,
    upcomingRaces, sortRaces, driverMetrics, avatar, cache, stored
  };
})();
