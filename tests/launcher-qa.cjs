const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width:1440, height:960, show:false, webPreferences:{offscreen:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false} });
  const failures = [];
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) failures.push(message); });
  const run = code => win.webContents.executeJavaScript(code);
  const waitFor = async expression => {
    for(let i=0;i<160;i++){if(await run(expression))return;await delay(200);}
    throw new Error('Timeout: '+expression);
  };
  try {
    await win.loadFile(path.resolve('index.html'));
    await waitFor("document.documentElement.classList.contains('app-ready')");
    await delay(1300);
    const home = await run(`({time:document.querySelector('.hero-kicker time')?.textContent,online:BSR.state.online,opacity:getComputedStyle(document.querySelector('#app')).opacity})`);
    assert.equal(home.online,true); assert.equal(home.opacity,'1'); assert.match(home.time,/19:00/);
    await run("location.hash='#/races'");
    await waitFor("!!document.querySelector('#raceGrid')");
    const order = await run(`({sort:BSR.state.filters.sort,ids:[...document.querySelectorAll('#raceGrid [data-race-id]')].map(el=>el.dataset.raceId),expected:BSR.sortRaces(BSR.state.races).map(r=>r.id)})`);
    assert.equal(order.sort,'new'); assert.deepEqual(order.ids,order.expected); assert.equal(order.ids[0],'CYRpGxBfao');
    await run("document.querySelector('#raceCategoryTrigger').click()");
    assert.equal(await run("document.querySelector('#raceCategoryTrigger').getAttribute('aria-expanded')"),'true');
    await run(`document.querySelector('[data-filter-value="GT4"]').click()`);
    assert.equal(await run("BSR.state.filters.category"),'GT4');
    assert.equal(await run("document.querySelector('#raceCategoryTrigger').getAttribute('aria-expanded')"),'false');
    await run(`document.querySelector('#raceCategoryTrigger').click();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.equal(await run("document.querySelector('#raceCategoryTrigger').getAttribute('aria-expanded')"),'false');
    assert.equal(await run("document.activeElement.id"),'raceCategoryTrigger');
    await run(`document.querySelector('#raceCategoryTrigger').click();document.querySelector('[data-filter-value="all"]').click()`);
    const output = path.resolve('tests/artifacts'); fs.mkdirSync(output,{recursive:true});
    for(const width of [1440,900,390]){
      win.setSize(width,960);await delay(800);
      const bounds = await run(`(()=>{const nav=document.querySelector('.nav-item.active').getBoundingClientRect(), pill=document.querySelector('.nav-glider').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,nav:Math.round(nav.left),pill:Math.round(pill.left)}})()`);
      assert.equal(bounds.overflow,false,'horizontal overflow '+width); assert.ok(Math.abs(bounds.nav-bounds.pill)<=1,'nav resize '+width+' '+JSON.stringify(bounds));
      if(width===1440){await run("document.querySelector('#raceCategoryTrigger').click()");await delay(250);}
      fs.writeFileSync(path.join(output,`races-${width}.png`),(await win.webContents.capturePage()).toPNG());
      await run("document.querySelectorAll('.filter-menu.open').forEach(menu=>menu.closeFilter())");
    }
    win.setSize(1440,960);
    await run("BSRComponents.openRace('JsT5Cs9ErY')");
    await waitFor("document.querySelector('#raceResults')?.getAttribute('aria-busy')==='false'");
    const results = await run(`({count:document.querySelectorAll('.results-table tbody tr').length,preRegistration:!!document.querySelector('#raceJoinButton'),names:[...document.querySelectorAll('.result-driver b')].every(el=>el.textContent!=='Piloto não identificado')})`);
    assert.equal(results.count,6);assert.equal(results.preRegistration,false);assert.equal(results.names,true);
    await delay(500);fs.writeFileSync(path.join(output,'race-results.png'),(await win.webContents.capturePage()).toPNG());
    await run("BSRComponents.openRace('wY30nGA8Ky')");
    await waitFor("document.querySelector('#raceResults')?.getAttribute('aria-busy')==='false'");
    assert.equal(await run("document.querySelectorAll('.results-table tbody tr').length"),23);
    await run("BSRComponents.closeDrawer();location.hash='#/standings'");await delay(160);
    await run("location.hash='#/career'");await delay(15);await run("location.hash='#/races'");await delay(1500);
    assert.equal(await run("!!document.querySelector('#raceGrid')"),true);
    assert.equal(await run("getComputedStyle(document.querySelector('#view')).opacity"),'1');
    assert.deepEqual(failures,[]);
    console.log(JSON.stringify({passed:true,home,order:'event date descending; undated last',filters:'mouse and Escape',responsive:[1440,900,390],results,duplicateSession:'6 Cascavel / 23 Road America, separated by track',rapidNavigation:'passed',screenshots:output}));
    app.exit(0);
  }catch(error){console.error(error.stack);app.exit(1);}
});
