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
  for(const index of order.slice(0,Math.min(maxProbes,candidates.length))){
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
    subtitleEvents:[],seekable:true,maxWindows:2
  });
  const valid=windows=>Array.isArray(windows)&&windows.length===2&&
    windows.every(w=>finite(w.start)&&finite(w.duration)&&
      w.start>=from-1e-6&&w.start+w.duration<=to+1e-6)&&
    windows[1].start+1e-6>=windows[0].start+windows[0].duration;
  let windows=scored.ok?scored.starts.map(start=>({
    start:Number((from+start).toFixed(3)),duration:windowSeconds
  })).sort((a,b)=>a.start-b.start):[];
  let mode=probes.length?'risk-stratified-observed':'time-stratified-no-risk-evidence';
  if(!valid(windows)){
    const uniform=calibrationSampleStarts(from,to,windowSeconds,2);
    windows=uniform.map(start=>({start,duration:windowSeconds}));
    mode='paired-uniform-fallback';
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
