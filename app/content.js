(function () {
  'use strict';
  const B = window.BSR;
  let catalog = [];
  let localState = { desktop:false, detected:false, gamePath:'', statuses:{} };
  let unsubscribeProgress = null;
  let publisherInspection = null;
  let activeBatch = null;
  const transferProgress = new Map();

  const desktopAPI = () => window.electronAPI?.content || null;
  const sessionToken = () => String(window.BSR_API?.getSessionToken?.() || '');
  const formatBytes = value => {
    const bytes = Number(value || 0);
    if (!bytes) return '—';
    const units = ['B','KB','MB','GB']; let unit = 0; let amount = bytes;
    while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
    return `${amount >= 10 || unit < 2 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
  };
  const formatRate = value => Number(value) > 0 ? `${formatBytes(value)}/s` : 'Calculando velocidade…';
  const formatEta = value => {
    const seconds = Math.max(0, Math.round(Number(value || 0)));
    if (!seconds) return 'Tempo restante calculando…';
    if (seconds < 60) return `Cerca de ${seconds}s restantes`;
    const minutes = Math.ceil(seconds / 60);
    return `Cerca de ${minutes} min restante${minutes === 1 ? '' : 's'}`;
  };
  const isCancellation = error => /(?:download|instalação|operação) cancelad[oa]/i.test(String(error?.message || error || ''));
  const installPhases = new Set(['validate','inspect','backup','install','installed','install-cancelled']);
  const workingPhases = new Set(['download','validate','inspect','backup','install']);
  const shortFile = value => {
    const text=String(value||'').replaceAll('\\','/');
    return text.length>74?`…${text.slice(-73)}`:text;
  };

  function packageStatus(pkg) {
    return localState.statuses?.[pkg.slug] || { installed:false, downloaded:false, updateAvailable:false };
  }

  function typeLabel(type) {
    return ({ car:'Carro', track:'Pista', skin:'Skin', app:'Aplicativo', extension:'Extensão', showroom:'Showroom' })[type] || type;
  }

  function recommendedRaceCar(packages, race = {}) {
    const cars=(packages||[]).filter(item=>item.type==='car'&&/^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(String(item.targetId||'')));
    if(!cars.length)return null;
    const primary=cars.filter(item=>!/(?:^|[\s_.-])safety(?:[\s_.-]|$)|safety\s*car/i.test(`${item.name||''} ${item.slug||''} ${item.targetId||''} ${(item.tags||[]).join(' ')}`));
    const pool=primary.length?primary:cars;
    if(pool.length===1)return pool[0];
    const ignored=new Set(['assetto','corsa','bsr','brasil','cup','race','racing','series','sprint','min','minutos','the','car']);
    const tokens=value=>String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9]+/).filter(token=>token.length>=3&&!ignored.has(token));
    const wanted=tokens(race.title||race.name||'');
    const ranked=pool.map(item=>{const text=tokens(`${item.name||''} ${item.slug||''} ${item.targetId||''} ${(item.tags||[]).join(' ')}`);return{item,score:wanted.reduce((score,token)=>score+(text.some(part=>part===token||part.includes(token)||token.includes(part))?1:0),0)};}).sort((a,b)=>b.score-a.score);
    return ranked[0]?.score&&ranked[0].score!==ranked[1]?.score?ranked[0].item:null;
  }

  function recommendedRaceTrack(packages, race = {}) {
    const tracks=(packages||[]).filter(item=>item.type==='track'&&/^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(String(item.targetId||'')));
    if(tracks.length<=1)return tracks[0]||null;
    const ignored=new Set(['assetto','corsa','bsr','brasil','cup','race','racing','series','sprint','min','minutos','the','track']);
    const tokens=value=>String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9]+/).filter(token=>token.length>=3&&!ignored.has(token));
    const wanted=tokens(`${race.title||race.name||''} ${race.track||''}`);
    const ranked=tracks.map(item=>{const text=tokens(`${item.name||''} ${item.slug||''} ${item.targetId||''} ${(item.tags||[]).join(' ')}`);return{item,score:wanted.reduce((score,token)=>score+(text.some(part=>part===token||part.includes(token)||token.includes(part))?1:0),0)};}).sort((a,b)=>b.score-a.score);
    return ranked[0]?.score&&ranked[0].score!==ranked[1]?.score?ranked[0].item:null;
  }

  async function loadCatalog(force = false) {
    if (!catalog.length || force) catalog = await window.BSR_API.getContentCatalog();
    return catalog;
  }

  async function refreshLocal(packages = catalog, verifyIntegrity = false) {
    const api = desktopAPI();
    if (!api) { localState = { desktop:false, detected:false, gamePath:'', statuses:{} }; return localState; }
    if (!localState.desktop) await api.initialize();
    const references = packages.map(item => ({ slug:item.slug, version:item.version }));
    localState = verifyIntegrity && api.audit ? await api.audit(references) : await api.status(references);
    return localState;
  }

  function dependencyOrder(packages, source = catalog) {
    const bySlug = new Map(source.map(item => [item.slug, item]));
    const output = []; const visiting = new Set(); const complete = new Set();
    const visit = pkg => {
      if (!pkg) throw new Error('Uma dependência obrigatória não está disponível no catálogo.');
      if (complete.has(pkg.slug)) return;
      if (visiting.has(pkg.slug)) throw new Error(`Dependência circular detectada em ${pkg.name}.`);
      visiting.add(pkg.slug);
      (pkg.dependencies || []).forEach(slug => {
        const dependency = bySlug.get(slug);
        if (!dependency) throw new Error(`A dependência “${slug}” exigida por ${pkg.name} não está disponível.`);
        visit(dependency);
      });
      visiting.delete(pkg.slug); complete.add(pkg.slug); output.push(pkg);
    };
    packages.forEach(visit); return output;
  }

  function progressListener(progress) {
    if (!progress?.slug) return;
    transferProgress.set(progress.slug, progress);
    const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
    const card = document.querySelector(`[data-content-slug="${CSS.escape(progress.slug)}"]`);
    if (card) {
      const bar = card.querySelector('.content-progress i'); const label = card.querySelector('.content-progress span');
      if (bar) bar.style.width = `${percent}%`;
      if (label) label.textContent = progress.phase === 'download' ? `Baixando ${percent}% · ${formatRate(progress.bytesPerSecond)}` : installPhases.has(progress.phase) ? `${progress.phase === 'installed' ? 'Instalado' : progress.phase === 'install-cancelled' ? 'Instalação cancelada' : 'Instalando'} ${percent}%${progress.message ? ` · ${shortFile(progress.message)}` : ''}` : progress.phase === 'cancelled' ? 'Download cancelado' : progress.phase === 'error' ? 'Operação não concluída' : 'Download concluído';
      card.classList.toggle('is-working', workingPhases.has(progress.phase));
    }
    const row = document.querySelector(`[data-race-requirement="${CSS.escape(progress.slug)}"]`);
    if (row) {
      row.classList.toggle('is-transferring', workingPhases.has(progress.phase));
      row.classList.toggle('is-complete', ['downloaded','installed'].includes(progress.phase));
      row.classList.toggle('is-cancelled', ['cancelled','install-cancelled'].includes(progress.phase));
      const bar = row.querySelector('.requirement-transfer i');
      const label = row.querySelector('.requirement-transfer em');
      if (bar) bar.style.width = `${percent}%`;
      if (label) label.textContent = progress.phase === 'download' ? `${percent}% · ${formatRate(progress.bytesPerSecond)}` : installPhases.has(progress.phase) ? `${percent}%${progress.message ? ` · ${shortFile(progress.message)}` : ''}` : progress.phase === 'downloaded' ? 'Download concluído' : progress.phase === 'cancelled' ? 'Cancelado' : progress.phase === 'error' ? 'Falha' : '';
    }
    const manager = document.getElementById('raceDownloadManager');
    if (!manager || !['download','downloaded','cancelled','error',...installPhases].includes(progress.phase)) return;
    manager.hidden = false;
    manager.classList.toggle('is-error', progress.phase === 'error');
    manager.classList.toggle('is-cancelled', progress.phase === 'cancelled');
    const index = activeBatch?.currentSlug === progress.slug ? activeBatch.currentIndex + 1 : 1;
    const totalFiles = activeBatch?.total || 1;
    const set = (selector, value) => { const node=manager.querySelector(selector); if(node) node.textContent=value; };
    const installing=installPhases.has(progress.phase)||progress.operation==='install';
    set('[data-transfer-kicker]', installing?'GERENCIADOR DE INSTALAÇÃO':'GERENCIADOR DE DOWNLOAD');
    set('[data-transfer-name]', progress.name || progress.slug);
    set('[data-transfer-file]', `Pacote ${Math.min(index, totalFiles)} de ${totalFiles} · v${progress.version || '—'}`);
    set('[data-transfer-percent]', `${percent}%`);
    set('[data-transfer-bytes]', installing ? (progress.total ? `Arquivo ${progress.current||0} de ${progress.total}` : 'Preparando arquivos') : `${formatBytes(progress.received)} de ${formatBytes(progress.total)}`);
    const stage=({validate:'Extraindo e validando',inspect:'Identificando conteúdo',backup:'Criando backup',install:'Instalando',installed:'Concluído','install-cancelled':'Revertido'})[progress.phase];
    set('[data-transfer-speed]', installing ? stage||'Preparando instalação' : progress.phase === 'download' ? formatRate(progress.bytesPerSecond) : progress.phase === 'downloaded' ? 'Verificação concluída' : progress.phase === 'cancelled' ? 'Transferência interrompida' : 'Transferência não concluída');
    set('[data-transfer-eta]', installing ? (progress.message ? `Arquivo atual: ${shortFile(progress.message)}` : 'Preparando o próximo arquivo…') : progress.phase === 'download' ? formatEta(progress.etaSeconds) : progress.phase === 'downloaded' ? 'Arquivo pronto para instalar' : progress.message || 'Nenhum arquivo parcial foi mantido');
    const managerBar = manager.querySelector('.race-transfer-bar i'); if(managerBar) managerBar.style.width=`${percent}%`;
  }

  function ensureProgressListener() {
    if (!unsubscribeProgress && desktopAPI()) unsubscribeProgress = desktopAPI().onProgress(progressListener);
  }

  async function runPackages(packages, action, options = {}) {
    const api = desktopAPI();
    if (!api) throw new Error('A instalação de conteúdo está disponível somente no launcher desktop.');
    const ordered = dependencyOrder(packages);
    const work = ordered.filter(pkg => {
      const status=packageStatus(pkg);
      if(action==='download')return !status.downloaded&&(!status.installed||status.updateAvailable||status.damaged);
      if(action==='install')return !status.installed||status.updateAvailable||status.damaged;
      return action==='repair'&&status.damaged;
    });
    const batch = options.batch || { action, cancelled:false, currentSlug:'', currentIndex:-1, total:work.length };
    if (activeBatch && activeBatch !== batch) throw new Error('Já existe uma operação de conteúdo em andamento.');
    batch.total = work.length; activeBatch = batch;
    try {
      for (let index=0; index<work.length; index+=1) {
        const pkg=work[index]; const status=packageStatus(pkg);
        if(batch.cancelled)throw new Error('Download cancelado pelo usuário.');
        batch.currentSlug=pkg.slug;batch.currentIndex=index;
        if(action==='download'){
          progressListener({slug:pkg.slug,name:pkg.name,version:pkg.version,phase:'download',received:0,total:pkg.sizeBytes,percent:0,bytesPerSecond:0,etaSeconds:null});
          await api.download(pkg,sessionToken());
          localState.statuses ||= {};
          localState.statuses[pkg.slug] = { ...packageStatus(pkg), downloaded:true, downloadedVersion:pkg.version };
        }
        if(action==='install'){
          if(!status.downloaded){progressListener({slug:pkg.slug,name:pkg.name,version:pkg.version,phase:'download',received:0,total:pkg.sizeBytes,percent:0,bytesPerSecond:0,etaSeconds:null});await api.download(pkg,sessionToken());localState.statuses ||= {};localState.statuses[pkg.slug]={...packageStatus(pkg),downloaded:true,downloadedVersion:pkg.version};}
          if(batch.cancelled)throw new Error('Download cancelado pelo usuário.');
          await api.install(pkg,sessionToken());
          localState.statuses ||= {};
          localState.statuses[pkg.slug] = { ...packageStatus(pkg), downloaded:true, downloadedVersion:pkg.version, installed:true, installedVersion:pkg.version, updateAvailable:false, damaged:false, missingFiles:0, changedFiles:0 };
        }
        if(action==='repair'&&status.damaged){await api.repair(pkg,sessionToken());localState.statuses ||= {};localState.statuses[pkg.slug]={...packageStatus(pkg),installed:true,installedVersion:pkg.version,downloaded:true,downloadedVersion:pkg.version,updateAvailable:false,damaged:false,missingFiles:0,changedFiles:0};}
        await refreshLocal(catalog,true);
      }
    } finally {
      if(activeBatch===batch)activeBatch=null;
    }
  }

  function contentCard(pkg) {
    const status = packageStatus(pkg);
    const state = status.damaged ? `${Number(status.missingFiles || 0) + Number(status.changedFiles || 0)} arquivo(s) requerem reparo` : status.updateAvailable ? 'Atualização disponível' : status.installed ? `Instalado · v${status.installedVersion}` : status.downloaded ? 'Pronto para instalar' : 'Não instalado';
    const action = !localState.desktop ? ['launcher','Disponível no launcher'] : !localState.detected ? ['locate','Localizar jogo'] : status.damaged ? ['repair','Reparar'] : status.installed && !status.updateAvailable ? ['uninstall','Desinstalar'] : status.downloaded ? ['install',status.updateAvailable ? 'Atualizar' : 'Instalar'] : ['download','Baixar'];
    return `<article class="content-card" data-content-slug="${B.escape(pkg.slug)}">
      <div class="content-cover" style="--content-image:url('${B.escape(B.cleanUrl(pkg.imageUrl, 'assets/historia/assetto.jpg'))}')"><span class="tag ${pkg.community ? 'green' : 'accent'}">${pkg.community ? 'COMUNIDADE' : 'OFICIAL'}</span><i>${B.escape(typeLabel(pkg.type).toUpperCase())}</i></div>
      <div class="content-card-body"><div class="content-title"><div><small>${B.escape(pkg.author || 'Brasil Sim Racing')}</small><h3>${B.escape(pkg.name)}</h3></div><span>v${B.escape(pkg.version)}</span></div><p>${B.escape(pkg.description || 'Conteúdo homologado para eventos da Brasil Sim Racing.')}</p>
      <div class="content-meta"><span>${formatBytes(pkg.sizeBytes)}</span><span>${(pkg.dependencies || []).length} dependência(s)</span><strong class="${status.damaged ? 'negative' : status.installed ? 'positive' : ''}">${B.escape(state)}</strong></div>
      <div class="content-progress"><i></i><span></span></div><div class="content-actions"><button class="button ${action[0] === 'uninstall' ? 'danger' : 'primary'}" type="button" data-content-action="${action[0]}" data-content-id="${B.escape(pkg.objectId)}" ${action[0] === 'launcher' ? 'disabled' : ''}>${B.escape(action[1])}</button>${status.installed ? `<button class="button" type="button" data-content-action="verify" data-content-id="${B.escape(pkg.objectId)}">Verificar</button>` : status.downloaded ? `<button class="button" type="button" data-content-action="clear" data-content-id="${B.escape(pkg.objectId)}">Remover arquivo</button>` : ''}</div></div>
    </article>`;
  }

  function bindCards() {
    document.querySelectorAll('[data-content-action]').forEach(button => button.addEventListener('click', async () => {
      const pkg = catalog.find(item => item.objectId === button.dataset.contentId);
      if (!pkg && button.dataset.contentAction !== 'locate') return;
      button.disabled = true;
      try {
        if (button.dataset.contentAction === 'locate') await desktopAPI().chooseGame();
        else if (button.dataset.contentAction === 'download') await runPackages([pkg], 'download');
        else if (button.dataset.contentAction === 'install') await runPackages([pkg], 'install');
        else if (button.dataset.contentAction === 'repair') await runPackages([pkg], 'repair');
        else if (button.dataset.contentAction === 'uninstall') await desktopAPI().uninstall(pkg.slug);
        else if (button.dataset.contentAction === 'clear') await desktopAPI().clearDownload(pkg.slug);
        else if (button.dataset.contentAction === 'verify') {
          const result = await desktopAPI().verify(pkg.slug);
          window.BSRComponents.toast(result.valid ? 'Conteúdo íntegro' : 'Reparo necessário', result.valid ? `${pkg.name} passou na verificação.` : `${result.missing.length} ausente(s) e ${result.changed.length} alterado(s).`, result.valid ? 'success' : 'error');
        }
        await refreshLocal(catalog, true); await view();
      } catch (error) { button.disabled = false; window.BSRComponents.toast('Operação não concluída',error.message,'error'); }
    }));
  }

  function packageAdminRow(item) {
    const state = item.approved && item.enabled !== false ? ['Publicado','published'] : item.approved ? ['Pausado','paused'] : ['Rascunho','draft'];
    return `<article class="admin-package-row"><div class="admin-package-thumb" style="--image:url('${B.escape(B.cleanUrl(item.imageUrl,'assets/historia/assetto.jpg'))}')"></div><div><span>${B.escape(typeLabel(item.type).toUpperCase())}</span><b>${B.escape(item.name)}</b><small>${B.escape(item.slug)} · v${B.escape(item.version)} · ${formatBytes(item.sizeBytes)}</small></div><em class="content-state ${state[1]}">${state[0]}</em><button type="button" data-edit-content="${B.escape(item.objectId)}">Editar →</button></article>`;
  }

  function adminPanel(context) {
    const packages = context.packages || []; const races = context.races || []; const server = context.server || {};
    const dependencyOptions = packages.map(item => `<label><input type="checkbox" value="${B.escape(item.slug)}"> <span><b>${B.escape(item.name)}</b><small>${B.escape(typeLabel(item.type))} · v${B.escape(item.version)}</small></span></label>`).join('');
    const racePackageOptions = packages.filter(item => item.approved && item.enabled !== false).map(item => `<label><input type="checkbox" value="${B.escape(item.slug)}"> <span><b>${B.escape(item.name)}</b><small>${B.escape(typeLabel(item.type))} · v${B.escape(item.version)}</small></span></label>`).join('');
    return `<section class="content-admin-hub panel"><header class="content-admin-head"><div><span>CENTRAL DE CONTEÚDO</span><h2>Publicação e requisitos</h2><p>Analise o ZIP, revise as informações e publique sem preencher dados técnicos manualmente.</p></div><button class="button primary" id="newContentPackage" type="button">+ Adicionar conteúdo</button></header><nav class="content-admin-tabs" aria-label="Administração de conteúdo"><button class="active" type="button" data-content-tab-button="library">Biblioteca <b>${packages.length}</b></button><button type="button" data-content-tab-button="races">Corridas <b>${races.length}</b></button><button type="button" data-content-tab-button="server">Servidor <i class="${server.configured ? 'ready' : ''}"></i></button></nav>
      <div class="content-admin-page active" data-content-tab="library"><div class="admin-library-toolbar"><div><b>Biblioteca administrativa</b><small>Rascunhos também aparecem aqui, mas não ficam visíveis para os pilotos.</small></div><label>⌕ <input id="adminPackageSearch" placeholder="Buscar conteúdo"></label></div><div class="admin-package-list" id="adminPackageList">${packages.map(packageAdminRow).join('') || '<div class="admin-empty"><b>Nenhum conteúdo cadastrado</b><span>Adicione o primeiro ZIP para começar a biblioteca.</span></div>'}</div>
        <section class="publisher-wizard" id="contentPublisher" hidden><header><div><span id="publisherMode">NOVO CONTEÚDO</span><h3>Assistente de publicação</h3></div><button type="button" id="publisherClose" aria-label="Fechar">×</button></header><ol class="publisher-steps"><li class="active" data-publisher-indicator="1"><b>1</b><span>Arquivo</span></li><li data-publisher-indicator="2"><b>2</b><span>Informações</span></li><li data-publisher-indicator="3"><b>3</b><span>Publicação</span></li><li data-publisher-indicator="4"><b>4</b><span>Revisão</span></li></ol><form id="contentPackageForm"><input id="contentObjectId" type="hidden">
          <section class="publisher-step active" data-publisher-step="1"><div class="publisher-intro"><span>01</span><div><h4>Selecione o ZIP</h4><p>O launcher calcula hash, tamanho e identifica automaticamente onde o conteúdo deve ser instalado.</p></div></div><button class="publisher-drop" id="contentAnalyzeZip" type="button" ${desktopAPI() ? '' : 'disabled'}><i>ZIP</i><b>${desktopAPI() ? 'Selecionar e analisar arquivo' : 'Análise disponível no launcher desktop'}</b><small>Carros, pistas, skins, aplicativos e extensões</small></button><div class="publisher-analysis" id="contentAnalysis"><span>Nenhum arquivo analisado.</span></div><button class="text-link" id="publisherManual" type="button">Preencher dados manualmente</button></section>
          <section class="publisher-step" data-publisher-step="2"><div class="publisher-intro"><span>02</span><div><h4>Confirme as informações</h4><p>Revise somente os dados que os pilotos verão no catálogo.</p></div></div><div class="publisher-fields"><label>Nome do conteúdo<input id="contentName" required maxlength="120"></label><label>Versão<input id="contentVersion" required value="1.0.0"></label><label>Tipo<select id="contentType"><option value="car">Carro</option><option value="track">Pista</option><option value="skin">Skin</option><option value="app">Aplicativo</option><option value="extension">Extensão</option><option value="showroom">Showroom</option></select></label><label>Autor<input id="contentAuthor" value="Brasil Sim Racing"></label><label class="wide">Imagem de capa HTTPS<input id="contentImage" type="url"></label><label class="wide">Descrição<textarea id="contentDescription" maxlength="1000"></textarea></label><label class="publisher-check wide"><input id="contentCommunity" type="checkbox"><span><b>Conteúdo da comunidade</b><small>Identifica conteúdo enviado e aprovado pela comunidade BSR.</small></span></label></div></section>
          <section class="publisher-step" data-publisher-step="3"><div class="publisher-intro"><span>03</span><div><h4>Download e disponibilidade</h4><p>Informe onde o ZIP está hospedado e escolha quando ele ficará visível.</p></div></div><div class="publisher-fields"><label class="wide">URL HTTPS direta do ZIP<input id="contentUrl" type="url" required placeholder="https://arquivos.bsr.com.br/conteudo.zip"></label><label>Status<select id="contentVisibility"><option value="draft">Salvar como rascunho</option><option value="published">Publicar para os pilotos</option><option value="paused">Aprovado, mas indisponível</option></select></label><label>Dependências selecionadas<span class="publisher-selection-count" id="dependencyCount">0 pacotes</span></label></div><div class="publisher-dependencies" id="contentDependencyChecks">${dependencyOptions || '<p>Nenhum outro pacote disponível.</p>'}</div><details class="publisher-advanced"><summary>Configurações avançadas</summary><div class="publisher-fields"><label>Slug<input id="contentSlug" required pattern="[A-Za-z0-9_.-]+"></label><label>ID de destino<input id="contentTarget" placeholder="Pasta no jogo"></label><label class="wide">SHA-256<input id="contentHash" required minlength="64" maxlength="64"></label><label>Tamanho em bytes<input id="contentSize" type="number" min="1" required></label><label>Caminho interno<input id="contentPath" placeholder="pasta/no/zip"></label></div></details></section>
          <section class="publisher-step" data-publisher-step="4"><div class="publisher-intro"><span>04</span><div><h4>Revise antes de salvar</h4><p>Confira o resumo final. Rascunhos não aparecem para os pilotos.</p></div></div><div class="publisher-review" id="publisherReview"></div></section>
          <footer class="publisher-actions"><button class="button" id="publisherBack" type="button" hidden>Voltar</button><span></span><button class="button" id="publisherNext" type="button">Continuar</button><button class="button primary" id="publisherSave" type="submit" hidden>Salvar conteúdo</button></footer></form></section></div>
      <div class="content-admin-page" data-content-tab="races"><header class="admin-page-title"><div><span>CORRIDAS</span><h3>Requisitos de participação</h3><p>Escolha uma corrida e marque o que o piloto precisa instalar.</p></div><span class="server-pill ${server.configured ? 'ready' : ''}">${server.configured ? 'Servidor principal configurado' : 'Configure o servidor principal'}</span></header><form id="raceContentForm" class="race-requirement-builder"><label>Corrida<select id="contentRace"><option value="">Selecione uma corrida</option>${races.map(race => `<option value="${B.escape(race.objectId)}">${B.escape(race.title || 'Corrida')} · ${B.escape(race.track || '')}</option>`).join('')}</select></label><label>Carro usado pelo piloto<input id="contentRequestedCar" list="contentCarTargets" placeholder="Selecionado automaticamente"><datalist id="contentCarTargets">${packages.filter(item=>item.type==='car'&&item.targetId).map(item=>`<option value="${B.escape(item.targetId)}">${B.escape(item.name)}</option>`).join('')}</datalist><small>O Hub sugere o ID do pacote de carro e ignora carros de segurança.</small></label><div class="race-package-picker"><header><div><b>Conteúdos obrigatórios</b><small>Dependências são resolvidas automaticamente para os pilotos.</small></div><label>⌕ <input id="racePackageSearch" placeholder="Buscar pacote"></label></header><div id="contentRequirementChecks">${racePackageOptions || '<p>Publique um conteúdo antes de configurar requisitos.</p>'}</div></div><div class="race-readiness" id="raceReadiness"><i></i><span><b>Selecione uma corrida</b><small>O diagnóstico aparecerá aqui.</small></span></div><button class="button primary" type="submit">Salvar requisitos da corrida</button></form></div>
      <div class="content-admin-page" data-content-tab="server"><header class="admin-page-title"><div><span>SERVIDOR ÚNICO</span><h3>Servidor principal BSR</h3><p>Esta conexão será utilizada por todas as corridas. O carro continua sendo definido em cada evento.</p></div></header><form id="primaryServerForm" class="primary-server-form"><div class="server-visual"><i>AC</i><span><small>ASSETTO CORSA SERVER</small><b id="serverVisualHost">${B.escape(server.serverHost || 'Ainda não configurado')}</b><em class="${server.configured ? 'online' : ''}">${server.configured ? 'CONFIGURADO' : 'PENDENTE'}</em></span></div><div class="publisher-fields"><label class="wide">Domínio ou IP<input id="primaryServerHost" required placeholder="race.bsr.com.br" value="${B.escape(server.serverHost || '')}"></label><label>Porta do servidor<input id="primaryServerPort" type="number" min="1" max="65535" value="${B.escape(server.serverPort || 9600)}"></label><label>Porta HTTP<input id="primaryServerHttpPort" type="number" min="1" max="65535" value="${B.escape(server.serverHttpPort || 8081)}"></label><label class="wide">Senha<input id="primaryServerPassword" type="password" maxlength="100" value="${B.escape(server.serverPassword || '')}"></label></div><div class="server-security-note"><b>Credenciais protegidas</b><span>A senha permanece na classe privada ServerProfile e nunca é enviada ao catálogo público.</span></div><button class="button primary" type="submit">Salvar servidor principal</button></form></div></section>`;
  }

  function bindAdmin(context) {
    const packages = context.packages || []; const byId = new Map(packages.map(item => [item.objectId, item])); const races = new Map((context.races || []).map(item => [item.objectId, item]));
    let generatedSlug = '';
    const activateTab = name => { document.querySelectorAll('[data-content-tab-button]').forEach(button => button.classList.toggle('active',button.dataset.contentTabButton === name)); document.querySelectorAll('[data-content-tab]').forEach(page => page.classList.toggle('active',page.dataset.contentTab === name)); };
    document.querySelectorAll('[data-content-tab-button]').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.contentTabButton)));
    const values = () => ({ objectId:document.getElementById('contentObjectId').value, name:document.getElementById('contentName').value.trim(), slug:document.getElementById('contentSlug').value.trim(), version:document.getElementById('contentVersion').value.trim(), type:document.getElementById('contentType').value, author:document.getElementById('contentAuthor').value.trim(), targetId:document.getElementById('contentTarget').value.trim(), downloadUrl:document.getElementById('contentUrl').value.trim(), sha256:document.getElementById('contentHash').value.trim(), sizeBytes:Number(document.getElementById('contentSize').value), contentPath:document.getElementById('contentPath').value.trim(), imageUrl:document.getElementById('contentImage').value.trim(), description:document.getElementById('contentDescription').value.trim(), dependencies:[...document.querySelectorAll('#contentDependencyChecks input:checked')].map(input=>input.value), community:document.getElementById('contentCommunity').checked });
    let publisherStep = 1;
    const showStep = step => { publisherStep=Math.min(4,Math.max(1,step)); document.querySelectorAll('[data-publisher-step]').forEach(node => node.classList.toggle('active',Number(node.dataset.publisherStep)===publisherStep)); document.querySelectorAll('[data-publisher-indicator]').forEach(node => { const index=Number(node.dataset.publisherIndicator); node.classList.toggle('active',index===publisherStep); node.classList.toggle('complete',index<publisherStep); }); document.getElementById('publisherBack').hidden=publisherStep===1; document.getElementById('publisherNext').hidden=publisherStep===4; document.getElementById('publisherSave').hidden=publisherStep!==4; if(publisherStep===4){const item=values();const visibility=document.getElementById('contentVisibility').value;document.getElementById('publisherReview').innerHTML=`<article><small>CONTEÚDO</small><b>${B.escape(item.name || 'Sem nome')}</b><span>${B.escape(typeLabel(item.type))} · v${B.escape(item.version)}</span></article><article><small>ARQUIVO</small><b>${B.escape(publisherInspection?.archiveName || 'URL externa')}</b><span>${formatBytes(item.sizeBytes)} · ${B.escape(item.targetId || 'Destino automático')}</span></article><article><small>PUBLICAÇÃO</small><b>${visibility==='published'?'Publicado':visibility==='paused'?'Pausado':'Rascunho'}</b><span>${item.dependencies.length} dependência(s)</span></article>`;}};
    const fill = item => { const map={contentObjectId:item?.objectId,contentName:item?.name,contentSlug:item?.slug,contentVersion:item?.version||'1.0.0',contentType:item?.type||'car',contentAuthor:item?.author||'Brasil Sim Racing',contentTarget:item?.targetId,contentUrl:item?.downloadUrl,contentHash:item?.sha256,contentSize:item?.sizeBytes,contentPath:item?.contentPath,contentImage:item?.imageUrl,contentDescription:item?.description};Object.entries(map).forEach(([id,value])=>{const input=document.getElementById(id);if(input)input.value=value||'';});document.getElementById('contentCommunity').checked=Boolean(item?.community);document.getElementById('contentVisibility').value=item?.approved&&item?.enabled!==false?'published':item?.approved?'paused':'draft';document.querySelectorAll('#contentDependencyChecks input').forEach(input=>input.checked=(item?.dependencies||[]).includes(input.value));document.getElementById('dependencyCount').textContent=`${(item?.dependencies||[]).length} pacote(s)`;};
    const openPublisher = item => { publisherInspection=null; fill(item||null); document.getElementById('publisherMode').textContent=item?'EDITAR CONTEÚDO':'NOVO CONTEÚDO'; document.getElementById('contentAnalysis').innerHTML=item?`<b>${B.escape(item.name)}</b><span>Metadados existentes carregados para edição.</span>`:'<span>Nenhum arquivo analisado.</span>'; document.getElementById('contentPublisher').hidden=false; showStep(item?2:1); document.getElementById('contentPublisher').scrollIntoView({behavior:'smooth',block:'start'}); };
    document.getElementById('newContentPackage').addEventListener('click',()=>{activateTab('library');openPublisher(null);});document.getElementById('publisherClose').addEventListener('click',()=>document.getElementById('contentPublisher').hidden=true);document.getElementById('publisherManual').addEventListener('click',()=>showStep(2));
    document.querySelectorAll('[data-edit-content]').forEach(button=>button.addEventListener('click',()=>openPublisher(byId.get(button.dataset.editContent))));
    document.getElementById('contentAnalyzeZip').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;button.querySelector('b').textContent='Analisando estrutura e segurança…';try{const result=await desktopAPI().inspectPackage();if(result.canceled)return;publisherInspection=result;generatedSlug=result.slug||'';const map={contentName:result.name,contentSlug:result.slug,contentType:result.type||'car',contentTarget:result.targetId,contentHash:result.sha256,contentSize:result.sizeBytes,contentPath:result.contentPath};Object.entries(map).forEach(([id,value])=>{const input=document.getElementById(id);if(input&&value!==undefined)input.value=value;});document.getElementById('contentAnalysis').innerHTML=`<div><i>✓</i><span><b>${B.escape(result.archiveName)}</b><small>${formatBytes(result.sizeBytes)} · ${result.fileCount} arquivo(s) · ${B.escape(result.confidence==='high'?'estrutura reconhecida':'revisão recomendada')}</small></span></div>${(result.warnings||[]).map(warning=>`<p>${B.escape(warning)}</p>`).join('')}`;showStep(2);}catch(error){window.BSRComponents.toast('ZIP não analisado',error.message,'error');}finally{button.disabled=false;button.querySelector('b').textContent='Selecionar outro arquivo';}});
    document.getElementById('contentName').addEventListener('input',event=>{const slug=document.getElementById('contentSlug');if(!slug.value||slug.value===generatedSlug){generatedSlug=event.target.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120);slug.value=generatedSlug;}});
    document.getElementById('contentDependencyChecks').addEventListener('change',()=>{const count=document.querySelectorAll('#contentDependencyChecks input:checked').length;document.getElementById('dependencyCount').textContent=`${count} pacote(s)`;});
    document.getElementById('publisherBack').addEventListener('click',()=>showStep(publisherStep-1));document.getElementById('publisherNext').addEventListener('click',()=>{if(publisherStep===2&&!['contentName','contentVersion','contentAuthor'].every(id=>document.getElementById(id).reportValidity()))return;if(publisherStep===3&&!['contentUrl','contentSlug','contentHash','contentSize'].every(id=>document.getElementById(id).reportValidity()))return;showStep(publisherStep+1);});
    document.getElementById('contentPackageForm').addEventListener('submit',async event=>{event.preventDefault();const button=document.getElementById('publisherSave');button.disabled=true;try{const payload=values();const detectedTarget=String(publisherInspection?.targetId||'').trim();if(['car','track'].includes(payload.type)&&detectedTarget&&payload.targetId.toLowerCase()!==detectedTarget.toLowerCase()){const targetInput=document.getElementById('contentTarget');targetInput.value=detectedTarget;showStep(3);targetInput.focus();throw new Error(`O pacote analisado usa o ID “${detectedTarget}”. O campo foi corrigido automaticamente; revise e salve novamente.`);}const visibility=document.getElementById('contentVisibility').value;payload.approved=visibility!=='draft';payload.enabled=visibility==='published';await window.BSR_API.upsertContentPackage(payload);catalog=[];window.BSRComponents.toast('Conteúdo salvo',visibility==='published'?'O pacote já está disponível para os pilotos.':'O pacote foi salvo sem publicação pública.','success');await view();}catch(error){button.disabled=false;window.BSRComponents.toast('Pacote não salvo',error.message,'error');}});
    document.getElementById('adminPackageSearch').addEventListener('input',event=>{const term=event.target.value.toLowerCase();document.querySelectorAll('.admin-package-row').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(term));});
    document.getElementById('primaryServerHost').addEventListener('input',event=>document.getElementById('serverVisualHost').textContent=event.target.value||'Ainda não configurado');
    document.getElementById('primaryServerForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('[type=submit]');button.disabled=true;try{await window.BSR_API.setContentServerProfile({serverHost:document.getElementById('primaryServerHost').value,serverPort:Number(document.getElementById('primaryServerPort').value),serverHttpPort:Number(document.getElementById('primaryServerHttpPort').value),serverPassword:document.getElementById('primaryServerPassword').value});window.BSRComponents.toast('Servidor atualizado','Todas as corridas usarão esta conexão principal.','success');await view();}catch(error){button.disabled=false;window.BSRComponents.toast('Servidor não salvo',error.message,'error');}});
    let automaticCar='';
    const selectedPackages=()=>[...document.querySelectorAll('#contentRequirementChecks input:checked')].map(input=>packages.find(item=>item.slug===input.value)).filter(Boolean);
    const suggestCar=race=>{const input=document.getElementById('contentRequestedCar');const suggestion=recommendedRaceCar(selectedPackages(),race);if(!input.value||input.value===automaticCar){input.value=suggestion?.targetId||'';automaticCar=input.value;}};
    const updateReadiness=race=>{const selected=document.querySelectorAll('#contentRequirementChecks input:checked').length;const root=document.getElementById('raceReadiness');root.classList.toggle('ready',Boolean(race&&context.server?.configured&&document.getElementById('contentRequestedCar').value));root.innerHTML=`<i>${race&&context.server?.configured?'✓':'!'}</i><span><b>${!race?'Selecione uma corrida':!context.server?.configured?'Servidor principal pendente':!document.getElementById('contentRequestedCar').value?'Selecione o carro usado pelo piloto':'Configuração pronta'}</b><small>${selected} conteúdo(s) obrigatório(s) selecionado(s)</small></span>`;};
    document.getElementById('contentRace').addEventListener('change',event=>{const race=races.get(event.target.value);automaticCar='';document.getElementById('contentRequestedCar').value=race?.requestedCar||'';document.querySelectorAll('#contentRequirementChecks input').forEach(input=>input.checked=(race?.requirementSlugs||[]).includes(input.value));suggestCar(race);updateReadiness(race);});document.getElementById('contentRequestedCar').addEventListener('input',()=>{automaticCar='';updateReadiness(races.get(document.getElementById('contentRace').value));});document.getElementById('contentRequirementChecks').addEventListener('change',()=>{const race=races.get(document.getElementById('contentRace').value);suggestCar(race);updateReadiness(race);});document.getElementById('racePackageSearch').addEventListener('input',event=>{const term=event.target.value.toLowerCase();document.querySelectorAll('#contentRequirementChecks label').forEach(label=>label.hidden=!label.textContent.toLowerCase().includes(term));});
    document.getElementById('raceContentForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('[type=submit]');button.disabled=true;try{const raceId=document.getElementById('contentRace').value;if(!raceId)throw new Error('Selecione uma corrida.');if(!context.server?.configured)throw new Error('Configure o servidor principal antes de liberar a corrida.');await window.BSR_API.setRaceContentConfig(raceId,[...document.querySelectorAll('#contentRequirementChecks input:checked')].map(input=>input.value),{requestedCar:document.getElementById('contentRequestedCar').value});window.BSRComponents.toast('Requisitos salvos','A corrida utilizará o servidor principal da BSR.','success');button.disabled=false;}catch(error){button.disabled=false;window.BSRComponents.toast('Configuração não salva',error.message,'error');}});
  }

  async function view() {
    const C = window.BSRComponents; C.setView?.('');
    document.getElementById('view').innerHTML = `${C.sectionHead('CONTEÚDO','Biblioteca BSR','', 'Carros, pistas, skins e aplicativos homologados, instalados diretamente pelo launcher.')}<div class="loading-grid"><div class="skeleton"></div><div class="skeleton"></div></div>`;
    try {
      await loadCatalog(true); await refreshLocal(catalog, true); ensureProgressListener();
      const adminContext = B.state.isAdmin ? await window.BSR_API.getContentAdminContext() : null;
      if (B.state.route !== 'content') return;
      const adminBanner = adminContext ? `<section class="content-admin-banner"><div><span>MODO ORGANIZAÇÃO</span><b>Catálogo e servidor principal conectados</b><small>${adminContext.packages.length} pacotes · ${adminContext.races.length} corridas disponíveis para configuração</small></div><nav><a class="button" href="#/admin">Central administrativa</a><a class="button primary" href="#/race-control">Lançar resultados</a></nav></section>` : '';
      document.getElementById('view').innerHTML = `${adminBanner}<section class="content-system panel"><div><span class="content-system-icon">AC</span><div><small>ASSETTO CORSA</small><b>${localState.desktop ? localState.detected ? 'Instalação detectada' : 'Instalação não localizada' : 'Gerenciamento disponível no launcher desktop'}</b><p>${B.escape(localState.gamePath || 'Abra o launcher instalado para baixar e instalar conteúdos.')}</p></div></div>${localState.desktop ? `<button class="button" id="chooseGameFolder" type="button">${localState.detected ? 'Alterar pasta' : 'Localizar jogo'}</button>` : '<span class="tag accent">MODO WEB</span>'}</section><div class="view-toolbar"><label class="filter-field">⌕ <input id="contentSearch" placeholder="Buscar carro, pista ou skin"></label><label class="filter-field"><select id="contentTypeFilter"><option value="all">Todos os conteúdos</option><option value="car">Carros</option><option value="track">Pistas</option><option value="skin">Skins</option><option value="app">Aplicativos</option><option value="extension">Extensões</option></select></label><span class="result-count">${catalog.length} pacotes</span></div><div class="content-grid-catalog" id="contentGrid">${catalog.length ? catalog.map(contentCard).join('') : C.empty('Catálogo pronto para receber conteúdo','Um administrador pode cadastrar o primeiro pacote nesta mesma tela.')}</div>${adminContext ? adminPanel(adminContext) : ''}`;
      const render=()=>{const q=document.getElementById('contentSearch').value.toLowerCase();const type=document.getElementById('contentTypeFilter').value;document.getElementById('contentGrid').innerHTML=catalog.filter(item=>(type==='all'||item.type===type)&&`${item.name} ${item.author} ${item.description}`.toLowerCase().includes(q)).map(contentCard).join('')||C.empty('Nenhum conteúdo encontrado','Altere os filtros para ver outros pacotes.');bindCards();};
      document.getElementById('contentSearch').addEventListener('input',render);document.getElementById('contentTypeFilter').addEventListener('change',render);document.getElementById('chooseGameFolder')?.addEventListener('click',async()=>{try{await desktopAPI().chooseGame();await refreshLocal();await view();}catch(error){C.toast('Jogo não localizado',error.message,'error');}});bindCards();if(adminContext){bindAdmin(adminContext);const requestedRace=sessionStorage.getItem('bsr_admin_content_race');if(requestedRace&&document.querySelector(`#contentRace option[value="${CSS.escape(requestedRace)}"]`)){const selector=document.getElementById('contentRace');selector.value=requestedRace;selector.dispatchEvent(new Event('change'));sessionStorage.removeItem('bsr_admin_content_race');selector.scrollIntoView({behavior:'smooth',block:'center'});}}
    } catch(error){document.getElementById('view').innerHTML=`<div class="panel">${C.empty('Catálogo indisponível',error.message,'<button class="button primary" onclick="location.reload()">Tentar novamente</button>')}</div>`;}
  }

  async function mountRaceRequirements(race, drawer) {
    const root=drawer.querySelector('#raceContentStatus'); const button=drawer.querySelector('#raceContentButton'); if(!root||!button)return;
    try {
      const direct=await window.BSR_API.getRaceRequirements(race.id); await loadCatalog(); const requirements=dependencyOrder(direct,catalog); await refreshLocal(requirements,true); ensureProgressListener();
      const draw=()=>{const damaged=requirements.filter(item=>packageStatus(item).damaged);const pending=requirements.filter(item=>{const status=packageStatus(item);return !status.installed||status.updateAvailable;});const downloads=pending.filter(item=>!packageStatus(item).downloaded);const currentBatch=activeBatch&&requirements.some(item=>item.slug===activeBatch.currentSlug)?activeBatch:null;const currentProgress=currentBatch?transferProgress.get(currentBatch.currentSlug):null;root.innerHTML=requirements.length?`<div class="race-requirements">${requirements.map(item=>{const status=packageStatus(item);const progress=transferProgress.get(item.slug);const transferring=workingPhases.has(progress?.phase);const complete=['downloaded','installed'].includes(progress?.phase);const state=status.damaged?'damaged':status.installed&&!status.updateAvailable?'ready':status.downloaded||complete?'downloaded':'';const icon=status.damaged?'×':status.installed&&!status.updateAvailable?'✓':status.downloaded||complete?'↓':'!';const progressText=progress?.phase==='download'?`${Number(progress.percent||0)}% · ${formatRate(progress.bytesPerSecond)}`:installPhases.has(progress?.phase)?`${Number(progress.percent||0)}%${progress.message?` · ${shortFile(progress.message)}`:''}`:complete?'Concluído':'';return `<div class="race-requirement ${transferring?'is-transferring':''} ${complete?'is-complete':''}" data-race-requirement="${B.escape(item.slug)}"><span class="requirement-state ${state}">${icon}</span><b>${B.escape(item.name)}</b><small>${B.escape(item.version)} · ${status.damaged?'reparo necessário':status.updateAvailable?'atualização necessária':formatBytes(item.sizeBytes)}</small><div class="requirement-transfer"><span><i style="width:${Math.max(0,Math.min(100,Number(progress?.percent||0)))}%"></i></span><em>${B.escape(progressText)}</em></div></div>`;}).join('')}</div><section class="race-download-manager" id="raceDownloadManager" ${currentProgress?'':'hidden'} aria-live="polite"><header><div><small data-transfer-kicker>${installPhases.has(currentProgress?.phase)?'GERENCIADOR DE INSTALAÇÃO':'GERENCIADOR DE DOWNLOAD'}</small><b data-transfer-name>${B.escape(currentProgress?.name||'Preparando requisitos…')}</b><span data-transfer-file>Pacote ${Math.min((currentBatch?.currentIndex||0)+1,currentBatch?.total||requirements.length)} de ${currentBatch?.total||requirements.length}</span></div><strong data-transfer-percent>${Number(currentProgress?.percent||0)}%</strong></header><div class="race-transfer-bar"><i style="width:${Number(currentProgress?.percent||0)}%"></i></div><footer><span data-transfer-bytes>Preparando…</span><span data-transfer-speed>Aguardando operação</span><span data-transfer-eta>${B.escape(currentProgress?.message||'Preparando requisitos…')}</span></footer></section>`:'<p>Nenhum conteúdo adicional é necessário para esta corrida.</p>';
        button.classList.remove('danger','primary');
        if(currentBatch){const label=currentBatch.action==='download'?'download':'instalação';button.textContent=currentBatch.cancelled?`Cancelando ${label}…`:`Cancelar ${label}`;button.disabled=Boolean(currentBatch.cancelled);button.dataset.action='cancel';button.classList.add('danger');return;}
        if(!desktopAPI()){button.textContent='Abra no launcher para instalar';button.disabled=true;return;}
        if(!localState.detected){button.textContent='Localizar Assetto Corsa';button.disabled=false;button.dataset.action='locate';return;}
        if(downloads.length){button.textContent=`Baixar requisitos (${downloads.length})`;button.disabled=false;button.dataset.action='download';return;}
        if(pending.length){button.textContent=`Instalar requisitos (${pending.length})`;button.disabled=false;button.dataset.action='install';return;}
        if(damaged.length){button.textContent=`Reparar requisitos (${damaged.length})`;button.disabled=false;button.dataset.action='repair';return;}
        button.textContent='Entrar no servidor';button.disabled=false;button.dataset.action='join';button.classList.add('primary');};
      draw(); button.onclick=async()=>{
        const action=button.dataset.action;
        if(action==='cancel'){
          const batch=activeBatch;if(!batch){draw();return;}
          batch.cancelled=true;button.disabled=true;
          const progress=transferProgress.get(batch.currentSlug);
          const installing=batch.action==='repair'||progress?.operation==='install'||installPhases.has(progress?.phase);
          button.textContent=installing?'Cancelando instalação…':'Cancelando download…';
          if(batch.currentSlug){if(installing)await desktopAPI().cancelInstall(batch.currentSlug);else await desktopAPI().cancelDownload(batch.currentSlug);}
          return;
        }
        button.disabled=true;let batch=null;
        try{
          if(action==='locate')await desktopAPI().chooseGame();
          else if(['download','install','repair'].includes(action)){
            batch={action,cancelled:false,currentSlug:'',currentIndex:-1,total:requirements.length};
            button.textContent=action==='download'?'Cancelar download':'Cancelar instalação';button.disabled=false;button.dataset.action='cancel';button.classList.remove('primary');button.classList.add('danger');
            await runPackages(requirements,action,{batch});
          }else if(action==='join'){
            if(!B.state.driver)throw new Error('Entre com a Steam antes de conectar.');await refreshLocal(requirements,true);const invalid=requirements.filter(item=>{const status=packageStatus(item);return !status.installed||status.updateAvailable||status.damaged;});if(invalid.length){draw();throw new Error(`Corrija ${invalid.length} requisito(s) antes de entrar no servidor.`);}const suggestedCar=recommendedRaceCar(requirements,race);const suggestedTrack=recommendedRaceTrack(requirements,race);if(!suggestedCar)throw new Error('Não foi possível identificar o carro desta corrida nos requisitos publicados.');if(!suggestedTrack)throw new Error('Não foi possível identificar a pista desta corrida nos requisitos publicados.');const config=await window.BSR_API.getRaceLaunchConfig(race.id,suggestedCar.targetId);await desktopAPI().joinServer({...config,expectedTrack:suggestedTrack.targetId,expectedTrackName:suggestedTrack.name||suggestedTrack.targetId,steamGUID:B.state.driver.steamGUID,driverName:B.state.driver.name});window.BSRComponents.toast('Assetto Corsa iniciado','Preset do servidor e conteúdo local validados. Conectando à corrida.','success');return;
          }
          await refreshLocal(requirements,true);
        }catch(error){if(!isCancellation(error))window.BSRComponents.toast('Ação não concluída',error.message,'error');}
        finally{if(action!=='join'){await refreshLocal(requirements,true).catch(()=>{});if(root.isConnected)draw();}}
      };
    } catch(error){root.innerHTML=`<p>Não foi possível verificar os requisitos: ${B.escape(error.message)}</p>`;button.hidden=true;}
  }

  window.BSRContent = { view, mountRaceRequirements, refreshLocal, loadCatalog };
})();
