const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false }
  });
  const run = code => window.webContents.executeJavaScript(code);
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await run(expression)) return;
      await delay(200);
    }
    throw new Error(`Timeout aguardando: ${expression}`);
  };

  try {
    await window.loadFile(path.resolve(__dirname, '..', 'index.html'));
    await waitFor("document.documentElement.classList.contains('app-ready')");
    assert.equal(await run("getComputedStyle(document.querySelector('#app')).opacity"), '1');
    assert.notEqual(await run("getComputedStyle(document.querySelector('.nav-glider')).transitionDuration"), '0s', 'a navegação deve manter animações ativas');
    const shellBounds = await run(`(()=>{
      document.documentElement.classList.add('electron-shell');
      const rect=document.querySelector('#app').getBoundingClientRect();
      return {left:rect.left,top:rect.top,width:rect.width,minHeight:getComputedStyle(document.querySelector('#app')).minHeight,viewport:innerWidth};
    })()`);
    assert.equal(shellBounds.left, 0, 'launcher desktop não deve ter margem lateral');
    assert.equal(shellBounds.top, 30, 'conteúdo deve começar logo abaixo da barra nativa');
    assert.equal(shellBounds.width, shellBounds.viewport, 'launcher desktop deve ocupar toda a largura da janela');
    assert.match(shellBounds.minHeight, /930px|calc/, 'launcher desktop deve preencher a altura útil da janela');
    const online = await run('BSR.state.online');
    if (!online) {
      const diagnostics = await run(`Promise.allSettled([
        BSR_API.getRaces(1, true),
        BSR_API.getChampionships(1)
      ]).then(results => results.map(result => result.status === 'fulfilled'
        ? { status: result.status }
        : { status: result.status, reason: String(result.reason?.stack || result.reason) }))`);
      console.error('Backend diagnostics:', JSON.stringify(diagnostics));
    }
    assert.equal(online, true);

    await run(`(async()=>{
      const originalCatalog=BSR_API.getContentCatalog;
      const originalRequirements=BSR_API.getRaceRequirements;
      const pkg={objectId:'download-smoke-package',slug:'download-smoke',name:'Pacote de teste',version:'1.0.0',type:'car',sizeBytes:104857600,dependencies:[]};
      const fixture=document.createElement('section');fixture.id='downloadSmokeFixture';fixture.innerHTML='<div id="raceContentStatus"></div><button id="raceContentButton" type="button"></button>';document.body.appendChild(fixture);
      window.__contentMode='download';
      const local=()=>({desktop:true,detected:true,gamePath:'C:/Assetto Corsa',statuses:{'download-smoke':{installed:false,downloaded:window.__contentMode==='install',updateAvailable:false}}});
      window.electronAPI={content:{
        initialize:async()=>({desktop:true,detected:true,gamePath:'C:/Assetto Corsa',statuses:{}}),
        status:async()=>local(), audit:async()=>local(),
        onProgress:callback=>{window.__downloadProgress=callback;return()=>{};},
        download:async()=>new Promise((resolve,reject)=>{window.__downloadResolve=resolve;window.__downloadReject=reject;}),
        cancelDownload:async slug=>{window.__cancelledSlug=slug;window.__downloadProgress({slug,name:pkg.name,version:pkg.version,phase:'cancelled',received:26214400,total:pkg.sizeBytes,percent:0,bytesPerSecond:0,etaSeconds:null});window.__downloadReject(new Error('Download cancelado pelo usuário.'));return{ok:true,canceled:true,slug};},
        install:async()=>new Promise((resolve,reject)=>{window.__installResolve=resolve;window.__installReject=reject;}),
        cancelInstall:async slug=>{window.__cancelledInstallSlug=slug;window.__downloadProgress({slug,name:pkg.name,version:pkg.version,operation:'install',phase:'install-cancelled',percent:0,message:'Instalação cancelada e alterações revertidas.'});window.__installReject(new Error('Instalação cancelada pelo usuário.'));return{ok:true,canceled:true,slug};}
      }};
      BSR_API.getContentCatalog=async()=>[pkg];BSR_API.getRaceRequirements=async()=>[pkg];
      await BSRContent.mountRaceRequirements({id:'download-smoke-race'},fixture);
      fixture.querySelector('#raceContentButton').click();
      await new Promise(resolve=>setTimeout(resolve,10));
      window.__downloadProgress({slug:pkg.slug,name:pkg.name,version:pkg.version,phase:'download',received:26214400,total:pkg.sizeBytes,percent:25,bytesPerSecond:1048576,etaSeconds:75});
      await new Promise(resolve=>setTimeout(resolve,10));
      window.__downloadSmokeSnapshot={
        manager:fixture.querySelector('#raceDownloadManager')?.textContent||'',
        hidden:fixture.querySelector('#raceDownloadManager')?.hidden,
        button:fixture.querySelector('#raceContentButton')?.textContent||''
      };
      fixture.querySelector('#raceContentButton').click();
      await new Promise(resolve=>setTimeout(resolve,40));
      window.__downloadSmokeSnapshot.cancelledSlug=window.__cancelledSlug;
      window.__downloadSmokeSnapshot.afterCancel=fixture.querySelector('#raceContentButton')?.textContent||'';
      window.__contentMode='download';
      await BSRContent.mountRaceRequirements({id:'download-smoke-race'},fixture);
      fixture.querySelector('#raceContentButton').click();
      await new Promise(resolve=>setTimeout(resolve,10));
      window.__contentMode='install';
      window.__downloadProgress({slug:pkg.slug,name:pkg.name,version:pkg.version,phase:'downloaded',received:pkg.sizeBytes,total:pkg.sizeBytes,percent:100,bytesPerSecond:0,etaSeconds:0});
      window.__downloadResolve({ok:true});
      for(let i=0;i<40&&!/Instalar requisitos/.test(fixture.querySelector('#raceContentButton')?.textContent||'');i+=1)await new Promise(resolve=>setTimeout(resolve,25));
      window.__downloadSmokeSnapshot.afterSuccess=fixture.querySelector('#raceContentButton')?.textContent||'';
      window.__contentMode='install';
      await BSRContent.mountRaceRequirements({id:'download-smoke-race'},fixture);
      fixture.querySelector('#raceContentButton').click();
      await new Promise(resolve=>setTimeout(resolve,10));
      window.__downloadProgress({slug:pkg.slug,name:pkg.name,version:pkg.version,operation:'install',phase:'install',current:7,total:20,percent:58,message:'content/cars/bsr_test_car/data.acd'});
      await new Promise(resolve=>setTimeout(resolve,10));
      window.__downloadSmokeSnapshot.installManager=fixture.querySelector('#raceDownloadManager')?.textContent||'';
      window.__downloadSmokeSnapshot.installButton=fixture.querySelector('#raceContentButton')?.textContent||'';
      fixture.querySelector('#raceContentButton').click();
      await new Promise(resolve=>setTimeout(resolve,40));
      window.__downloadSmokeSnapshot.cancelledInstallSlug=window.__cancelledInstallSlug;
      BSR_API.getContentCatalog=originalCatalog;BSR_API.getRaceRequirements=originalRequirements;fixture.remove();delete window.electronAPI;
    })()`);
    const downloadUi = await run('window.__downloadSmokeSnapshot');
    assert.equal(downloadUi.hidden, false, 'gerenciador de download deve ficar visível durante a transferência');
    assert.match(downloadUi.manager, /Pacote de teste/);
    assert.match(downloadUi.manager, /25%/);
    assert.match(downloadUi.manager, /1(?:\.0)? MB\/s/);
    assert.equal(downloadUi.button, 'Cancelar download');
    assert.equal(downloadUi.cancelledSlug, 'download-smoke');
    assert.match(downloadUi.afterCancel, /Baixar requisitos/);
    assert.match(downloadUi.afterSuccess, /Instalar requisitos/, 'download concluído deve liberar instalação sem reabrir a corrida');
    assert.match(downloadUi.installManager, /GERENCIADOR DE INSTALAÇÃO/);
    assert.match(downloadUi.installManager, /58%/);
    assert.match(downloadUi.installManager, /content\/cars\/bsr_test_car\/data\.acd/);
    assert.equal(downloadUi.installButton, 'Cancelar instalação');
    assert.equal(downloadUi.cancelledInstallSlug, 'download-smoke');

    const restricted = await run("BSR.state.access?.allowed === false");
    if (restricted) {
      assert.equal(await run("Boolean(document.querySelector('.hub-access-stage'))"), true, 'modo restrito deve mostrar o portal de acesso');
      assert.equal(await run("Boolean(document.querySelector('a[href=\"login.html\"]'))"), true, 'portal deve oferecer autenticação Steam');
      console.log('Launcher smoke checks passed in invite-only mode.');
      app.exit(0);
      return;
    }

    await run("location.hash='#/races'");
    await waitFor("Boolean(document.querySelector('#raceGrid'))");
    const ordering = await run(`({
      actual: [...document.querySelectorAll('#raceGrid [data-race-id]')].map(node => node.dataset.raceId),
      expected: BSR.sortRaces(BSR.state.races, 'new').map(race => race.id)
    })`);
    assert.deepEqual(ordering.actual, ordering.expected, 'corridas devem estar da mais recente para a mais antiga');

    await run("location.hash='#/standings'");
    await waitFor("document.querySelectorAll('#standingsBody tr').length > 0");
    const standings = await run(`({
      names:[...document.querySelectorAll('#standingsBody .driver-cell b')].map(node => node.textContent.trim()),
      ratings:[...document.querySelectorAll('#standingsBody tr')].map(row => row.cells[4]?.textContent.trim()),
      safety:[...document.querySelectorAll('#standingsBody tr')].map(row => row.cells[5]?.textContent.trim())
    })`);
    assert.equal(standings.names.some(name => name === 'Piloto'), false, 'classificação não deve usar nomes genéricos');
    assert.equal(standings.ratings.some(value => value && value !== '1.600'), true, 'classificação deve mostrar iRating real');
    assert.equal(standings.safety.some(value => value && value !== '0.00'), true, 'classificação deve mostrar SR real');

    await run("location.hash='#/content'");
    await waitFor("Boolean(document.querySelector('.content-system'))");
    assert.match(await run("document.querySelector('.content-system').textContent"), /ASSETTO CORSA/i, 'biblioteca de conteúdo deve carregar');
    assert.equal(await run("document.querySelector('[data-route=content]')?.textContent.includes('Conteúdo')"), true, 'navegação deve expor a biblioteca');

    await run(`(()=>{
      BSR.state.isAdmin=true;
      BSR_API.getContentAdminContext=async()=>({
        server:{configured:true,serverHost:'race.bsr.com.br',serverPort:9600,serverHttpPort:8081,serverPassword:'test'},
        packages:[
          {objectId:'pkg-live',slug:'bsr-gt3',name:'BSR GT3',version:'1.2.0',type:'car',author:'BSR',sizeBytes:104857600,approved:true,enabled:true,dependencies:[]},
          {objectId:'pkg-draft',slug:'draft-track',name:'Pista em revisão',version:'0.9.0',type:'track',author:'BSR',sizeBytes:52428800,approved:false,enabled:false,dependencies:[]}
        ],
        races:[{objectId:'race-admin',title:'GT3 Sprint',track:'Interlagos',requestedCar:'bsr_gt3',requirementSlugs:['bsr-gt3']}]
      });
      return BSRContent.view();
    })()`);
    await waitFor("Boolean(document.querySelector('.content-admin-hub'))");
    assert.equal(await run("document.querySelectorAll('.content-admin-tabs button').length"), 3, 'central deve separar biblioteca, corridas e servidor');
    await run("document.querySelector('[data-content-tab-button=races]').click()");
    await delay(250);
    assert.equal(await run("document.querySelector('.content-admin-page.active')?.dataset.contentTab"), 'races');
    assert.equal(await run("document.querySelectorAll('#contentRequirementChecks input').length"), 1, 'corridas devem listar somente pacotes publicados');
    assert.match(await run("document.querySelector('[data-content-tab=races]').textContent"), /Servidor principal configurado/i);
    await run("document.querySelector('[data-content-tab-button=server]').click()");
    await delay(250);
    assert.equal(await run("document.querySelector('.content-admin-page.active')?.dataset.contentTab"), 'server');
    assert.match(await run("document.querySelector('[data-content-tab=server]').textContent"), /race\.bsr\.com\.br/i);
    await window.webContents.capturePage().then(image => require('node:fs').writeFileSync(path.join(__dirname, 'artifacts', 'content-admin-1440.png'), image.toPNG()));

    const freeRace = await run(`(async()=>{
      const race=BSR.normalizeRace({objectId:'smoke-free-race',title:'Sessão livre',track:'Interlagos',status:'aberta',requiresRegistration:false,cars:[{name:'GT3'}]});
      BSR.state.races.push(race);
      await BSRComponents.openRace(race.id);
      const result={hasReservationButton:Boolean(document.querySelector('#raceJoinButton')),copy:document.querySelector('#drawer')?.textContent||''};
      BSRComponents.closeDrawer(); BSR.state.races=BSR.state.races.filter(item=>item.id!==race.id); return result;
    })()`);
    assert.equal(freeRace.hasReservationButton, false, 'corrida livre não deve solicitar inscrição');
    assert.match(freeRace.copy, /Acesso livre/i, 'corrida livre deve explicar o acesso sem inscrição');

    await run("location.hash='#/admin'");
    await waitFor("Boolean(document.querySelector('.admin-auth-stage,.admin-command-header'))");
    assert.equal(await run("Boolean(document.querySelector('a[href=\"admin.html\"]'))"), false, 'launcher não deve depender do painel administrativo legado');
    assert.equal(await run("Boolean(document.querySelector('#launcherAdminLogin,.admin-command-header'))"), true, 'administração deve abrir dentro do launcher');

    await run(`(()=>{
      BSR.state.isAdmin=false;
      BSR.state.access={mode:'invite',allowed:false,authenticated:false,reason:'login_required',steamId:'',displayName:''};
      location.hash='#/standings';
    })()`);
    await waitFor("Boolean(document.querySelector('.hub-access-stage'))");
    assert.equal(await run("Boolean(document.querySelector('a[href=\"login.html\"]'))"), true, 'portal restrito deve oferecer login Steam');
    assert.equal(await run("document.querySelector('.app-shell').dataset.access"), 'restricted', 'shell deve ocultar a navegação enquanto o acesso está bloqueado');
    await run(`(()=>{
      BSR.state.access={mode:'invite',allowed:false,authenticated:true,reason:'not_invited',steamId:'76561198000000000',displayName:'Piloto Teste'};
      location.hash='#/races';
    })()`);
    await waitFor("document.querySelector('.hub-access-identity')?.textContent.includes('76561198000000000')");
    assert.match(await run("document.querySelector('.hub-access-card').textContent"), /não está na lista/i, 'piloto não convidado deve receber uma mensagem clara');
    await run("location.hash='#/admin'");
    await waitFor("Boolean(document.querySelector('#launcherAdminLogin'))");
    assert.equal(await run("document.querySelector('.app-shell').hasAttribute('data-access')"), false, 'login administrativo deve continuar acessível durante o modo restrito');
    await run(`(()=>{
      BSR.state.access={mode:'open',allowed:true,authenticated:false,reason:'open',steamId:'',displayName:''};
      location.hash='#/races';
    })()`);
    await waitFor("Boolean(document.querySelector('#raceGrid'))");

    for (const width of [1440, 900, 390]) {
      window.setSize(width, 960);
      await delay(250);
      assert.equal(await run('document.documentElement.scrollWidth > innerWidth'), false, `overflow horizontal em ${width}px`);
    }

    console.log('Launcher smoke checks passed.');
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error);
    app.exit(1);
  }
});
