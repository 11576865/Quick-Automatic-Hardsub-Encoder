import {formatSize} from './media-planning.js';
import {projectReadOnlyDeliveryContract} from './delivery-contract-projection.js';
const actions={copy:'复制',encode:'重编码',aac:'转为 AAC',libopus:'转为 Opus',flac:'转为 FLAC',drop:'不输出'};
export function buildTaskReview({media=null,hasSource=false,sourceIdentity='',task=null,artifact=null,stale=false,state='idle'}={}){
 let domainProjection=null,domainIssue='';
 if(task&&media){
   try{domainProjection=projectReadOnlyDeliveryContract({task,media,sourceIdentity});}
   catch(e){domainIssue='只读交付合同暂不可用：'+e.message;}
 }
 const rows=[];const plan=task?.outputPlan;
 if(plan){
  for(const [key,label] of [['video','视频'],['audio','音频'],['subtitles','字幕'],['attachments','附件']]){
   for(const row of plan[key]||[])rows.push(label+' '+(row.sourceOrdinal==='all'?'全部':'#'+row.sourceOrdinal)+' → '+(actions[row.action]||row.action)+(row.range?' · '+(row.range==='full'?'完整':'IN/OUT'):''));
   if(['subtitles','attachments'].includes(key)&&!plan[key]?.length)rows.push(label+' → 不保留');
  }
  for(const row of plan.droppedAudio||[])rows.push('音频 #'+row.sourceOrdinal+' → 不输出');
  rows.push('元数据 → '+(plan.metadata?'保留':'不保留'),'章节 → '+(plan.chapters?'保留':'不保留'));
 }
 const report=artifact?.report;
 let artifactStatus='尚无成品';
 if(artifact){
  artifactStatus=report?.deliveryAllowed===false?'禁止交付':state==='saved'?(artifact.saveKind==='browser-download'?'已交给浏览器保存':'保存操作已完成'):state==='saving'?'正在保存':state==='save_failed'?'保存失败，可重试':'成品暂存，尚未保存';
  if(stale)artifactStatus='上一任务 · '+artifactStatus;
 }
 return {
  domainProjection,domainIssue,
  source:{status:media?'来源参数已读取':hasSource?'来源未读取参数':'未选择来源',facts:media?[media.videoCodec||media.codec||'视频编码未知',media.width&&media.height?media.width+'×'+media.height:'尺寸未知',Number(media.duration)>0?Number(media.duration).toFixed(2)+' 秒':'时长未知',Number(media.audioTracks??media.audioStreams?.length??0)+' 条音轨']:[]},
  plan:{status:task?'当前方案已检查':'当前方案未检查',encoder:task?.encoder||null,container:task?.outputContainer||null,rows,budget:task?.sizePlan?['目标 '+formatSize(task.sizePlan.targetBytes),'固定负载 '+formatSize(task.sizePlan.fixedPayloadBytes),'编码音频 '+formatSize(task.sizePlan.encodedAudioBytes),'封装余量 '+formatSize(task.sizePlan.containerReserveBytes),...(task.sizePlan.copiedTrimReserveBytes>0?['裁切复制流按完整源流预留 '+formatSize(task.sizePlan.copiedTrimReserveBytes)]:[])]:[]},
  artifact:{available:!!artifact,status:artifactStatus,source:artifact?.source||'来源未记录',encoder:artifact?.task?.encoder||null,container:artifact?.task?.outputContainer||null,bytes:Number.isSafeInteger(report?.outputBytes)&&report.outputBytes>0?report.outputBytes:null,verification:report?.verified===true?'后端成品验证已通过':report?.verified===false?'后端成品验证未通过':'未提供后端验证回执',playback:'外部播放器与真实设备兼容性未验证'}
 };
}
export function taskReviewOverview(model){
 return [model.source.status,model.plan.status,model.artifact.status].join(' · ');
}
export function renderTaskReview(root,model){
 const overview=root.parentElement?.querySelector('[data-review-overview]');
 if(overview)overview.textContent=taskReviewOverview(model);
 const put=(id,text)=>{root.querySelector('[data-review="'+id+'"]').textContent=text;};
 const list=(id,rows)=>{const el=root.querySelector('[data-review="'+id+'"]');el.replaceChildren();for(const text of rows){const li=document.createElement('li');li.textContent=text;el.append(li);}};
 put('source-status',model.source.status);list('source-facts',model.source.facts);
 put('plan-status',model.plan.status);put('plan-codec',model.plan.encoder?[model.plan.encoder,model.plan.container?.toUpperCase()].filter(Boolean).join(' · '):'检查后显示执行计划');list('plan-rows',model.plan.rows);list('plan-budget',model.plan.budget);
 put('artifact-status',model.artifact.status);put('artifact-facts',model.artifact.available?[model.artifact.source,model.artifact.encoder?'执行配置 '+model.artifact.encoder:null,model.artifact.container?'计划容器 '+model.artifact.container.toUpperCase():null,model.artifact.bytes?formatSize(model.artifact.bytes):'成品字节数未知'].filter(Boolean).join(' · '):'执行后显示实际成品');
 put('artifact-evidence',model.artifact.available?model.artifact.verification+'。'+model.artifact.playback+'。':'成品回执与保存状态会在此显示。');
 // A user-expandable read-only P1 domain view uses the same compiled task.
 // It is never an editable form nor a separate task-state authority.
 let details=root.querySelector('[data-review-domain-projection]');
 if(!details){
   details=document.createElement('details');
   details.dataset.reviewDomainProjection='true';
   const summary=document.createElement('summary');
   summary.textContent='展开来源／用户意图／逐流计划／执行参数（只读）';
   const body=document.createElement('pre');
   body.dataset.reviewDomainContent='true';
   body.style.whiteSpace='pre-wrap';
   body.style.overflowWrap='anywhere';
   body.style.maxHeight='22rem';
   body.style.overflow='auto';
   details.append(summary,body);
   root.append(details);
 }
 const domain=model.domainProjection;
 details.hidden=!domain&&!model.domainIssue;
 if(domain){
   const rows=[];
   rows.push('SourceAsset · '+(domain.sourceAsset.sourceName||'未命名来源')+
     ' · '+(domain.sourceAsset.identity?'已绑定来源身份':'来源身份未绑定'));
   rows.push('UserIntent · '+domain.userIntent.operation+
     ' · '+domain.userIntent.codecAction+' · '+domain.userIntent.container+
     '（从正式任务推导，并非另一个可编辑意图源）');
   for(const [kind,label] of [['video','视频'],['audio','音频'],['subtitles','字幕'],['attachments','附件']]){
     for(const stream of domain.sourceStreams[kind]){
       rows.push('SourceStream · '+label+' #'+stream.sourceOrdinal+
         ' / '+stream.codec+' → '+stream.action+
         (stream.range?' · '+stream.range:''));
     }
   }
   rows.push('OutputPlan · 元数据 '+(domain.outputPlan.metadata?'保留':'删除')+
     ' · 章节 '+(domain.outputPlan.chapters?'保留':'删除'));
   rows.push('ImmutableJobPlan（只读投影，非冻结新任务） · '+
     domain.executablePlanView.rawOutputArgs.join(' '));
   rows.push('ArtifactRecord · 尚无由此投影生成的独立成品证明');
   rows.push('追踪状态 · '+domain.trace.status);
   for(const warning of domain.trace.warnings)rows.push('需复核 · '+warning);
   rows.push('边界 · '+domain.trace.limitation);
   details.querySelector('[data-review-domain-content]').textContent=rows.join('\n');
 }else details.querySelector('[data-review-domain-content]').textContent=
   model.domainIssue||'读取媒体并检查正式任务后才有只读交付合同。';
 root.dataset.planChecked=String(!!model.plan.encoder);root.dataset.artifactAvailable=String(model.artifact.available);
}
