import {parseMediaTime} from './media-time.js';
import {normalizeAudioPlan,auxiliarySelection} from './media-stream-plan.js';

// Build bounded observations, not a formal task. The source and selected
// packet ledger are authenticated again by Native Bridge at start and return.
export function buildAuxiliaryPreflightRequest({settings,media,budgetEvidence}={}){
 const n=Number(media?.audioTracks||0),duration=Number(media?.duration);
 if(!settings||!(duration>0)||!Number.isFinite(duration)||
    budgetEvidence?.version!==1||budgetEvidence?.scope!=='full-source'||
    !budgetEvidence.measurementId)
  return {ok:false,reason:'missing-source-measurement'};
 const start=parseMediaTime(settings.start,{empty:0,max:duration,label:'开始时间'});
 const end=parseMediaTime(settings.end,{empty:duration,max:duration,label:'结束时间'});
 if(!(end>start))return {ok:false,reason:'invalid-clip-window'};
 let selected;
 try{selected=normalizeAudioPlan(settings.audioPlan,media,settings.audioRange||'trim');}
 catch(e){return {ok:false,reason:'invalid-audio-plan',detail:String(e.message||e)};}
 const flac=selected?.filter(t=>t.action==='flac')||[];
 if(flac.length){
  if(end-start>14400)return {ok:false,reason:'flac-preview-over-four-hours'};
  return {ok:true,mode:'flac',partial:selected.some(t=>t.action!=='flac'&&t.action!=='drop'),
   request:{version:1,mode:'isolated-flac-encode',start,end,outputFormat:'matroska',
    tracks:flac.map(t=>({action:'flac',sourceOrdinal:t.sourceOrdinal,range:t.range,
      channels:t.channels??null,sampleRate:t.sampleRate??null}))}};
 }
 if(!selected&&settings.audio!=='copy'&&!settings.keepSubtitles)
  return {ok:false,reason:'no-relevant-copy-or-flac-stream'};
 // One isolated copy seek cannot reproduce mixed full/trim stream timelines.
 const sourceAudio=selected?selected.filter(t=>t.action==='copy')
   :settings.audio==='copy'
     ?(settings.audioTrack==='all'?Array.from({length:n},(_,i)=>({sourceOrdinal:i,range:settings.audioRange||'trim'}))
       :[{sourceOrdinal:Number(settings.audioTrack),range:settings.audioRange||'trim'}])
     :[];
 if(sourceAudio.some(t=>t.range!=='trim'))
  return {ok:false,reason:'mixed-or-full-copy-not-a-trim-preview'};
 let subtitleOrdinals=[];
 if(settings.keepSubtitles){
  try{
   const selectedSubs=auxiliarySelection(settings.subtitleStreams,Number(media.subtitleTracks||0),'内封字幕');
   subtitleOrdinals=selectedSubs||Array.from({length:Number(media.subtitleTracks||0)},(_,i)=>i);
  }catch(e){return {ok:false,reason:'invalid-subtitle-selection'};}
  if(settings.subtitleRange!=='trim')return {ok:false,reason:'mixed-or-full-copy-not-a-trim-preview'};
 }
 const audioOrdinals=sourceAudio.map(t=>t.sourceOrdinal);
 if(start<=0&&end>=duration-1e-6)return {ok:false,reason:'no-trim-requested'};
 if(end-start>3600)return {ok:false,reason:'copy-preview-over-one-hour'};
 if(audioOrdinals.length+subtitleOrdinals.length===0)
  return {ok:false,reason:'no-auxiliary-copy-stream'};
 if(audioOrdinals.some(t=>!Number.isSafeInteger(t)||t<0||t>=n))
  return {ok:false,reason:'invalid-source-audio-ordinal'};
 return {ok:true,mode:'copy',partial:!!selected?.some(t=>t.action!=='copy'&&t.action!=='drop'),
  request:{version:1,mode:'isolated-trim-copy',start,end,outputFormat:'matroska',
   audioOrdinals,subtitleOrdinals}};
}
