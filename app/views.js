(function () {
  'use strict';
  const B = window.BSR;
  const C = window.BSRComponents;
  function setView(html) {
    const view = document.getElementById('view');
    view.innerHTML = html;
    if (document.documentElement.classList.contains('app-ready')) C.revealView(view);
    view.focus({ preventScroll: true });
  }

  function filterMenu(id, label, options, value) {
    const selected = options.find(option => option.value === value) || options[0];
    return `<div class="filter-menu" data-filter-menu>
      <button class="filter-menu-trigger" id="${id}Trigger" type="button" aria-haspopup="listbox" aria-controls="${id}Options" aria-expanded="false">
        <span><small>${B.escape(label)}</small><b data-filter-label>${B.escape(selected.label)}</b></span><i aria-hidden="true">⌄</i>
      </button>
      <div class="filter-menu-popover" id="${id}Options" role="listbox" aria-labelledby="${id}Trigger" inert>
        ${options.map(option => `<button type="button" role="option" tabindex="-1" data-filter-value="${B.escape(option.value)}" aria-selected="${option.value === value}"><span>${B.escape(option.label)}</span><i aria-hidden="true">✓</i></button>`).join('')}
      </div>
    </div>`;
  }

  function bindFilterMenu(root, onChange) {
    const trigger = root.querySelector('.filter-menu-trigger');
    const popup = root.querySelector('.filter-menu-popover');
    const options = [...root.querySelectorAll('[data-filter-value]')];
    const close = (focus = false) => {
      root.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); popup.inert = true;
      if (focus) trigger.focus();
    };
    root.closeFilter = close;
    const open = () => {
      document.querySelectorAll('.filter-menu.open').forEach(menu => menu.closeFilter?.());
      root.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); popup.inert = false;
      const selected = options.find(item => item.getAttribute('aria-selected') === 'true') || options[0];
      selected?.focus({ preventScroll:true }); selected?.scrollIntoView({ block:'nearest' });
    };
    trigger.addEventListener('click', () => root.classList.contains('open') ? close() : open());
    options.forEach(option => option.addEventListener('click', () => {
      options.forEach(item => item.setAttribute('aria-selected', String(item === option)));
      root.querySelector('[data-filter-label]').textContent = option.querySelector('span').textContent;
      close(true); onChange(option.dataset.filterValue);
    }));
    root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) close(); });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault();
        if (!root.classList.contains('open')) return open();
        const index = options.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options[next].focus();
      }
    });
  }

  document.addEventListener('pointerdown', event => {
    document.querySelectorAll('.filter-menu.open').forEach(menu => { if (!menu.contains(event.target)) menu.closeFilter?.(); });
  });

  function bindRaceOpen(root = document) {
    root.querySelectorAll('[data-race-id]').forEach(element => {
      const open = () => C.openRace(element.dataset.raceId);
      element.addEventListener('click', open);
      element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); });
    });
  }

  function bindChampOpen(root = document) {
    root.querySelectorAll('[data-champ-id]').forEach(element => {
      const open = () => C.openChampionship(element.dataset.champId);
      element.addEventListener('click', open);
      element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); });
    });
  }

  async function dashboard() {
    const upcoming = B.upcomingRaces();
    const next = upcoming[0];
    const driver = B.state.driver;
    const metrics = B.driverMetrics();
    const results = B.state.driverResults || [];
    const today = new Date(); today.setHours(0,0,0,0);
    const days = Array.from({length:7}, (_, index) => {
      const date = new Date(today); date.setDate(date.getDate() - 6 + index);
      const count = results.filter(result => {
        const raced = new Date(result.sessionDate?.iso || result.createdAt);
        return raced.toDateString() === date.toDateString();
      }).length;
      return { date, count };
    });
    const highest = Math.max(1, ...days.map(day => day.count));
    const weekTotal = days.reduce((sum, day) => sum + day.count, 0);
    const featured = B.state.championships.slice(0,3);
    const image = next?.imageUrl || B.cleanUrl('assets/video/stockcar.png');
    setView(`<section class="launcher-home" aria-label="Central do piloto">
      <div class="launcher-art" style="--hero-image:url('${B.escape(image)}')"></div>
      <div class="hero-session"><span class="session-light"></span><div><b>${next ? 'PRÓXIMA SESSÃO' : 'BRASIL SIM RACING'}</b><small>${next ? B.escape(next.dateLabel + ' · ' + next.timeLabel) : 'AUTOMOBILISMO VIRTUAL'}</small></div><span class="session-symbol">↗</span></div>
      <div class="launcher-intro">
        <div class="hero-kicker"><p class="overline">${next ? B.escape(next.category) : 'SEU LUGAR NO GRID'}</p>${next ? `<time datetime="${B.escape(next.dateObject?.toISOString?.() || '')}"><span>${B.escape(next.dateLabel)}</span><i></i><span>${B.escape(next.timeLabel)}</span></time>` : ''}</div>
        <h2 class="launcher-title">${next ? B.escape(next.title) : 'BRASIL<span class="title-mini">SIM</span><br>RACING'}</h2>
        <p class="launcher-description">${next ? B.escape(next.track + ' · ' + next.durationLabel) : 'A competição começa com você.'}</p>
        <div class="hero-action-row">${next ? `<button class="play-button" data-race-id="${B.escape(next.id)}"><span>▶</span> ABRIR SESSÃO</button>` : '<a class="play-button" href="#/races"><span>▶</span> EXPLORAR CORRIDAS</a>'}<a class="hero-secondary" href="#/championships">Campeonatos <span>↗</span></a></div>
      </div>
      <div class="launcher-widgets">
        <section class="launcher-widget"><h3>ATIVIDADE DA SEMANA</h3><div class="widget-body activity-body"><div class="activity-identity">${driver ? `<img src="${B.escape(B.avatar(driver))}" alt="">` : '<span class="activity-icon">⚑</span>'}<strong>${driver ? weekTotal : '—'}</strong><small>${driver ? 'corridas' : 'Conecte-se'}</small></div><div class="week-chart" role="img" aria-label="${driver ? weekTotal + ' corridas nos últimos sete dias' : 'Conecte sua conta para ver a atividade'}">${days.map(day => `<div title="${B.formatDate(day.date)}: ${day.count} corridas"><div class="bar-track"><i style="--bar:${day.count / highest * 100}%" class="${day.count ? 'has-value' : ''}"></i></div><small>${day.date.toLocaleDateString('pt-BR',{weekday:'short'}).slice(0,1).toUpperCase()}</small></div>`).join('')}</div></div><a class="widget-link" href="${driver ? '#/career' : 'login.html'}">${driver ? 'VER ATIVIDADE' : 'CONECTAR STEAM'} <span>↗</span></a></section>
        <section class="launcher-widget"><h3>SUAS ESTATÍSTICAS</h3><div class="widget-body mini-stats"><div><strong>${driver ? metrics.rating.toLocaleString('pt-BR') : '—'} <span>◒</span></strong><small>BSR RATING</small></div><div><strong>${driver ? metrics.safety.toFixed(2) : '—'} <span>◇</span></strong><small>SAFETY RATING</small></div></div><a class="widget-link" href="#/career">VER CARREIRA <span>↗</span></a></section>
        <section class="launcher-widget"><h3>${featured.length ? 'CAMPEONATOS EM DESTAQUE' : 'EXPLORE O HUB'}</h3><div class="widget-body featured-series">${featured.length ? featured.map(champ => `<button class="series-tile" data-champ-id="${B.escape(champ.id)}"><img src="${B.escape(champ.imageUrl)}" alt=""><span>${B.escape(champ.title)}</span></button>`).join('') : '<a class="series-tile" href="#/races"><img src="assets/video/stockcar.png" alt=""><span>CORRIDAS</span></a><a class="series-tile" href="#/championships"><img src="assets/historia/assetto.jpg" alt=""><span>TEMPORADAS</span></a><a class="series-tile" href="#/standings"><img src="assets/foto/fundo2.png" alt=""><span>RANKING</span></a>'}</div><a class="widget-link" href="#/championships">VER CAMPEONATOS <span>↗</span></a></section>
      </div>
    </section>`);
    bindRaceOpen();
    bindChampOpen();
  }

  function races() {
    const categories = [...new Set(B.state.races.map(race => race.category).filter(Boolean))].sort();
    const categoryOptions = [{ value:'all', label:'Todas as categorias' }, ...categories.map(value => ({ value, label:value }))];
    const statusOptions = [{ value:'all', label:'Todos os estados' },{ value:'open', label:'Inscrições abertas' },{ value:'upcoming', label:'Em breve' },{ value:'finished', label:'Encerradas' }];
    const sortOptions = [{ value:'new', label:'Mais recentes primeiro' },{ value:'soon', label:'Mais antigas primeiro' },{ value:'name', label:'Ordem alfabética' }];
    setView(`${C.sectionHead('COMPETIÇÃO','Calendário de corridas','', 'Encontre uma sessão compatível com seu nível e reserve seu lugar no grid.')}<div class="race-filter-panel"><label class="filter-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><span><small>BUSCAR</small><input id="raceSearch" placeholder="Corrida, pista ou categoria" value="${B.escape(B.state.filters.search)}"></span></label>${filterMenu('raceCategory','CATEGORIA',categoryOptions,B.state.filters.category)}${filterMenu('raceStatus','STATUS',statusOptions,B.state.filters.status)}${filterMenu('raceSort','ORDENAR',sortOptions,B.state.filters.sort)}<span class="result-count" id="raceCount"></span></div><div class="race-grid" id="raceGrid"></div>`);
    const render = () => {
      const filters = B.state.filters;
      let list = B.state.races.filter(race => (!filters.search || `${race.title} ${race.track} ${race.category}`.toLowerCase().includes(filters.search.toLowerCase())) && (filters.category === 'all' || race.category === filters.category) && (filters.status === 'all' || race.statusKey === filters.status));
      list = B.sortRaces(list, filters.sort);
      document.getElementById('raceCount').textContent = `${list.length} ${list.length === 1 ? 'sessão' : 'sessões'}`;
      document.getElementById('raceGrid').innerHTML = list.length ? list.map(C.raceCard).join('') : C.empty('Nenhuma corrida encontrada','Ajuste os filtros para encontrar outras sessões.');
      bindRaceOpen(document.getElementById('raceGrid'));
    };
    document.getElementById('raceSearch').addEventListener('input', event => { B.state.filters.search = event.target.value; render(); });
    const menus = document.querySelectorAll('.race-filter-panel .filter-menu');
    bindFilterMenu(menus[0], value => { B.state.filters.category = value; render(); });
    bindFilterMenu(menus[1], value => { B.state.filters.status = value; render(); });
    bindFilterMenu(menus[2], value => { B.state.filters.sort = value; render(); });
    render();
  }

  function championships() {
    setView(`${C.sectionHead('TEMPORADAS','Campeonatos BSR','', 'Acompanhe calendários, progresso e classificação de cada categoria.')}<div class="view-toolbar"><label class="filter-field">⌕ <input id="champSearch" placeholder="Buscar campeonato"></label><span class="result-count">${B.state.championships.length} temporadas</span></div><div class="championship-grid" id="champGrid">${B.state.championships.length ? B.state.championships.map(C.championshipCard).join('') : C.empty('Nenhum campeonato publicado','Novas temporadas aparecerão aqui quando forem publicadas.')}</div>`);
    const render = value => {
      const q = value.toLowerCase();
      const list = B.state.championships.filter(item => `${item.title} ${item.category}`.toLowerCase().includes(q));
      document.getElementById('champGrid').innerHTML = list.length ? list.map(C.championshipCard).join('') : C.empty('Nenhum resultado','Tente outro termo de busca.');
      bindChampOpen(document.getElementById('champGrid'));
    };
    document.getElementById('champSearch').addEventListener('input', event => render(event.target.value));
    bindChampOpen();
  }

  async function standings() {
    setView(`${C.sectionHead('RANKING','Classificação geral','', 'Desempenho competitivo consolidado da comunidade.')}<div class="loading-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`);
    const [drivers, standingsData] = await Promise.all([B.loadDrivers().catch(() => []), B.loadStandings().catch(() => [])]);
    if (B.state.route !== 'standings') return;
    const key = value => String(value || '').trim().toLocaleLowerCase('pt-BR');
    const pointsById = new Map();
    const pointsByName = new Map();
    standingsData.forEach(row => {
      const points = Number(row.points || 0);
      const id = row.driver?.objectId || row.driverId || row.driverObjectId;
      const name = row.driver?.name || row.driverName || row.name;
      if (id) pointsById.set(String(id), (pointsById.get(String(id)) || 0) + points);
      if (name) pointsByName.set(key(name), (pointsByName.get(key(name)) || 0) + points);
    });
    const list = drivers.filter(driver => {
      const name = key(driver.name);
      return name && name !== 'piloto' && name !== 'piloto não identificado';
    }).map(driver => ({
      name: driver.name || 'Piloto não identificado',
      rating: Number.isFinite(Number(driver.irating)) ? Number(driver.irating) : 1600,
      safety: Number.isFinite(Number(driver.safetyRating)) ? Number(driver.safetyRating) : 2.5,
      reliability: Number.isFinite(Number(driver.reliability)) ? Number(driver.reliability) : 90,
      confidence: Number(driver.ratingConfidence || 0),
      provisional: driver.ratingProvisional !== false,
      discipline: driver.primaryDiscipline || 'road',
      license: driver.licenseClass || 'R',
      points: pointsById.get(String(driver.objectId)) ?? pointsByName.get(key(driver.name)) ?? Number(driver.points || 0),
      driver
    })).sort((a,b) => b.rating - a.rating || b.safety - a.safety || a.name.localeCompare(b.name, 'pt-BR'))
      .map((driver,index) => ({ ...driver, position:index + 1 }));
    setView(`${C.sectionHead('RANKING','Classificação geral','', 'Habilidade competitiva oficial, independente dos pontos de cada campeonato.')}<div class="rating-legend"><span><i></i> BSR Rating mede desempenho esperado</span><span>Safety mede condução limpa</span><span>Confiabilidade considera as últimas 20 largadas</span></div><div class="view-toolbar"><label class="filter-field">⌕ <input id="standingSearch" placeholder="Buscar piloto"></label><span class="result-count">${list.length} pilotos</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>POS</th><th>PILOTO</th><th>DISCIPLINA</th><th>LICENÇA</th><th>BSR RATING</th><th>CONFIANÇA</th><th>SAFETY</th><th>CONFIAB.</th></tr></thead><tbody id="standingsBody"></tbody></table></div>`);
    const render = query => {
      const q = query.toLowerCase();
      document.getElementById('standingsBody').innerHTML = list.filter(row => String(row.name).toLowerCase().includes(q)).map(row => `<tr><td class="position ${row.position <= 3 ? 'podium' : ''}">${row.position}</td><td><button class="driver-cell driver-profile-trigger" type="button" data-profile-id="${B.escape(row.driver.objectId)}" aria-label="Abrir perfil de ${B.escape(row.name)}"><img src="${B.escape(B.avatar(row.driver))}" alt=""><span><b>${B.escape(row.name)}</b>${row.driver.location ? `<small>${B.escape(row.driver.location)}</small>` : ''}</span></button></td><td><span class="rating-discipline">${B.escape(String(row.discipline).toUpperCase())}</span></td><td><span class="license">${B.escape(row.license)}</span></td><td><b>${row.rating.toLocaleString('pt-BR')}</b>${row.provisional ? '<small class="provisional-label">PROVISÓRIO</small>' : ''}</td><td>${row.confidence}%</td><td>${row.safety.toFixed(2)}</td><td>${row.reliability}%</td></tr>`).join('');
      document.querySelectorAll('[data-profile-id]').forEach(button => button.addEventListener('click', () => C.openDriverProfile(button.dataset.profileId)));
    };
    document.getElementById('standingSearch').addEventListener('input', event => render(event.target.value)); render('');
  }

  function career() {
    const driver = B.state.driver;
    if (!driver) {
      setView(`${C.sectionHead('PILOTO','Minha carreira','')}<div class="panel">${C.empty('Conecte sua conta Steam','Seu histórico, rating, Safety Rating e resultados aparecerão neste cockpit.','<a class="button primary" href="login.html">Entrar com Steam</a>')}</div>`);
      return;
    }
    const metrics = B.driverMetrics();
    const results = [...B.state.driverResults].sort((a,b) => new Date(b.sessionDate?.iso || b.createdAt) - new Date(a.sessionDate?.iso || a.createdAt));
    const safetyProfiles = driver.safetyRatings || {};
    const ratingProfiles = Object.entries(driver.skillRatings || {}).map(([discipline, profile]) => { const safety=safetyProfiles[discipline] || {}; return `<div class="discipline-rating ${discipline === metrics.discipline ? 'active' : ''}"><small>${B.escape(discipline.toUpperCase())}</small><strong>${Number(profile.display || 1600).toLocaleString('pt-BR')}</strong><span>${Number(profile.confidence || 0)}% confiança${profile.provisional ? ' · provisório' : ''}</span><div class="discipline-license"><b>${B.escape(safety.license || (discipline === metrics.discipline ? driver.licenseClass : 'R') || 'R')}</b><span>SR ${Number(safety.rating ?? (discipline === metrics.discipline ? metrics.safety : 2.5)).toFixed(2)} · MPR ${Number(safety.mpr || 0)} · ${B.escape(safety.badge || 'Rookie')}</span></div></div>`; }).join('');
    setView(`<section class="profile-hero"><img src="${B.escape(B.avatar(driver))}" alt=""><div class="profile-identity"><small>PILOTO BSR · ${B.escape(String(metrics.rank).toUpperCase())}</small><h2>${B.escape(driver.name)}</h2><p>${B.escape(driver.bio || `Steam: ${driver.steamName || driver.name} · ${metrics.races} corridas oficiais`)}</p></div><div class="profile-rating"><small>BSR RATING · ${B.escape(String(metrics.discipline).toUpperCase())}</small><strong>${metrics.rating.toLocaleString('pt-BR')}</strong><span>SAFETY ${metrics.safety.toFixed(2)} · CONFIABILIDADE ${metrics.reliability}%</span>${metrics.provisional ? '<em>PROVISÓRIO</em>' : ''}</div></section><div class="profile-toolbar"><div><span>${B.escape(driver.location || 'Localização não informada')}</span><i></i><span>${B.escape(driver.favoriteCar || 'Carro favorito não informado')}</span><i></i><span>${B.escape(driver.favoriteTrack || 'Pista favorita não informada')}</span><small>Dados sincronizados com o perfil canônico do Back4App</small></div><button class="button" id="syncSteamProfile" type="button">Atualizar dados e Steam</button><button class="button primary" id="editDriverProfile" type="button">Personalizar perfil</button></div>${ratingProfiles ? `<section class="discipline-ratings">${ratingProfiles}</section>` : ''}<section class="stat-grid rating-stat-grid"><div class="stat-card"><small>CORRIDAS</small><strong>${metrics.races}</strong><em>⚑</em><span>Participações oficiais</span></div><div class="stat-card"><small>VITÓRIAS</small><strong>${metrics.wins}</strong><em>♛</em><span>${metrics.races ? Math.round(metrics.wins/metrics.races*100) : 0}% de aproveitamento</span></div><div class="stat-card"><small>PÓDIOS</small><strong>${metrics.podiums}</strong><em>◇</em><span>Top 3</span></div><div class="stat-card"><small>SAFETY</small><strong>${metrics.safety.toFixed(2)}</strong><em>◈</em><span>Últimas 2.000 curvas</span></div><div class="stat-card"><small>CONFIABILIDADE</small><strong>${metrics.reliability}%</strong><em>✓</em><span>Últimas 20 largadas</span></div><div class="stat-card"><small>CONFIANÇA DO RATING</small><strong>${metrics.confidence}%</strong><em>◎</em><span>${metrics.provisional ? 'Fase provisória' : 'Rating consolidado'}</span></div></section><section class="history-grid"><article class="panel">${C.sectionHead('RESULTADOS','Histórico recente','')}<div class="history-list">${results.length ? results.slice(0,20).map(result => { const date = new Date(result.sessionDate?.iso || result.createdAt); const delta = Number(result.deltaIRating ?? (Number(result.newIRating || 0)-Number(result.oldIRating || 0))); const safetyDelta = Number(result.deltaSafetyRating ?? (Number(result.newSafetyRating || 0)-Number(result.oldSafetyRating || 0))); return `<div class="history-row rating-history-row"><span>${Number.isNaN(date.getTime()) ? '—' : B.formatDate(date)}</span><div><b>${B.escape(result.raceTitle || result.track || 'Sessão BSR')}</b><small>${B.escape(result.carModel || result.category || 'Resultado oficial')} · P${Number(result.officialPosition || result.finishPosition || 0)} · SR ${safetyDelta >= 0 ? '+' : ''}${safetyDelta.toFixed(2)}</small></div><strong class="delta ${delta >= 0 ? 'positive' : 'negative'}">${delta > 0 ? '+' : ''}${delta || 0}</strong></div>`; }).join('') : C.empty('Ainda sem resultados','Complete sua primeira corrida oficial para iniciar o histórico.')}</div></article><aside class="panel">${C.sectionHead('LICENÇA','Progressão','')}<div class="career-summary"><div class="career-rating"><small>CLASSE ATUAL</small><strong>${B.escape(driver.licenseClass || 'R')}</strong><span>${B.escape(String(metrics.rank).toUpperCase())}</span></div><div class="safety-gauge" style="--value:${Math.min(100,metrics.safety/4.99*100)}%"><div><strong>${metrics.safety.toFixed(2)}</strong><small>SAFETY</small></div></div></div><p class="rating-explanation">A licença usa Safety e participação mínima. O BSR Rating mede apenas habilidade; punições esportivas alteram primeiro a classificação oficial.</p></aside></section>`);
    document.getElementById('syncSteamProfile').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true; button.textContent = 'Sincronizando…';
      try { await window.BSR_API.refreshSteamProfile(); B.cache.clear(); await B.loadCurrentDriver(true); C.toast('Steam sincronizada',`Nome e avatar atualizados para ${B.state.driver.name}.`,'success'); career(); }
      catch (error) { button.disabled = false; button.textContent = 'Sincronizar Steam'; C.toast('Sincronização indisponível',error.message,'error'); }
    });
    document.getElementById('editDriverProfile').addEventListener('click', () => {
      C.openModal('Personalizar perfil', `<form id="driverProfileForm" class="form-grid profile-edit-form"><div class="form-field"><label>NOME PÚBLICO</label><input id="profileName" maxlength="40" value="${B.escape(driver.customDisplayName || '')}" placeholder="Em branco usa o nome da Steam"></div><div class="form-field"><label>LOCALIZAÇÃO</label><input id="profileLocation" maxlength="60" value="${B.escape(driver.location || '')}" placeholder="Ex.: São Paulo, Brasil"></div><div class="form-field"><label>APRESENTAÇÃO</label><textarea id="profileBio" maxlength="300" placeholder="Conte um pouco sobre você e sua trajetória no sim racing">${B.escape(driver.bio || '')}</textarea></div><div class="form-field"><label>CARRO FAVORITO</label><input id="profileCar" maxlength="80" value="${B.escape(driver.favoriteCar || '')}"></div><div class="form-field"><label>PISTA FAVORITA</label><input id="profileTrack" maxlength="80" value="${B.escape(driver.favoriteTrack || '')}"></div><div class="form-field"><label>AVATAR PERSONALIZADO (HTTPS)</label><input id="profileAvatar" type="url" maxlength="1000" value="${B.escape(driver.customAvatar || '')}" placeholder="Em branco usa o avatar da Steam"></div></form>`, async () => {
        const confirm = document.getElementById('modalConfirm'); confirm.disabled = true; confirm.textContent = 'Salvando…';
        try {
          await window.BSR_API.updateMyDriverProfile({ displayName:document.getElementById('profileName').value, location:document.getElementById('profileLocation').value, bio:document.getElementById('profileBio').value, favoriteCar:document.getElementById('profileCar').value, favoriteTrack:document.getElementById('profileTrack').value, customAvatar:document.getElementById('profileAvatar').value });
          C.closeModal(); B.cache.clear(); await B.loadCurrentDriver(true); C.toast('Perfil atualizado','Suas alterações já estão públicas.','success'); career();
        } catch (error) { confirm.disabled = false; confirm.textContent = 'Salvar perfil'; C.toast('Perfil não atualizado',error.message,'error'); }
      }, 'Salvar perfil');
    });
  }

  async function stewarding() {
    const driver = B.state.driver;
    setView(`${C.sectionHead('DIREÇÃO DE PROVA','Central esportiva','', 'Protestos e comunicados oficiais em um fluxo único e rastreável.')}<section class="content-grid"><article class="panel">${C.sectionHead('PROTESTOS','Enviar novo protesto','')} ${driver ? `<form id="protestForm" class="form-grid"><div class="form-field"><label>CORRIDA</label><select id="protestRace" required><option value="">Selecione a sessão</option>${B.state.races.filter(r => r.statusKey === 'finished').map(r => `<option value="${B.escape(r.id)}">${B.escape(r.title)} · ${B.escape(r.track)}</option>`).join('')}</select></div><div class="form-field"><label>STEAMID DO PILOTO REPORTADO</label><input id="reportedSteamId" required placeholder="SteamID64"></div><div class="form-field"><label>DESCRIÇÃO DO INCIDENTE</label><textarea id="protestDescription" required placeholder="Volta, curva e descrição objetiva do ocorrido"></textarea></div><div class="form-field"><label>LINK DA EVIDÊNCIA</label><input id="protestVideo" type="url" placeholder="https://"></div><button class="button primary" type="submit">Enviar para análise</button></form>` : C.empty('Login necessário','Conecte a Steam para enviar e acompanhar protestos.','<a class="button primary" href="login.html">Entrar com Steam</a>')}</article><aside class="panel">${C.sectionHead('COMUNICADOS','Direção de prova','')}<div class="history-list">${B.state.notifications.length ? B.state.notifications.slice(0,8).map(item => `<div class="history-row"><span>${B.formatDate(new Date(item.timestamp?.iso || item.createdAt))}</span><div><b>${B.escape(item.title || 'Comunicado BSR')}</b><small>${B.escape(item.message || '')}</small></div><strong>›</strong></div>`).join('') : C.empty('Nenhum comunicado','Decisões e avisos aparecerão aqui.')}</div></aside></section>`);
    document.getElementById('protestForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type=submit]'); button.disabled = true;
      try {
        const targetSteam = document.getElementById('reportedSteamId').value.trim();
        await window.BSR_API.submitRaceReport(document.getElementById('protestRace').value,targetSteam,document.getElementById('protestDescription').value.trim(),document.getElementById('protestVideo').value.trim());
        event.currentTarget.reset(); C.toast('Protesto enviado','A direção de prova recebeu sua solicitação.','success');
      } catch (error) { C.toast('Falha no envio',error.message,'error'); } finally { button.disabled = false; }
    });
  }

  async function raceControl() {
    if (!B.state.isAdmin) throw new Error('Permissão administrativa necessária.');
    setView(`${C.sectionHead('ORGANIZAÇÃO','Lançamento oficial de resultados','', 'Importe, revise e valide a classificação antes de atualizar BSR Rating, Safety, confiabilidade e campeonato.')}<div class="loading-grid"><div class="skeleton"></div><div class="skeleton"></div></div>`);
    const context = await window.BSR_API.getRaceProcessorContext();
    if (B.state.route !== 'race-control') return;
    const recent = context.imports || [];
    setView(`<section class="processor-layout">
      <article class="panel processor-form"><div class="processor-step"><span>01</span><div><b>SESSÃO E ARQUIVOS</b><small>Selecione uma corrida cadastrada e carregue o resultado do Assetto Corsa.</small></div></div>
        <div class="processor-fields"><label class="form-field processor-wide"><span>CORRIDA CADASTRADA</span><select id="processorRace"><option value="">Selecione a corrida</option>${context.races.map(race => `<option value="${B.escape(race.objectId)}" data-track="${B.escape(race.track || '')}" data-date="${B.escape(race.startAt?.iso || race.startAt || race.date?.iso || race.date || '')}">${B.escape(race.title || 'Corrida BSR')} · ${B.escape(race.track || 'Pista a definir')}</option>`).join('')}</select></label>
        <label class="form-field"><span>TIPO DE SESSÃO</span><select id="processorType"><option>RACE</option><option>SPRINT</option><option>FEATURE</option></select></label><label class="form-field"><span>DATA E HORÁRIO</span><input id="processorDate" type="datetime-local"></label><label class="form-field"><span>CURVAS POR VOLTA</span><input id="processorCorners" type="number" min="0" max="1000" value="0" required></label>
        <label class="processor-option"><input id="processorOfficial" type="checkbox" checked><span><b>Sessão oficial</b><small>Atualiza habilidade, Safety e confiabilidade</small></span></label><label class="processor-option"><input id="processorDistance" type="checkbox" checked><span><b>Distância válida</b><small>A prova atingiu o mínimo regulamentar</small></span></label><label class="form-field"><span>GRID MÍNIMO GERAL</span><input id="processorMinimum" type="number" min="2" max="100" value="4"></label><label class="form-field"><span>MÍNIMO POR CLASSE</span><input id="processorClassMinimum" type="number" min="2" max="100" value="3"></label></div>
        <div class="drop-grid"><label class="file-drop"><input id="resultsFile" type="file" accept=".json,application/json"><span>JSON</span><b>results.json</b><small>Formato recomendado · classificação, voltas e tempos</small></label><label class="file-drop"><input id="serverLogFile" type="file" accept=".txt,.log,text/plain"><span>LOG</span><b>Log do servidor</b><small>Alternativa ao JSON · conexões e leaderboard</small></label><label class="file-drop optional"><input id="pluginLogFile" type="file" accept=".txt,.log,text/plain"><span>+</span><b>Log de cortes</b><small>Opcional · avisos de pista</small></label></div>
        <button class="button primary" id="parseRaceFiles" type="button">Ler e validar arquivos</button>
      </article>
      <aside class="panel processor-history">${C.sectionHead('AUDITORIA','Importações recentes','')}<div class="history-list">${recent.length ? recent.map(item => `<div class="history-row"><span>${B.escape(item.status === 'completed' ? 'OK' : String(item.status || '—').toUpperCase())}</span><div><b>${B.escape(item.importKey || item.raceId)}</b><small>${Number(item.driverCount || 0)} pilotos</small></div><strong>${B.formatDate(new Date(item.createdAt))}</strong></div>`).join('') : C.empty('Nenhuma importação','Os lotes publicados aparecerão neste histórico.')}</div></aside>
    </section><section id="processorWorkspace"></section>`);
    let parsed = null;
    let preview = null;
    let previewPayload = null;
    let sourceHash = '';
    const heatField = document.createElement('label');
    heatField.className = 'form-field';
    heatField.innerHTML = '<span>BATERIA</span><input id="processorHeat" value="1" maxlength="32" pattern="[a-zA-Z0-9_-]+"><small>Use um identificador diferente para cada bateria.</small>';
    document.querySelector('.processor-fields').append(heatField);
    const policyFields = document.createElement('details');
    policyFields.className = 'panel';
    policyFields.innerHTML = `<summary>Regulamento de rating da corrida</summary><p>Defina antes da largada. Após o início, as regras ficam bloqueadas.</p><label class="form-field">Carteira mínima do evento<select id="policyLicense">${['R','D','C','B','A','S'].map(value => `<option>${value}</option>`).join('')}</select></label><label class="form-field">Curvas mínimas para MPR<input id="policyCorners" type="number" min="1" value="100"></label><label class="form-field">Incidentes máximos por 100 curvas para MPR<input id="policyIncidents" type="number" min="0" step="0.5" value="4"></label><button class="button" id="saveRatingPolicy" type="button">Salvar regulamento antes da largada</button>`;
    document.querySelector('.processor-form').append(policyFields);
    document.getElementById('saveRatingPolicy').onclick = async () => {
      try {
        await window.BSR_API.setRaceRatingPolicy(document.getElementById('processorRace').value, {
          minimumLicense:document.getElementById('policyLicense').value,
          minimumMprCorners:Number(document.getElementById('policyCorners').value),
          maximumMprIncidentsPer100Corners:Number(document.getElementById('policyIncidents').value),
          minimumStarters:Number(document.getElementById('processorMinimum').value),
          minimumClassStarters:Number(document.getElementById('processorClassMinimum').value)
        });
        invalidatePreview(); C.toast('Regulamento salvo','As próximas prévias usarão estas regras.','success');
      } catch (error) { C.toast('Regulamento não salvo',error.message,'error'); }
    };
    const recentRows = document.querySelectorAll('.processor-history .history-row');
    const calibration = document.createElement('button');
    calibration.className = 'button'; calibration.textContent = 'Analisar calibração';
    calibration.onclick = async () => {
      calibration.disabled = true;
      try {
        const report = await window.BSR_API.getRatingCalibration();
        C.openModal('Calibração com resultados reais', `<p>${report.sampledResults} resultados analisados, limite de ${report.limit}. Nenhum parâmetro foi alterado.</p>${report.groups.map(group => `<p><b>${B.escape(group.group)}</b> · ${group.sessions} sessões<br>CPI mediano: ${group.medianCpi === null ? '—' : Number(group.medianCpi).toFixed(1)} · variação típica SR: ${group.medianSafetyDelta === null ? '—' : Number(group.medianSafetyDelta).toFixed(2)}<br>${B.escape(group.note)}</p>`).join('') || '<p>Ainda não há resultados suficientes.</p>'}`);
      } catch (error) { C.toast('Análise indisponível',error.message,'error'); }
      finally { calibration.disabled = false; }
    };
    document.querySelector('.processor-history').append(calibration);
    const publicationSecurity = document.createElement('button');
    publicationSecurity.className = 'button';
    publicationSecurity.disabled = true;
    publicationSecurity.textContent = 'Verificando publicação segura…';
    document.querySelector('.processor-history').append(publicationSecurity);
    const initializePublication = async () => {
      publicationSecurity.disabled = true;
      publicationSecurity.textContent = 'Ativando publicação segura…';
      try {
        const status = await window.BSR_API.getRatingPublicationStatus();
        if (!status.initialized) await window.BSR_API.initializeRatingPublication();
        publicationSecurity.textContent = 'Publicação segura ativa';
        publicationSecurity.disabled = true;
      } catch (error) {
        publicationSecurity.textContent = 'Tentar ativar publicação segura';
        publicationSecurity.disabled = false;
        C.toast('Proteção de ratings indisponível',error.message,'error');
      }
    };
    publicationSecurity.onclick = initializePublication;
    initializePublication();
    const reconcile = document.createElement('button');
    reconcile.className = 'button'; reconcile.textContent = 'Conferir e restaurar ratings';
    reconcile.onclick = () => C.openModal('Conferir os ratings pelo histórico?', '<p>Perfis divergentes serão restaurados para o último snapshot auditável. Perfis legados sem snapshot completo serão preservados.</p>', async () => {
      const button = document.getElementById('modalConfirm'); button.disabled = true;
      try { const result = await window.BSR_API.rebuildRatingsFromLedger(); C.closeModal(); B.cache.clear(); C.toast('Conferência concluída',`${result.inspected} perfis conferidos; ${result.repaired} restaurados.`,'success'); }
      catch (error) { button.disabled = false; C.toast('Conferência interrompida',error.message,'error'); }
    }, 'Conferir e restaurar');
    document.querySelector('.processor-history').append(reconcile);
    recent.forEach((item,index) => {
      const host = recentRows[index]; if (!host) return;
      if (['failed','processing'].includes(item.status)) {
        const button = document.createElement('button'); button.className = 'button'; button.textContent = 'Retomar';
        button.onclick = async () => {
          button.disabled = true;
          try { await window.BSR_API.resumeRaceImport(item.objectId); C.toast('Publicação retomada','Os valores salvos foram aplicados.','success'); await raceControl(); }
          catch (error) { C.toast('Retomada não concluída',error.message,'error'); button.disabled = false; }
        };
        host.append(button);
      }
      if (item.status === 'completed') {
        const button = document.createElement('button'); button.className = 'button'; button.textContent = 'Anular';
        button.onclick = () => C.openModal('Anular publicação?', '<p>Os ratings voltarão ao estado anterior. Anule da publicação mais recente para a mais antiga. O histórico permanecerá auditável.</p><label class="form-field">Motivo<textarea id="voidRatingReason" minlength="10"></textarea></label>', async () => {
          const confirm = document.getElementById('modalConfirm'); confirm.disabled = true;
          try { await window.BSR_API.voidLatestRaceImport(item.objectId,document.getElementById('voidRatingReason').value); C.closeModal(); B.cache.clear(); await raceControl(); }
          catch (error) { C.toast('Anulação não concluída',error.message,'error'); confirm.disabled = false; }
        }, 'Anular e restaurar ratings');
        host.append(button);
      }
    });
    const invalidatePreview = () => {
      previewPayload = null;
      document.querySelector('.processor-preview')?.remove();
    };
    document.querySelector('.processor-fields').addEventListener('change', invalidatePreview);
    document.querySelectorAll('.file-drop input').forEach(input => input.addEventListener('change', () => { parsed = null; sourceHash = ''; invalidatePreview(); document.getElementById('processorWorkspace').innerHTML = ''; }));
    const readFile = input => new Promise((resolve, reject) => { const file = input.files?.[0]; if (!file) return resolve(''); const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`)); reader.readAsText(file); });
    const selectedRace = () => document.getElementById('processorRace').selectedOptions[0];
    document.getElementById('processorRace').addEventListener('change', () => {
      const option = selectedRace(); const value = option?.dataset.date;
      if (value) { const date = new Date(value); if (!Number.isNaN(date.getTime())) document.getElementById('processorDate').value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16); }
      const policy = context.races.find(race => race.objectId === option.value)?.ratingPolicy || {};
      document.getElementById('processorMinimum').value = policy.minimumStarters || 4;
      document.getElementById('processorClassMinimum').value = policy.minimumClassStarters || 3;
      document.getElementById('policyLicense').value = policy.minimumLicense || 'R';
      document.getElementById('policyCorners').value = policy.minimumMprCorners || 100;
      document.getElementById('policyIncidents').value = policy.maximumMprIncidentsPer100Corners ?? 4;
      const frozen = !value || new Date(value) <= new Date();
      for (const id of ['processorMinimum','processorClassMinimum','policyLicense','policyCorners','policyIncidents','saveRatingPolicy']) document.getElementById(id).disabled = frozen;
    });
    document.querySelectorAll('.file-drop input').forEach(input => input.addEventListener('change', () => { const label = input.closest('.file-drop'); label.classList.toggle('has-file', Boolean(input.files?.length)); if (input.files?.[0]) label.querySelector('b').textContent = input.files[0].name; }));

    const collectPayload = () => ({ raceId:document.getElementById('processorRace').value, sessionType:document.getElementById('processorType').value,
      heat:document.getElementById('processorHeat').value.trim(), sourceHash,
      sessionDate:document.getElementById('processorDate').value ? new Date(document.getElementById('processorDate').value).toISOString() : new Date().toISOString(),
      track:parsed?.track || selectedRace()?.dataset.track || 'Pista não identificada', cornersPerLap:Number(document.getElementById('processorCorners').value || 0),
      official:document.getElementById('processorOfficial').checked, distanceValid:document.getElementById('processorDistance').checked,
      minimumStarters:Number(document.getElementById('processorMinimum').value || 4), minimumClassStarters:Number(document.getElementById('processorClassMinimum').value || 3), drivers:parsed?.drivers || [] });
    const renderDrivers = () => {
      const root = document.getElementById('processorWorkspace');
      const parserWarnings = (parsed.warnings || []).map(message => `<div class="processor-guidance processor-file-note"><b>Arquivo corrigido</b><span>${B.escape(message)}</span></div>`).join('');
      root.innerHTML = `<article class="panel processor-review"><div class="processor-review-head"><div class="processor-step"><span>02</span><div><b>REVISÃO DO GRID</b><small>${parsed.drivers.length} pilotos · ${B.escape(parsed.track)}. Posição, status e pontos de incidente devem refletir a decisão oficial.</small></div></div><button class="button primary" id="previewImport" type="button">Calcular prévia</button></div>${parserWarnings}<div class="processor-guidance"><b>Como revisar</b><span>1x saída de pista · 2x rodada/contato leve · 4x contato forte. Abandono só deve ser usado quando a desconexão for confirmada.</span></div><div class="table-wrap"><table class="data-table processor-table"><thead><tr><th>POS</th><th>PILOTO / STEAMID</th><th>CLASSE / CARRO</th><th>VOLTAS</th><th>PONTOS INC.</th><th>STATUS</th><th>PENALIDADE</th></tr></thead><tbody>${parsed.drivers.map((driver,index) => `<tr data-driver-row="${index}"><td><input data-field="finishPosition" type="number" min="1" value="${driver.finishPosition}"></td><td><b>${B.escape(driver.name)}</b><small>${B.escape(driver.steamGUID || 'SteamID não detectado')}</small></td><td><input data-field="carClass" value="${B.escape(driver.carClass)}"><small>${B.escape(driver.carModel || 'Modelo não detectado')}</small></td><td><input data-field="lapsCompleted" type="number" min="0" value="${driver.lapsCompleted}"></td><td><input data-field="incidentPoints" type="number" min="0" step="0.5" value="${Number(driver.incidentPoints ?? driver.incidents ?? 0)}"></td><td><select data-field="status"><option value="finished" ${!driver.isDNF && !driver.isDSQ ? 'selected' : ''}>Finalizou</option><option value="dnf" ${driver.isDNF && !driver.isRageQuit ? 'selected' : ''}>DNF</option><option value="rage" ${driver.isRageQuit ? 'selected' : ''}>Desconectou/abandonou</option><option value="dsq" ${driver.isDSQ ? 'selected' : ''}>DSQ</option></select></td><td><select data-penalty>${Object.entries(window.BSRRaceProcessor.penalties).map(([key,item]) => `<option value="${key}">${B.escape(item.label)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div></article>`;
      root.querySelectorAll('[data-driver-row]').forEach(row => {
        const driver = parsed.drivers[Number(row.dataset.driverRow)];
        const status = row.querySelector('[data-field="status"]');
        status.querySelector('[value="rage"]').textContent = 'Abandono confirmado';
        for (const [value, label] of [['disconnected','Desconexão técnica'],['dns','Não largou'],['server','Falha do servidor']]) {
          const option = document.createElement('option'); option.value = value; option.textContent = label; status.append(option);
        }
        if (driver.didNotStart) status.value = 'dns';
        else if (driver.disconnected && !driver.isRageQuit) status.value = 'disconnected';
        row.querySelectorAll('[data-field]').forEach(input => input.addEventListener('change', () => {
          invalidatePreview();
          const field = input.dataset.field;
          if (field === 'status') { driver.isDNF = ['dnf','rage','disconnected','server'].includes(input.value); driver.isRageQuit = input.value === 'rage'; driver.disconnected = ['rage','disconnected','server'].includes(input.value); driver.isDSQ = input.value === 'dsq'; driver.didNotStart = input.value === 'dns'; driver.serverFailure = input.value === 'server'; }
          else driver[field] = input.type === 'number' ? Number(input.value) : input.value;
          if (field === 'incidentPoints') driver.incidentEvidence = 'reviewed';
        }));
        row.querySelector('[data-penalty]').addEventListener('change', event => { invalidatePreview(); const penalty = window.BSRRaceProcessor.penalties[event.target.value]; driver.penaltySeconds=penalty.seconds; driver.penaltyIncidents=penalty.incidents; driver.penaltyReason=event.target.value === 'none' ? '' : penalty.label; });
      });
      document.getElementById('previewImport').addEventListener('click', calculatePreview);
    };
    const calculatePreview = async event => {
      const button = event.currentTarget; button.disabled = true; button.textContent = 'Calculando…';
      try {
        const payload = JSON.parse(JSON.stringify(collectPayload()));
        const withoutSteam = payload.drivers.filter(driver => !driver.steamGUID);
        if (payload.official && withoutSteam.length) throw new Error(`SteamID ausente para ${withoutSteam.slice(0,3).map(driver => driver.name).join(', ')}${withoutSteam.length > 3 ? '…' : ''}. Corrija o arquivo ou publique como sessão não oficial.`);
        if (payload.official && !payload.cornersPerLap && payload.drivers.some(driver => !driver.cornersCompleted && driver.lapsCompleted > 0)) throw new Error('Informe as curvas por volta para calcular o Safety Rating.');
        preview = await window.BSR_API.previewRaceImport(payload);
        if (preview.duplicate) throw new Error('Esta sessão já foi publicada. O sistema bloqueou a duplicação.');
        previewPayload = { ...payload, previewToken:preview.previewToken };
        const root = document.getElementById('processorWorkspace'); const review = root.querySelector('.processor-review');
        root.querySelector('.processor-preview')?.remove();
        review.insertAdjacentHTML('afterend', `<article class="panel processor-preview"><div class="processor-review-head"><div class="processor-step"><span>03</span><div><b>PRÉVIA OFICIAL · ${B.escape(preview.engineVersion || 'BSR v3')}</b><small>${preview.totals.drivers} pilotos · ${preview.totals.rated} válidos para habilidade · SOF ${Number(preview.totals.strengthOfField || 0).toLocaleString('pt-BR')} · ${preview.totals.incidents}x</small></div></div><button class="button primary" id="commitImport" type="button">Publicar resultados</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>POS</th><th>PILOTO</th><th>CLASSE</th><th>PONTOS</th><th>BSR RATING</th><th>SAFETY</th><th>CONFIAB.</th><th>CARTEIRA</th></tr></thead><tbody>${preview.rows.map(row => `<tr><td class="position ${row.officialPosition <= 3 ? 'podium' : ''}">${row.officialPosition}</td><td><b>${B.escape(row.name)}</b><small>${row.isDSQ ? 'DSQ' : row.isRageQuit ? 'Abandono confirmado' : row.isDNF ? 'DNF' : row.ratingReason}</small></td><td>${B.escape(row.carClass)} · P${row.classPosition}<small>${B.escape(String(row.discipline || 'road').toUpperCase())} · esperado P${Number(row.expectedFinish || 0).toFixed(1)}</small></td><td>${row.points}</td><td>${Number(row.oldIRating).toLocaleString('pt-BR')} <strong class="delta ${row.deltaIRating >= 0 ? 'positive' : 'negative'}">${row.deltaIRating >= 0 ? '+' : ''}${row.deltaIRating}</strong></td><td>${Number(row.oldSafetyRating).toFixed(2)} → ${Number(row.newSafetyRating).toFixed(2)}<small>${Number(row.incidentPoints || 0)}x · CPI ${Number(row.safetyCpi || 0).toFixed(1)}</small></td><td>${Number(row.reliability || 0)}%<small>${B.escape(row.contactBadge || 'Rookie')}</small></td><td><span class="license">${B.escape(row.oldLicense)} → ${B.escape(row.newLicense)}</span><small>${row.mprEligible ? `MPR ${Number(row.licenseMPR || 0)}` : 'MPR não contado'}</small></td></tr>`).join('')}</tbody></table></div></article>`);
        const provisioned = Array.isArray(preview.provisionedDrivers) ? preview.provisionedDrivers : [];
        const explanation = document.createElement('div');
        explanation.className = 'processor-guidance processor-file-note';
        explanation.innerHTML = `<b>Regulamento e evidências</b><span>${(preview.warnings || []).map(B.escape).join(' · ') || 'Validações documentais concluídas.'}</span>`;
        root.querySelector('.processor-preview').append(explanation);
        const details = document.createElement('details');
        details.innerHTML = `<summary>Por que cada rating mudou?</summary><div class="table-wrap"><table class="data-table"><thead><tr><th>Piloto</th><th>Curvas</th><th>Janela SR</th><th>MPR / confiabilidade</th></tr></thead><tbody>${preview.rows.map(row => `<tr><td>${B.escape(row.name)}</td><td>${Number(row.countedCorners || 0)}</td><td>${Number(row.safetyWindowCorners || 0)} curvas / ${Number(row.safetyWindowIncidents || 0)}x</td><td>${B.escape((row.mprReasons || []).join('; ') || 'Elegível para MPR')} ${B.escape(row.reliabilityReason || '')}</td></tr>`).join('')}</tbody></table></div>`;
        root.querySelector('.processor-preview').append(details);
        if (provisioned.length) {
          const previewNode = root.querySelector('.processor-preview');
          previewNode.querySelector('.processor-review-head').insertAdjacentHTML('afterend', `<div class="processor-guidance processor-file-note"><b>${provisioned.length} ${provisioned.length === 1 ? 'perfil preparado' : 'perfis preparados'} automaticamente</b><span>Esses participantes ainda não tinham perfil de rating. Nenhuma conta de acesso foi criada; os históricos foram vinculados aos SteamIDs e serão associados quando entrarem no Hub.</span></div>`);
        }
        document.getElementById('commitImport').addEventListener('click', confirmCommit);
        document.querySelector('.processor-preview').scrollIntoView({behavior:'smooth',block:'start'});
      } catch (error) { C.toast('Prévia não gerada',error.message,'error'); } finally { button.disabled = false; button.textContent = 'Calcular prévia'; }
    };
    const confirmCommit = () => C.openModal('Publicar resultados oficiais?', `<div class="confirm-copy"><p>Esta ação gravará a classificação e atualizará BSR Rating, Safety, confiabilidade, licença e campeonato de <strong>${preview.rows.length} pilotos</strong>.</p><p>O cálculo será registrado em um ledger imutável e a mesma sessão não poderá ser publicada novamente.</p></div>`, async () => {
      const button = document.getElementById('modalConfirm'); button.disabled = true; button.textContent = 'Publicando…';
      try { if (!previewPayload) throw new Error('Gere uma prévia válida antes de publicar.'); const result = await window.BSR_API.commitRaceImport(previewPayload); C.closeModal(); B.cache.clear(); C.toast('Resultados publicados',`${result.results} classificações foram gravadas com segurança.`,'success'); await raceControl(); }
      catch (error) { button.disabled = false; button.textContent = 'Publicar resultados'; C.toast('Publicação interrompida',error.message,'error'); }
    }, 'Publicar resultados');
    document.getElementById('parseRaceFiles').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true; button.textContent = 'Lendo arquivos…';
      try {
        if (!document.getElementById('processorRace').value) throw new Error('Selecione a corrida cadastrada.');
        const [json, log, plugin] = await Promise.all([readFile(document.getElementById('resultsFile')),readFile(document.getElementById('serverLogFile')),readFile(document.getElementById('pluginLogFile'))]);
        if (!json && !log) throw new Error('Carregue o results.json ou o log do servidor.');
        parsed = json ? window.BSRRaceProcessor.parseResultsJson(json) : window.BSRRaceProcessor.parseServerLog(log, plugin);
        sourceHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json || log)))].map(byte => byte.toString(16).padStart(2,'0')).join('');
        if (parsed.sessionDate) { const date = new Date(parsed.sessionDate); if (!Number.isNaN(date.getTime())) { document.getElementById('processorDate').step = '1'; document.getElementById('processorDate').value = new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,19); } }
        document.getElementById('processorType').value = ['RACE','SPRINT','FEATURE'].includes(parsed.sessionType) ? parsed.sessionType : 'RACE'; renderDrivers();
      } catch (error) { C.toast('Arquivo não processado',error.message,'error'); } finally { button.disabled = false; button.textContent = 'Ler e validar arquivos'; }
    });
  }

  function localDateTimeValue(race) {
    const date = race?.dateObject || B.parseDate(race);
    if (!date || Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  }

  function raceDurationInputValue(race) {
    const value = race?.duration ?? race?.raceDuration ?? '';
    const match = String(value).trim().replace(',', '.').match(/\d+(?:\.\d+)?/);
    return match ? match[0] : '';
  }

  function openAdminRaceEditor(race = null) {
    const editing = Boolean(race?.id || race?.objectId);
    C.openModal(editing ? 'Editar corrida' : 'Criar corrida', `<form id="adminRaceForm" class="form-grid admin-race-form">
      <div class="form-field"><label>TÍTULO</label><input id="adminRaceTitle" maxlength="140" required value="${B.escape(race?.title || '')}"></div>
      <div class="form-field"><label>PISTA</label><input id="adminRaceTrack" maxlength="140" required value="${B.escape(race?.track || '')}"></div>
      <div class="form-field"><label>DATA E HORÁRIO</label><input id="adminRaceStart" type="datetime-local" required value="${B.escape(localDateTimeValue(race))}"></div>
      <div class="form-field"><label>CATEGORIA</label><input id="adminRaceCategory" maxlength="100" required value="${B.escape(race?.category || '')}"></div>
      <div class="form-field"><label>STATUS</label><select id="adminRaceStatus"><option value="em_breve" ${race?.status === 'em_breve' ? 'selected' : ''}>Em breve</option><option value="aberta" ${race?.status === 'aberta' ? 'selected' : ''}>Aberta</option><option value="fechada" ${race?.status === 'fechada' ? 'selected' : ''}>Fechada</option><option value="encerrada" ${race?.status === 'encerrada' ? 'selected' : ''}>Encerrada</option><option value="cancelada" ${race?.status === 'cancelada' ? 'selected' : ''}>Cancelada</option></select></div>
      <div class="form-field"><label>TIPO</label><select id="adminRaceType"><option value="fun" ${race?.raceType === 'fun' ? 'selected' : ''}>Fun Race</option><option value="ranked" ${race?.raceType === 'ranked' ? 'selected' : ''}>Ranqueada</option><option value="championship" ${race?.raceType === 'championship' ? 'selected' : ''}>Campeonato</option></select></div>
      <div class="form-field"><label>DURAÇÃO EM MINUTOS</label><input id="adminRaceDuration" type="number" min="1" max="1440" value="${B.escape(raceDurationInputValue(race))}"></div>
      <div class="form-field"><label>MÁXIMO DE PILOTOS</label><input id="adminRaceSlots" type="number" min="1" max="500" value="${B.escape(race?.maxDrivers || race?.maxSlots || '')}"></div>
      <div class="form-field admin-field-wide"><label>IMAGEM DE CAPA HTTPS</label><input id="adminRaceImage" type="url" value="${B.escape(race?.bannerUrl || race?.image || '')}"></div>
      <div class="form-field"><label>ID DA SESSÃO</label><input id="adminRaceSession" maxlength="120" value="${B.escape(race?.sessionId || '')}"></div>
      <label class="admin-toggle"><input id="adminRaceRegistration" type="checkbox" ${race ? race.requiresRegistration !== false ? 'checked' : '' : ''}><span><b>Exigir inscrição prévia</b><small>Desmarcado permite acesso livre após validar os conteúdos.</small></span></label>
      <div class="form-field admin-field-wide"><label>DESCRIÇÃO E BRIEFING</label><textarea id="adminRaceDescription" maxlength="1500">${B.escape(race?.description || '')}</textarea></div>
    </form>`, async () => {
      const button = document.getElementById('modalConfirm');
      const form = document.getElementById('adminRaceForm');
      if (!form.reportValidity()) return;
      button.disabled = true; button.textContent = 'Salvando…';
      try {
        const start = new Date(document.getElementById('adminRaceStart').value);
        if (Number.isNaN(start.getTime())) throw new Error('Informe uma data válida.');
        const date = start.toLocaleDateString('pt-BR');
        const time = start.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
        const payload = {
          title:document.getElementById('adminRaceTitle').value.trim(), track:document.getElementById('adminRaceTrack').value.trim(),
          category:document.getElementById('adminRaceCategory').value.trim(), status:document.getElementById('adminRaceStatus').value,
          raceType:document.getElementById('adminRaceType').value, duration:document.getElementById('adminRaceDuration').value.trim(),
          maxDrivers:Number(document.getElementById('adminRaceSlots').value || 0) || null, image:document.getElementById('adminRaceImage').value.trim(),
          sessionId:document.getElementById('adminRaceSession').value.trim(), description:document.getElementById('adminRaceDescription').value.trim(),
          requiresRegistration:document.getElementById('adminRaceRegistration').checked, date, time,
          startAt:{__type:'Date',iso:start.toISOString()}
        };
        await window.BSR_API.saveAdminRace(payload, race?.id || race?.objectId || '');
        C.closeModal(); B.cache.clear(); await B.loadRaces(true);
        C.toast('Corrida salva',`${payload.title} foi sincronizada com o calendário.`,'success');
        await admin();
      } catch (error) { button.disabled = false; button.textContent = 'Salvar corrida'; C.toast('Corrida não salva',error.message,'error'); }
    }, 'Salvar corrida');
  }

  function renderAdminLogin() {
    setView(`<section class="admin-auth-stage"><div class="admin-auth-ambient" aria-hidden="true"><i></i><i></i><i></i></div><article class="admin-login-surface"><header class="admin-login-brand"><span class="admin-brand-seal"><img src="assets/foto/bsr.png" alt="Brasil Sim Racing"></span><small>CENTRAL DA ORGANIZAÇÃO</small></header><div class="admin-login-copy"><span>ACESSO RESTRITO</span><h2>Login administrativo</h2><p>Bem-vindo de volta à central de operações BSR.</p></div><form id="launcherAdminLogin" class="admin-login-form"><label class="admin-line-field"><span>Usuário administrativo</span><div><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"></circle><path d="M5 20c.5-4 3-6 7-6s6.5 2 7 6"></path></svg><input id="launcherAdminUser" autocomplete="username" spellcheck="false" required></div></label><label class="admin-line-field"><span>Senha</span><div><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg><input id="launcherAdminPassword" type="password" autocomplete="current-password" required><button id="adminPasswordToggle" class="admin-password-toggle" type="button" aria-label="Mostrar senha" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg></button></div></label><label class="admin-remember"><input id="launcherAdminRemember" type="checkbox" checked><span>Manter sessão administrativa neste dispositivo</span></label><button class="admin-login-submit" id="launcherAdminSubmit" type="submit"><span>Entrar na administração</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M14 7l5 5-5 5"></path></svg></button><p id="launcherAdminError" class="admin-login-error" role="alert"></p></form>${B.state.driver ? `<div class="admin-current-driver"><img src="${B.escape(B.avatar(B.state.driver))}" alt=""><span><small>SESSÃO STEAM PRESERVADA</small><b>${B.escape(B.state.driver.name)}</b></span><i>✓</i></div>` : ''}<footer class="admin-login-footer"><span>ROLE ADMIN OBRIGATÓRIA</span><i></i><span>SESSÃO PROTEGIDA</span><i></i><span>BSR NETWORK</span></footer></article></section>`);
    const passwordInput = document.getElementById('launcherAdminPassword');
    document.getElementById('adminPasswordToggle').addEventListener('click', event => {
      const visible = passwordInput.type === 'text';
      passwordInput.type = visible ? 'password' : 'text';
      event.currentTarget.setAttribute('aria-pressed', String(!visible));
      event.currentTarget.setAttribute('aria-label', visible ? 'Mostrar senha' : 'Ocultar senha');
      passwordInput.focus();
    });
    document.getElementById('launcherAdminLogin').addEventListener('submit', async event => {
      event.preventDefault();
      const button = document.getElementById('launcherAdminSubmit'); const errorNode = document.getElementById('launcherAdminError');
      button.disabled = true; button.textContent = 'Validando role…'; errorNode.textContent = '';
      try {
        await window.BSR_API.enterAdminMode(document.getElementById('launcherAdminUser').value.trim(),document.getElementById('launcherAdminPassword').value,document.getElementById('launcherAdminRemember').checked);
        location.reload();
      } catch (error) { errorNode.textContent = error.message; button.disabled = false; button.textContent = 'Entrar na administração'; }
    });
  }

  async function admin() {
    if (!B.state.isAdmin) { renderAdminLogin(); return; }
    setView(`${C.sectionHead('ORGANIZAÇÃO','Central administrativa','', 'Carregando calendário, catálogo, auditoria e integridade operacional.')}<div class="loading-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`);
    const [contentResult,processorResult,auditResult,reportsResult,driversResult,accessResult] = await Promise.allSettled([
      window.BSR_API.getContentAdminContext(), window.BSR_API.getRaceProcessorContext(), window.BSR_API.getAdminAudit(10), window.BSR_API.getAdminReports(200), B.loadDrivers(), window.BSR_API.getHubAccessAdminContext()
    ]);
    if (B.state.route !== 'admin') return;
    const contentContext = contentResult.status === 'fulfilled' ? contentResult.value : { packages:[], races:[] };
    const processorContext = processorResult.status === 'fulfilled' ? processorResult.value : { imports:[] };
    const audits = auditResult.status === 'fulfilled' ? auditResult.value : [];
    const reports = reportsResult.status === 'fulfilled' ? reportsResult.value : [];
    const drivers = driversResult.status === 'fulfilled' ? driversResult.value : B.state.drivers;
    const accessContext = accessResult.status === 'fulfilled' ? accessResult.value : { mode:'open', grants:[], candidates:[] };
    const activeGrants = accessContext.grants.filter(item => item.enabled !== false);
    const accessRestricted = accessContext.mode === 'invite';
    const races = B.sortRaces(B.state.races,'new');
    const configured = new Set((contentContext.races || []).filter(item => item.serverHost && item.requestedCar).map(item => item.objectId));
    const pendingReports = reports.filter(item => String(item.status || 'pending').toLowerCase() === 'pending').length;
    const session = window.BSR_API.readSession();
    setView(`<section class="admin-command-header"><div><span>SESSÃO ADMINISTRATIVA VERIFICADA</span><h2>${B.escape(B.state.admin?.username || session?.username || 'Administrador BSR')}</h2><p>Role validada pelo Cloud Code · operações registradas no AuditLog</p></div><button class="button" id="leaveAdminMode" type="button">${window.BSR_API.hasDriverSessionToRestore() ? 'Voltar ao perfil do piloto' : 'Sair da administração'}</button></section>
      <section class="admin-stat-grid"><article><small>CORRIDAS</small><strong>${races.length}</strong><span>${races.filter(item => ['open','upcoming'].includes(item.statusKey)).length} próximas/abertas</span></article><article><small>PILOTOS</small><strong>${drivers.length}</strong><span>perfis públicos canônicos</span></article><article><small>CONTEÚDOS</small><strong>${contentContext.packages.length}</strong><span>${configured.size} servidores configurados</span></article><article><small>PROTESTOS</small><strong>${pendingReports}</strong><span>aguardando análise</span></article><article><small>ACESSO</small><strong>${accessRestricted ? activeGrants.length : 'OPEN'}</strong><span>${accessRestricted ? 'pilotos liberados' : 'aberto a todos'}</span></article></section>
      <section class="admin-workflow-grid"><a href="#/content" class="admin-workflow-card"><span>01</span><div><small>BIBLIOTECA</small><h3>Conteúdos e servidores</h3><p>Publique carros, pistas e skins; associe requisitos e conexão a cada corrida.</p></div><b>ABRIR →</b></a><a href="#/race-control" class="admin-workflow-card"><span>02</span><div><small>RESULTADOS</small><h3>Processador oficial</h3><p>Revise a classificação e publique BSR Rating v3, Safety, carteiras e pontos.</p></div><b>ABRIR →</b></a><button type="button" id="repairAdminIdentities" class="admin-workflow-card"><span>03</span><div><small>IDENTIDADES</small><h3>Sincronizar pilotos</h3><p>Consolide cadastros duplicados e recupere nomes e avatares da Steam.</p></div><b>EXECUTAR →</b></button><button type="button" id="migrateAdminRatings" class="admin-workflow-card"><span>04</span><div><small>RATINGS</small><h3>Inicializar motor v3</h3><p>Preserve valores atuais e prepare ratings, Safety e carteiras por disciplina.</p></div><b>INICIALIZAR →</b></button></section>
      <section class="panel hub-access-admin-panel"><div class="section-head hub-access-admin-head"><div><span>ACESSO AO HUB</span><h2>Convites da fase inicial</h2><p>Cadastre os pilotos antes de ativar o modo restrito. Administradores sempre mantêm acesso.</p></div><div class="hub-access-mode"><span class="tag ${accessRestricted ? 'green' : ''}">${accessRestricted ? 'SOMENTE CONVIDADOS' : 'ABERTO A TODOS'}</span><button class="button ${accessRestricted ? '' : 'primary'}" id="hubAccessModeToggle" type="button">${accessRestricted ? 'Abrir para todos' : 'Ativar acesso restrito'}</button></div></div>
        <form id="hubAccessGrantForm" class="hub-access-grant-form"><label><span>SteamID64 ou piloto</span><input id="hubAccessSteamId" list="hubAccessCandidates" inputmode="numeric" pattern="[0-9]{17}" maxlength="17" placeholder="7656119..." required><datalist id="hubAccessCandidates">${accessContext.candidates.map(item => `<option value="${B.escape(item.steamId)}">${B.escape(item.name)}</option>`).join('')}</datalist></label><label><span>Identificação</span><input id="hubAccessLabel" maxlength="100" placeholder="Nome do piloto"></label><label><span>Observação</span><input id="hubAccessNote" maxlength="240" placeholder="Ex.: teste fechado"></label><button class="button primary" type="submit">Liberar acesso</button></form>
        <div class="table-wrap"><table class="data-table hub-access-table"><thead><tr><th>PILOTO</th><th>STEAMID64</th><th>OBSERVAÇÃO</th><th>STATUS</th><th>AÇÃO</th></tr></thead><tbody>${accessContext.grants.length ? accessContext.grants.map(item => `<tr><td><b>${B.escape(item.label || 'Piloto convidado')}</b></td><td>${B.escape(item.steamId)}</td><td>${B.escape(item.note || '—')}</td><td><span class="admin-health ${item.enabled !== false ? 'ready' : ''}">${item.enabled !== false ? 'Liberado' : 'Revogado'}</span></td><td><button class="button" type="button" data-hub-grant="${B.escape(item.steamId)}" data-enabled="${item.enabled !== false ? 'false' : 'true'}">${item.enabled !== false ? 'Revogar' : 'Reativar'}</button></td></tr>`).join('') : '<tr><td colspan="5">Nenhum piloto convidado. Cadastre ao menos um antes de restringir o hub.</td></tr>'}</tbody></table></div>
      </section>
      <section class="admin-console-grid"><article class="panel admin-races-panel"><div class="section-head"><div><span>CALENDÁRIO</span><h2>Gerenciar corridas</h2><p>Cadastro esportivo e acesso ao Content Manager no mesmo fluxo.</p></div><button class="button primary" id="newAdminRace" type="button">+ Nova corrida</button></div><div class="table-wrap"><table class="data-table admin-race-table"><thead><tr><th>CORRIDA</th><th>DATA</th><th>STATUS</th><th>ACESSO</th><th>CONTEÚDO</th><th>AÇÕES</th></tr></thead><tbody>${races.slice(0,20).map(race => `<tr><td><b>${B.escape(race.title)}</b><small>${B.escape(race.track)} · ${B.escape(race.category)}</small></td><td>${B.escape(race.dateLabel)}<small>${B.escape(race.timeLabel)}</small></td><td><span class="tag ${race.statusKey === 'open' ? 'green' : ''}">${B.escape(race.statusKey.toUpperCase())}</span></td><td>${race.requiresRegistration ? 'Inscrição' : 'Livre'}</td><td><span class="admin-health ${configured.has(race.id) ? 'ready' : ''}">${configured.has(race.id) ? 'Configurado' : 'Pendente'}</span></td><td><div class="admin-table-actions"><button type="button" data-admin-edit-race="${B.escape(race.id)}">Editar</button><button type="button" data-admin-content-race="${B.escape(race.id)}">Requisitos</button></div></td></tr>`).join('') || '<tr><td colspan="6">Nenhuma corrida cadastrada.</td></tr>'}</tbody></table></div></article>
      <aside class="panel admin-audit-panel">${C.sectionHead('AUDITORIA','Atividade recente','')}<div class="history-list">${audits.length ? audits.map(item => `<div class="history-row"><span>${B.escape(String(item.action || 'AÇÃO').toUpperCase().slice(0,12))}</span><div><b>${B.escape(item.target || 'Operação administrativa')}</b><small>${B.escape(item.admin || 'admin')}</small></div><strong>${B.formatDate(new Date(item.timestamp?.iso || item.createdAt))}</strong></div>`).join('') : C.empty('Sem eventos recentes','As próximas operações administrativas aparecerão aqui.')}</div><div class="admin-import-summary"><small>IMPORTAÇÕES CONCLUÍDAS</small><strong>${(processorContext.imports || []).filter(item => item.status === 'completed').length}</strong></div></aside></section>`);
    document.getElementById('leaveAdminMode').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true; button.textContent = 'Encerrando…';
      const restored = session?.kind === 'admin' ? await window.BSR_API.leaveAdminMode() : (await window.BSR_API.logout(), null);
      if (!restored) for (const storage of [sessionStorage,localStorage]) ['steamId','steamName','steamAvatar'].forEach(key => storage.removeItem(key));
      location.hash = '#/dashboard'; location.reload();
    });
    document.getElementById('newAdminRace').addEventListener('click', () => openAdminRaceEditor());
    document.querySelectorAll('[data-admin-edit-race]').forEach(button => button.addEventListener('click', () => openAdminRaceEditor(B.state.races.find(item => item.id === button.dataset.adminEditRace))));
    document.querySelectorAll('[data-admin-content-race]').forEach(button => button.addEventListener('click', () => { sessionStorage.setItem('bsr_admin_content_race',button.dataset.adminContentRace); location.hash = '#/content'; }));
    const accessCandidates = new Map(accessContext.candidates.map(item => [String(item.steamId), item]));
    document.getElementById('hubAccessSteamId').addEventListener('input', event => {
      const candidate = accessCandidates.get(event.target.value.trim());
      if (candidate && !document.getElementById('hubAccessLabel').value.trim()) document.getElementById('hubAccessLabel').value = candidate.name;
    });
    document.getElementById('hubAccessGrantForm').addEventListener('submit', async event => {
      event.preventDefault(); const button = event.currentTarget.querySelector('[type=submit]'); button.disabled = true; button.textContent = 'Liberando…';
      try {
        await window.BSR_API.setHubAccessGrant({ steamId:document.getElementById('hubAccessSteamId').value.trim(), label:document.getElementById('hubAccessLabel').value.trim(), note:document.getElementById('hubAccessNote').value.trim(), enabled:true });
        C.toast('Acesso liberado','O piloto já pode entrar no BSR Hub com a Steam.','success'); await admin();
      } catch (error) { button.disabled = false; button.textContent = 'Liberar acesso'; C.toast('Acesso não alterado',error.message,'error'); }
    });
    document.querySelectorAll('[data-hub-grant]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await window.BSR_API.setHubAccessGrant({ steamId:button.dataset.hubGrant, enabled:button.dataset.enabled === 'true' }); C.toast('Lista atualizada','A permissão foi sincronizada.','success'); await admin(); }
      catch (error) { button.disabled = false; C.toast('Permissão não alterada',error.message,'error'); }
    }));
    document.getElementById('hubAccessModeToggle').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true; button.textContent = 'Aplicando…';
      try { const next = accessRestricted ? 'open' : 'invite'; await window.BSR_API.setHubAccessMode(next); C.toast('Modo de acesso atualizado',next === 'invite' ? 'Apenas pilotos liberados podem abrir o hub.' : 'O hub está aberto para todos.','success'); B.cache.clear(); await B.loadHubAccess(); await admin(); }
      catch (error) { button.disabled = false; button.textContent = accessRestricted ? 'Abrir para todos' : 'Ativar acesso restrito'; C.toast('Modo não alterado',error.message,'error'); }
    });
    document.getElementById('repairAdminIdentities').addEventListener('click', async event => {
      const button = event.currentTarget; const label = button.querySelector('b'); button.disabled = true; label.textContent = 'PROCESSANDO…';
      try { const result = await window.BSR_API.repairDriverIdentities(25); B.cache.clear(); C.toast('Identidades sincronizadas',`${result.repaired} perfil(is) corrigido(s)${result.remaining ? ` · ${result.remaining} restantes` : ''}.`,'success'); label.textContent = result.remaining ? 'EXECUTAR NOVO LOTE →' : 'CONCLUÍDO'; button.disabled = !result.remaining; }
      catch (error) { button.disabled = false; label.textContent = 'TENTAR NOVAMENTE →'; C.toast('Sincronização interrompida',error.message,'error'); }
    });
    document.getElementById('migrateAdminRatings').addEventListener('click', async event => {
      const button = event.currentTarget; const label = button.querySelector('b'); button.disabled = true; label.textContent = 'INICIALIZANDO…';
      try { const result = await window.BSR_API.migrateRatingsV3(); B.cache.clear(); C.toast('Motor de ratings preparado',`${result.migrated} de ${result.inspected} perfil(is) inicializado(s) em ${result.version}.`,'success'); label.textContent = 'CONCLUÍDO'; }
      catch (error) { button.disabled = false; label.textContent = 'TENTAR NOVAMENTE →'; C.toast('Migração interrompida',error.message,'error'); }
    });
  }

  function settings() {
    const session = window.BSR_API.readSession();
    setView(`${C.sectionHead('APLICATIVO','Sistema e conexões','', 'Diagnóstico local do hub, identidade ativa e acesso centralizado à organização.')}<section class="content-grid"><article class="panel">${C.sectionHead('STATUS','Serviços conectados','')}<div class="history-list"><div class="history-row"><span>BACK4APP</span><div><b>Banco de dados</b><small>${B.state.online ? 'Sincronização operacional' : 'Conexão indisponível'}</small></div><strong class="delta ${B.state.online ? 'positive' : 'negative'}">${B.state.online ? 'ONLINE' : 'OFFLINE'}</strong></div><div class="history-row"><span>STEAM</span><div><b>Identidade do piloto</b><small>${B.state.driver ? B.escape(B.state.driver.name) : 'Nenhuma conta conectada'}</small></div><strong>${B.state.driver ? 'ATIVA' : '—'}</strong></div><div class="history-row"><span>PARSE</span><div><b>Sessão persistente</b><small>${session ? `${B.escape(session.kind || 'usuário')} · válida neste dispositivo` : 'Nenhuma sessão criada'}</small></div><strong>${session ? 'ATIVA' : '—'}</strong></div><div class="history-row"><span>ROLE</span><div><b>Permissão administrativa</b><small>${B.state.isAdmin ? `Validada para ${B.escape(B.state.admin?.username || session?.username || 'admin')}` : 'Acesso comum de piloto'}</small></div><strong class="delta ${B.state.isAdmin ? 'positive' : ''}">${B.state.isAdmin ? 'ADMIN' : '—'}</strong></div></div></article><aside class="panel">${C.sectionHead('ORGANIZAÇÃO','Central administrativa','')}<div class="guest-card"><strong>${B.state.isAdmin ? 'Modo administrativo ativo' : 'Acesso integrado no launcher'}</strong><p>${B.state.isAdmin ? 'Gerencie corridas, conteúdos, servidores, identidades e resultados sem abrir páginas legadas.' : 'Entre com uma conta da role admin. Sua sessão Steam será preservada durante a administração.'}</p><a class="button primary" href="#/admin">${B.state.isAdmin ? 'Abrir central administrativa' : 'Entrar como administrador'}</a></div></aside></section>`);
  }

  const content = () => window.BSRContent.view();
  const routes = { dashboard, races, championships, content, standings, career, stewarding, admin, settings, 'race-control': raceControl };
  window.BSRViews = { routes, dashboard, races, championships, content, standings, career, stewarding, admin, settings, raceControl };
})();
