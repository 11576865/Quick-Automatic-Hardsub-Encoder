import test from 'node:test';
import assert from 'node:assert/strict';
import {fitRateDistortionModel} from './rate-distortion-model.js';
import {createMultiBranchFrontier} from './compression-decision.js';
import {projectWholeFileFrontier} from './whole-file-frontier.js';
import {evaluateSharedEvidenceDecision} from './shared-evidence-decision.js';
const guided=JSON.stringify(['decision-reference-v1','guided-ass-rendered','source','runtime','render']);
const manual=JSON.stringify(['decision-reference-v1','manual-source-sdr','source','runtime','ref','filter','metric','windows']);
const branch=(id,a,b,scope)=>({id,model:fitRateDistortionModel([
 {sampleBitrate:1000000,ssim:a,averageSsim:a},
 {sampleBitrate:2000000,ssim:b,averageSsim:b}
 ]),measurementScope:scope,preset:'medium'});
test('WU09 the real shared multi-branch evaluator honors both workflow references without conflation',()=>{
 for(const [workflow,scope] of [['guided',guided],['manual',manual]]){
  const frontier=createMultiBranchFrontier([
   branch('h264',.9,.94,scope),branch('h265',.94,.97,scope)
  ],{durationSeconds:120,reservePercent:4,audioBitrate:0});
  assert.equal(frontier.ok,true);
  const target=Math.sqrt(frontier.minimumEvidenceTargetBytes*frontier.maximumEvidenceTargetBytes);
  const a=evaluateSharedEvidenceDecision({workflow,referenceScope:scope,
   currentReferenceScope:scope,frontier,targetBytes:target,budgetCoordinate:'whole-modeled'});
  assert.equal(a.phase,'recommendation');
  assert.equal(a.candidate.branchId,'h265');
  assert.equal(a.canCommit,false);
  const bad=evaluateSharedEvidenceDecision({workflow,referenceScope:scope,
   currentReferenceScope:scope===guided?manual:guided,frontier,targetBytes:target,
   budgetCoordinate:'whole-modeled'});
  assert.equal(bad.reason,'wrong-reference-domain');
 }
});
test('WU09 projection of video payload and fixed whole-file bytes never ranks two different budget coordinates as equal',()=>{
 const f=createMultiBranchFrontier([
  branch('h264',.91,.96,manual),branch('h265',.94,.98,manual)
 ],{durationSeconds:120,audioBitrate:0,reservePercent:0});
 assert.equal(f.ok,true);
 const ledger={durationSeconds:120,reservePercent:4,
  fixedPayloadBytes:1200000,encodedAudioBytes:200000,copiedTrimReserveBytes:0};
 const whole=projectWholeFileFrontier(f,ledger);
 assert.equal(whole.ok,true);
 const target=Math.sqrt(whole.minimumEvidenceTargetBytes*whole.maximumEvidenceTargetBytes);
 const recommended=evaluateSharedEvidenceDecision({workflow:'manual',referenceScope:manual,
  currentReferenceScope:manual,frontier:whole,targetBytes:target,budgetCoordinate:'whole-modeled'});
 const wrong=evaluateSharedEvidenceDecision({workflow:'manual',referenceScope:manual,
  currentReferenceScope:manual,frontier:whole,targetBytes:target,budgetCoordinate:'video-only'});
 assert.equal(recommended.canRecommend,true);
 assert.equal(wrong.canRecommend,false);
 assert.equal(recommended.candidate.targetBytes,target);
 assert.equal(recommended.wholeFileVerified,false);
});
