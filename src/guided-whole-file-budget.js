// Guided ASS uses Manual's authoritative auxiliary cost rules, not a new estimator.
// Video CQ evidence is projected; this grants no VBR or final-file verification.
import {wholeFileLedger,projectWholeFileFrontier} from './whole-file-frontier.js';

export function guidedWholeFileProjection(videoFrontier,{media,audio,evidence=null,reservePercent=4}={}){
  const duration=Number(media?.duration),tracks=Number(media?.audioTracks??0);
  if(!videoFrontier?.ok||!(duration>0)||!Number.isSafeInteger(tracks)||tracks<0||
    !['none','copy','aac','libopus'].includes(audio?.audio))
    return {ok:false,reason:'invalid-guided-source-or-audio'};
  if(audio.audio==='copy'&&tracks>0&&!evidence)
    return {ok:false,reason:'copy-cost-not-measured'};
  try{
    const ledger=wholeFileLedger({
      expectedVideoDuration:duration,sourceDuration:duration,trimDuration:duration,
      expectedAudioTracks:audio.audio==='none'?0:tracks,
      audio:audio.audio,audioBitrate:audio.audioBitrate||128000,
      audioTrack:'all',audioRange:'full',sizeReserve:reservePercent,
      keepSubtitles:false,keepAttachments:false
    },evidence);
    const f=projectWholeFileFrontier(videoFrontier,ledger);
    return f.ok?{...f,kind:videoFrontier.kind,
      guidedCostBasis:audio.audio==='copy'&&tracks>0?'measured-source-packets':'planned-audio'}:f;
  }catch(error){return {ok:false,reason:'guided-whole-file-cost-unavailable',detail:error.message};}
}

// Feasibility for the exact same full-duration cost policy used by compileTask.
// No absent copied packet cost is ever replaced with an estimated audio rate.
export function assessGuidedWholeFileBudget({
  targetBytes,media,audio,evidence=null,reservePercent=4,minimumVideoBitrate=150001
}={}){
  const duration=Number(media?.duration),tracks=Number(media?.audioTracks??0);
  if(!Number.isSafeInteger(targetBytes)||targetBytes<=0||targetBytes>1e13||
     !(duration>0)||!Number.isSafeInteger(tracks)||tracks<0||
     !Number.isFinite(reservePercent)||reservePercent<1||reservePercent>30||
     !Number.isSafeInteger(minimumVideoBitrate)||minimumVideoBitrate<1000||
     !['none','copy','aac','libopus'].includes(audio?.audio)||
     (['aac','libopus'].includes(audio.audio) &&
       !(Number.isFinite(Number(audio.audioBitrate||128000))&&Number(audio.audioBitrate||128000)>0)))
    return {status:'invalid',reason:'invalid-guided-budget'};
  if(audio.audio==='copy'&&tracks>0&&!evidence)
    return {status:'unknown',reason:'copy-cost-not-measured',targetBytes};
  let ledger;
  try{
    ledger=wholeFileLedger({
      expectedVideoDuration:duration,sourceDuration:duration,trimDuration:duration,
      expectedAudioTracks:audio.audio==='none'?0:tracks,
      audio:audio.audio,audioBitrate:audio.audioBitrate||128000,
      audioTrack:'all',audioRange:'full',sizeReserve:reservePercent,
      keepSubtitles:false,keepAttachments:false
    },evidence);
  }catch(error){
    return {status:'unknown',reason:'whole-file-cost-unavailable',
      targetBytes,detail:error.message};
  }
  const fixed=ledger.fixedPayloadBytes+ledger.encodedAudioBytes;
  const available=bytes=>Math.floor((bytes-Math.ceil(bytes*reservePercent/100)-fixed)*8/duration);
  const mathematicalMinimum=Math.ceil(
    (fixed+minimumVideoBitrate*duration/8)/(1-reservePercent/100)
  );
  if(!Number.isSafeInteger(mathematicalMinimum)||mathematicalMinimum>1e13)
    return {status:'invalid',reason:'minimum-budget-out-of-range'};
  let low=0,high=Math.max(1,mathematicalMinimum);
  while(available(high)<minimumVideoBitrate){
    if(high>=1e13)return {status:'invalid',reason:'minimum-budget-out-of-range'};
    high=Math.min(1e13,Math.ceil(high*1.2)+1);
  }
  while(high-low>1){
    const mid=low+Math.floor((high-low)/2);
    if(available(mid)>=minimumVideoBitrate)high=mid;else low=mid;
  }
  const availableVideoBitrate=available(targetBytes);
  return {
    status:availableVideoBitrate>=minimumVideoBitrate?'feasible':'infeasible',
    targetBytes,minimumTargetBytes:high,
    shortfallBytes:Math.max(0,high-targetBytes),
    availableVideoBitrate,minimumVideoBitrate,
    fixedPayloadBytes:ledger.fixedPayloadBytes,
    encodedAudioBytes:ledger.encodedAudioBytes,
    audioPayloadBytes:ledger.fixedPayloadBytes+ledger.encodedAudioBytes,
    containerReserveBytes:Math.ceil(targetBytes*reservePercent/100),
    reservePercent,
    estimatedBytes:availableVideoBitrate*duration/8+fixed,
    costBasis:audio.audio==='copy'&&tracks>0?'measured-source-packets':'planned-audio',
    durationSeconds:duration
  };
}
