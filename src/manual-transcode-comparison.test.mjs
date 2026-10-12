import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualTranscodeComparison, normalizeManualComparisonProtocol } from './manual-transcode-comparison.js';

// Synthetic readings use the same paired windows and source-decode reference,
// not actual FFmpeg/GPU evidence. Runtime field acceptance is separate.
const protocol=()=>({
  method:'windows-native-exact-cq-v1',
  referenceMetric:'source-sdr-yuv420p-ssim-v1',
  sourceToken:'sha256:fixture-source',runtimeToken:'ffmpeg7.1.5/win/native/driverA',
  referenceToken:'unscaled-source-ssim-v1',filterToken:'no-video-filters',
  samplePlanVersion:'manual-paired-window-v1',
  mediaDuration:180,rangeStart:30,rangeEnd:90,videoStream:0,
  referenceWidth:1920,referenceHeight:1080,
  windows:[{start:30,duration:2},{start:58,duration:2},{start:88,duration:2}]
});
const observation=(bitrate,quality)=>({
  sampleBitrate:bitrate,
  ssim:quality,averageSsim:quality,
  sampleMeasurements:[30,58,88].map(start=>({start,duration:2,ssim:quality,bitrate}))
});
const trial=(id,codec,encoder,points=[
  observation(1_000_000,.91),
  observation(2_000_000,.95),
  observation(3_000_000,.97)
])=>({
  protocol:protocol(),candidate:{id,codec,encoder,preset:'medium',
    outputWidth:1920,outputHeight:1080,pixelFormat:'yuv420p'},
  points
});
const budget=()=>({durationSeconds:60,audioBitrate:0,audioEvidence:'no-audio',reservePercent:4});
const compare=(trials=[trial('h264','h264','libx264'),
  trial('h265','h265','libx265',[observation(1e6,.93),
    observation(2e6,.965),observation(3e6,.975)])],b=budget())=>
  createManualTranscodeComparison({trials,budget:b});

test('compatible paired candidates create one bounded session-only decision frontier',()=>{
  const result=compare();
  assert.equal(result.ok,true);
  assert.equal(result.sessionOnly,true);
  assert.equal(result.adoptionRequiresNativeVbrVerification,true);
  assert.deepEqual(result.branchIds,['h264','h265']);
  assert.equal(result.protocol.windows.length,3);
  const frontier=result.frontier;
  assert.equal(frontier.kind,'multi-branch');
  assert.equal(frontier.evaluateTargetBytes(frontier.minimumEvidenceTargetBytes*.5).status,'below-evidence');
  assert.equal(frontier.evaluateTargetBytes(frontier.maximumEvidenceTargetBytes*1.5).status,'above-evidence');
  const at=(frontier.minimumEvidenceTargetBytes+frontier.maximumEvidenceTargetBytes)/2;
  assert.equal(frontier.evaluateTargetBytes(at).branchId,'h265');
  assert.equal(frontier.evaluateTargetBytes(at).alternatives.length,2);
  assert.ok(frontier.sampleCurve(10).length>=2);
});

test('protocol enforces explicit nonempty source, runtime, reference and filter identity',()=>{
  for(const key of ['sourceToken','runtimeToken','referenceToken','filterToken','samplePlanVersion']){
    const t=[trial('a','h264','libx264'),trial('b','h265','libx265')];
    t[1].protocol[key]='changed';
    assert.equal(compare(t).reason,'incompatible-measurement-protocol',key);
    const p=protocol();p[key]='';
    assert.equal(normalizeManualComparisonProtocol(p).reason,'invalid-protocol',key);
  }
  for(const change of [{referenceWidth:1280},{referenceMetric:'VMAF'},
    {method:'guided-libass-burnin-v1'},{rangeStart:20},{videoStream:1},
    {mediaDuration:210},{samplePlanVersion:'different-v2'}]){
    const t=[trial('a','h264','libx264'),trial('b','h265','libx265')];
    Object.assign(t[1].protocol,change);
    assert.notEqual(compare(t).ok,true,JSON.stringify(change));
  }
});

test('paired sample windows exclude accidental cross-scene and incomplete models',()=>{
  const t=[trial('a','h264','libx264'),trial('b','h265','libx265')];
  t[1].protocol.windows[1].start=57;
  assert.equal(compare(t).reason,'incompatible-measurement-protocol');
  const missing=[trial('a','h264','libx264'),trial('b','h265','libx265')];
  missing[1].points[0].sampleMeasurements.pop();
  assert.equal(compare(missing).reason,'invalid-trial-evidence');
  const shifted=[trial('a','h264','libx264'),trial('b','h265','libx265')];
  shifted[1].points[0].sampleMeasurements[1].start=56;
  assert.equal(compare(shifted).reason,'unpaired-sample-evidence');
  const wrongDuration=[trial('a','h264','libx264'),trial('b','h265','libx265')];
  wrongDuration[1].points[0].sampleMeasurements[0].duration=1.5;
  assert.equal(compare(wrongDuration).reason,'unpaired-sample-evidence');
});

test('invalid SSIM, numeric coercions, invalid codec geometry and duplicate candidates fail closed',()=>{
  for(const value of [null,undefined,'',false,true,NaN,Infinity,-.1,1.01]){
    const t=[trial('a','h264','libx264'),trial('b','h265','libx265')];
    t[1].points[0].ssim=value;
    assert.equal(compare(t).ok,false,String(value));
  }
  const altered=[trial('a','h264','libx264'),trial('b','h265','libx265')];
  altered[1].candidate.outputWidth=1280;
  assert.equal(compare(altered).reason,'unsupported-candidate-geometry');
  const duplicates=[trial('a','h264','libx264'),trial('a','h265','libx265')];
  assert.equal(compare(duplicates).reason,'duplicate-candidate');
  const flat=[trial('a','h264','libx264'),trial('b','h265','libx265',
    [observation(1e6,.9),observation(1e6,.95)])];
  assert.equal(compare(flat).reason,'insufficient-distinct-rates');
});

test('unknown or incompatible output budgets cannot masquerade as final-size estimates',()=>{
  const t=[trial('a','h264','libx264'),trial('b','h265','libx265')];
  assert.equal(compare(t,{...budget(),audioBitrate:null,audioEvidence:'estimated'}).reason,'unknown-output-budget');
  assert.equal(compare(t,{...budget(),audioBitrate:192000,audioEvidence:'no-audio'}).reason,'unknown-output-budget');
  assert.equal(compare(t,{...budget(),durationSeconds:180}).reason,'incompatible-output-duration');
  const estimate=compare(t,{...budget(),audioBitrate:192000,audioEvidence:'estimated'});
  assert.equal(estimate.ok,true);
  assert.equal(estimate.audioEvidence,'estimated');
});

test('do not extrapolate across disjoint codec bitrate/size evidence',()=>{
  const t=[trial('a','h264','libx264',
      [observation(1e6,.9),observation(2e6,.95)]),
    trial('b','h265','libx265',
      [observation(6e6,.96),observation(8e6,.98)])];
  assert.equal(compare(t).reason,'no-common-evidence-domain');
});

test('protocol windows are ordered, bounded, non-overlapping, and never invented',()=>{
  const t=protocol();
  t.windows=[{start:58,duration:2},{start:30,duration:2},{start:88,duration:2}];
  const p=normalizeManualComparisonProtocol(t);
  assert.equal(p.ok,true);
  assert.deepEqual(p.protocol.windows.map(w=>w.start),[30,58,88]);
  for(const windows of [
    [],[{start:30,duration:0}],
    [{start:30,duration:40},{start:58,duration:2}],
    [{start:89,duration:4}],
    [{start:null,duration:2}]
  ]) {
    const s=protocol();s.windows=windows;
    assert.equal(normalizeManualComparisonProtocol(s).ok,false,JSON.stringify(windows));
  }
});
