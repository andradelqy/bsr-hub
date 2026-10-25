(function () {
  'use strict';
  document.documentElement.classList.toggle('electron-shell', Boolean(window.electronAPI));
  const B = window.BSR;
  const C = window.BSRComponents;
  const V = window.BSRViews;

  const routeMeta = {
    dashboard: ['CENTRAL DO PILOTO','Início'],
    races: ['COMPETIÇÃO','Corridas'],
    championships: ['TEMPORADAS','Campeonatos'],
    content: ['BIBLIOTECA','Conteúdo'],
    standings: ['RANKING BSR','Classificação'],
    career: ['PERFIL DO PILOTO','Minha carreira'],
    stewarding: ['DIREÇÃO DE PROVA','Central esportiva'],
    admin: ['ORGANIZAÇÃO','Central administrativa'],
    settings: ['APLICATIVO','Sistema'],
    'race-control': ['ORGANIZAÇÃO','Lançar resultados']
  };
  let routeSequence = 0;
  let hasRenderedRoute = false;
  let departure;

  function currentRoute() {
    const route = location.hash.replace(/^#\/?/,'').split('/')[0];
    return V.routes[route] ? route : 'dashboard';
  }

  async function route() {
    const sequence = ++routeSequence;
    let name = currentRoute();
    if (!B.state.access?.allowed && name !== 'admin') {
      B.state.route = 'access';
      renderAccessGate();
      return;
    }
    document.getElementById('app').removeAttribute('data-access');
    if (name === 'race-control' && !B.state.isAdmin) {
      C.toast('Acesso restrito','Entre com uma conta administrativa para abrir esta área.','error');
      name = 'settings';
      history.replaceState(null, '', '#/settings');
    }
    B.state.route = name;
    C.renderNav(name);
    const [eyebrow,title] = routeMeta[name];
    document.getElementById('routeEyebrow').textContent = eyebrow;
    document.getElementById('routeTitle').textContent = title;
    document.title = `${title} · BSR Hub`;
    try {
      const view = document.getElementById('view');
      if (hasRenderedRoute && view.childElementCount) {
        departure?.cancel();
        view.getAnimations({subtree:true}).forEach(animation => animation.cancel());
        departure = view.animate([{opacity:1},{opacity:0}], {duration:120, fill:'forwards', easing:'ease-out'});
        await departure.finished.catch(() => {});
        if (sequence !== routeSequence) return;
      }
      document.getElementById('app').dataset.route = name;
      departure?.cancel();
      await V.routes[name]();
      hasRenderedRoute = true;
    } catch (error) {
      console.error(`[BSR] Falha na rota ${name}:`, error);
      document.getElementById('view').innerHTML = `<div class="panel">${C.empty('Não foi possível abrir esta área',error.message,'<button class="button primary" onclick="location.reload()">Tentar novamente</button>')}</div>`;
    }
  }

  function updateConnection() {
    const status = document.getElementById('serviceState');
    status.className = `service-state ${B.state.online ? 'online' : 'offline'}`;
    status.querySelector('small').textContent = B.state.online ? 'Todos os serviços online' : 'Modo desconectado';
  }

  function renderAccessGate() {
    const access = B.state.access || {};
    const authenticated = Boolean(access.authenticated);
    const app = document.getElementById('app');
    app.dataset.access = 'restricted';
    document.title = 'Acesso antecipado · BSR Hub';
    document.getElementById('routeEyebrow').textContent = 'ACESSO ANTECIPADO';
    document.getElementById('routeTitle').textContent = 'BSR Hub';
    document.getElementById('view').innerHTML = `<section class="hub-access-stage">
      <div class="hub-access-light" aria-hidden="true"><i></i><i></i><i></i></div>
      <article class="hub-access-card">
        <header><img src="assets/foto/favicon.png" alt=""><span><b>BSR</b><small>RACING HUB</small></span><em>ACESSO ANTECIPADO</em></header>
        <div class="hub-access-copy"><span>${authenticated ? 'CONTA IDENTIFICADA' : 'FASE DE TESTES'}</span><h2>${authenticated ? 'Acesso ainda não liberado' : 'O grid está sendo formado'}</h2><p>${authenticated ? 'Sua conta Steam foi autenticada corretamente, mas ainda não está na lista desta fase. Peça à organização para liberar o SteamID abaixo.' : 'Nesta etapa, o BSR Hub está disponível apenas para pilotos convidados. Entre com a Steam para verificar sua liberação.'}</p></div>
        ${authenticated ? `<div class="hub-access-identity"><div><small>PILOTO</small><b>${B.escape(access.displayName || 'Piloto BSR')}</b></div><div><small>STEAMID64</small><b>${B.escape(access.steamId || 'Não identificado')}</b></div><span>AGUARDANDO</span></div>` : ''}
        <div class="hub-access-actions">${authenticated ? '<button class="button primary" id="accessChangeAccount" type="button">Entrar com outra conta</button>' : '<a class="button primary" href="login.html">Verificar acesso com Steam</a>'}<a class="button" href="#/admin">Acesso da organização</a></div>
        <footer><span><i></i> Autenticação protegida pelo Back4App</span><b>BRASIL SIM RACING</b></footer>
      </article>
    </section>`;
    document.getElementById('accessChangeAccount')?.addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true; button.textContent = 'Encerrando sessão…';
      await window.BSR_API.logout(); location.replace('login.html');
    });
  }

  function updateAccount() {
    const driver = B.state.driver;
    const hasIdentity = Boolean(driver || B.state.isAdmin);
    document.getElementById('authButton').classList.toggle('is-hidden', hasIdentity);
    document.getElementById('accountButton').classList.toggle('is-hidden', !hasIdentity);
    if (hasIdentity) {
      document.getElementById('accountAvatar').src = driver ? B.avatar(driver) : 'assets/foto/favicon.png';
      document.getElementById('accountName').textContent = driver?.name || B.state.admin?.username || 'Administrador BSR';
    }
    document.getElementById('notificationDot').classList.toggle('is-hidden', !B.state.notifications.some(item => !item.seen));
  }

  function openAccountMenu() {
    const driver = B.state.driver;
    if (!driver && !B.state.isAdmin) return;
    const session = window.BSR_API.readSession();
    const identity = driver
      ? `<div class="driver-cell" style="margin-bottom:18px"><img src="${B.escape(B.avatar(driver))}" style="width:52px;height:52px" alt=""><div><b>${B.escape(driver.name)}</b><p style="margin:5px 0 0;color:var(--muted);font-size:.52rem">SteamID ${B.escape(driver.steamGUID || '—')}${B.state.isAdmin ? ' · ADMIN' : ''}</p></div></div>`
      : `<div class="driver-cell" style="margin-bottom:18px"><img src="assets/foto/favicon.png" style="width:52px;height:52px;object-fit:contain" alt=""><div><b>${B.escape(B.state.admin?.username || session?.username || 'Administrador BSR')}</b><p style="margin:5px 0 0;color:var(--muted);font-size:.52rem">SESSÃO ADMINISTRATIVA VERIFICADA</p></div></div>`;
    C.openModal(driver ? 'Conta e permissões' : 'Conta administrativa', `${identity}<div class="form-grid">${driver ? '<a class="button" href="#/career" data-close-modal>Minha carreira</a>' : ''}${B.state.isAdmin ? '<a class="button primary" href="#/admin" data-close-modal>Central administrativa</a>' : ''}<a class="button" href="#/settings" data-close-modal>Sistema e conexões</a><button class="button danger" id="logoutDriver" type="button">${session?.kind === 'admin' && window.BSR_API.hasDriverSessionToRestore() ? 'Voltar ao perfil do piloto' : 'Sair da conta'}</button></div>`, null);
    document.getElementById('logoutDriver').addEventListener('click', async () => {
      const restored = session?.kind === 'admin' ? await window.BSR_API.leaveAdminMode() : (await window.BSR_API.logout(), null);
      const steamId = B.stored('steamId');
      if (session?.kind !== 'admin' || !restored) {
        for (const storage of [sessionStorage, localStorage]) {
          ['steamId','steamName','steamAvatar'].forEach(key => storage.removeItem(key));
          Object.keys(storage).filter(key => key.startsWith('bsr_driver_') || key.startsWith('userStats_')).forEach(key => storage.removeItem(key));
        }
        if (steamId && typeof window.clearDriverCache === 'function') window.clearDriverCache(steamId);
      }
      C.closeModal(); location.reload();
    });
  }

  function openNotifications() {
    const items = B.state.notifications;
    C.openModal('Notificações', items.length ? `<div class="history-list">${items.map(item => `<div class="history-row"><span>${B.formatDate(new Date(item.timestamp?.iso || item.createdAt))}</span><div><b>${B.escape(item.title || 'BSR')}</b><small>${B.escape(item.message || '')}</small></div><strong>›</strong></div>`).join('')}</div>` : C.empty('Tudo limpo','Nenhuma notificação nova.'), null);
  }

  async function sync() {
    const button = document.getElementById('syncButton');
    button.disabled = true; button.textContent = '…';
    try {
      B.cache.clear();
      await B.bootstrap(true);
      updateConnection(); updateAccount(); await route();
      C.toast('Hub sincronizado','Calendário, perfil e competições foram atualizados.','success');
    } catch (error) { C.toast('Falha na sincronização',error.message,'error'); }
    finally { button.disabled = false; button.textContent = '↻'; }
  }

  async function init() {
    const bootStarted = performance.now();
    const app = document.getElementById('app');
    C.renderNav(currentRoute());
    document.getElementById('view').innerHTML = '<div class="loading-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
    await B.bootstrap();
    updateConnection(); updateAccount(); await route();
    const hero = document.querySelector('.launcher-art');
    if (hero) {
      const image = new Image();
      image.src = B.upcomingRaces()[0]?.imageUrl || B.cleanUrl('assets/video/stockcar.png');
      await Promise.race([image.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1200))]);
    }
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 700 - (performance.now() - bootStarted))));
    app.setAttribute('aria-busy','false');
    document.documentElement.classList.add('app-ready');
    document.getElementById('bootScreen').classList.add('done');
    C.revealView(document.getElementById('view'), true);
    setTimeout(() => document.getElementById('bootScreen')?.remove(),500);
  }

  window.addEventListener('hashchange', () => { C.closeDrawer(); route(); });
  window.addEventListener('online', sync);
  window.addEventListener('offline', () => { B.state.online = false; updateConnection(); });
  document.getElementById('drawerBackdrop').addEventListener('click', C.closeDrawer);
  document.getElementById('searchTrigger').addEventListener('click', C.openCommandPalette);
  document.getElementById('syncButton').addEventListener('click', sync);
  document.getElementById('notificationButton').addEventListener('click', openNotifications);
  document.getElementById('accountButton').addEventListener('click', openAccountMenu);
  document.querySelectorAll('[data-window]').forEach(button => button.addEventListener('click', () => {
    if (window.electronAPI?.controlWindow) window.electronAPI.controlWindow(button.dataset.window);
  }));
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); C.openCommandPalette(); }
    if (event.key === 'Escape') { C.closeCommandPalette(); C.closeDrawer(); C.closeModal(); }
  });

  init().catch(error => {
    console.error('[BSR] Falha fatal:', error);
    document.getElementById('bootScreen').classList.add('done');
    document.documentElement.classList.add('app-ready');
    document.getElementById('app').setAttribute('aria-busy','false');
    document.getElementById('view').innerHTML = `<div class="panel">${C.empty('O hub não conseguiu inicializar',error.message,'<button class="button primary" onclick="location.reload()">Recarregar</button>')}</div>`;
  });
})();
