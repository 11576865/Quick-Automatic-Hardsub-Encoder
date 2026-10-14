// Coordinate projection only: does not measure video quality or attest output bytes.
import {sizeBudget} from './media-planning.js';
export function wholeFileLedger(task,evidence){
 const duration=Number(task.expectedVideoDuration);
 if(!(duration>0))throw Error('缺少有效视频预算时长');
 const reservePercent=Number(task.sizeReserve??4);
 // Reuse the authoritative per-stream cost rules without a tiny probe target.
 const b=sizeBudget({...task,budgetEvidence:evidence,targetSize:10000000,sizeUnit:'MB',sizeReserve:reservePercent},duration,task.expectedAudioTracks);
 return Object.freeze({durationSeconds:duration,reservePercent,fixedPayloadBytes:b.fixedPayloadBytes,encodedAudioBytes:b.encodedAudioBytes,copiedTrimReserveBytes:b.copiedTrimReserveBytes});
}
export function projectWholeFileFrontier(frontier,ledger){
 const d=ledger?.durationSeconds,r=ledger?.reservePercent/100;
 const fixed=ledger?.fixedPayloadBytes+ledger?.encodedAudioBytes;
 if(!frontier?.ok||!(d>0)||!Number.isFinite(fixed)||fixed<0||!(r>=.01&&r<=.30))return {ok:false,reason:'unknown-whole-file-budget'};
 const payload=total=>total-Math.ceil(total*r)-fixed;
 const videoBytesToTarget=bytes=>{
  let total=Math.ceil((bytes+fixed)/(1-r));
  if(payload(total)<bytes)total++;
  return total;
 };
 const minVideo=Math.ceil(frontier.minimumEvidenceTargetBytes*8/d)*d/8;
 const maxVideo=Math.floor(frontier.maximumEvidenceTargetBytes*8/d)*d/8;
 const min=videoBytesToTarget(minVideo);
 let max=videoBytesToTarget(maxVideo);
 if(payload(max)>maxVideo)max--;
 if(!(Number.isSafeInteger(min)&&Number.isSafeInteger(max)&&max>min))return {ok:false,reason:'no-common-evidence-domain'};
 function evaluateTargetBytes(value){
  const bytes=Math.round(Number(value));
  if(!Number.isSafeInteger(bytes)||bytes<=0)return {status:'invalid',targetBytes:bytes,prediction:null};
  const available=payload(bytes),rate=Math.floor(available*8/d);
  const budget={...ledger,targetBytes:bytes,containerReserveBytes:Math.ceil(bytes*r),videoPayloadBytes:rate*d/8,videoRate:rate};
  if(rate<1000)return {status:'infeasible',targetBytes:bytes,prediction:null,budget};
  if(bytes<min||bytes>max)return {status:bytes<min?'below-evidence':'above-evidence',targetBytes:bytes,prediction:null,budget};
  const e=frontier.evaluateTargetBytes(rate*d/8);
  return {...e,targetBytes:bytes,videoBitrate:rate,budget};
 }
 return {...frontier,kind:'whole-file-projection',budget:ledger,minimumEvidenceTargetBytes:min,maximumEvidenceTargetBytes:max,videoBytesToTarget,evaluateTargetBytes,
  evidencePoints:(frontier.evidencePoints||[]).map(p=>({...p,targetBytes:videoBytesToTarget(p.targetBytes)})).filter(p=>p.targetBytes>=min&&p.targetBytes<=max),
  knee:frontier.knee?{...frontier.knee,targetBytes:videoBytesToTarget(frontier.knee.targetBytes)}:null,
  sampleCurve(count=64){const n=Math.max(2,Math.min(256,Math.floor(Number(count)||64)));return Array.from({length:n},(_,i)=>{const e=evaluateTargetBytes(min+(max-min)*i/(n-1));return e.status==='within-evidence'?{...e.prediction,targetBytes:e.targetBytes,videoBitrate:e.videoBitrate,branchId:e.branchId}:null;}).filter(Boolean);},
  marginalQualityPerDoubling:()=>null};
}
