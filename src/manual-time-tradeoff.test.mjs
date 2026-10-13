import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeManualEncodeCost} from './manual-time-tradeoff.js';

function protocol(){
 return {
  method:'windows-native-exact-cq-v1',
  referenceMetric:'source-sdr-yuv420p-ssim-v1',
  sourceToken:'same-source',runtimeToken:'same-ffmpeg',
  referenceToken:'original-sdr-source',filterToken:'none',
  samplePlanVersion:'paired-v1',
  mediaDuration:8,rangeStart:0,rangeEnd:8,videoStream:0,
  referenceWidth:640,referenceHeight:360,
  windows:[{start:.5,duration:1.5},{start:4,duration:1.5}]
 };
}
function point(q,min,avg,rate,elapsed){
 return {qualitySetting:q,ssim:min,averageSsim:avg,
  sampleBitrate:rate,sampleMeasurements:[
   {start:.5,duration:1.5,ssim:min,bitrate:rate,elapsedSeconds:elapsed[0]},
   {start:4,duration:1.5,ssim:2*avg-min,bitrate:rate,elapsedSeconds:elapsed[1]}
  ]};
}
function trials(){
 const proto=protocol();
 return [
  {protocol:proto,candidate:{id:'x264-medium',codec:'h264',encoder:'libx264',preset:'medium'},
   points:[
    point(20,.94,.945,1000000,[.75,.75]),
    point(32,.974,.976,1600000,[.8,.8])
   ]},
  {protocol:proto,candidate:{id:'x265-medium',codec:'h265',encoder:'libx265',preset:'medium'},
   points:[
    point(25,.941,.946,750000,[1.5,1.5]),
    point(37,.985,.987,1200000,[1.8,1.8])
   ]}
 ];
}
test('real encode stopwatch values are exposed alongside same-window CQ size/SSIM, without full movie extrapolation',()=>{
 const cost=summarizeManualEncodeCost(trials(),{referenceVideoBitrate:1050000});
 assert.equal(cost.ok,true);
 assert.equal(cost.measuredWindowCount,2);
 assert.equal(cost.candidates.length,2);
 const a=cost.candidates[0],b=cost.candidates[1];
 assert.equal(a.nearestObserved.qualitySetting,20);
 assert.equal(a.nearestObserved.measuredMediaSeconds,3);
 assert.equal(a.nearestObserved.measuredEncodeSeconds,1.5);
 assert.equal(a.nearestObserved.speedFactor,2);
 assert.equal(a.nearestObserved.minimumWindowSpeedFactor,2);
 assert.equal(b.nearestObserved.qualitySetting,37);
 assert.equal(a.mayPredictWholeFileSeconds,false);
 assert.equal(a.canRankUnmeasuredTarget,false);
 assert.equal(cost.timeBasis,'windows-native-ffmpeg-encode-stopwatch-v1');
 assert.ok(cost.limitations.includes('no-full-movie-time-forecast'));
});
test('near-matched measured quality produces paired time and bitrate ratios, not exact equivalence',()=>{
 const cost=summarizeManualEncodeCost(trials());
 assert.equal(cost.matchedQualityPairs.length,1);
 const pair=cost.matchedQualityPairs[0];
 assert.equal(pair.candidateA,'x264-medium');
 assert.equal(pair.candidateB,'x265-medium');
 assert.equal(pair.timeRatioAOverB,.5);
 assert.equal(pair.videoRateRatioAOverB,1000000/750000);
 assert.equal(pair.exactQualityEquivalence,false);
 assert.equal(pair.wholeMoviePrediction,false);
});
test('large quality gaps never invent a matched-quality CPU winner',()=>{
 const cases=trials();
 cases[1].points=cases[1].points.map(p=>({
   ...p,ssim:p.ssim+.02,averageSsim:p.averageSsim+.02,
   sampleMeasurements:p.sampleMeasurements.map(s=>({...s,ssim:s.ssim+.02}))
 }));
 const cost=summarizeManualEncodeCost(cases);
 assert.equal(cost.ok,true);
 assert.deepEqual(cost.matchedQualityPairs,[]);
});
test('absent, zero, malformed or incomplete timings cannot produce observed cost',()=>{
 for(const invalid of [null,0,-1,NaN,Infinity,'1']){
  const cases=trials();
  cases[0].points.forEach(p=>p.sampleMeasurements.forEach(m=>{m.elapsedSeconds=invalid}));
  const cost=summarizeManualEncodeCost(cases);
  assert.equal(cost.ok,true);
  assert.equal(cost.candidates[0].nearestObserved,null,String(invalid));
  assert.equal(cost.candidates[0].availableQualitySettings,0);
 }
 const broken=trials();
 broken[1].points[0].sampleMeasurements.pop();
 assert.equal(summarizeManualEncodeCost(broken).candidates[1].availableQualitySettings,1);
 const none=trials();
 none.forEach(t=>t.points.forEach(p=>p.sampleMeasurements.forEach(m=>{m.elapsedSeconds=0})));
 assert.equal(summarizeManualEncodeCost(none).reason,'no-complete-timing-evidence');
});
test('protocol identity, source and window mismatch refuse cost comparisons',()=>{
 const changed=trials();changed[1].protocol={...changed[1].protocol,sourceToken:'another-source'};
 assert.equal(summarizeManualEncodeCost(changed).reason,'incompatible-cost-protocol');
 const shifted=trials();shifted[0].points[0].sampleMeasurements[0].start=1;
 assert.equal(summarizeManualEncodeCost(shifted).candidates[0].availableQualitySettings,1);
 const wrong=trials();wrong[0].points[0].sampleBitrate=1e9;
 assert.equal(summarizeManualEncodeCost(wrong).candidates[0].availableQualitySettings,1);
 const duplicates=trials();duplicates[1].candidate.id=duplicates[0].candidate.id;
 assert.equal(summarizeManualEncodeCost(duplicates).reason,'invalid-cost-candidate');
});
test('quality setting coverage and chosen bitrate proximity remain explicit observational domains',()=>{
 const cost=summarizeManualEncodeCost(trials(),{referenceVideoBitrate:1600000,maxDisplayedCandidates:1});
 assert.equal(cost.candidates.length,1);
 assert.equal(cost.candidatesOmitted,1);
 assert.equal(cost.candidates[0].nearestObserved.qualitySetting,32);
 assert.equal(cost.candidates[0].referenceRateDeltaPercent,0);
 assert.equal(summarizeManualEncodeCost(trials(),{referenceVideoBitrate:0}).ok,false);
 assert.equal(summarizeManualEncodeCost(trials(),{maxDisplayedCandidates:20}).ok,false);
});
test('UI is explicitly diagnostic and cannot adopt codec based on measured speed',async()=>{
 const {readFile}=await import('node:fs/promises');
 const text=await readFile(new URL('./manual-transcode-compare-ui.js',import.meta.url),'utf8');
 assert.match(text,/summarizeManualEncodeCost\(session\.trials\(\)/);
 assert.match(text,/不能把最近档位当作目标码率验证/);
 assert.match(text,/拒绝推断同画质编码时间赢家/);
 assert.match(text,/确认写入已验证的编码方案/);
});
