(function () {
  'use strict';

  const classRules = [
    ['hypercar','Hypercar'],['lmdh','Hypercar'],['lmh','Hypercar'],['gtp','Hypercar'],['dpi','Hypercar'],
    ['ferrenzo','Hypercar'],['valkyrie','Hypercar'],['protech_p96','Hypercar'],['bayer_hybrid','Hypercar'],
    ['lmp1','LMP1'],['lmp 1','LMP1'],['lmp3','LMP3'],['lmp 3','LMP3'],['js_p3','LMP3'],
    ['lmp2','LMP2'],['lmp 2','LMP2'],['js_p2','LMP2'],['gt3','GT3'],['gt 3','GT3'],
    ['mercer','GT3'],['furiano','GT3'],['macca','GT3'],['adonis','GT3'],['hyperion','GT3'],
    ['protech_p92','GT3'],['lanzo','GT3'],['cortex','GT3'],['gt4','GT4'],['gt 4','GT4'],
    ['gte-am','GTE-Am'],['gtd','GTE-Am'],['gte','GTE'],['gtlm','GTE'],['tcr','TCR'],
    ['marcas_turbo','Marcas Turbo'],['cup','GTC'],['prototype','Prototype'],['proto','Prototype']
  ];
  const penalties = {
    none: { label:'Sem penalidade', seconds:0, incidents:0 },
    pit_speed: { label:'Excesso no pit lane · +5s', seconds:5, incidents:0 },
    jump_start: { label:'Queima de largada · +10s', seconds:10, incidents:0 },
    contact_damage: { label:'Contato com dano · +15s / +4x', seconds:15, incidents:4 },
    track_limits: { label:'Limites de pista · +5s / +1x', seconds:5, incidents:1 },
    blue_flag: { label:'Desrespeito à bandeira azul · +10s / +2x', seconds:10, incidents:2 },
    yellow_overtake: { label:'Ultrapassagem sob amarela · +30s / +4x', seconds:30, incidents:4 },
    min_drive_time: { label:'Tempo mínimo não cumprido · +60s', seconds:60, incidents:0 },
    dangerous_move: { label:'Manobra perigosa · +20s / +4x', seconds:20, incidents:4 },
    custom: { label:'Personalizada', seconds:0, incidents:0 }
  };
  const normalizedName = value => String(value || '').trim().replace(/\s+/g, ' ');
  const classifyCar = value => {
    const model = String(value || '').toLowerCase();
    return classRules.find(([keyword]) => model.includes(keyword))?.[1] || 'Unknown';
  };
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const timeMs = value => {
    if (Number.isFinite(Number(value))) return Number(value);
    const parts = String(value || '').trim().split(':').map(Number);
    if (!parts.length || parts.some(Number.isNaN)) return 0;
    let seconds = 0; parts.forEach(part => { seconds = seconds * 60 + part; });
    return Math.round(seconds * 1000);
  };

  function detectDNF(drivers) {
    // Nunca infere abandono apenas pela porcentagem de voltas: retardatarios e
    // provas curtas eram marcados como rage quit incorretamente. O estado agora
    // depende dos eventos/flags fornecidos pelo servidor e pode ser revisado.
    drivers.forEach(driver => {
      driver.disconnected = Boolean(driver.disconnected || driver.isRageQuit);
      driver.isDNF = Boolean(driver.isDNF || driver.disconnected);
      driver.isRageQuit = Boolean(driver.isRageQuit);
    });
    return drivers;
  }

  function collectIncidents(events) {
    const totals = new Map();
    const contactClusters = new Map();
    const item = id => {
      const key = String(id ?? '');
      if (!totals.has(key)) totals.set(key, { offTracks:0, lossOfControl:0, lightContacts:0, heavyContacts:0 });
      return totals.get(key);
    };
    (events || []).forEach((event, index) => {
      const type = String(event.Type || event.Event || '').toUpperCase();
      const carId = String(event.CarId ?? event.CarID ?? event.Car ?? '');
      const driverGuid = String(event.DriverGuid || event.DriverGUID || event.Driver?.Guid || event.GUID || '').trim();
      const driverKey = driverGuid || carId;
      if (!driverKey) return;
      if (/CUT|OFF_TRACK|TRACK_LIMIT/.test(type)) { item(driverKey).offTracks += 1; return; }
      if (/SPIN|LOSS_OF_CONTROL/.test(type)) { item(driverKey).lossOfControl += 1; return; }
      if (!/COLLISION|CONTACT/.test(type)) return;
      const otherId = String(event.OtherCarId ?? event.OtherCarID ?? event.OtherCar ?? event.TargetCarId ?? 'world');
      const otherGuid = String(event.OtherDriverGuid || event.OtherDriverGUID || event.OtherDriver?.Guid || event.TargetDriverGuid || '').trim();
      const otherKey = otherGuid || otherId;
      const timestamp = finite(event.Time ?? event.Timestamp ?? event.SessionTime, index * 3001);
      const pair = [driverKey, otherKey].sort().join(':');
      const impact = finite(event.ImpactSpeed ?? event.RelativeSpeed ?? event.Speed ?? event.Impact, 0);
      const heavy = impact >= 20 || /HEAVY/.test(type);
      const field = heavy ? 'heavyContacts' : 'lightContacts';
      const ids = [driverKey, ...(otherKey !== 'world' && otherKey !== '' ? [otherKey] : [])];
      const previous = contactClusters.get(pair);
      if (previous && Math.abs(timestamp - previous.timestamp) <= 3000) {
        // Uma sequência 2x→4x conta apenas como 4x. Isso também evita a
        // duplicação comum em que o servidor registra o contato pelos dois carros.
        if (field === 'heavyContacts' && previous.field === 'lightContacts') {
          previous.ids.forEach(id => { item(id).lightContacts = Math.max(0, item(id).lightContacts - 1); });
          ids.forEach(id => { item(id).heavyContacts += 1; });
          contactClusters.set(pair, { timestamp, field, ids });
        }
        return;
      }
      ids.forEach(id => { item(id)[field] += 1; });
      contactClusters.set(pair, { timestamp, field, ids });
    });
    return totals;
  }

  function parseResultsJson(text) {
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error('O results.json não contém um JSON válido.'); }
    const cars = Array.isArray(data.Cars) ? data.Cars : [];
    const carsById = new Map();
    cars.forEach((car, index) => {
      const key = String(car.CarId ?? car.CarID ?? index);
      if (!carsById.has(key)) carsById.set(key, []);
      carsById.get(key).push(car);
    });
    const resultRows = Array.isArray(data.Result) ? data.Result : Array.isArray(data.Results) ? data.Results : [];
    if (!resultRows.length) throw new Error('Nenhum resultado foi encontrado no arquivo JSON.');
    const incidentMap = collectIncidents(data.Events || []);
    const ownersBySlot = new Map();
    const drivers = resultRows.map((row, index) => {
      const carId = String(row.CarId ?? row.CarID ?? index);
      const rowGuid = String(row.DriverGuid || row.DriverGUID || row.Driver?.Guid || row.GUID || '').trim();
      const rowName = normalizedName(row.DriverName || row.Driver?.Name || row.Name);
      const candidates = carsById.get(carId) || [];
      const car = candidates.find(candidate => rowGuid && String(candidate.DriverGuid || candidate.DriverGUID || candidate.Driver?.Guid || '').trim() === rowGuid)
        || candidates.find(candidate => rowName && normalizedName(candidate.DriverName || candidate.Driver?.Name).toLocaleLowerCase('pt-BR') === rowName.toLocaleLowerCase('pt-BR'))
        || candidates[0] || {};
      const steamGUID = rowGuid || String(car.DriverGuid || car.DriverGUID || car.Driver?.Guid || '').trim();
      const model = row.CarModel || row.Car || car.Model || car.CarModel || '';
      const name = rowName || normalizedName(car.DriverName || car.Driver?.Name);
      const ownerKey = steamGUID || name.toLocaleLowerCase('pt-BR');
      if (!ownersBySlot.has(carId)) ownersBySlot.set(carId, new Set());
      if (ownerKey) ownersBySlot.get(carId).add(ownerKey);
      const incident = incidentMap.get(steamGUID) || incidentMap.get(carId) || { offTracks:0, lossOfControl:0, lightContacts:0, heavyContacts:0 };
      const explicitIncidents = Number.isFinite(Number(row.IncidentPoints ?? row.Incidents));
      const calculatedPoints = incident.offTracks + incident.lossOfControl * 2 + incident.lightContacts * 2 + incident.heavyContacts * 4;
      const rawStatus = String(row.Status || row.ResultStatus || '').toLowerCase();
      const disconnected = Boolean(row.Disconnected || row.ConnectionLost || /disconnect|left/.test(rawStatus));
      const isRageQuit = Boolean(row.RageQuit || /rage|quit/.test(rawStatus));
      const isDNF = Boolean(row.DNF || disconnected || /dnf|did not finish/.test(rawStatus));
      return {
        name, steamGUID,
        incidentEvidence:explicitIncidents ? 'reported' : Array.isArray(data.Events) ? 'events' : 'missing',
        didNotStart:Boolean(row.DNS || /dns|did not start/.test(rawStatus)), serverFailure:false,
        finishPosition:finite(row.Position ?? row.FinishPosition, index + 1), lapsCompleted:finite(row.NumLaps ?? row.Laps ?? row.LapsCompleted),
        cornersCompleted:finite(row.CornersCompleted), incidents:explicitIncidents ? finite(row.IncidentPoints ?? row.Incidents) : calculatedPoints,
        incidentPoints:explicitIncidents ? finite(row.IncidentPoints ?? row.Incidents) : calculatedPoints, ...incident,
        carModel:model, carClass:row.CarClass || car.Class || classifyCar(model), bestLapMs:timeMs(row.BestLap ?? row.BestLapMs),
        totalTimeMs:timeMs(row.TotalTime ?? row.TotalTimeMs ?? row.Time), isDNF, isRageQuit, disconnected, isDSQ:Boolean(row.DSQ || /dsq|disqual/.test(rawStatus)),
        penaltySeconds:0, penaltyIncidents:0, penaltyReason:''
      };
    }).filter(driver => driver.name);
    detectDNF(drivers);
    const reusedSlots = [...ownersBySlot.entries()].filter(([, owners]) => owners.size > 1).map(([carId, owners]) => ({ carId, drivers:owners.size }));
    const warnings = reusedSlots.length ? [`${reusedSlots.length} slot${reusedSlots.length > 1 ? 's' : ''} reutilizado${reusedSlots.length > 1 ? 's' : ''} pelo servidor; as identidades e os incidentes foram separados por SteamID.`] : [];
    return { track: normalizedName(data.TrackName || data.Track || 'Pista não identificada'), sessionType:String(data.Type || 'RACE').toUpperCase(), sessionDate:data.Date || null, drivers, reusedSlots, warnings };
  }

  function parseServerLog(text, pluginText = '') {
    const trackMatch = text.match(/(?:Track:\s*|content\/tracks\/)([^/\r\n"]+)/i);
    const track = normalizedName((trackMatch?.[1] || 'Pista não identificada').replace(/^ks_/i, '').replaceAll('_',' '));
    const connections = new Map();
    for (const match of text.matchAll(/Name:\s*(.+?),\s*GUID:\s*(\d+)/gi)) connections.set(normalizedName(match[1]).toLowerCase(), match[2]);
    const collisions = new Map();
    for (const match of text.matchAll(/(?:msg=")?(.+?) collided with/gi)) {
      const name = normalizedName(match[1].replace(/^.*?Name:\s*/i,'')).toLowerCase(); collisions.set(name, (collisions.get(name) || 0) + 1);
    }
    const models = [...text.matchAll(/content\/cars\/([^/\s"]+)/gi)].map(match => match[1]);
    const leaderboard = [...text.matchAll(/(?:^|\n).*?(\d+)\.\s*(.+?)\s*-\s*CarID:\s*(\d+),\s*Time:\s*([^,]+),\s*NumLaps:\s*(\d+)/gi)];
    if (!leaderboard.length) throw new Error('O leaderboard final não foi encontrado no log do servidor.');
    const cuts = new Map();
    for (const match of pluginText.matchAll(/Name:\s*(.+?)\s*-.*?Cutting warning:\s*(\d+)/gi)) cuts.set(normalizedName(match[1]).toLowerCase(), finite(match[2]));
    const drivers = leaderboard.map(match => {
      const name = normalizedName(match[2]); const key = name.toLowerCase(); const carId = finite(match[3]); const model = models[carId] || '';
      const lightContacts = collisions.get(key) || 0; const offTracks = cuts.get(key) || 0; const points = lightContacts * 2 + offTracks;
      return { name, steamGUID:connections.get(key) || '', finishPosition:finite(match[1]), lapsCompleted:finite(match[5]), cornersCompleted:0,
        incidents:points, incidentPoints:points, offTracks, lossOfControl:0, lightContacts, heavyContacts:0,
        carModel:model, carClass:classifyCar(model), bestLapMs:0, totalTimeMs:timeMs(match[4]), isDNF:false, isRageQuit:false,
        disconnected:false, isDSQ:false, penaltySeconds:0, penaltyIncidents:0, penaltyReason:'' };
    });
    detectDNF(drivers);
    return { track, sessionType:'RACE', sessionDate:null, drivers };
  }

  window.BSRRaceProcessor = { penalties, classifyCar, detectDNF, collectIncidents, parseResultsJson, parseServerLog };
})();
