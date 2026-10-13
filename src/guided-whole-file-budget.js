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
