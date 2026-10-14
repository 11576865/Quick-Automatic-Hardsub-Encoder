// A Guided counterpart to Manual's explicit verified transaction. Only
// complete source-paired, ASS-rendered *single-pass* VBR observations permit
// an opt-in mutation of the selected Guided codec/resolution.
const positiveInt=n=>Number.isSafeInteger(n)&&n>0;
const sizeKey=s=>s?JSON.stringify([s.id,s.width,s.height]):'source';
// Compare executable fields, not diagnostic frontier interpolation objects.
// The frontier incumbent changes after adoption, so nonexecuting predictions
// may legitimately change while codec, rate, size and real budget stay fixed.
const same=(a,b)=>JSON.stringify([a?.mode,a?.goal,a?.codec,a?.preset,
  a?.targetVideoBitrate,a?.sizeCeiling,a?.sizeBudgetPolicy,a?.outputWidth,
  a?.outputHeight,a?.safeBudgetBytes,a?.plannedBytes,a?.containerReserveBytes,
  a?.audioPayloadBytes,a?.fixedPayloadBytes,a?.encodedAudioBytes,
  a?.budgetCostBasis])===JSON.stringify([b?.mode,b?.goal,b?.codec,b?.preset,
  b?.targetVideoBitrate,b?.sizeCeiling,b?.sizeBudgetPolicy,b?.outputWidth,
  b?.outputHeight,b?.safeBudgetBytes,b?.plannedBytes,b?.containerReserveBytes,
  b?.audioPayloadBytes,b?.fixedPayloadBytes,b?.encodedAudioBytes,
  b?.budgetCostBasis]);
export function createGuidedBranchProposal({
  branchId,codec,sourceScope,selectedBytes,videoBitrate,preset,
  outputSize=null,priorCodec,priorOutputSize=null
}={}){
  if(typeof branchId!=='string'||!branchId||!['h264','h265','av1'].includes(codec)||
     typeof sourceScope!=='string'||!sourceScope.includes('guided-ass-rendered')||
     !positiveInt(selectedBytes)||!positiveInt(videoBitrate)||
     typeof preset!=='string'||!preset||
     !['h264','h265','av1'].includes(priorCodec)||
     (outputSize&&(!positiveInt(outputSize.width)||!positiveInt(outputSize.height)||
       typeof outputSize.id!=='string'||!outputSize.id)))
    return {ok:false,reason:'invalid-guided-proposal'};
  const size=outputSize?Object.freeze({...outputSize}):null;
  const prior=priorOutputSize?Object.freeze({...priorOutputSize}):null;
  if(branchId!==(size?codec+'@'+size.id:codec)||
     (codec===priorCodec&&sizeKey(size)===sizeKey(prior)))
    return {ok:false,reason:'not-a-different-guided-branch'};
  return Object.freeze({
    ok:true,kind:'guided-single-pass-branch-proposal-v1',
    branchId,codec,sourceScope,selectedBytes,videoBitrate,preset,
    outputSize:size,priorCodec,priorOutputSize:prior,
    identity:JSON.stringify(['guided-vbr-branch-v1',branchId,sourceScope,selectedBytes,
      videoBitrate,preset,sizeKey(size),priorCodec,sizeKey(prior)]),
    automaticAdoption:false,wholeMovieVerified:false
  });
}
export function currentGuidedBranchProposal(proposal,{
  referenceScope,budgetBytes,selectedCodec,selectedOutputSize,evaluation,
  approvedPreset
}={}){
  return proposal?.ok===true &&
    proposal.kind==='guided-single-pass-branch-proposal-v1' &&
    proposal.sourceScope===referenceScope &&
    proposal.selectedBytes===budgetBytes &&
    proposal.priorCodec===selectedCodec &&
    sizeKey(proposal.priorOutputSize)===sizeKey(selectedOutputSize) &&
    evaluation?.status==='within-evidence'&&
    evaluation.branchId===proposal.branchId&&
    Math.round(Number(evaluation.videoBitrate))===proposal.videoBitrate&&
    approvedPreset===proposal.preset;
}
const matches=(task,proposal)=>task?.mode==='budget-rate'&&
  task.goal==='sizeBudget'&&task.codec===proposal.codec&&
  task.preset===proposal.preset&&task.sizeBudgetPolicy==='best-effort'&&
  task.sizeCeiling===proposal.selectedBytes&&
  task.targetVideoBitrate===proposal.videoBitrate&&
  (task.outputWidth||0)===(proposal.outputSize?.width||0)&&
  (task.outputHeight||0)===(proposal.outputSize?.height||0);
export function commitVerifiedGuidedBranch({
 proposal,verification,readSelection,writeSelection,preview,compile,isCurrent
}={}){
  if(!proposal?.ok||!verification?.result?.ok||!verification.result.passed||
     verification.confirmed||verification.proposalIdentity!==proposal.identity||
     verification.result.referenceScope!==proposal.sourceScope||
     verification.result.requestedVideoBitrate!==proposal.videoBitrate||
     verification.result.budgetBytes!==proposal.selectedBytes||
     verification.result.canAutoAdopt!==false||
     typeof readSelection!=='function'||typeof writeSelection!=='function'||
     typeof preview!=='function'||typeof compile!=='function'||
     typeof isCurrent!=='function')
    return {ok:false,reason:'invalid-guided-branch-adoption'};
  if(!isCurrent())return {ok:false,reason:'stale-guided-branch-proposal'};
  const original=readSelection();
  if(original?.codec!==proposal.priorCodec||
     sizeKey(original.outputSize)!==sizeKey(proposal.priorOutputSize))
    return {ok:false,reason:'guidance-state-diverged'};
  let didWrite=false;
  try{
    // Independently compile the hypothetical task before changing UI state.
    const expected=preview(proposal);
    if(!matches(expected,proposal))throw Error('preview-formal-plan-mismatch');
    if(!isCurrent())throw Error('proposal-expired-during-preflight');
    didWrite=true;
    writeSelection({codec:proposal.codec,outputSize:proposal.outputSize});
    const actual=compile();
    if(!matches(actual,proposal)||!same(actual,expected))
      throw Error('compiled-formal-plan-diverged');
    return {ok:true,kind:'guided-explicit-verified-branch-adoption-v1',plan:actual};
  }catch(error){
    if(didWrite){
      try{writeSelection(original);}catch(rollbackError){
        return {ok:false,reason:'adoption-rollback-failed',
          detail:String(rollbackError?.message||rollbackError)};
      }
    }
    return {ok:false,reason:'adoption-rejected',detail:String(error?.message||error)};
  }
}
