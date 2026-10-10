// Bounded risk-aware selection. This is a heuristic, NOT a statistical
// confidence interval and not a guarantee that rare difficult scenes were found.
export const SCENE_PLAN_VERSION='paired-scene-strata-v1';
function finite(x){return typeof x==='number'&&Number.isFinite(x)?x:null;}
function clamp(x){return Math.max(0,Math.min(1,x));}
export function sceneProbeStarts(duration,windowSeconds=2) {
  if(!(finite(duration)>0 && finite(windowSeconds)>0))return [];
  const range=Math.max(0,duration-windowSeconds);
  const fractions=[1/12,3/12,5/12,7/12,9/12,11/12];
  const chosen=[];
  for(const fraction of fractions){
    const start=Number((range*fraction).toFixed(3));
    if(!chosen.some(x=>Math.abs(x-start)<Math.min(windowSeconds*.75,range/9)))chosen.push(start);
  }
  return chosen;
}
export function normalizedSceneRisk(signals={}) {
  const luma=finite(signals.meanLuma),difference=finite(signals.meanYdif),
    cut=finite(signals.peakScene),contrast=finite(signals.meanContrast);
  if(luma===null && difference===null && cut===null && contrast===null)return null;
  return (
    (difference===null?0:clamp(difference/25)*.38)+
    (cut===null?0:clamp(cut/25)*.28)+
    (luma===null?0:clamp((95-luma)/95)*.20)+
    (contrast===null?0:clamp(contrast/170)*.14)
  );
}
function dialogueBurden(start,seconds,events=[]) {
  let burden=0;
  for(const event of events){
    if(String(event?.kind||'').toLowerCase()!=='dialogue')continue;
    const from=finite(event.startSeconds),to=finite(event.endSeconds);
    if(from===null||to===null||to<=from||from>=start+seconds||to<=start)continue;
    const overlap=Math.min(to,start+seconds)-Math.max(from,start);
    // Dense multi-layer dialogue and frequent changes are rendering risks.
    burden+=overlap/seconds+0.12;
  }
  return clamp(burden/3);
}
export function selectPairedSceneWindows({
  durationSeconds,windowSeconds=2,probes=[],subtitleEvents=[],
  seekable=true,maxWindows=3
}={}) {
  const duration=finite(durationSeconds),seconds=finite(windowSeconds);
  if(!(duration>0&&seconds>0)||!Number.isInteger(maxWindows)||maxWindows<1||maxWindows>6)
    return {ok:false,reason:'invalid-scene-plan'};
  const starts=seekable?sceneProbeStarts(duration,seconds):[0];
  if(!starts.length)return {ok:false,reason:'no-scene-windows'};
  const validProbes=new Map();
  for(const probe of Array.isArray(probes)?probes:[]){
    const start=finite(probe?.start);
    if(start===null||!starts.some(s=>Math.abs(s-start)<.002))continue;
    const risk=normalizedSceneRisk(probe);
    if(risk!==null)validProbes.set(starts.find(s=>Math.abs(s-start)<.002),risk);
  }
  const scored=starts.map((start,i)=>({
    start,stratum:Math.min(2,Math.floor(i*3/starts.length)),
    visual:validProbes.get(start)??null,
    subtitle:dialogueBurden(start,seconds,subtitleEvents)
  })).map(x=>({...x,score:(x.visual??0)*.8+x.subtitle*.2}));
  const best=[];
  for(let stratum=0;stratum<3;stratum++){
    const options=scored.filter(x=>x.stratum===stratum)
      .sort((a,b)=>b.score-a.score||a.start-b.start);
    if(options.length)best.push(options[0]);
  }
  if(best.length<maxWindows) {
    const chosen=new Set(best.map(x=>x.start));
    for(const item of [...scored].sort((a,b)=>b.score-a.score||a.start-b.start)){
      if(best.length>=maxWindows)break;
      if(!chosen.has(item.start)){chosen.add(item.start);best.push(item);}
    }
  }
  const windows=best.slice(0,maxWindows).sort((a,b)=>a.start-b.start);
  return {ok:true,version:SCENE_PLAN_VERSION,
    starts:windows.map(x=>x.start),windows,
    candidates:scored,
    probedWindows:validProbes.size,candidateWindows:scored.length,
    riskAware:validProbes.size>=Math.min(3,starts.length),
    // Every branch must receive the exact same starts and metric version.
    fingerprint:SCENE_PLAN_VERSION+':'+seconds+':'+windows.map(x=>x.start.toFixed(3)).join(',')};
}
// A conservative screen for whether another paired measurement can change a
// selection. The intervals are observed ranges, NOT significance intervals.
export function refinementOpportunity({candidates,budgetRemainingSeconds,nextPairedCostSeconds,margin=.003}={}) {
  if(!Array.isArray(candidates)||candidates.length<2)return {refine:false,reason:'not-comparative'};
  const remaining=finite(budgetRemainingSeconds),cost=finite(nextPairedCostSeconds);
  if(!(remaining>0&&cost>0&&cost<=remaining))return {refine:false,reason:'budget-exhausted'};
  const evidence=[];
  for(const item of candidates){
    const lo=finite(item?.lowerQuality),hi=finite(item?.upperQuality);
    if(lo===null||hi===null||lo>hi)return {refine:false,reason:'invalid-range'};
    evidence.push({id:item.id,lowerQuality:lo,upperQuality:hi});
  }
  evidence.sort((a,b)=>b.lowerQuality-a.lowerQuality);
  const best=evidence[0],challengers=evidence.slice(1);
  const maxChallengerUpper=Math.max(...challengers.map(c=>c.upperQuality));
  if(maxChallengerUpper+margin<best.lowerQuality)
    return {refine:false,reason:'robust-dominance',leaderId:best.id};
  return {refine:true,reason:'overlapping-observed-ranges',leaderId:best.id,
    // A lower-ranked branch can still reverse the decision when its upper
    // observed quality reaches the leader's conservative lower bound.
    // This is NOT a probability distribution or an expected-regret estimate.
    uncertaintyGap:Math.max(0,maxChallengerUpper-best.lowerQuality)};
}
