import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRateDistortionModel } from './rate-distortion-model.js';
import { createMultiBranchFrontier } from './compression-decision.js';
import { planPairedRefinement,appendMatchedSceneObservation } from './calibration-refinement.js';

const starts=[10,35,60],fingerprint='paired-scene-strata-v2:2:10.000,35.000,60.000';
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
 assert.equal(p.branches.flatMap(x=>x.points).length,4,
   'Every observed CRF point in every branch must receive the extra scene');
 assert.ok(p.fingerprint.includes('85.000'));
});
test('same-scene risk evidence can reverse the conservative codec recommendation',()=>{
 const args=inputs();
 const p=planPairedRefinement(args);
 assert.equal(args.frontier.evaluateTargetBytes(args.targetBytes).branchId,'A');
 const appendAll=(list,ssimValues)=>list.map((point,index)=>
   appendMatchedSceneObservation(point,{...point,sampleMeasurements:[{
     start:85,ssim:ssimValues[index],bitrate:point.sampleBitrate,
     duration:2,elapsedSeconds:2
   }]},{
     start:85,originalFingerprint:fingerprint,nextFingerprint:p.fingerprint
   }));
 const refinedA=appendAll(A,[.84,.87]);
 const refinedB=appendAll(B,[.97,.98]);
 assert.ok([...refinedA,...refinedB].every(x=>x?.sampleMeasurements.length===4));
 const after=frontier(refinedA,refinedB);
 assert.equal(after.ok,true);
 assert.equal(after.evaluateTargetBytes(args.targetBytes).branchId,'B');
});
test('rejects unaffordable, stale, unpaired or malformed data',()=>{
 const args=inputs();
 assert.equal(planPairedRefinement({...args,spentSeconds:64}).reason,'budget-exhausted');
 assert.equal(planPairedRefinement({...args,budgetSeconds:19}).reason,'budget-exhausted');
 assert.equal(planPairedRefinement({...args,branches:args.branches.map(b=>({...b,sampleFingerprint:'old'}))}).reason,'stale-or-incomplete-evidence');
 assert.equal(planPairedRefinement({...args,samplePlan:{...args.samplePlan,candidates:[]}}).reason,'no-unmeasured-window');
 assert.equal(appendMatchedSceneObservation(A[0],{...A[0],sampleMeasurements:[
   {start:85,ssim:false,bitrate:1e6,duration:2,elapsedSeconds:1}
 ]},{start:85,originalFingerprint:fingerprint,nextFingerprint:'new'}),null);
});

test('strict paired observations reject absent elapsed time and mismatched point provenance',()=>{
 const extra={...A[0],sampleMeasurements:[{
  start:85,ssim:.95,bitrate:1e6,duration:2,elapsedSeconds:null
 }]};
 assert.equal(appendMatchedSceneObservation(A[0],extra,{
  start:85,originalFingerprint:fingerprint,nextFingerprint:'new'}),null);
 const argumentsWithStalePoints=inputs(
  A.map(p=>({...p,sampleFingerprint:'older-plan'})),B);
 assert.equal(planPairedRefinement(argumentsWithStalePoints).reason,'unmatched-sample-windows');
});
