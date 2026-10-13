import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneProbeStarts} from './scene-risk-selection.js';
import {prepareManualPairedRiskPlan} from './manual-paired-risk-plan.js';

const distinct=r=>r.windows.length===2&&r.windows[0].start+r.windows[0].duration<=r.windows[1].start;
test('Manual reuses shared B15 stratifier with same Native windows for every codec candidate',async()=>{
 const starts=sceneProbeStarts(120,2),called=[];
 const p=await prepareManualPairedRiskPlan({
  rangeStart:0,rangeEnd:120,maxProbes:3,
  probeScene:async options=>{
   called.push(options);
   return {frameCount:4,meanLuma:Math.abs(options.start-starts[2])<.001?8:150,
    meanYdif:Math.abs(options.start-starts[2])<.001?30:2,
    peakScene:Math.abs(options.start-starts[2])<.001?25:0,
    meanContrast:60};
  }
 });
 assert.equal(p.ok,true);assert.equal(p.mode,'risk-stratified-observed');
 assert.equal(p.probedWindows,3);assert.equal(p.riskAware,true);
 assert.ok(distinct(p));assert.equal(p.windows.length,2);
 assert.ok(called.some(x=>x.start===starts[2]));
 assert.ok(p.windows.some(w=>w.start===starts[2]));
 assert.ok(p.windows[1].start>80 || p.windows[0].start<40);
 assert.equal(p.cannotReuseGuidedAssEvidence,true);
 assert.equal(p.noStatisticalCoverageClaim,true);
 assert.match(p.fingerprint,/manual-source-only/);
});
test('trim start is mapped to absolute Native source time, not zero-offset footage',async()=>{
 const p=await prepareManualPairedRiskPlan({
  rangeStart:100,rangeEnd:220,probeScene:async q=>({
   frameCount:4,meanLuma:q.start<150?20:120,meanYdif:5,peakScene:3,meanContrast:40
  })
 });
 assert.equal(p.ok,true);assert.ok(distinct(p));
 assert.ok(p.windows.every(w=>w.start>=100&&w.start+w.duration<=220));
});
test('real Native scene probe failure falls back to two time-spaced windows, not invented low risk',async()=>{
 let calls=0;
 const result=await prepareManualPairedRiskPlan({
  rangeStart:0,rangeEnd:55,probeScene:async()=>{calls++;throw Error('no FFmpeg scene');}
 });
 assert.equal(result.ok,true);assert.ok(distinct(result));
 assert.equal(result.probedWindows,0);
 assert.equal(result.riskAware,false);
 assert.equal(result.mode,'time-stratified-no-risk-evidence');
 assert.equal(calls,1);
 const independent=await prepareManualPairedRiskPlan({rangeStart:0,rangeEnd:55,maxProbes:0});
 assert.deepEqual(result.windows,independent.windows);
});
test('source/settings changes during Native probe reject all late results',async()=>{
 let current=true;
 const plan=await prepareManualPairedRiskPlan({
  rangeStart:0,rangeEnd:50,
  isCurrent:()=>current,
  probeScene:async()=>{current=false;return {frameCount:4,meanLuma:90};}
 });
 assert.equal(plan.ok,false);
 assert.equal(plan.reason,'stale-source-after-native-response');
 assert.equal((await prepareManualPairedRiskPlan({
  rangeStart:0,rangeEnd:50,isCurrent:()=>false,
  probeScene:async()=>{throw Error('should never run');}
 })).reason,'stale-source-before-probing');
});
test('unseekable, short, malformed and impossible ranges fail closed before sampling',async()=>{
 for(const args of [
  {rangeStart:0,rangeEnd:3}, {rangeStart:10,rangeEnd:10},
  {rangeStart:-1,rangeEnd:20}, {rangeStart:0,rangeEnd:20,windowSeconds:0},
  {rangeStart:0,rangeEnd:20,seekable:false},
  {rangeStart:0,rangeEnd:20,maxProbes:-1},
  {rangeStart:0,rangeEnd:20,probeBudgetMs:22000}
 ]){
  let count=0;
  const r=await prepareManualPairedRiskPlan({...args,probeScene:async()=>{count++;throw Error('unreachable')}});
  assert.equal(r.ok,false,JSON.stringify(args));
  assert.equal(count,0,JSON.stringify(args));
 }
});
test('minimal four-second timeline preserves two distinct non-overlapping samples',async()=>{
 const r=await prepareManualPairedRiskPlan({rangeStart:3,rangeEnd:7,maxProbes:0});
 assert.equal(r.ok,true);
 assert.equal(r.windows.length,2);
 assert.ok(distinct(r));
 assert.ok(r.windows[0].start>=3);
 assert.ok(r.windows[1].start+r.windows[1].duration<=7);
});
test('sampling planner is wired to real Windows Native risk interface and source guard',async()=>{
 const {readFile}=await import('node:fs/promises');
 const [ui,main,guided]=await Promise.all([
  readFile(new URL('./manual-transcode-compare-ui.js',import.meta.url),'utf8'),
  readFile(new URL('./main.js',import.meta.url),'utf8'),
  readFile(new URL('./scene-risk-selection.js',import.meta.url),'utf8')
 ]);
 assert.match(ui,/prepareManualPairedRiskPlan\(/);
 assert.match(ui,/samplePlanVersion:'manual-ui-paired-risk-v2:'\+scenePlan\.fingerprint/);
 assert.match(ui,/probeScene:hooks\.sceneRiskProbe/);
 assert.match(ui,/isCurrent:planCurrent/);
 assert.match(main,/sceneRiskProbe: async \(\{start,duration,timeoutSeconds=3\}\)=>/);
 assert.match(main,/sceneRiskOnly:true,start,duration,timeoutSeconds/);
 assert.match(guided,/export function selectPairedSceneWindows/);
});
