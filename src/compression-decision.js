// Compression decision policy: measured-only codec envelope and bounded trial costs.
// Never extrapolate between incompatible measurement scopes or into unmeasured budgets.
import { createSizeQualityFrontier } from './rate-distortion-model.js';

function valid(x) { return typeof x === 'number' && Number.isFinite(x) ? x : null; }

// This is a soft preflight budget: non-preemptible native FFmpeg probes can overrun it.
export function calibrationTimeBudget(mediaSeconds, {fraction=.10, minimumSeconds=8, maximumSeconds=120}={}) {
  const duration=valid(mediaSeconds);
  if(!(duration>0) || !(fraction>0) || !(minimumSeconds>0) || !(maximumSeconds>=minimumSeconds))
    return null;
  return Math.min(maximumSeconds,Math.max(minimumSeconds,duration*fraction));
}
export function calibrationCost(point) {
  const samples=point?.sampleMeasurements;
  if(!Array.isArray(samples) || !samples.length) return null;
  let sum=0;
  for(const sample of samples) {
    const cost=valid(sample?.elapsedSeconds);
    if(cost===null || cost<0) return null;
    sum+=cost;
  }
  return sum>0 ? sum : null;
}
export function calibrationShouldContinue({points, budgetSeconds, minimumPoints=2}={}) {
  if(!Array.isArray(points)) return {continue:false,reason:'invalid-evidence'};
  const budget=valid(budgetSeconds);
  if(!(budget>0)) return {continue:true,reason:'unbounded'};
  if(!points.length) return {continue:true,reason:'initial-probe'};
  const costs=points.map(calibrationCost);
  if(costs.some(x=>x===null)) return {continue:false,reason:'unknown-cost'};
  const spent=costs.reduce((a,b)=>a+b,0);
  // Use the slowest observed candidate as a conservative cost predictor.
  const estimate=Math.max(...costs);
  if(spent+estimate>budget) return {continue:false,reason:'time-budget',spentSeconds:spent,estimatedNextSeconds:estimate};
  return {continue:true,reason:points.length<minimumPoints?'minimum-evidence':'within-budget',
    spentSeconds:spent,estimatedNextSeconds:estimate};
}

// Same-source, same-reference, same-resolution branches only. Different output
// resolutions require a distinct shared-reference quality measurement pipeline.
export function createMultiBranchFrontier(branches, {
  durationSeconds,audioBitrate=0,reservePercent=4,
  containerReservePercent=0,fixedReserveBytes=0,minimumVideoBitrate=1000,
  incumbentId=null,hysteresisSsim=.003
}={}) {
  if(!Array.isArray(branches) || branches.length<2) return {ok:false,reason:'insufficient-branches'};
  const ids=new Set(),scopes=new Set(),prepared=[];
  for(const b of branches) {
    if(!b?.id || ids.has(b.id) || !b.model?.ok || !b.measurementScope)
      return {ok:false,reason:'invalid-branch'};
    ids.add(b.id);scopes.add(b.measurementScope);
    const frontier=createSizeQualityFrontier(b.model,{durationSeconds,audioBitrate,reservePercent,
      containerReservePercent,fixedReserveBytes,minimumVideoBitrate});
    if(!frontier.ok) return {ok:false,reason:'invalid-branch-frontier'};
    prepared.push({id:b.id,frontier,model:b.model,preset:b.preset||null});
  }
  if(scopes.size!==1) return {ok:false,reason:'incompatible-evidence-scope'};
  if(!(hysteresisSsim>=0 && hysteresisSsim<=.1)) return {ok:false,reason:'invalid-hysteresis'};
  // Restrict to common measured budgets: do not draw an invented continuous
  // upper envelope through gaps where a codec was never tested.
  const min=Math.max(...prepared.map(b=>b.frontier.minimumEvidenceTargetBytes));
  const max=Math.min(...prepared.map(b=>b.frontier.maximumEvidenceTargetBytes));
  if(!(min>0 && max>min)) return {ok:false,reason:'no-common-evidence-domain'};
  function evaluateTargetBytes(targetBytes) {
    const bytes=valid(targetBytes);
    if(!(bytes>0)) return {status:'invalid',targetBytes:bytes,prediction:null};
    if(bytes<min) return {status:'below-evidence',targetBytes:bytes,prediction:null};
    if(bytes>max) return {status:'above-evidence',targetBytes:bytes,prediction:null};
    const choices=prepared.map(({id,frontier,preset})=>{
      const result=frontier.evaluateTargetBytes(bytes);
      return result.status==='within-evidence' ? {
        id,preset,videoBitrate:result.videoBitrate,prediction:result.prediction,
        conservativeQuality:result.prediction.lowerQuality
      } : null;
    }).filter(Boolean);
    if(choices.length!==prepared.length) return {status:'no-shared-evidence',targetBytes:bytes,prediction:null};
    const ordered=[...choices].sort((a,b)=>b.conservativeQuality-a.conservativeQuality ||
      b.prediction.quality-a.prediction.quality || String(a.id).localeCompare(String(b.id)));
    const winner=ordered[0],incumbent=choices.find(c=>c.id===incumbentId);
    const chosen=incumbent && winner.conservativeQuality-incumbent.conservativeQuality<hysteresisSsim
      ? incumbent : winner;
    return {
      status:'within-evidence',targetBytes:bytes,videoBitrate:chosen.videoBitrate,
      prediction:{...chosen.prediction,branchId:chosen.id},branchId:chosen.id,preset:chosen.preset,
      bestMeasuredId:winner.id,handoff:!!(incumbent && chosen.id!==incumbent.id),
      qualityGainOverIncumbent:incumbent?winner.conservativeQuality-incumbent.conservativeQuality:null,
      alternatives:ordered.map(c=>({id:c.id,quality:c.prediction.quality,
        lowerQuality:c.prediction.lowerQuality,upperQuality:c.prediction.upperQuality,
        videoBitrate:c.videoBitrate}))
    };
  }
  const evidencePoints=prepared.flatMap(({id,frontier})=>
    frontier.evidencePoints.filter(p=>p.targetBytes>=min && p.targetBytes<=max)
      .map(p=>({...p,branchId:id})));
  function sampleCurve(count=64) {
    const n=Math.max(2,Math.min(256,Math.floor(Number(count)||64)));
    return Array.from({length:n},(_,i)=>{
      const targetBytes=Math.exp(Math.log(min)+(Math.log(max)-Math.log(min))*i/(n-1));
      const e=evaluateTargetBytes(targetBytes);
      return e.status==='within-evidence' ? {
        ...e.prediction,targetBytes,branchId:e.branchId,videoBitrate:e.videoBitrate
      }:null;
    }).filter(Boolean);
  }
  return {ok:true,kind:'multi-branch',branchIds:prepared.map(b=>b.id),
    minimumEvidenceTargetBytes:min,maximumEvidenceTargetBytes:max,
    evidencePoints,knee:null,incumbentId,evaluateTargetBytes,sampleCurve,
    // A multi-branch envelope is not the marginal curve of a single encoder.
    marginalQualityPerDoubling:()=>null};
}
