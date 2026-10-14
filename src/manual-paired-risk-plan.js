// B15: use the same bounded scene-risk stratifier as Guided ASS, but never
// equate pure-source SDR reference samples with subtitle-rendered references.
// Native probes are optional measurements, not confidence intervals.
import {sceneProbeStarts,selectPairedSceneWindows,SCENE_PLAN_VERSION} from './scene-risk-selection.js';
import {calibrationSampleStarts} from './transcode-curves.js';

const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validSignals=p=>finite(p?.meanLuma)||finite(p?.meanYdif)||
  finite(p?.peakScene)||finite(p?.meanContrast);

export async function prepareManualPairedRiskPlan({
  rangeStart,rangeEnd,windowSeconds=2,seekable=true,
  probeScene=async()=>null,isCurrent=()=>true,
  now=()=>Date.now(),maxProbes=3,probeBudgetMs=9000
}={}){
  const from=Number(rangeStart),to=Number(rangeEnd);
  if(!finite(from)||!finite(to)||from<0||to<=from||
     !finite(windowSeconds)||windowSeconds<=0||
     !Number.isSafeInteger(maxProbes)||maxProbes<0||maxProbes>6||
     !finite(probeBudgetMs)||probeBudgetMs<0||probeBudgetMs>20000||
     typeof probeScene!=='function'||typeof isCurrent!=='function'||typeof now!=='function')
    return {ok:false,reason:'invalid-manual-risk-plan'};
  const span=to-from;
  if(span<2*windowSeconds)return {ok:false,reason:'insufficient-paired-duration'};
  if(!seekable)return {ok:false,reason:'source-not-seekable-for-two-paired-windows'};
  if(!isCurrent())return {ok:false,reason:'stale-source-before-probing'};
  const candidates=sceneProbeStarts(span,windowSeconds);
  const probes=[];
  const started=now();
  const order=[0,2,4,1,3,5];
  for(const index of order.filter(i=>i<candidates.length).slice(0,maxProbes)){
    if(!isCurrent())return {ok:false,reason:'stale-source-during-probing'};
    if(now()-started>=probeBudgetMs)break;
    const relative=candidates[index];
    if(relative===undefined)continue;
    let result;
    try{
      result=await probeScene({
        start:Number((from+relative).toFixed(3)),
        duration:windowSeconds,timeoutSeconds:Math.min(3,Math.max(1,(probeBudgetMs-(now()-started))/1000))
      });
    }catch(error){
      if(!isCurrent())return {ok:false,reason:'stale-source-during-probing'};
      // A real failure means risk UNKNOWN, not 0 or a fabricated success.
      break;
    }
    if(!isCurrent())return {ok:false,reason:'stale-source-after-native-response'};
    if(Number(result?.frameCount)>0 && validSignals(result)){
      probes.push({
        start:relative,meanLuma:result.meanLuma,
        meanYdif:result.meanYdif,peakScene:result.peakScene,
        meanContrast:result.meanContrast
      });
    }
  }
  if(!isCurrent())return {ok:false,reason:'stale-source-after-probing'};
  const scored=selectPairedSceneWindows({
    durationSeconds:span,windowSeconds,probes,
    subtitleEvents:[],seekable:true,maxWindows:3
  });
  // Two samples cannot represent all three strata. Keep the strongest known
  // risk window plus a distant second stratum. With no reliable risk signals,
  // prefer time-spaced uniform windows rather than arbitrary stratum 0/1.
  const chooseTwo=()=>{
    if(!scored.ok||scored.windows.length<2||probes.length===0)return [];
    const rated=[...scored.windows].sort((a,b)=>b.score-a.score||a.start-b.start);
    const first=rated[0];
    const second=[...scored.windows].filter(w=>w.start!==first.start)
      .sort((a,b)=>Math.abs(b.start-first.start)-Math.abs(a.start-first.start)||
        b.score-a.score||a.start-b.start)[0];
    if(!second)return [];
    return [first,second].sort((a,b)=>a.start-b.start);
  };
  const valid=windows=>Array.isArray(windows)&&windows.length===2&&
    windows.every(w=>finite(w.start)&&finite(w.duration)&&
      w.start>=from-1e-6&&w.start+w.duration<=to+1e-6)&&
    windows[1].start+1e-6>=windows[0].start+windows[0].duration;
  let windows=chooseTwo().map(w=>({
    start:Number((from+w.start).toFixed(3)),duration:windowSeconds
  }));
  let mode=probes.length?'risk-stratified-observed':'time-stratified-no-risk-evidence';
  if(!valid(windows)){
    const uniform=calibrationSampleStarts(from,to,windowSeconds,2);
    windows=uniform.map(start=>({start,duration:windowSeconds}));
    mode=probes.length?'paired-uniform-fallback':'time-stratified-no-risk-evidence';
  }
  if(!valid(windows))return {ok:false,reason:'unable-to-create-nonoverlapping-paired-windows'};
  return {
    ok:true,version:1,kind:'manual-source-only-paired-risk-plan',
    referenceDomain:'pure-source-sdr-no-ass',
    scenePlanVersion:SCENE_PLAN_VERSION,
    rangeStart:from,rangeEnd:to,windows,mode,
    probedWindows:probes.length,candidateWindows:candidates.length,
    riskAware:!!(scored?.riskAware&&mode==='risk-stratified-observed'),
    // Immutable only by convention. Provenance remains a Native sample receipt.
    fingerprint:JSON.stringify([
      'manual-source-only',SCENE_PLAN_VERSION,from,to,windowSeconds,
      mode,windows.map(w=>[w.start,w.duration])
    ]),
    cannotReuseGuidedAssEvidence:true,
    noStatisticalCoverageClaim:true
  };
}
