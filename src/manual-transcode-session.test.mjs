import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualTranscodeSession,runManualPairedSweep} from './manual-transcode-session.js';

const protocol=()=>({
 method:'windows-native-exact-cq-v1',
 referenceMetric:'source-sdr-yuv420p-ssim-v1',
 sourceToken:'stat-sha256:synthetic-source',runtimeToken:'stat-sha256:ffmpeg',
 referenceToken:'direct-source-v0-yuv420p-setpts-ssim-v1',
 filterToken:'no-video-filters-sdr-yuv420p-v1',samplePlanVersion:'same-windows-v1',
 mediaDuration:6,rangeStart:0,rangeEnd:6,videoStream:0,
 referenceWidth:320,referenceHeight:180,
 windows:[{start:.5,duration:1.5},{start:3,duration:1.5}]
});
const candidates=()=>[
 {id:'x264',codec:'h264',encoder:'libx264',preset:'medium',
 outputWidth:320,outputHeight:180,pixelFormat:'yuv420p'},
 {id:'x265',codec:'h265',encoder:'libx265',preset:'medium',
 outputWidth:320,outputHeight:180,pixelFormat:'yuv420p'}
];
const budget=()=>({durationSeconds:6,audioBitrate:0,
 audioEvidence:'no-audio',reservePercent:0});
const sample=(candidate,qualitySetting,window)=> {
 const bitrate=(qualitySetting===20?600000:qualitySetting===32?1100000:1900000)*
 (candidate.id==='x265'?.93:1);
 const ssim=Math.min(.999,qualitySetting===20?.90:qualitySetting===32?.945:.985)+
 (candidate.id==='x265'?.003:0);
 const totalVideoBytes=bitrate*window.duration/8;
 return {
  encoder:candidate.encoder,ssim,totalVideoBytes,duration:window.duration,
  elapsedSeconds:.11,
  nativeEvidence:{
   schemaVersion:1,method:'windows-native-exact-cq-v1',
   referenceMetric:'source-sdr-yuv420p-ssim-v1',
   sourceToken:'stat-sha256:synthetic-source',runtimeToken:'stat-sha256:ffmpeg',
   referenceToken:'direct-source-v0-yuv420p-setpts-ssim-v1',
   filterToken:'no-video-filters-sdr-yuv420p-v1',
   identityKind:'file-stat-snapshot-not-content-hash',
   videoStream:0,pixelFormat:'yuv420p',mode:'quality',
   requestedRate:0,requestedQuality:qualitySetting,
   requestedStart:window.start,requestedDuration:window.duration,
   actualDuration:window.duration,encoder:candidate.encoder,
   preset:candidate.preset
  }
 };
};
const open=opts=>createManualTranscodeSession({protocol:protocol(),
 candidates:candidates(),...opts});
const add=(session,candidate,quality,window,sampleOverride=null)=>
 session.addSample({candidate,qualitySetting:quality,window,
 sample:sampleOverride??sample(candidate,quality,window)});
const both=async(session,qualitySettings=[20,32])=>
 runManualPairedSweep({
  session,branches:candidates(),qualitySettings,
  sampleNative:async({candidate,qualitySetting,window})=>sample(candidate,qualitySetting,window)
 });

test('complete paired samples form bounded comparable frontier; incomplete never appears',async()=>{
 const session=open();
 assert.equal(session.ok,true);
 const c=candidates(),windows=protocol().windows;
 assert.equal(add(session,c[0],20,windows[0]).completed,false);
 assert.equal(session.snapshot().candidates[0].pendingSettings,1);
 assert.equal(session.trials()[0].points.length,0);
 assert.equal(session.compare(budget()).reason,'insufficient-complete-branches');
 session.discardIncomplete(c[0].id);
 assert.equal(session.snapshot().candidates[0].pendingSettings,0);
 const done=await both(session);
 assert.equal(done.ok,true);
 assert.equal(done.completedRequests,8);
 assert.deepEqual(session.snapshot().candidates.map(x=>x.completeSettings),[2,2]);
 const model=session.compare(budget());
 assert.equal(model.ok,true);
 assert.equal(model.frontier.kind,'multi-branch');
 assert.equal(model.frontier.branchIds.length,2);
 assert.ok(model.frontier.minimumEvidenceTargetBytes<model.frontier.maximumEvidenceTargetBytes);
 assert.equal(model.frontier.evaluateTargetBytes(model.frontier.maximumEvidenceTargetBytes*2).status,'above-evidence');
 assert.equal(session.trials()[0].points[0].sampleMeasurements.length,2);
 const snapshot=session.snapshot();
 assert.equal(Object.isFrozen(snapshot.protocol),true);
 assert.equal(Object.isFrozen(snapshot.protocol.windows[0]),true);
});

test('reject duplicate samples, wrong candidate, changed source and wrong mode',()=>{
 const session=open();
 const c=candidates(),w=protocol().windows[0];
 assert.equal(add(session,c[0],20,w).ok,true);
 assert.equal(add(session,c[0],20,w).reason,'duplicate-window');
 assert.equal(add(session,{...c[0],preset:'fast'},20,protocol().windows[1]).reason,
  'candidate-settings-changed');
 const changed=sample(c[0],20,protocol().windows[1]);
 changed.nativeEvidence.sourceToken='stale source';
 assert.equal(add(session,c[0],20,protocol().windows[1],changed).reason,
  'incompatible-native-receipt');
 assert.equal(session.trials()[0].points.length,0);
 assert.equal(session.snapshot().stats.receivedSamples,1);
});

test('completed quality settings survive cancellation; partial quality is discarded',async()=>{
 const session=open();
 const c=candidates(),q=[20,32,44];
 let requests=0;
 const x=await runManualPairedSweep({
  session,branches:c,qualitySettings:q,
  shouldStop:()=>requests>=5,
  sampleNative:async({candidate,qualitySetting,window})=>{
   requests++;
   return sample(candidate,qualitySetting,window);
  }
 });
 assert.equal(x.reason,'stopped-after-native-response');
 // A stop observed on return from Native must refuse that late sample.
 assert.equal(session.snapshot().candidates[0].completeSettings,2);
 assert.equal(session.snapshot().candidates[0].pendingSettings,0);
 assert.equal(session.snapshot().candidates[1].completeSettings,0);
 assert.equal(session.trials()[0].points.length,2);
 assert.equal(session.compare(budget()).reason,'insufficient-complete-branches');
});

test('failed Native call never commits a partial CQ point or consumes unrelated evidence',async()=>{
 const session=open();const c=candidates();
 const r=await runManualPairedSweep({
  session,branches:c,qualitySettings:[20,32],
  sampleNative:async({candidate,qualitySetting,window})=>{
   if(candidate.id==='x264'&&qualitySetting===32&&window.start===3)
    throw Error('intentional Native failure');
   return sample(candidate,qualitySetting,window);
  }
 });
 assert.equal(r.ok,false);
 assert.equal(r.reason,'native-sample-failed');
 assert.equal(session.trials()[0].points.length,1);
 assert.equal(session.snapshot().candidates[0].pendingSettings,0);
 assert.equal(session.snapshot().stats.receivedSamples,3);
});

test('strict request, total sample, quality and actual encode-cost limits',async()=>{
 const c=candidates();
 const a=open();
 assert.equal((await runManualPairedSweep({session:a,branches:c,
  qualitySettings:[20,32,44],maxRequests:6,
  sampleNative:async()=>{throw Error('should never start')}})).reason,
  'sweep-request-budget-exceeded');
 assert.equal(a.snapshot().stats.receivedSamples,0);
 const b=open({maxTotalSamples:3});
 const bResult=await both(b);
 assert.equal(bResult.reason,'sample-budget-exceeded');
 assert.equal(b.snapshot().stats.receivedSamples,3);
 assert.equal(b.snapshot().candidates[0].completeSettings,1);
 assert.equal(b.snapshot().candidates[0].pendingSettings,0);
 const d=open({maxEncodeSeconds:.3});
 const dResult=await both(d);
 assert.equal(dResult.reason,'encode-time-budget-exceeded');
 assert.equal(d.snapshot().stats.receivedSamples,2);
 assert.equal(d.snapshot().candidates[0].completeSettings,1);
 const e=open({maxQualitySettings:2});
 assert.equal(add(e,c[0],20,protocol().windows[0]).ok,true);
 assert.equal(add(e,c[0],32,protocol().windows[0]).ok,true);
 assert.equal(add(e,c[0],44,protocol().windows[0]).reason,
  'quality-setting-budget-exceeded');
});

test('source invalidation clears all memory and permanently rejects stale response',async()=>{
 const session=open();
 await both(session);
 assert.equal(session.snapshot().stats.receivedSamples,8);
 assert.equal(session.invalidate('new-source').invalidated,true);
 assert.deepEqual(session.snapshot().candidates,[]);
 assert.equal(session.trials().length,0);
 assert.equal(session.compare(budget()).reason,'session-invalidated');
 assert.equal(add(session,candidates()[0],20,protocol().windows[0]).reason,
  'session-invalidated');
});

test('reject malformed session settings and protocol without allocating a registry',()=>{
 assert.equal(open({maxCandidates:1}).reason,'invalid-session-limits');
 assert.equal(open({maxTotalSamples:0}).reason,'invalid-session-limits');
 assert.equal(open({maxEncodeSeconds:0}).reason,'invalid-session-limits');
 assert.equal(createManualTranscodeSession({protocol:{},candidates:candidates()}).reason,
  'invalid-protocol');
 const c=candidates();c[1]={...c[0]};
 assert.equal(open({candidates:c}).reason,'invalid-session-candidate');
});
