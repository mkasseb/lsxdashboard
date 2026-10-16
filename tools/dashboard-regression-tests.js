#!/usr/bin/env node
'use strict';

// Reproduce review findings through the served page, with controlled upstream responses.
const assert = require('node:assert/strict');
const playwright = require('playwright');
const {open, config, setBrowser} = require('./weather-stress-tests');
const engine = process.env.WEATHER_BROWSER || 'chromium';
let passed = 0, failed = 0;

async function run(name, test) {
  if (process.env.DASHBOARD_CASE_FILTER && !new RegExp(process.env.DASHBOARD_CASE_FILTER, 'i').test(name)) return;
  const session = await open(config('review regression', {aqi:75, uv:6}));
  try {
    await test(session.page);
    assert.deepEqual(session.errors, [], 'no uncaught application errors');
    passed++;
    console.log('PASS', name);
  } catch (error) {
    failed++;
    console.error('FAIL', name, error.stack);
  } finally {
    await session.context.close();
  }
}

async function forecastRace(page, oldFails) {
  const source = await page.evaluate(() => nwsLocalForecast.daily);
  const old = structuredClone(source), latest = structuredClone(source);
  old.properties.periods.forEach(p => p.temperature = 42);
  latest.properties.periods.forEach(p => p.temperature = 88);
  let first, count = 0;
  const pending = new Promise(resolve => first = resolve);
  await page.route('**/forecast', route => {
    if (++count === 1) {first(route); return;}
    return route.fulfill({json:latest});
  });
  await page.evaluate(() => {window.reviewOldForecast = loadForecast();});
  const route = await pending;
  await page.evaluate(() => loadForecast());
  await route.fulfill(oldFails ? {status:503, json:{}} : {json:old});
  await page.evaluate(() => window.reviewOldForecast);
  assert.equal(await page.evaluate(() => smart.days[0]?.day?.temperature), 88);
  assert.equal(await page.evaluate(() => feedChecks.daily.status), 'ready');
  assert.match(await page.locator('#daily').innerText(), /88°/);
}

async function pendingSearch(page, action) {
  let first;
  const pending = new Promise(resolve => first = resolve);
  await page.route('https://geocoding-api.open-meteo.com/**', route => {first(route);});
  const input = page.locator('#locSearch');
  await input.fill('Wentzville');
  await page.clock.runFor(350);
  const route = await pending;
  await action(input);
  const response = page.waitForResponse(r => r.url().startsWith('https://geocoding-api.open-meteo.com/'));
  await route.fulfill({json:{results:[{id:1, name:'Wentzville', latitude:38.81, longitude:-90.86,
    country_code:'US', admin1:'Missouri', admin2:'St. Charles', feature_code:'PPL'}]}});
  // Drain the response and its promise chain without starting the next debounce.
  await response;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await page.locator('#locSug').evaluate(e => e.classList.contains('show')), false);
  assert.equal(await page.evaluate(() => sugItems.length), 0);
}

async function regionalRace(page, stations) {
  const now = await page.evaluate(() => Date.now()), size = stations ? 15 : 6;
  let count = 0, ready;
  const held = [], pending = new Promise(resolve => ready = resolve);
  function payload(value) {
    return stations ? {properties:{timestamp:new Date(now).toISOString(), temperature:{value}, windSpeed:{value:10}}}
      : {status:{observed:{primary:value, primaryUnit:'ft', floodCategory:'minor', validTime:new Date(now).toISOString()}}};
  }
  await page.route(stations ? '**/observations/latest' : 'https://api.water.noaa.gov/nwps/v1/gauges/*', route => {
    if (++count <= size) {
      held.push(route);
      if (held.length === size) ready();
      return;
    }
    return route.fulfill({json:payload(30)});
  });
  await page.evaluate(stations => {
    window.reviewOldRegional = stations ? loadStationPlot() : loadRivers();
  }, stations);
  await pending;
  await page.evaluate(stations => stations ? loadStationPlot() : loadRivers(), stations);
  await Promise.all(held.map(r => r.fulfill({json:payload(10)})));
  await page.evaluate(() => window.reviewOldRegional);
  if (stations) {
    assert(await page.evaluate(() => stnObs.filter(Boolean).every(o => o.tempF === 86)));
    assert(await page.evaluate(() => Object.values(_stnLast).every(o => o.tempF === 86)), 'late work cannot regress the fallback cache');
  } else {
    const values = await page.locator('#rivers .rval').allTextContents();
    assert.equal(values.length, size);
    assert(values.every(value => /30 ft/.test(value)));
  }
}

async function main() {
  const browser = await playwright[engine].launch({
    headless:engine !== 'firefox', timeout:30000,
    ...(engine === 'chromium' ? {executablePath:process.env.CHROMIUM_PATH || undefined, args:['--no-sandbox']} : {})
  });
  setBrowser(browser);
  try {
    await run('late forecast success cannot overwrite a newer refresh', p => forecastRace(p, false));
    await run('late forecast failure cannot clear a newer refresh', p => forecastRace(p, true));
    await run('late river refresh cannot overwrite newer gauge levels', p => regionalRace(p, false));
    await run('late station refresh cannot overwrite newer readings or fallback cache', p => regionalRace(p, true));

    await run('Escape dismisses an in-flight location search', p => pendingSearch(p, input => input.press('Escape')));
    await run('clearing search rejects its pending results', p => pendingSearch(p, input => input.fill('')));
    await run('editing search invalidates results before the next debounce', p => pendingSearch(p, input => input.fill('Quincy')));
    await run('Enter cannot select results left over from another query', async p => {
      await p.evaluate(() => renderSuggestions([{name:'Wentzville', latitude:38.81, longitude:-90.86,
        country_code:'US', admin1:'Missouri', admin2:'St. Charles', feature_code:'PPL'}], {keys:['wentzville']}));
      const before = await p.evaluate(() => geoSeq);
      await p.locator('#locSearch').fill('Quincy');
      await p.locator('#locSearch').press('Enter');
      assert.equal(await p.evaluate(() => geoSeq), before, 'old options cannot start a location selection');
      assert.equal(await p.evaluate(() => current.name), 'Lake St. Louis, MO');
    });

    for (const partial of [false, true]) {
      await run(partial ? 'partly missing daily rain chance stays incomplete' : 'missing daily rain chance stays unknown', async p => {
        await p.evaluate(partial => {
          const f = structuredClone(nwsLocalForecast.daily);
          f.properties.periods.forEach(period => period.probabilityOfPrecipitation = {value:null});
          if (partial) f.properties.periods[0].probabilityOfPrecipitation.value = 20;
          renderDailyForecast(f, null);
        }, partial);
        const value = await p.locator('#daily .day-item').first().locator('.dd-item').filter({hasText:'Precip Chance'}).innerText();
        assert.match(value, partial ? /known.*20%.*incomplete/i : /unavailable/i);
      });
    }

    await run('elapsed forecast periods are removed from a partly current package', async p => {
      const count = await p.evaluate(() => {
        const f = structuredClone(nwsLocalForecast.daily), expired = structuredClone(f.properties.periods[0]);
        expired.startTime = new Date(Date.now()-3*3600000).toISOString();
        expired.endTime = new Date(Date.now()-3600000).toISOString();
        f.properties.periods.unshift(expired);
        return validatedForecast(f, Date.now()).properties.periods.filter(p => Date.parse(p.endTime) <= Date.now()).length;
      });
      assert.equal(count, 0);
    });

    await run('UV outage removes old daily UV values immediately', async p => {
      assert(await p.locator('#daily .dd-item').filter({hasText:'UV Index'}).count() > 0);
      await p.route('https://api.open-meteo.com/**', r => r.fulfill({status:503, json:{}}));
      await p.evaluate(() => loadUv());
      assert.equal(await p.locator('#daily .dd-item').filter({hasText:'UV Index'}).count(), 0);
    });
    await run('forecast snapshots omit separately fetched UV values', async p => {
      assert(await p.locator('#daily .dd-item').filter({hasText:'UV Index'}).count() > 0);
      const markup = await p.evaluate(() => {saveSnapshot(); return JSON.parse(localStorage.getItem(SNAP_KEY)).parts.daily;});
      assert.doesNotMatch(markup, />UV Index</);
    });
    await run('older forecast snapshots discard UV without source provenance', async p => {
      await p.evaluate(() => {
        saveSnapshot();
        const snap = JSON.parse(localStorage.getItem(SNAP_KEY));
        snap.parts.daily = snap.parts.daily.replace('<div class="dd-grid">', '<div class="dd-grid"><div class="dd-item"><div class="k">UV Index</div><div class="v">99</div></div>');
        localStorage.setItem(SNAP_KEY, JSON.stringify(snap));
        restoreSnapshot();
      });
      assert.equal(await p.locator('#daily .dd-item').filter({hasText:'UV Index'}).count(), 0);
    });
    await run('malformed UV values cannot become ready or print NaN', async p => {
      const now = await p.evaluate(() => Date.now());
      await p.route('https://api.open-meteo.com/**', r => r.fulfill({json:{
        hourly:{time:[now/1000], uv_index:['broken']}, daily:{time:['2026-09-30'], uv_index_max:['broken']}
      }}));
      await p.evaluate(() => loadUv());
      assert.equal(await p.evaluate(() => feedChecks.uv.status), 'unavailable');
      assert.doesNotMatch(await p.locator('#currentCard, #daily').allTextContents().then(t => t.join(' ')), /NaN/);
    });

    await run('observation failure preserves independently checked air quality and UV', async p => {
      await p.route('**/observations/latest', r => r.fulfill({status:503, json:{}}));
      await p.evaluate(() => loadCurrent());
      assert.match(await p.locator('#current').innerText(), /observation unavailable/i);
      assert.equal(await p.locator('#aqiMini').count(), 1);
      assert.match(await p.locator('#aqiMini').innerText(), /75/);
      assert.match(await p.locator('#ccUv').innerText(), /UV/);
      assert.equal(await p.evaluate(() => heroNow.temp), null);
    });

    for (const timestamp of [null, 'not-a-date', '2026-10-01T18:00:00Z']) {
      await run('station plot rejects invalid observation time '+timestamp, async p => {
        await p.route('**/observations/latest', r => r.fulfill({json:{properties:{
          timestamp, temperature:{value:20}, windSpeed:{value:10}
        }}}));
        await p.evaluate(() => {_stnLast = {}; return loadStationPlot();});
        assert.equal(await p.evaluate(() => stnObs.filter(Boolean).length), 0);
        assert.equal(await p.evaluate(() => feedChecks.stations.status), 'unavailable');
      });
    }

    await run('transient climate station lookup is retried', async p => {
      let calls = 0;
      await p.route('https://data.rcc-acis.org/StnMeta', r => {
        calls++;
        return r.fulfill(calls === 1 ? {status:503, json:{}} : {json:{meta:[{
          name:'Quincy', sids:['KUIN 3'], ll:[-91.2,39.9], valid_daterange:Array(3).fill(['1950-01-01','2026-09-30'])
        }]}});
      });
      const stations = await p.evaluate(async () => {
        _climStationCache = {};
        const first = await climStation(39.9,-91.2), second = await climStation(39.9,-91.2);
        return [first.sid,second.sid];
      });
      assert.deepEqual(stations, ['KSTL','KUIN']);
      assert.equal(calls, 2);
    });
    await run('malformed basemap style permits a successful retry', async p => {
      let calls = 0;
      await p.route('https://tiles.openfreemap.org/styles/**', r => r.fulfill({json:++calls === 1 ? {} : {
        version:8, sources:{}, layers:[{id:'background',type:'background',paint:{'background-color':'#18202d'}}]
      }}));
      const results = await p.evaluate(async () => {
        mapStylePromises = {};
        const rejected = await loadMapStyle('dark').then(() => false, () => true);
        const recovered = await loadMapStyle('dark');
        return [rejected, recovered.version];
      });
      assert.deepEqual(results, [true,8]);
      assert.equal(calls, 2);
    });
    await run('failed QPF metadata does not permanently disable rainfall totals', async p => {
      let calls = 0;
      await p.route('**/wpc_qpf/MapServer**', r => {
        if (new URL(r.request().url()).pathname.endsWith('/query')) return r.fulfill({json:{features:[{attributes:{qpf:1.2}}]}});
        return r.fulfill({json:++calls === 1 ? {error:{code:500}} : {layers:[{id:0,name:'7-day QPF'}]}});
      });
      await p.evaluate(async () => {qpfLayerId = undefined; await loadQpf(); await loadQpf();});
      assert.equal(calls, 2);
      assert.match(await p.locator('#qpf7').innerText(), /1\.2/);
    });
    await run('mobile fullscreen has an accessible open and close name', async p => {
      await p.setViewportSize({width:320,height:900});
      const control=p.locator('#rsFull');
      assert.match(await control.getAttribute('aria-label'), /open.*fullscreen/i);
      await p.evaluate(() => setRadarFull(true));
      assert.match(await control.getAttribute('aria-label'), /close.*fullscreen/i);
      await p.evaluate(() => setRadarFull(false));
      assert.match(await control.getAttribute('aria-label'), /open.*fullscreen/i);
    });
    await run('AQI and UV category text clears contrast requirements in both themes', async p => {
      const contrasts=await p.evaluate(() => {
        function luminance(color){
          const parts=color.startsWith('#')?color.slice(1).match(/../g).map(v=>parseInt(v,16)):color.match(/[\d.]+/g).slice(0,3).map(Number);
          return parts.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        }
        const result=[];
        for(const theme of ['light','dark']){
          applyTheme(theme);
          const background=luminance(getComputedStyle(document.documentElement).getPropertyValue('--panel-2').trim());
          for(const [kind,values] of [['aqi',[0,75,125,175,250,350]],['uv',[1,4,7,10,12]]])for(const value of values){
            let element;
            if(kind==='aqi'){aqiState.val=value;renderAqiMini();element=document.querySelector('#aqiMini .v');}
            else{uv.now=value;renderUvNow();element=document.querySelector('#ccUv .v');}
            const foreground=luminance(getComputedStyle(element).color);
            result.push({theme,kind,value,ratio:(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)});
          }
        }
        return result;
      });
      for(const c of contrasts)assert(c.ratio>=4.5,JSON.stringify(c));
    });
  } finally {
    await browser.close();
  }
  console.log(passed+' passed; '+failed+' failed');
  if (failed) process.exitCode = 1;
}

main().catch(error => {console.error(error); process.exitCode = 1;});
