// QHE WU09 R19 P3: common, read-only decision gate for BOTH frontends.
// Uses their already validated frontiers; never performs calibration, estimates
// unobserved budgets, verifies real video, or mutates official task settings.
const isFiniteNum=v=>typeof v==='number'&&Number.isFinite(v);
function typeOfScope(scope){
 try{
  const a=JSON.parse(scope);
  if(!Array.isArray(a)||a[0]!=='decision-reference-v1')return null;
  return ['guided-ass-rendered','manual-source-sdr'].includes(a[1])?a[1]:null;
 }catch{return null;}
}
const fail=(reason,detail=null)=>Object.freeze({
 kind:'shared-evidence-decision-v1',phase:'unavailable',
 canRecommend:false,canVerifyCandidate:false,canCommit:false,reason,detail
});
export function evaluateSharedEvidenceDecision({
 workflow,referenceScope,currentReferenceScope,frontier,targetBytes,
 budgetCoordinate,verification=null,userApproved=false
}={}){
 if(!['guided','manual'].includes(workflow))return fail('invalid-workflow');
 const expected=workflow==='guided'?'guided-ass-rendered':'manual-source-sdr';
 if(typeOfScope(referenceScope)!==expected||
    typeOfScope(currentReferenceScope)!==expected)
  return fail('wrong-reference-domain');
 if(referenceScope!==currentReferenceScope)return fail('stale-reference');
 if(!frontier?.ok||typeof frontier.evaluateTargetBytes!=='function')
  return fail('missing-comparable-frontier');
 if(!isFiniteNum(targetBytes)||targetBytes<=0)
  return fail('missing-target');
 const evaluated=frontier.evaluateTargetBytes(targetBytes);
 if(evaluated?.status!=='within-evidence')
  return fail('outside-measured-domain',evaluated?.status||null);
 if(typeof evaluated.branchId!=='string'||!evaluated.branchId||
    !isFiniteNum(evaluated.videoBitrate)||evaluated.videoBitrate<=0||
    !isFiniteNum(evaluated.prediction?.quality)||
    !isFiniteNum(evaluated.prediction?.lowerQuality))
  return fail('incomplete-measurement');
 const candidate=Object.freeze({
  branchId:evaluated.branchId,videoBitrate:evaluated.videoBitrate,
  fittedSsim:evaluated.prediction.quality,
  observedLowerSsim:evaluated.prediction.lowerQuality,
  targetBytes
 });
 if(!['whole-modeled','whole-estimated','video-only'].includes(budgetCoordinate))
  return fail('unknown-budget-coordinate');
 if(budgetCoordinate==='video-only'||budgetCoordinate==='whole-estimated')
  return Object.freeze({
   kind:'shared-evidence-decision-v1',phase:'diagnosis-only',
   canRecommend:false,canVerifyCandidate:false,canCommit:false,
   reason:budgetCoordinate==='video-only'?'video-payload-not-whole-file':'unmeasured-copy-cost',
   referenceDomain:expected,budgetCoordinate,candidate,
   warning:'质量只基于当前同参考短样；不能据此推荐完整文件预算或改变编码器'
  });
 const receiptMatch=verification?.passed===true&&
   verification.referenceScope===referenceScope&&
   verification.branchId===candidate.branchId&&
   verification.targetBytes===Math.round(targetBytes)&&
   verification.videoBitrate===Math.round(candidate.videoBitrate)&&
   verification.vbrMethod==='independent-native-vbr';
 const phase=receiptMatch?'vbr-short-sample-verified':'recommendation';
 return Object.freeze({
  kind:'shared-evidence-decision-v1',phase,
  canRecommend:true,canVerifyCandidate:true,
  // This is only a prerequisite; existing workflow-specific atomic
  // adoption checks and explicit click must STILL be executed.
  canCommit:receiptMatch&&userApproved===true,
  reason:receiptMatch?'independent-vbr-observed':'vbr-not-yet-verified',
  referenceDomain:expected,budgetCoordinate,candidate,
  wholeFileVerified:false,automaticAdoption:false,
  caveat:'同源参考的短样拟合与 VBR 验证不证明最终整片画质、体积或播放器兼容'
 });
}
