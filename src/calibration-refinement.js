// Refinement chooses an affordable, paired, previously unobserved scene.
// Observed sample extrema are NOT confidence bounds or statistical VOI.
import { refinementOpportunity } from './scene-risk-selection.js';

const number=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const near=(a,b)=>Math.abs(a-b)<.003;
const goodSample=s=>number(s?.start)!==null && number(s?.ssim)!==null &&
  s.ssim>=0 && s.ssim<=1 && number(s?.bitrate)>0 &&
  number(s?.duration)>0 && number(s?.elapsedSeconds)>=0;
export function planPairedRefinement({
  frontier,targetBytes,branches,samplePlan,spentSeconds,budgetSeconds,
  hysteresis=.003
}={}) {
  if(!frontier?.ok||frontier.kind!=='multi-branch'||!samplePlan?.fingerprint||
    !Array.isArray(samplePlan.starts)||!samplePlan.starts.length)
    return {refine:false,reason:'incompatible-plan'};
  const choice=frontier.evaluateTargetBytes(targetBytes);
  if(choice?.status!=='within-evidence')return {refine:false,reason:'no-common-budget'};
  if(!Array.isArray(branches)||branches.length<2||
    branches.length!==choice.alternatives?.length)
    return {refine:false,reason:'missing-comparative-branch'};
  const matching=new Map(choice.alternatives.map(a=>[a.id,a]));
  const selected=[];
  for(const b of branches){
    const alternative=matching.get(b?.id);
    if(!alternative||!Array.isArray(b.testedPoints)||b.testedPoints.length<2||
      !b.codec||!b.preset||!b.sourceScope||
      b.sampleFingerprint!==samplePlan.fingerprint)
      return {refine:false,reason:'stale-or-incomplete-evidence'};
    const expected=Number(alternative.videoBitrate);
    const candidates=b.testedPoints.filter(p=>{
      const samples=p?.sampleMeasurements;
      return Number.isInteger(p?.crf) && number(p?.sampleBitrate)>0 &&
        Array.isArray(samples)&&samples.length===samplePlan.starts.length &&
        samples.every(goodSample) &&
        samples.every((s,i)=>near(s.start,samplePlan.starts[i]));
    });
    if(!candidates.length)return {refine:false,reason:'unmatched-sample-windows'};
    const point=[...candidates].sort((a,b)=>
      Math.abs(Math.log(a.sampleBitrate/expected))-
      Math.abs(Math.log(b.sampleBitrate/expected)))[0];
    const meanCost=point.sampleMeasurements.reduce((s,x)=>s+x.elapsedSeconds,0)/
      point.sampleMeasurements.length;
    if(!(meanCost>0))return {refine:false,reason:'unknown-next-cost'};
    selected.push({
      id:b.id,codec:b.codec,preset:b.preset,crf:point.crf,outputSize:b.outputSize||null,
      sourceScope:b.sourceScope,point,estimatedSeconds:Math.max(.1,meanCost*1.4)
    });
  }
  if(new Set(selected.map(x=>x.id)).size!==selected.length ||
     new Set(selected.map(x=>x.sourceScope)).size!==1)
    return {refine:false,reason:'incompatible-evidence-scope'};
  const candidates=Array.isArray(samplePlan.candidates)?samplePlan.candidates:[];
  const remaining=candidates.filter(x=>number(x?.start)!==null &&
    !samplePlan.starts.some(s=>near(s,x.start)) &&
    x.start>=0 && number(x.score)!==null);
  if(!remaining.length)return {refine:false,reason:'no-unmeasured-window'};
  const next=[...remaining].sort((a,b)=>b.score-a.score||a.start-b.start)[0];
  const nextCost=selected.reduce((s,b)=>s+b.estimatedSeconds,0);
  const remainingSeconds=number(budgetSeconds)===null?null:
    budgetSeconds-(number(spentSeconds)||0);
  const opportunity=refinementOpportunity({
    candidates:choice.alternatives.map(a=>({
      id:a.id,lowerQuality:a.lowerQuality,upperQuality:a.upperQuality
    })),
    budgetRemainingSeconds:remainingSeconds,nextPairedCostSeconds:nextCost,
    margin:hysteresis
  });
  if(!opportunity.refine)return {...opportunity,estimatedSeconds:nextCost};
  return {refine:true,reason:opportunity.reason,targetBytes,
    starts:[next.start],riskScore:next.score,
    fingerprint:samplePlan.fingerprint+':paired-extra-'+next.start.toFixed(3),
    previousFingerprint:samplePlan.fingerprint,
    branches:selected,estimatedSeconds:nextCost,
    observedDecisionGap:opportunity.uncertaintyGap};
}
export function appendMatchedSceneObservation(point,newPoint,{
  start,originalFingerprint,nextFingerprint
}={}) {
  if(!Number.isInteger(point?.crf)||point.crf!==newPoint?.crf||
    point.codec!==newPoint?.codec||point.preset!==newPoint?.preset||
    point.sampleFingerprint!==originalFingerprint||
    !Array.isArray(point.sampleMeasurements)||
    !Array.isArray(newPoint.sampleMeasurements)||
    newPoint.sampleMeasurements.length!==1 ||
    !goodSample(newPoint.sampleMeasurements[0]) ||
    !near(newPoint.sampleMeasurements[0].start,start) ||
    point.sampleMeasurements.some(x=>near(x.start,start)) ||
    !nextFingerprint || !originalFingerprint) return null;
  const values=[...point.sampleMeasurements,newPoint.sampleMeasurements[0]];
  if(!values.every(goodSample))return null;
  const sum=(field)=>values.reduce((s,v)=>s+v[field],0);
  const seconds=sum('duration'),elapsed=sum('elapsedSeconds');
  return {
    ...point,ssim:Math.min(...values.map(x=>x.ssim)),
    averageSsim:sum('ssim')/values.length,
    sampleBitrate:sum('bitrate')/values.length,
    sampleCount:values.length,encodeSpeed:elapsed>0?seconds/elapsed:0,
    sampleMeasurements:values,sampleFingerprint:nextFingerprint,
    samplePlanVersion:'paired-scene-strata-v1',riskRefined:true
  };
}
