(function () {
  'use strict';
  const B = window.BSR;

  const icons = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10M9 20v-6h6v6"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 21V4m0 1h11l-2 3 2 3H5"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v4m-4 3h8m-6-3h4"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 20V10m7 10V4m7 16v-7"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6l-.3-2.6h-4L10.4 6A8 8 0 0 0 9 7L6.5 6l-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1A8 8 0 0 0 10 18l.3 2.6h4L15 18a8 8 0 0 0 1.4-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M5 14v5h14v-5"/></svg>',
    content: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>'
  };

  const nav = [
    { id: 'dashboard', label: 'Início', icon: 'home' },
    { id: 'races', label: 'Corridas', icon: 'flag' },
    { id: 'championships', label: 'Campeonatos', icon: 'trophy' },
    { id: 'content', label: 'Conteúdo', icon: 'content' },
    { id: 'standings', label: 'Classificação', icon: 'chart' },
    { id: 'career', label: 'Carreira', icon: 'user' },
    { id: 'stewarding', label: 'Direção de prova', icon: 'shield' },
    { id: 'admin', label: 'Admin', icon: 'upload' },
    { id: 'settings', label: 'Sistema', icon: 'gear' }
  ];

  function renderNav(active) {
    const root = document.getElementById('mainNav');
    const allowed = nav.filter(item => !item.adminOnly || B.state.isAdmin);
    const signature = allowed.map(item => item.id).join('|');
    if (root.dataset.signature !== signature) {
      root.dataset.signature = signature;
      root.innerHTML = `<i class="nav-glider" aria-hidden="true"></i>${allowed.map(item => item.section
        ? `<span class="nav-label">${item.section}</span>`
        : `<a class="nav-item" href="#/${item.id}" data-route="${item.id}">${icons[item.icon]}<span>${item.label}</span>${item.id === 'stewarding' && B.state.notifications.length ? '<i class="nav-badge">!</i>' : ''}</a>`
      ).join('')}`;
    }
    root.querySelectorAll('.nav-item').forEach(item => {
      const selected = item.dataset.route === active;
      item.classList.toggle('active', selected);
      if (selected) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    const selected = root.querySelector('.nav-item.active');
    const glider = root.querySelector('.nav-glider');
    if (selected && glider) requestAnimationFrame(() => {
      glider.style.setProperty('--nav-x', `${selected.offsetLeft}px`);
      glider.style.setProperty('--nav-width', `${selected.offsetWidth}px`);
      glider.style.setProperty('--nav-y', `${selected.offsetTop}px`);
      glider.style.setProperty('--nav-height', `${selected.offsetHeight}px`);
      glider.classList.add('visible');
    });
  }

  new ResizeObserver(() => renderNav(B.state.route)).observe(document.getElementById('mainNav'));
  document.fonts?.ready.then(() => renderNav(B.state.route));

  function revealView(view, startup = false) {
    view.getAnimations({ subtree:true }).forEach(animation => animation.cancel());
    const home = view.querySelector('.launcher-home');
    const elements = home
      ? [...view.querySelectorAll('.hero-session,.launcher-intro > *,.launcher-widget')]
      : [...view.children];
    elements.forEach((element, index) => element.animate([
      { opacity:0, transform:`translateY(${startup ? 22 : 12}px)` },
      { opacity:1, transform:'translateY(0)' }
    ], { duration:startup ? 750 : 420, delay:Math.min(index * (startup ? 65 : 35), 390), easing:'cubic-bezier(.22,1,.36,1)', fill:'backwards' }));
    const art = view.querySelector('.launcher-art');
    if (art) art.animate([{opacity:0, transform:'scale(1.025)'},{opacity:1,transform:'scale(1)'}], {duration:startup ? 1100 : 600,easing:'cubic-bezier(.22,1,.36,1)'});
  }

  function sectionHead(eyebrow, title, action, description = '') {
    return `<div class="section-head"><div><span>${B.escape(eyebrow)}</span><h2>${B.escape(title)}</h2>${description ? `<p>${B.escape(description)}</p>` : ''}</div>${action || ''}</div>`;
  }

  function empty(title, text, action = '') {
    return `<div class="empty-state"><b>${B.escape(title)}</b><p>${B.escape(text)}</p>${action}</div>`;
  }

  function statusTag(race) {
    if (!race.requiresRegistration && !['closed','finished','cancelled'].includes(race.statusKey)) return '<span class="tag green">ACESSO LIVRE</span>';
    const map = { open: ['INSCRIÇÕES ABERTAS','green'], upcoming: ['EM BREVE','accent'], closed: ['GRID FECHADO',''], finished: ['ENCERRADA',''], cancelled: ['CANCELADA','red'] };
    const [label, style] = map[race.statusKey] || map.upcoming;
    return `<span class="tag ${style}">${label}</span>`;
  }

  function raceCard(race) {
    return `<article class="race-card" data-race-id="${B.escape(race.id)}" tabindex="0" role="button" aria-label="Abrir ${B.escape(race.title)}">
      <div class="race-card-cover" style="--image:url('${B.escape(race.imageUrl)}')">${statusTag(race)}<div class="race-card-date"><strong>${B.escape(race.timeLabel)}</strong><small>${B.escape(race.dateLabel.toUpperCase())}</small></div></div>
      <div class="race-card-body"><h3>${B.escape(race.title)}</h3><p>${B.escape(race.category)}</p><div class="race-card-info"><div><small>PISTA</small><span>${B.escape(race.track)}</span></div><div><small>DURAÇÃO</small><span>${B.escape(race.durationLabel)}</span></div></div></div>
      <footer class="race-card-footer"><span>${race.requiresRegistration ? (race.maxDrivers ? `Até ${race.maxDrivers} pilotos` : 'Inscrição obrigatória') : 'Sem inscrição'}</span><b>${race.statusKey === 'finished' ? 'VER RESULTADOS →' : 'DETALHES →'}</b></footer>
    </article>`;
  }

  function championshipCard(champ) {
    return `<article class="champ-card" data-champ-id="${B.escape(champ.id)}" tabindex="0" role="button"><div class="champ-card-cover" style="--image:url('${B.escape(champ.imageUrl)}')"><span class="tag accent">${B.escape(champ.category.toUpperCase())}</span></div><div class="champ-card-body"><h3>${B.escape(champ.title)}</h3><p>${B.escape(champ.description)}</p><div class="progress" style="--progress:${champ.progress}%"><i></i></div><div class="champ-meta"><span>${champ.completed}/${champ.rounds || '—'} etapas</span><span>${champ.statusKey === 'active' ? 'ATIVO' : B.escape(champ.statusKey.toUpperCase())}</span></div></div></article>`;
  }

  function toast(title, message, type = '') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.innerHTML = `<span>${type === 'error' ? '!' : type === 'success' ? '✓' : 'i'}</span><div><b>${B.escape(title)}</b><span>${B.escape(message)}</span></div>`;
    document.getElementById('toastRoot').appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  function closeDrawer() {
    const drawer = document.getElementById('drawer');
    drawer.classList.remove('open');
    drawer.dataset.raceId = '';
    drawer.classList.remove('results-drawer');
    drawer.setAttribute('aria-hidden', 'true');
    document.getElementById('drawerBackdrop').hidden = true;
  }

  async function openRace(raceId) {
    const race = B.state.races.find(item => item.id === raceId);
    if (!race) return;
    if (race.statusKey === 'finished') return openResults(race);
    const drawer = document.getElementById('drawer');
    drawer.classList.remove('results-drawer');
    drawer.dataset.raceId = raceId;
    document.getElementById('drawerBackdrop').hidden = false;
    const registrationPanel = race.requiresRegistration
      ? '<div class="drawer-section"><h3>Grid confirmado</h3><div class="driver-list" id="drawerDrivers"><div class="empty-state"><p>Consultando inscrições…</p></div></div></div>'
      : '<div class="drawer-section open-session"><h3>Acesso livre</h3><p>Esta corrida não exige inscrição. Prepare os conteúdos necessários e entre diretamente no servidor.</p></div>';
    const registrationButton = race.requiresRegistration
      ? `<button class="button primary" id="raceJoinButton" ${['closed','finished','cancelled'].includes(race.statusKey) ? 'disabled' : ''}>${race.statusKey === 'open' ? 'Participar da corrida' : 'Pré-inscrição'}</button>`
      : '';
    drawer.innerHTML = `<div class="drawer-cover" style="--image:url('${B.escape(race.imageUrl)}')"><div>${statusTag(race)}</div><button class="drawer-close" data-close-drawer>×</button></div><div class="drawer-content"><h2>${B.escape(race.title)}</h2><p class="drawer-subtitle">${B.escape(race.category)} · ${B.escape(race.track)}</p><div class="detail-grid"><div class="detail-item"><small>DATA E HORÁRIO</small><b>${B.escape(race.dateLabel)} · ${B.escape(race.timeLabel)}</b></div><div class="detail-item"><small>DURAÇÃO</small><b>${B.escape(race.durationLabel)}</b></div><div class="detail-item"><small>ACESSO</small><b>${race.requiresRegistration ? 'Inscrição obrigatória' : 'Livre, sem inscrição'}</b></div><div class="detail-item"><small>LICENÇA</small><b>${B.escape(race.requiredLicense || 'Livre')}</b></div></div><div class="drawer-section"><h3>Briefing</h3><p>${B.escape(race.description)}</p></div><div class="drawer-section race-content-section"><h3>Conteúdo necessário</h3><div id="raceContentStatus"><p>Verificando carros, pistas e skins…</p></div></div>${registrationPanel}</div><div class="drawer-actions"><button class="button" data-close-drawer>Fechar</button><button class="button" id="raceContentButton" type="button" disabled>Verificando requisitos…</button>${registrationButton}</div>`;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    drawer.querySelectorAll('[data-close-drawer]').forEach(button => button.addEventListener('click', closeDrawer));
    drawer.querySelector('#raceJoinButton')?.addEventListener('click', () => openReservation(race));
    window.BSRContent?.mountRaceRequirements(race, drawer);
    if (!race.requiresRegistration) return;
    try {
      const reservations = await B.loadReservations(raceId);
      if (drawer.dataset.raceId !== raceId) return;
      const mine = reservations.find(item => item.isMine);
      document.getElementById('drawerDrivers').innerHTML = reservations.length ? reservations.map((item, index) => `<div class="driver-list-row"><b>${index + 1}. ${B.escape(item.driverName || 'Piloto')}</b><span>${B.escape(item.carModel || 'Carro a definir')}</span></div>`).join('') : `<div class="empty-state"><p>O grid ainda está vazio.</p></div>`;
      const button = document.getElementById('raceJoinButton');
      if (button && mine) { const replacement = button.cloneNode(true); button.replaceWith(replacement); replacement.textContent = 'Cancelar minha inscrição'; replacement.classList.remove('primary'); replacement.classList.add('danger'); replacement.onclick = () => cancelReservation(mine.objectId, race); }
    } catch (_) {
      if (drawer.dataset.raceId !== raceId) return;
      document.getElementById('drawerDrivers').innerHTML = `<div class="empty-state"><p>Não foi possível carregar o grid.</p></div>`;
    }
  }

  function resultsTable(results) {
    const position = row => Number(row.officialPosition || row.finishPosition);
    const official = results.every(row => row.classificationStatus === 'official');
    return `<div class="results-summary"><span>${results.length} participantes</span><span>${official ? 'Classificação oficial' : 'Resultado registrado'}</span></div>
      <div class="table-wrap"><table class="data-table results-table"><caption class="sr-only">Posições finais dos participantes</caption><thead><tr><th scope="col">POS.</th><th scope="col">PILOTO</th><th scope="col">VOLTAS</th><th scope="col">PONTOS</th><th scope="col">SITUAÇÃO</th></tr></thead><tbody>${results.map(row => {
        const pos = position(row);
        const classified = Number.isFinite(pos) && pos > 0 && pos < 99;
        const status = row.isDSQ || row.classificationStatus === 'disqualified' ? 'DSQ' : row.isDNF ? 'DNF' : 'Concluiu';
        return `<tr><td class="position ${classified && pos <= 3 ? 'podium' : ''}">${classified ? pos : '—'}</td><td><div class="result-driver"><b>${B.escape(row.driver?.name || row.driverName || 'Piloto não identificado')}</b><small>${B.escape(row.carModel || (row.carClass !== 'Unknown' ? row.carClass : '') || 'Categoria não informada')}</small>${Number(row.penaltySeconds) > 0 ? `<small class="result-penalty">+${B.escape(row.penaltySeconds)}s de penalidade</small>` : ''}</div></td><td>${B.escape(row.lapsCompleted ?? '—')}</td><td>${B.escape(row.championshipPoints ?? row.points ?? '—')}</td><td><span class="result-status ${status === 'Concluiu' ? '' : 'incomplete'}">${status}</span></td></tr>`;
      }).join('')}</tbody></table></div><p class="results-note">DNF: não concluiu · DSQ: desclassificado. Posições e penalidades conforme o resultado registrado.</p>`;
  }

  async function openResults(race) {
    const drawer = document.getElementById('drawer');
    drawer.dataset.raceId = race.id;
    drawer.classList.add('results-drawer', 'open');
    drawer.setAttribute('aria-hidden', 'false');
    document.getElementById('drawerBackdrop').hidden = false;
    drawer.innerHTML = `<div class="drawer-cover" style="--image:url('${B.escape(race.imageUrl)}')">${statusTag(race)}<button class="drawer-close" data-close-drawer aria-label="Fechar resultados">×</button></div><div class="drawer-content"><p class="overline">RESULTADOS DA CORRIDA</p><h2>${B.escape(race.title)}</h2><p class="drawer-subtitle">${B.escape(race.track)} · ${B.escape(race.dateLabel)} · ${B.escape(race.timeLabel)}</p><section id="raceResults" aria-live="polite" aria-busy="true"><div class="empty-state"><p>Carregando classificação…</p></div></section></div><div class="drawer-actions"><button class="button" data-close-drawer>Fechar</button></div>`;
    drawer.querySelectorAll('[data-close-drawer]').forEach(button => button.addEventListener('click', closeDrawer));
    const target = drawer.querySelector('#raceResults');
    try {
      const resultsKey = race.resultsSessionId || race.sessionId;
      let results = await window.BSR_API.getRaceResults(resultsKey, race.id);
      if (drawer.dataset.raceId !== race.id || !target.isConnected) return;
      const duplicates = B.state.races.filter(item => item.sessionId && item.sessionId === race.sessionId);
      if (duplicates.length > 1 && results.length) {
        const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const track = normalize(race.track);
        results = results.filter(row => row.raceId === race.id || row.race?.objectId === race.id || (track && normalize(row.track) && (normalize(row.track).includes(track) || track.includes(normalize(row.track)))));
        if (!results.length) {
          target.innerHTML = empty('Resultado com vínculo inconsistente', 'Esta sessão está vinculada a mais de uma corrida. A organização precisa corrigir o vínculo antes de exibir a classificação desta etapa.');
          return;
        }
      }
      target.innerHTML = results.length ? resultsTable(results) : empty('Resultados ainda não publicados', 'A corrida foi encerrada, mas a classificação ainda não está vinculada a esta etapa.');
      const sessions = [...new Set(results.map(row => row.importKey || row.sessionId || 'legacy'))];
      if (sessions.length > 1) {
        target.innerHTML = `<label class="form-field">BATERIA<select id="resultHeat">${sessions.map((key,index) => {
          const row = results.find(item => (item.importKey || item.sessionId || 'legacy') === key);
          return `<option value="${B.escape(key)}">Bateria ${B.escape(row.heat || String(index+1))} · ${B.escape(B.formatDate(new Date(row.sessionDate?.iso || row.sessionDate || row.createdAt)))}</option>`;
        }).join('')}</select></label><div id="resultHeatTable"></div>`;
        const select = target.querySelector('#resultHeat');
        select.value = sessions.includes(resultsKey) ? resultsKey : sessions[sessions.length-1];
        const render = () => { target.querySelector('#resultHeatTable').innerHTML = resultsTable(results.filter(row => (row.importKey || row.sessionId || 'legacy') === select.value)); };
        select.addEventListener('change',render); render();
      }
    } catch (error) {
      if (drawer.dataset.raceId !== race.id || !target.isConnected) return;
      target.innerHTML = empty('Não foi possível carregar os resultados', error.message, '<button class="button" id="retryResults">Tentar novamente</button>');
      target.querySelector('#retryResults')?.addEventListener('click', () => openResults(race));
    } finally { target.setAttribute('aria-busy', 'false'); }
  }

  function openReservation(race) {
    if (!B.state.driver) {
      toast('Login necessário', 'Conecte sua conta Steam antes de entrar no grid.');
      setTimeout(() => { window.location.href = 'login.html'; }, 800);
      return;
    }
    const cars = (race.cars || []).map(car => car.nome || car.name).filter(Boolean);
    if (!cars.length) cars.push(race.carModel || race.category || 'Categoria oficial');
    openModal('Confirmar participação', `<form id="reservationForm" class="form-grid"><div class="form-field"><label>CORRIDA</label><input value="${B.escape(race.title)}" disabled></div><div class="form-field"><label>CARRO / CATEGORIA</label><select id="reservationCar">${cars.map(car => `<option>${B.escape(car)}</option>`).join('')}</select></div><p style="margin:0;color:var(--muted);font-size:.52rem;line-height:1.6">Sua inscrição será vinculada ao piloto ${B.escape(B.state.driver.name)}. O servidor e a senha aparecerão quando o grid for liberado.</p></form>`, async () => {
      try {
        await window.BSR_API.reserveCar(race.id, B.state.driver.steamGUID, B.state.driver.name, document.getElementById('reservationCar').value);
        B.cache.delete(`reservations:${race.id}`);
        closeModal(); closeDrawer(); toast('Inscrição confirmada', 'Seu lugar no grid foi reservado.', 'success');
      } catch (error) { toast('Não foi possível inscrever', error.message, 'error'); }
    }, 'Confirmar inscrição');
  }

  async function cancelReservation(id, race) {
    try {
      await window.BSR_API.cancelReservation(id);
      B.cache.delete(`reservations:${race.id}`);
      closeDrawer(); toast('Inscrição cancelada', 'Sua vaga foi liberada.', 'success');
    } catch (error) { toast('Não foi possível cancelar', error.message, 'error'); }
  }

  async function openChampionship(champId) {
    const champ = B.state.championships.find(item => item.id === champId);
    if (!champ) return;
    const races = B.state.races.filter(race => race.championshipId === champ.id);
    const drawer = document.getElementById('drawer');
    drawer.dataset.raceId = '';
    drawer.classList.remove('results-drawer');
    document.getElementById('drawerBackdrop').hidden = false;
    drawer.innerHTML = `<div class="drawer-cover" style="--image:url('${B.escape(champ.imageUrl)}')"><span class="tag accent">${B.escape(champ.category.toUpperCase())}</span><button class="drawer-close" data-close-drawer>×</button></div><div class="drawer-content"><h2>${B.escape(champ.title)}</h2><p class="drawer-subtitle">${B.escape(champ.category)} · ${champ.rounds || '—'} etapas</p><div class="drawer-section"><h3>Sobre a temporada</h3><p>${B.escape(champ.description)}</p></div><div class="drawer-section"><h3>Calendário</h3><div class="driver-list">${races.length ? races.map((race,index) => `<button class="driver-list-row stage-row" type="button" data-stage-id="${B.escape(race.id)}"><b>R${race.roundNumber || index + 1} · ${B.escape(race.track)}</b><span>${B.escape(race.dateLabel)} · ${race.statusKey === 'finished' ? 'Ver resultados →' : 'Detalhes →'}</span></button>`).join('') : '<div class="empty-state"><p>Calendário ainda não publicado.</p></div>'}</div></div></div><div class="drawer-actions"><button class="button" data-close-drawer>Fechar</button><button class="button primary" onclick="location.hash='#/standings'">Ver classificação</button></div>`;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden','false');
    drawer.querySelectorAll('[data-stage-id]').forEach(button => button.addEventListener('click', () => openRace(button.dataset.stageId)));
    drawer.querySelectorAll('[data-close-drawer]').forEach(button => button.addEventListener('click', closeDrawer));
  }

  async function openDriverProfile(driverId) {
    if (!driverId) return;
    openModal('Perfil do piloto', '<div class="profile-modal-loading"><div class="skeleton"></div><p>Carregando perfil público…</p></div>', null);
    try {
      const driver = await window.BSR_API.getPublicDriverProfile(driverId);
      const results = driver.results || [];
      openModal(driver.name || 'Piloto BSR', `<section class="public-profile">
        <div class="public-profile-head"><img src="${B.escape(B.avatar(driver))}" alt=""><div><span class="license">${B.escape(driver.licenseClass || 'R')}</span><h3>${B.escape(driver.name || 'Piloto BSR')}</h3><p>${B.escape(driver.location || 'Comunidade Brasil Sim Racing')}</p></div><div class="public-profile-rating"><strong>${Number(driver.irating || 1600).toLocaleString('pt-BR')}</strong><small>BSR RATING · ${B.escape(String(driver.primaryDiscipline || 'road').toUpperCase())}</small><b>${Number(driver.safetyRating || 0).toFixed(2)} SR · ${Number(driver.reliability ?? 90)}% CONF.</b>${driver.ratingProvisional !== false ? '<em>PROVISÓRIO</em>' : ''}</div></div>
        <p class="public-profile-bio">${B.escape(driver.bio || 'Este piloto ainda não escreveu uma apresentação.')}</p>
        <div class="profile-favorites"><div><small>CARRO FAVORITO</small><b>${B.escape(driver.favoriteCar || 'Não informado')}</b></div><div><small>PISTA FAVORITA</small><b>${B.escape(driver.favoriteTrack || 'Não informada')}</b></div><div><small>CONFIANÇA DO RATING</small><b>${Number(driver.ratingConfidence || 0)}%</b></div></div>
        <div class="public-results"><h4>RESULTADOS RECENTES</h4>${results.length ? results.map(result => `<div><strong>P${Number(result.officialPosition || result.classPosition || 0) || '—'}</strong><span><b>${B.escape(result.raceTitle || result.track || 'Corrida BSR')}</b><small>${B.escape(result.carClass || result.carModel || 'Categoria BSR')} · Rating ${Number(result.deltaIRating || 0) >= 0 ? '+' : ''}${Number(result.deltaIRating || 0)}</small></span><time>${B.formatDate(new Date(result.sessionDate?.iso || result.sessionDate || Date.now()))}</time></div>`).join('') : '<p>Nenhum resultado oficial publicado.</p>'}</div>
      </section>`, null);
    } catch (error) {
      openModal('Perfil indisponível', empty('Não foi possível abrir o piloto', error.message), null);
    }
  }

  function openModal(title, body, onConfirm, confirmLabel = 'Confirmar') {
    document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>${B.escape(title)}</h2><button type="button" data-close-modal>×</button></div>${body}<div class="modal-actions"><button class="button" type="button" data-close-modal>Cancelar</button>${onConfirm ? `<button class="button primary" id="modalConfirm" type="button">${B.escape(confirmLabel)}</button>` : ''}</div></div></div>`;
    document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
    document.getElementById('modalConfirm')?.addEventListener('click', onConfirm);
  }
  function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

  function openCommandPalette() {
    const root = document.getElementById('commandPalette');
    root.hidden = false;
    root.innerHTML = `<div class="command-box"><input id="commandInput" placeholder="Buscar corridas, campeonatos, pilotos ou páginas…" autocomplete="off"><div class="command-results" id="commandResults"></div></div>`;
    const input = document.getElementById('commandInput');
    const render = () => {
      const q = input.value.trim().toLowerCase();
      const pages = nav.filter(item => item.id && (!item.adminOnly || B.state.isAdmin)).map(item => ({ type:'Página', title:item.label, subtitle:'Abrir seção', action:() => location.hash=`#/${item.id}` }));
      const races = B.state.races.map(item => ({ type:'Corrida', title:item.title, subtitle:`${item.track} · ${item.dateLabel}`, action:() => openRace(item.id) }));
      const champs = B.state.championships.map(item => ({ type:'Campeonato', title:item.title, subtitle:item.category, action:() => openChampionship(item.id) }));
      const results = [...pages,...races,...champs].filter(item => !q || `${item.title} ${item.subtitle}`.toLowerCase().includes(q)).slice(0,12);
      document.getElementById('commandResults').innerHTML = results.map((item,index) => `<button class="command-result" data-command="${index}"><span>⌕</span><div><b>${B.escape(item.title)}</b><small>${B.escape(item.type)} · ${B.escape(item.subtitle)}</small></div></button>`).join('') || `<div class="empty-state"><p>Nenhum resultado.</p></div>`;
      root.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => { const item = results[Number(button.dataset.command)]; closeCommandPalette(); item.action(); }));
    };
    input.addEventListener('input', render); render(); input.focus();
    root.addEventListener('click', event => { if (event.target === root) closeCommandPalette(); }, { once:true });
  }
  function closeCommandPalette() { const root = document.getElementById('commandPalette'); root.hidden = true; root.innerHTML = ''; }

  window.BSRComponents = { icons, nav, renderNav, revealView, sectionHead, empty, statusTag, raceCard, championshipCard, toast, openRace, openChampionship, openDriverProfile, closeDrawer, openModal, closeModal, openCommandPalette, closeCommandPalette };
})();
