import {formatSize} from './media-planning.js';
const actions={copy:'复制',encode:'重编码',aac:'转为 AAC',libopus:'转为 Opus',flac:'转为 FLAC',drop:'不输出'};
export function buildTaskReview({media=null,hasSource=false,task=null,artifact=null,stale=false,state='idle'}={}){
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
  source:{status:media?'来源参数已读取':hasSource?'来源未读取参数':'未选择来源',facts:media?[media.videoCodec||media.codec||'视频编码未知',media.width&&media.height?media.width+'×'+media.height:'尺寸未知',Number(media.duration)>0?Number(media.duration).toFixed(2)+' 秒':'时长未知',Number(media.audioTracks??media.audioStreams?.length??0)+' 条音轨']:[]},
  plan:{status:task?'当前方案已检查':'当前方案未检查',encoder:task?.encoder||null,container:task?.outputContainer||null,rows,budget:task?.sizePlan?['目标 '+formatSize(task.sizePlan.targetBytes),'固定负载 '+formatSize(task.sizePlan.fixedPayloadBytes),'编码音频 '+formatSize(task.sizePlan.encodedAudioBytes),'封装余量 '+formatSize(task.sizePlan.containerReserveBytes)]:[]},
  artifact:{available:!!artifact,status:artifactStatus,source:artifact?.source||'来源未记录',encoder:artifact?.task?.encoder||null,container:artifact?.task?.outputContainer||null,bytes:Number.isSafeInteger(report?.outputBytes)&&report.outputBytes>0?report.outputBytes:null,verification:report?.verified===true?'后端成品验证已通过':report?.verified===false?'后端成品验证未通过':'未提供后端验证回执',playback:'外部播放器与真实设备兼容性未验证'}
 };
}
export function renderTaskReview(root,model){
 const put=(id,text)=>{root.querySelector('[data-review="'+id+'"]').textContent=text;};
 const list=(id,rows)=>{const el=root.querySelector('[data-review="'+id+'"]');el.replaceChildren();for(const text of rows){const li=document.createElement('li');li.textContent=text;el.append(li);}};
 put('source-status',model.source.status);list('source-facts',model.source.facts);
 put('plan-status',model.plan.status);put('plan-codec',model.plan.encoder?[model.plan.encoder,model.plan.container?.toUpperCase()].filter(Boolean).join(' · '):'检查后显示执行计划');list('plan-rows',model.plan.rows);list('plan-budget',model.plan.budget);
 put('artifact-status',model.artifact.status);put('artifact-facts',model.artifact.available?[model.artifact.source,model.artifact.encoder?'执行配置 '+model.artifact.encoder:null,model.artifact.container?'计划容器 '+model.artifact.container.toUpperCase():null,model.artifact.bytes?formatSize(model.artifact.bytes):'成品字节数未知'].filter(Boolean).join(' · '):'执行后显示实际成品');
 put('artifact-evidence',model.artifact.available?model.artifact.verification+'。'+model.artifact.playback+'。':'成品回执与保存状态会在此显示。');
 root.dataset.planChecked=String(!!model.plan.encoder);root.dataset.artifactAvailable=String(model.artifact.available);
}
