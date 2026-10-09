#!/usr/bin/env node
'use strict';
// The P10/P90 threshold heuristics were removed with the quartile migration.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const s={Intl,Date,URLSearchParams};vm.createContext(s);vm.runInContext(fs.readFileSync('assets/hourly-range.js','utf8'),s);
for(const name of ['planningNote','briefing','noteText','briefingConfig'])assert.equal(s.NbmHourly[name],undefined);
const ui=fs.readFileSync('assets/dashboard.js','utf8');assert(!ui.includes('renderNbmBriefing'));assert(!ui.includes('nbmBriefNote'));
assert(!fs.readFileSync('index.html','utf8').includes('forecastTempContext'));
console.log('PASS removed tail-based threshold commentary and API; NWS selection stays independent');
