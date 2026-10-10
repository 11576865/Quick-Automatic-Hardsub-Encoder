import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRateDistortionModel } from './rate-distortion-model.js';
import { createMultiBranchFrontier } from './compression-decision.js';
import { planPairedRefinement,appendMatchedSceneObservation } from './calibration-refinement.js';

const starts=[10,35,60],fingerprint='paired-scene-strata-v1:2:10.000,35.000,60.000';
const scope='same-media:common-reference';
function point(codec,crf,rate,ssim,seconds=1) {
 const ss=[...starts].map(start=>({start,ssim,bitrate:rate,duration:2,elapsedSeconds:seconds}));
 return {codec,crf,preset:'medium',sampleBitrate:rate,ssim,averageSsim:ssim,
  sampleMeasurements:ss,sampleCount:3,sampleFingerprint:fingerprint};
}
const A=[point('A',22,1000000,.974),point('A',18,2000000,.989)];
const B=[point('B',22,1000000,.971),point('B',18,2000000,.987)];
const frontier=(pointsA=A,pointsB=B)=>createMultiBranchFrontier([
 {id:'A',model:fitRateDistortionModel(pointsA),measurementScope:scope},
 {id:'B',model:fitRateDistortionModel(pointsB),measurementScope:scope}
],{durationSeconds:120,audioBitrate:64000,reservePercent:4});
function inputs(ptsA=A,ptsB=B) {
 const f=frontier(ptsA,ptsB);
 return {frontier:f,targetBytes:Math.sqrt(f.minimumEvidenceTargetBytes*f.maximumEvidenceTargetBytes),
  branches:[{id:'A',codec:'A',preset:'medium',testedPoints:ptsA,sampleFingerprint:fingerprint,sourceScope:scope},
            {id:'B',codec:'B',preset:'medium',testedPoints:ptsB,sampleFingerprint:fingerprint,sourceScope:scope}],
  samplePlan:{fingerprint,starts,candidates:[...starts,75,85].map(start=>({
   start,score:start===85?.95:.2}))},budgetSeconds:65,spentSeconds:15};
}
test('schedule an affordable paired extra scene when measured ranges overlap',()=>{
 const p=planPairedRefinement(inputs());
 assert.equal(p.refine,true);
 assert.equal(p.starts[0],85);
 assert.deepEqual(p.branches.map(x=>x.id),['A','B']);
 assert.ok(p.estimatedSeconds>0);
 assert.ok(p.fingerprint.includes('85.000'));
});
test('same-scene risk evidence can reverse the conservative codec recommendation',()=>{
 const args=inputs();
 const p=planPairedRefinement(args);
 assert.equal(args.frontier.evaluateTargetBytes(args.targetBytes).branchId,'A');
 const newA={...A[0],sampleMeasurements:[{start:85,ssim:.84,bitrate:1000000,
   duration:2,elapsedSeconds:2}]};
 const newB={...B[0],sampleMeasurements:[{start:85,ssim:.97,bitrate:1000000,
   duration:2,elapsedSeconds:2}]};
 const a=appendMatchedSceneObservation(A[0],newA,{
   start:85,originalFingerprint:fingerprint,nextFingerprint:p.fingerprint});
 const b=appendMatchedSceneObservation(B[0],newB,{
   start:85,originalFingerprint:fingerprint,nextFingerprint:p.fingerprint});
 assert.ok(a&&b);
 const after=frontier([a,A[1]],[b,B[1]]);
 assert.equal(after.ok,true);
 assert.equal(after.evaluateTargetBytes(args.targetBytes).branchId,'B');
});
test('rejects unaffordable, stale, unpaired or malformed data',()=>{
 const args=inputs();
 assert.equal(planPairedRefinement({...args,spentSeconds:64}).reason,'budget-exhausted');
 assert.equal(planPairedRefinement({...args,branches:args.branches.map(b=>({...b,sampleFingerprint:'old'}))}).reason,'stale-or-incomplete-evidence');
 assert.equal(planPairedRefinement({...args,samplePlan:{...args.samplePlan,candidates:[]}}).reason,'no-unmeasured-window');
 assert.equal(appendMatchedSceneObservation(A[0],{...A[0],sampleMeasurements:[
   {start:85,ssim:false,bitrate:1e6,duration:2,elapsedSeconds:1}
 ]},{start:85,originalFingerprint:fingerprint,nextFingerprint:'new'}),null);
});
