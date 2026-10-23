// WU11 UI admission: turn an explicitly confirmed, source-bound per-stream
// choice into one Guided CPU handoff snapshot. Reuse the formal compiler's
// real whole-file ledger; never transplant Native VBR/SSIM certificates.
import {guidedTaskSettings} from './guided-task-handoff.js';
import {compileTask} from './media-task.js';

const fail=reason=>({ok:false,reason});
const parseArray=x=>{
 try{const a=typeof x==='string'?JSON.parse(x):x;return Array.isArray(a)?a:null}
 catch{return null}
};
export function prepareGuidedExplicitAudioHandoff({
 snapshot,settings,defaults,media,sourceKey,evidence=null,evidenceSourceKey='',
 approved=false
}={}){
 if(!approved)return fail('explicit-audio-approval-required');
 if(!snapshot?.plan||!media||typeof sourceKey!=='string'||!sourceKey)
  return fail('missing-guided-source-or-plan');
 const entries=parseArray(settings?.audioPlan);
 const locks=parseArray(settings?.mustCopyAudioOrdinals);
 if(!entries?.length||!locks?.length||entries.length>32||
    settings?.audioKeepSourceIdentity!==sourceKey)
  return fail('missing-or-stale-explicit-audio-lock');
 // Exactly one complete per-source policy. A Copy lock is not inferred
 // from the codec; the owner must tick it in the existing audio editor.
 const count=Number(media.audioTracks);
 if(!Number.isInteger(count)||count<2||entries.length!==count||
    new Set(entries.map(x=>x?.sourceOrdinal)).size!==count||
    entries.some((x,i)=>x?.sourceOrdinal!==i)||
    entries.some(x=>!['copy','aac','libopus'].includes(x.action)||x.range!=='full')||
    !entries.some(x=>x.action==='copy')||
    !entries.some(x=>x.action!=='copy')||
    locks.length!==entries.filter(x=>x.action==='copy').length||
    locks.some(x=>!Number.isInteger(x)||entries[x]?.action!=='copy')||
    new Set(locks).size!==locks.length)
  return fail('incomplete-or-incompatible-guided-audio-plan');
 if(!evidence||evidence.scope!=='full-source'||evidenceSourceKey!==sourceKey)
  return fail('missing-current-source-audio-budget');
 const scopeMedia={...media,sourceIdentity:sourceKey,budgetEvidence:evidence};
 const audio={
  audio:'copy',intent:'explicit-per-stream-v1',sourceIdentity:sourceKey,
  mustCopyAudioOrdinals:[...locks],audioPlan:entries.map(x=>({...x}))
 };
 let compiled;
 try{
  // This is a hypothetical recomputation, before mutation of either UI.
  // Legacy Guided could have projected the size budget with copy-all audio.
  // Recalculate fixed and newly encoded bytes *before* VBR admission.
  const raw=guidedTaskSettings({...snapshot,audio},defaults);
  compiled=compileTask(raw,scopeMedia);
 }catch(error){return {ok:false,reason:'shared-budget-recompile-rejected',detail:String(error?.message||error)};}
 const old=snapshot.plan,plan={...old};
 if(old.mode==='budget-rate'){
  if(!compiled.sizePlan||compiled.sizePlan.targetBytes!==old.sizeCeiling)
   return fail('recomputed-target-coordinate-diverged');
  Object.assign(plan,{
   targetVideoBitrate:compiled.bitrate,
   containerReserveBytes:compiled.sizePlan.containerReserveBytes,
   fixedPayloadBytes:compiled.sizePlan.fixedPayloadBytes,
   encodedAudioBytes:compiled.sizePlan.encodedAudioBytes
  });
 }
 return {
  ok:true,kind:'guided-ui-explicit-mixed-audio-snapshot-v1',
  snapshot:{plan,audio,container:snapshot.container},
  media:scopeMedia,
  budgetEvidence:evidence,sourceKey,
  previousVideoBitrate:old.targetVideoBitrate??null,
  newVideoBitrate:plan.targetVideoBitrate??null,
  nativeVbrCertificateTransferAllowed:false,
  requiresFreshExecutionValidation:true
 };
}
