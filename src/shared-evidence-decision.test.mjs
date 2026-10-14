import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSharedEvidenceDecision} from './shared-evidence-decision.js';
const guided=JSON.stringify(['decision-reference-v1','guided-ass-rendered','source','runtime','hash']);
const manual=JSON.stringify(['decision-reference-v1','manual-source-sdr','source','runtime','ref','filter','metric','windows']);
const f={ok:true,evaluateTargetBytes:n=>n<100000?{status:'below-evidence'}:n>200000?{status:'above-evidence'}:{
 status:'within-evidence',branchId:'h265',videoBitrate:500000,
 prediction:{quality:.986,lowerQuality:.972,upperQuality:.99}
}};
const decide=(workflow,scope,extra={})=>evaluateSharedEvidenceDecision({
 workflow,referenceScope:scope,currentReferenceScope:scope,
 frontier:f,targetBytes:150000,budgetCoordinate:'whole-modeled',...extra
});
test('P3 both workflows share recommendation criteria but never reuse cross-reference SSIM',()=>{
 for(const [workflow,scope] of [['guided',guided],['manual',manual]]){
  const r=decide(workflow,scope);
  assert.equal(r.phase,'recommendation');
  assert.equal(r.canRecommend,true);
  assert.equal(r.canCommit,false);
  assert.equal(r.wholeFileVerified,false);
  assert.equal(r.candidate.observedLowerSsim,.972);
  assert.equal(Object.isFrozen(r.candidate),true);
 }
 assert.equal(decide('guided',manual).reason,'wrong-reference-domain');
 assert.equal(decide('manual',guided).reason,'wrong-reference-domain');
 assert.equal(decide('guided',guided,{currentReferenceScope:guided+'stale'}).canRecommend,false);
});
test('P3 video-only and copied-stream unknown costs remain diagnostic, not adopted recommendations',()=>{
 for(const coordinate of ['video-only','whole-estimated']){
  const r=decide('manual',manual,{budgetCoordinate:coordinate});
  assert.equal(r.phase,'diagnosis-only');
  assert.equal(r.canRecommend,false);
  assert.equal(r.canVerifyCandidate,false);
 }
 assert.equal(decide('guided',guided,{targetBytes:80000}).reason,'outside-measured-domain');
 assert.equal(decide('manual',manual,{targetBytes:350000}).reason,'outside-measured-domain');
});
test('P3 only bound independent VBR can unlock preliminary commit gate; no automatic adoption',()=>{
 const v={passed:true,referenceScope:guided,branchId:'h265',targetBytes:150000,
   videoBitrate:500000,vbrMethod:'independent-native-vbr'};
 assert.equal(decide('guided',guided,{verification:v}).canCommit,false);
 assert.equal(decide('guided',guided,{verification:v,userApproved:true}).canCommit,true);
 assert.equal(decide('guided',guided,{verification:{...v,referenceScope:manual},userApproved:true}).canCommit,false);
 assert.equal(decide('guided',guided,{verification:{...v,targetBytes:130000},userApproved:true}).canCommit,false);
 assert.equal(decide('manual',manual,{verification:{...v,referenceScope:manual},userApproved:true}).canCommit,true);
});
test('P3 does not mistake empty/malformed predictions for quality evidence',()=>{
 assert.equal(decide('manual',manual,{frontier:{ok:false}}).canRecommend,false);
 assert.equal(decide('manual',manual,{frontier:{ok:true,evaluateTargetBytes:()=>({
   status:'within-evidence',branchId:'h264',videoBitrate:1,prediction:{quality:NaN,lowerQuality:.7}
 })}}).reason,'incomplete-measurement');
});
