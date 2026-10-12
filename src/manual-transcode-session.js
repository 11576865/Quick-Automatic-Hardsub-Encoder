// Session-only Manual native CQ evidence registry. No UI, storage, scheduler,
// codec switching or authorization to publish a video output is implemented here.
import {
  normalizeManualComparisonProtocol,
  admitManualNativeCqSample,
  createManualTranscodeComparison
} from './manual-transcode-comparison.js';

const finite = n => typeof n === 'number' && Number.isFinite(n);
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
const candidateKey = c => JSON.stringify([
  c.id,c.codec,c.encoder,c.preset,c.outputWidth,c.outputHeight,c.pixelFormat
]);

export function createManualTranscodeSession({
  protocol,candidates,maxCandidates=4,maxQualitySettings=7,
  maxTotalSamples=128,maxEncodeSeconds=360
}={}) {
  const normalized=normalizeManualComparisonProtocol(protocol);
  if(!normalized.ok) return normalized;
  if(!Array.isArray(candidates) || candidates.length<1 ||
     candidates.length>maxCandidates || maxCandidates<1 || maxCandidates>12 ||
     !Number.isSafeInteger(maxQualitySettings) || maxQualitySettings<2 ||
     maxQualitySettings>12 || !Number.isSafeInteger(maxTotalSamples) ||
     maxTotalSamples<2 || maxTotalSamples>512 ||
     !finite(maxEncodeSeconds) || maxEncodeSeconds<=0 || maxEncodeSeconds>3600)
    return {ok:false,reason:'invalid-session-limits'};
  const p=Object.freeze({...normalized.protocol,
    windows:Object.freeze(normalized.protocol.windows.map(w=>Object.freeze({...w})))
  });
  const ids=new Set();
  const branchMap=new Map();
  for(const c of candidates){
    if(!c || typeof c.id!=='string' || !c.id.trim() ||
       typeof c.codec!=='string' || !c.codec ||
       typeof c.encoder!=='string' || !c.encoder ||
       typeof c.preset!=='string' || !c.preset ||
       c.outputWidth!==p.referenceWidth || c.outputHeight!==p.referenceHeight ||
       c.pixelFormat!=='yuv420p' || ids.has(c.id))
      return {ok:false,reason:'invalid-session-candidate'};
    ids.add(c.id);
    const frozen=Object.freeze({...c});
    branchMap.set(c.id,{candidate:frozen,key:candidateKey(frozen),
      complete:new Map(),inflight:new Map()});
  }
  let received=0,encodeSeconds=0,invalidated=false;
  let reason=null,scope=normalized.scope;
  const stats=()=>({
    receivedSamples:received,measuredEncodeSeconds:encodeSeconds,
    maxTotalSamples,maxEncodeSeconds,maxQualitySettings,invalidated
  });
  function discardIncomplete(branchId=null){
    if(branchId===null){
      for(const branch of branchMap.values())branch.inflight.clear();
    }else branchMap.get(branchId)?.inflight.clear();
    return {ok:true};
  }
  function invalidate(message='session-invalidated'){
    invalidated=true;reason=String(message);
    for(const branch of branchMap.values()){
      branch.inflight.clear();branch.complete.clear();
    }
    scope=null;
    return {ok:true,invalidated:true};
  }
  function addSample({candidate,qualitySetting,window,sample}={}){
    if(invalidated)return {ok:false,reason:'session-invalidated'};
    const b=branchMap.get(candidate?.id);
    if(!b || b.key!==candidateKey(candidate))
      return {ok:false,reason:'candidate-settings-changed'};
    if(!Number.isSafeInteger(qualitySetting) || qualitySetting<0 ||
       qualitySetting>63)return {ok:false,reason:'invalid-quality-setting'};
    const winIndex=p.windows.findIndex(w=>
      w.start===window?.start && w.duration===window?.duration);
    if(winIndex<0)return {ok:false,reason:'unexpected-window'};
    if(b.complete.has(qualitySetting))return {ok:false,reason:'already-complete'};
    const current=b.inflight.get(qualitySetting);
    if(current?.has(winIndex))return {ok:false,reason:'duplicate-window'};
    if(!current && b.inflight.size+b.complete.size>=maxQualitySettings)
      return {ok:false,reason:'quality-setting-budget-exceeded'};
    if(received>=maxTotalSamples)return {ok:false,reason:'sample-budget-exceeded'};
    const elapsed=sample?.elapsedSeconds;
    if(!finite(elapsed) || elapsed<0 ||
       encodeSeconds+elapsed>maxEncodeSeconds)
      return {ok:false,reason:'encode-time-budget-exceeded'};
    const accepted=admitManualNativeCqSample({
      sample,protocol:p,candidate:b.candidate,window,qualitySetting
    });
    if(!accepted.ok)return accepted;
    let readings=current;
    if(!readings){readings=new Map();b.inflight.set(qualitySetting,readings);}
    readings.set(winIndex,Object.freeze({
      ...accepted.measurement,elapsedSeconds:elapsed
    }));
    received++;encodeSeconds+=elapsed;
    if(readings.size===p.windows.length){
      const complete=p.windows.map((_,i)=>readings.get(i));
      b.complete.set(qualitySetting,Object.freeze(complete));
      b.inflight.delete(qualitySetting);
      return {ok:true,completed:true,branchId:b.candidate.id,
        qualitySetting,receivedSamples:received};
    }
    return {ok:true,completed:false,remainingWindows:p.windows.length-readings.size};
  }
  function trials(){
    if(invalidated)return [];
    return [...branchMap.values()].map(b=>({
      protocol:p,candidate:b.candidate,
      points:[...b.complete.entries()].map(([qualitySetting,samples])=>{
        const ssim=samples.map(s=>s.ssim),rates=samples.map(s=>s.bitrate);
        return {
          qualitySetting,
          sampleBitrate:rates.reduce((a,v)=>a+v,0)/rates.length,
          ssim:Math.min(...ssim),
          averageSsim:ssim.reduce((a,v)=>a+v,0)/ssim.length,
          sampleCount:samples.length,
          sampleMeasurements:samples.map(v=>({...v}))
        };
      })
    }));
  }
  function snapshot(){
    const t=trials();
    return {ok:!invalidated,reason,protocol:invalidated?null:p,
      scope,stats:stats(),
      candidates:t.map(x=>({
        id:x.candidate.id,completeSettings:x.points.length,
        pendingSettings:branchMap.get(x.candidate.id).inflight.size,
        qualitySettings:x.points.map(y=>y.qualitySetting)
      }))
    };
  }
  function compare(budget,{incumbentId=null,hysteresisSsim=.003}={}){
    if(invalidated)return {ok:false,reason:'session-invalidated'};
    // Incomplete trials must never create a new point, or be counted as a
    // complete branch. Fully measured settings survive a cancelled sweep.
    const eligible=trials().filter(t=>t.points.length>=2);
    if(eligible.length<2)return {ok:false,reason:'insufficient-complete-branches'};
    return createManualTranscodeComparison({
      trials:eligible,budget,incumbentId,hysteresisSsim
    });
  }
  return {ok:true,kind:'manual-transcode-session-v1',addSample,
    discardIncomplete,invalidate,trials,snapshot,compare};
}

// Cooperative bounded serial scheduler. Native in-flight sample cancellation
// is not promised; a stop request takes effect between finished sample calls.
// The caller owns source/task preflight, Native Bridge transport and rendering.
export async function runManualPairedSweep({
  session,branches,qualitySettings,sampleNative,shouldStop=()=>false,
  onProgress=()=>{},maxRequests=64
}={}) {
  if(!session?.ok || typeof session.addSample!=='function' ||
     !Array.isArray(branches) || !Array.isArray(qualitySettings) ||
     !qualitySettings.length || typeof sampleNative!=='function' ||
     typeof shouldStop!=='function' || typeof onProgress!=='function' ||
     !Number.isSafeInteger(maxRequests) || maxRequests<1 ||
     maxRequests>512)return {ok:false,reason:'invalid-sweep-plan'};
  const snapshot=session.snapshot();
  if(!snapshot.ok)return {ok:false,reason:'session-invalidated'};
  const windows=snapshot.protocol.windows;
  const expected=branches.length*qualitySettings.length*windows.length;
  if(expected>maxRequests)return {ok:false,reason:'sweep-request-budget-exceeded'};
  let completed=0;
  for(const candidate of branches){
    for(const qualitySetting of qualitySettings){
      for(const window of windows){
        if(shouldStop()){
          session.discardIncomplete();
          return {ok:false,reason:'stopped-between-samples',
            completedRequests:completed};
        }
        let response;
        try {
          response=await sampleNative({candidate,qualitySetting,window});
        } catch(error){
          session.discardIncomplete(candidate?.id);
          return {ok:false,reason:'native-sample-failed',detail:String(error?.message||error),
            completedRequests:completed};
        }
        // Never consume a late observation after the source/settings changed.
        if(shouldStop()){
          session.discardIncomplete();
          return {ok:false,reason:'stopped-after-native-response',
            completedRequests:completed};
        }
        const accepted=session.addSample({
          candidate,qualitySetting,window,sample:response
        });
        if(!accepted.ok){
          session.discardIncomplete(candidate?.id);
          return {ok:false,reason:accepted.reason,completedRequests:completed};
        }
        completed++;
        onProgress({completedRequests:completed,maxRequests:expected,
          candidateId:candidate.id,qualitySetting,
          completedQualitySetting:accepted.completed});
      }
    }
  }
  return {ok:true,completedRequests:completed};
}
