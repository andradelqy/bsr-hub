const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width:1440, height:960, show:false, webPreferences:{ offscreen:true, nodeIntegration:false, contextIsolation:true, backgroundThrottling:false } });
  const run = code => window.webContents.executeJavaScript(code);
  const output = path.resolve(__dirname, 'artifacts');
  fs.mkdirSync(output, { recursive:true });
  try {
    await window.loadFile(path.resolve(__dirname, '..', 'index.html'));
    for (let attempt = 0; attempt < 160; attempt += 1) {
      if (await run("document.documentElement.classList.contains('app-ready')")) break;
      await delay(200);
    }
    await delay(2200);

    await run(`(()=>{
      BSR.state.route='career';
      document.getElementById('app').dataset.route='career';
      BSR.state.driver={objectId:'driver-me',name:'Piloto Teste',steamName:'Piloto Teste',licenseClass:'C',driverRank:'C',licenseMPR:3,contactBadge:'Good',totalRaces:12,irating:1842,safetyRating:3.67,reliability:94,ratingConfidence:58,ratingProvisional:false,primaryDiscipline:'road',skillRatings:{road:{display:1842,confidence:58,provisional:false},formula:{display:1678,confidence:31,provisional:true}},safetyRatings:{road:{rating:3.67,license:'C',mpr:3,badge:'Good'},formula:{rating:2.91,license:'D',mpr:1,badge:'Rookie'}}};
      BSR.state.driverResults=[{raceTitle:'GT3 Interlagos',carModel:'GT3',officialPosition:2,oldIRating:1810,newIRating:1842,deltaIRating:32,oldSafetyRating:3.61,newSafetyRating:3.67,deltaSafetyRating:.06,sessionDate:new Date().toISOString()}];
      BSRViews.career();
    })()`);
    await delay(1800);
    assert.equal(await run("document.querySelectorAll('.rating-stat-grid .stat-card').length"), 6);
    assert.equal(await run("document.querySelectorAll('.discipline-rating').length"), 2);
    assert.equal(await run("document.querySelectorAll('.discipline-license').length"), 2);
    assert.match(await run("document.querySelector('.discipline-license').textContent"), /SR 3\.67.*MPR 3.*Good/);
    assert.match(await run("document.querySelector('.profile-rating').textContent"), /CONFIABILIDADE 94%/);
    fs.writeFileSync(path.join(output, 'ratings-career-1440.png'), (await window.webContents.capturePage()).toPNG());

    await run(`(async()=>{
      const drivers=[
        {objectId:'d1',name:'Piloto A',licenseClass:'B',irating:2100,safetyRating:3.8,reliability:98,ratingConfidence:72,ratingProvisional:false,primaryDiscipline:'road'},
        {objectId:'d2',name:'Piloto B',licenseClass:'D',irating:1700,safetyRating:4.1,reliability:91,ratingConfidence:20,ratingProvisional:true,primaryDiscipline:'formula'}
      ];
      BSR.loadDrivers=async()=>drivers; BSR.loadStandings=async()=>[]; BSR.state.route='standings'; document.getElementById('app').dataset.route='standings'; await BSRViews.standings();
    })()`);
    await delay(1800);
    assert.equal(await run("document.querySelectorAll('#standingsBody tr').length"), 2);
    assert.equal(await run("document.querySelectorAll('.data-table thead th').length"), 8);
    assert.match(await run("document.querySelector('#standingsBody tr').textContent"), /2\.100/);
    fs.writeFileSync(path.join(output, 'ratings-standings-1440.png'), (await window.webContents.capturePage()).toPNG());

    await run(`(async()=>{
      BSR.state.isAdmin=true; BSR.state.route='race-control'; document.getElementById('app').dataset.route='race-control';
      BSR_API.getRaceProcessorContext=async()=>({races:[{objectId:'race-1',title:'GT3 Sprint',track:'Interlagos',startAt:new Date().toISOString()}],imports:[]});
      BSR_API.getRatingPublicationStatus=async()=>({initialized:false});
      BSR_API.initializeRatingPublication=async()=>({initialized:true});
      await BSRViews.raceControl();
    })()`);
    await delay(900);
    assert.equal(await run("document.querySelector('#processorOfficial').checked"), true);
    assert.equal(await run("document.querySelector('#processorDistance').checked"), true);
    assert.equal(await run("document.querySelector('#processorMinimum').value"), '4');
    assert.equal(await run("document.querySelector('#processorClassMinimum').value"), '3');
    assert.equal(await run("document.querySelector('#processorHeat').value"), '1');
    const ratingFlow = await run(`(async()=>{
      const race=document.querySelector('#processorRace'); race.value='race-1'; race.dispatchEvent(new Event('change'));
      const data={TrackName:'Interlagos',Date:'2026-10-20T20:00:00Z',Events:[],Result:[{DriverName:'Teste',DriverGuid:'76561198000000001',CarClass:'GT3',NumLaps:20,IncidentPoints:2}]};
      const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(data)],'result.json',{type:'application/json'}));
      document.querySelector('#resultsFile').files=transfer.files;
      document.querySelector('#resultsFile').dispatchEvent(new Event('change'));
      document.querySelector('#parseRaceFiles').click();
      return true;
    })()`);
    assert.equal(ratingFlow,true);
    for(let attempt=0;attempt<20;attempt++) { if(await run("Boolean(document.querySelector('#previewImport'))")) break; await delay(100); }
    await run(`BSR_API.previewRaceImport=async payload=>{
      if(!/^[a-f0-9]{64}$/.test(payload.sourceHash)) throw Error('hash missing');
      return {previewToken:'test-token',engineVersion:'bsr-rating-v3.1.0',totals:{drivers:1,rated:1,incidents:2},rows:[{name:'Teste',officialPosition:1,classPosition:1,carClass:'GT3',points:25,ratingReason:'Válida para rating',expectedFinish:2,reliability:100,oldLicense:'R',newLicense:'R',oldIRating:1600,newIRating:1620,deltaIRating:20,oldSafetyRating:2.5,newSafetyRating:2.6,deltaSafetyRating:.1,countedCorners:200,safetyWindowCorners:1200,safetyWindowIncidents:35,mprReasons:[]}],warnings:[]};
    }; document.querySelector('#processorCorners').value='10';document.querySelector('#previewImport').click();`);
    for(let attempt=0;attempt<20;attempt++) { if(await run("Boolean(document.querySelector('.processor-preview'))")) break; await delay(100); }
    assert.equal(await run("Boolean(document.querySelector('#commitImport'))"),true);
    assert.match(await run("document.querySelector('.processor-preview details').textContent"),/1200 curvas/);
    await run("const incident=document.querySelector('[data-field=incidentPoints]');incident.value='4';incident.dispatchEvent(new Event('change'));");
    assert.equal(await run("Boolean(document.querySelector('#commitImport'))"),false,'editing incidents invalidates the preview');
    fs.writeFileSync(path.join(output, 'ratings-admin-1440.png'), (await window.webContents.capturePage()).toPNG());

    await run(`(async()=>{
      BSR.state.isAdmin=true; BSR.state.admin={username:'admin.bsr'}; BSR.state.route='admin'; document.getElementById('app').dataset.route='admin';
      BSR.state.races=[BSR.normalizeRace({objectId:'race-1',title:'GT3 Sprint',track:'Interlagos',category:'GT3',status:'aberta',duration:'45 min',startAt:new Date().toISOString()})];
      BSR.loadDrivers=async()=>[{objectId:'d1',steamId:'76561198000000000',name:'Piloto Teste'}];
      BSR_API.getContentAdminContext=async()=>({packages:[],races:[]});
      BSR_API.getRaceProcessorContext=async()=>({imports:[]});
      BSR_API.getRatingPublicationStatus=async()=>({initialized:true});
      BSR_API.initializeRatingPublication=async()=>({initialized:true});
      BSR_API.getAdminAudit=async()=>[];
      BSR_API.getAdminReports=async()=>[];
      BSR_API.getHubAccessAdminContext=async()=>({mode:'invite',grants:[{objectId:'g1',steamId:'76561198000000000',label:'Piloto Teste',note:'Beta fechado',enabled:true}],candidates:[{steamId:'76561198000000000',name:'Piloto Teste'}]});
      await BSRViews.admin();
    })()`);
    await delay(900);
    assert.equal(await run("Boolean(document.querySelector('.hub-access-admin-panel'))"), true);
    assert.match(await run("document.querySelector('.hub-access-admin-panel').textContent"), /SOMENTE CONVIDADOS/);
    assert.equal(await run("document.querySelectorAll('[data-hub-grant]').length"), 1);
    assert.equal(await run("document.querySelector('#hubAccessSteamId').getAttribute('pattern')"), '[0-9]{17}');
    fs.writeFileSync(path.join(output, 'hub-access-admin-1440.png'), (await window.webContents.capturePage()).toPNG());
    await run("document.querySelector('[data-admin-edit-race=\"race-1\"]').click()");
    await delay(250);
    assert.equal(await run("document.querySelector('#adminRaceDuration').value"), '45', 'legacy string duration must remain editable in the numeric field');

    const contentFlow = await run(`(async()=>{
      const pkg={objectId:'pkg-content-ui',slug:'bsr-ui-car',name:'BSR UI Car',version:'1.0.0',type:'car',author:'BSR',sizeBytes:4096,approved:true,enabled:true,dependencies:[]};
      const test={downloaded:false,installed:false,damaged:false,downloadToken:'',repairToken:''};
      const snapshot=()=>({desktop:true,detected:true,gamePath:'C:/Games/assettocorsa',statuses:{[pkg.slug]:{downloaded:test.downloaded,installed:test.installed,installedVersion:test.installed?'1.0.0':null,updateAvailable:false,damaged:test.damaged,missingFiles:test.damaged?1:0,changedFiles:0}}});
      window.electronAPI={content:{initialize:async()=>snapshot(),status:async()=>snapshot(),audit:async()=>snapshot(),chooseGame:async()=>snapshot(),download:async(_pkg,token)=>{test.downloadToken=token;test.downloaded=true;return {ok:true};},install:async()=>{test.installed=true;return {ok:true};},repair:async(_pkg,token)=>{test.repairToken=token;test.damaged=false;return {ok:true,repaired:true};},uninstall:async()=>({ok:true}),verify:async()=>({installed:true,valid:true,missing:[],changed:[]}),clearDownload:async()=>({ok:true}),joinServer:async()=>({ok:true}),onProgress:()=>()=>{}}};
      BSR_API.getSessionToken=()=> 'r:renderer-session-token-12345';
      BSR_API.getContentCatalog=async()=>[pkg];
      BSR.state.isAdmin=false;BSR.state.route='content';document.getElementById('app').dataset.route='content';
      await BSRContent.view();
      document.querySelector('[data-content-action=download]').click();
      for(let i=0;i<40&&!test.downloadToken;i+=1)await new Promise(resolve=>setTimeout(resolve,25));
      test.installed=true;test.damaged=true;await BSRContent.view();
      const repairVisible=document.querySelector('[data-content-action=repair]')?.textContent.trim();
      document.querySelector('[data-content-action=repair]').click();
      for(let i=0;i<40&&!test.repairToken;i+=1)await new Promise(resolve=>setTimeout(resolve,25));
      return {...test,repairVisible};
    })()`);
    assert.equal(contentFlow.downloadToken, 'r:renderer-session-token-12345', 'download must forward the active session to Electron');
    assert.equal(contentFlow.repairToken, 'r:renderer-session-token-12345', 'repair must forward the active session to Electron');
    assert.equal(contentFlow.repairVisible, 'Reparar', 'damaged content must expose the repair action');

    console.log('Rating and content UI checks passed.');
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error);
    app.exit(1);
  }
});
