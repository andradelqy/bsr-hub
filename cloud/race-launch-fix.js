/*
 * BSR Racing Hub — resolução segura do carro para entrada direta.
 * Mantido como módulo isolado para permitir uma publicação incremental no
 * Back4App sem substituir o arquivo main.js obrigatório pelo painel.
 */

function cleanText(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

async function userHasRole(user, roleName) {
  if (!user) return false;
  const role = await new Parse.Query(Parse.Role).equalTo('name', roleName).first({ useMasterKey:true });
  if (!role) return false;
  return Boolean(await role.getUsers().query().equalTo('objectId', user.id).first({ useMasterKey:true }));
}

async function requireHubUser(request) {
  if (!request.user) throw new Parse.Error(Parse.Error.SESSION_MISSING, 'Sessão obrigatória.');
  if (await userHasRole(request.user, 'admin')) return request.user;
  const policy = await new Parse.Query('HubAccessPolicy').equalTo('key', 'primary').first({ useMasterKey:true });
  if (policy?.get('mode') !== 'invite') return request.user;
  const steamId = cleanText(request.user.get('steamId'), 30);
  const grant = steamId ? await new Parse.Query('HubAccessGrant').equalTo('steamId', steamId).notEqualTo('enabled', false).first({ useMasterKey:true }) : null;
  if (!grant) throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Seu acesso ao BSR Hub ainda não foi liberado.');
  return request.user;
}

async function raceContentPackages(race) {
  const slugs = Array.isArray(race.get('requirementSlugs')) ? race.get('requirementSlugs').map(item => cleanText(item, 120).toLowerCase()).filter(Boolean) : [];
  const byRace = new Parse.Query('ContentPackage'); byRace.equalTo('raceIds', race.id);
  let query = byRace;
  if (slugs.length) {
    const bySlug = new Parse.Query('ContentPackage'); bySlug.containedIn('slug', slugs);
    query = Parse.Query.or(byRace, bySlug);
  }
  query.equalTo('approved', true); query.notEqualTo('enabled', false); query.limit(500);
  return query.find({ useMasterKey:true });
}

function searchText(item) {
  return [item.get('name'), item.get('slug'), item.get('targetId'), ...(Array.isArray(item.get('tags')) ? item.get('tags') : [])]
    .map(value => cleanText(value, 160).toLowerCase()).filter(Boolean).join(' ');
}

function tokens(value) {
  const ignored = new Set(['assetto','corsa','bsr','brasil','cup','race','racing','series','sprint','min','minutos','the','car']);
  return cleanText(value, 300).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter(token => token.length >= 3 && !ignored.has(token));
}

function inferRequestedCar(race, packages, preferredName = '') {
  const candidates = packages.filter(item => item.get('type') === 'car' && /^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(cleanText(item.get('targetId'), 120)));
  if (!candidates.length) return '';
  const primary = candidates.filter(item => !/(?:^|[\s_.-])safety(?:[\s_.-]|$)|safety\s*car/i.test(searchText(item)));
  const pool = primary.length ? primary : candidates;
  if (pool.length === 1) return cleanText(pool[0].get('targetId'), 120);
  const wanted = tokens(preferredName || race.get('title') || race.get('name'));
  const ranked = pool.map(item => {
    const text = tokens(searchText(item));
    return { item, score:wanted.reduce((score, token) => score + (text.some(part => part === token || part.includes(token) || token.includes(part)) ? 1 : 0), 0) };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.score && ranked[0].score !== ranked[1]?.score ? cleanText(ranked[0].item.get('targetId'), 120) : '';
}

Parse.Cloud.define('getRaceLaunchConfig', async request => {
  const user = await requireHubUser(request);
  const raceId = cleanText(request.params.raceId, 40);
  const race = await new Parse.Query('Races').get(raceId, { useMasterKey:true });
  const [connection, serverProfile, requiredPackages] = await Promise.all([
    new Parse.Query('RaceConnection').equalTo('raceId', raceId).first({ useMasterKey:true }),
    new Parse.Query('ServerProfile').equalTo('key', 'assetto-corsa-primary').first({ useMasterKey:true }),
    raceContentPackages(race)
  ]);
  const isAdmin = await userHasRole(user, 'admin');
  const requiresRegistration = race.get('requiresRegistration') !== false;
  const reservation = requiresRegistration
    ? await new Parse.Query('CarReservations').equalTo('raceId', raceId).equalTo('steamId', user.get('steamId')).first({ useMasterKey:true })
    : null;
  if (!isAdmin && requiresRegistration && !reservation) throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Confirme sua inscrição antes de entrar no servidor.');
  const host = cleanText(serverProfile?.get('serverHost') || connection?.get('serverHost'), 253).toLowerCase();
  if (!host) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'O servidor ainda não foi liberado pela organização.');
  const cars = Array.isArray(race.get('cars')) ? race.get('cars') : [];
  const reservedCar = reservation?.get('carModel');
  const car = cars.find(item => (item.name || item.nome) === reservedCar);
  const hint = cleanText(request.params.requestedCarHint, 120);
  const requiredCarTargets = [...new Set(requiredPackages.filter(item => item.get('type') === 'car').map(item => cleanText(item.get('targetId'), 120)).filter(item => /^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(item)))];
  const approvedHint = requiredCarTargets.find(item => item.toLowerCase() === hint.toLowerCase()) || '';
  const configuredCandidates = [connection?.get('requestedCar'), race.get('carContentId')].map(item => cleanText(item, 120)).filter(Boolean);
  const approvedConfiguredCar = requiredCarTargets.length
    ? configuredCandidates.find(candidate => requiredCarTargets.some(target => target.toLowerCase() === candidate.toLowerCase())) || ''
    : configuredCandidates[0] || '';
  const requestedCar = cleanText(car?.contentId || car?.folder || car?.id || approvedConfiguredCar || approvedHint || inferRequestedCar(race, requiredPackages, reservedCar), 120);
  if (!requestedCar) throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Selecione no painel administrativo qual carro desta corrida será usado para entrar no servidor.');
  return {
    host,
    serverPort:Number(serverProfile?.get('serverPort') || connection?.get('serverPort') || 9600),
    httpPort:Number(serverProfile?.get('serverHttpPort') || connection?.get('serverHttpPort') || 8081),
    password:serverProfile?.get('serverPassword') || connection?.get('serverPassword') || '',
    serverName:race.get('title') || race.get('name') || 'Brasil Sim Racing',
    requestedCar
  };
});
