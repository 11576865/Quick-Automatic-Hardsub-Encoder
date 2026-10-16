import {auxiliarySelection} from './media-stream-plan.js';

// Source object checklists project the existing keep flags and ordinal fields.
// They neither extract assets nor select an ASS rendering source.
export function mountWorkbenchStreamControls({shell,form,source,media,locked,schedule}){
  const groups=[
    {kind:'subtitles',key:'subtitleStreams',count:'subtitleTracks',keep:'keepSubtitles',label:'软字幕',prefix:'s'},
    {kind:'attachments',key:'attachmentStreams',count:'attachmentTracks',keep:'keepAttachments',label:'附件 / 字体',prefix:'t'}
  ];
  const actual=name=>form.elements.namedItem(name);
  const host=document.createElement('div');host.className='v3-object-selections';
  shell.querySelector('.v3-basic-streams').append(host);
  const note=document.createElement('p');note.textContent='序号是各类流的 FFmpeg 顺序，从 0 开始；保留软字幕不会将其烧入画面。兼容性由正式检查判定。';host.append(note);
  let boundSource,boundKey;
  const sourceKey=file=>JSON.stringify([file?.name,file?.size,file?.lastModified]);
  const sourceCurrent=()=>source()===boundSource&&sourceKey(source())===boundKey;
  const facts=group=>Array.isArray(media()?.[group.key])?media()[group.key]:[];
  const title=(group,stream,ordinal)=>`${group.prefix}:${ordinal} · ${stream.filename||stream.tags?.filename||stream.title||stream.tags?.title||stream.codec||stream.codec_name||group.label}${stream.language||stream.tags?.language?' · '+(stream.language||stream.tags?.language):''}`;
  const complete=group=>Array.isArray(media()?.[group.key])&&(media()?.[group.count]==null||Number(media()[group.count])===facts(group).length);
  const signature=group=>JSON.stringify([media()?.[group.count],facts(group).map((s,i)=>[s.index,title(group,s,i)])]);
  const guided=()=>document.body.dataset.mediaOperation==='hardsub'&&document.body.dataset.hardsubStrategy==='guided';
  function selection(group){
    if(!actual(group.keep).checked)return new Set();
    return new Set(auxiliarySelection(actual(group.key).value,facts(group).length,group.label)??facts(group).map((_,i)=>i));
  }
  for(const group of groups){
    const section=document.createElement('section');section.className='v3-object-selection';
    const heading=document.createElement('h4');heading.textContent=group.label+'保留';
    const rows=document.createElement('div');rows.className='v3-object-options';
    const status=document.createElement('p');status.setAttribute('role','status');
    section.append(heading,rows,status);host.append(section);Object.assign(group,{rows,status,signature:null});
  }
  function refresh(){
    boundSource=source();boundKey=sourceKey(boundSource);
    for(const group of groups){
      const streams=facts(group),shape=signature(group);
      if(shape!==group.signature){
        group.rows.replaceChildren();
        // Keep large or incomplete probe inventories in the full formal editor.
        if(streams.length<=32)for(const [ordinal,stream] of streams.entries()){
          const label=document.createElement('label'),checkbox=document.createElement('input'),text=document.createElement('span');
          checkbox.type='checkbox';checkbox.dataset.objectKind=group.kind;checkbox.dataset.objectOrdinal=String(ordinal);
          text.textContent=title(group,stream,ordinal);label.append(checkbox,text);group.rows.append(label);
        }
        group.signature=shape;
      }
      let selected,error='';try{selected=selection(group);}catch(e){selected=new Set();error='正式选择无法映射当前来源：'+e.message+'。请在完整正式参数中修正。';}
      const disabled=!source()||!complete(group)||locked()||guided()||actual(group.keep).matches(':disabled')||actual(group.key).matches(':disabled')||!!error;
      for(const checkbox of group.rows.querySelectorAll('input')){checkbox.checked=selected.has(Number(checkbox.dataset.objectOrdinal));checkbox.disabled=disabled;}
      const status=error||(!complete(group)?'来源对象清单不完整，请重新检查来源；现有保留策略不变。':streams.length>32?'来源对象超过 32 个，请在完整正式参数中选择；现有保留策略不变。':!streams.length?'尚无可列出的'+group.label+'；请检查来源探测结果。':`已选择 ${selected.size} / ${streams.length} 个来源对象；实际去向以正式计划为准。`);
      if(group.status.textContent!==status)group.status.textContent=status;
    }
  }
  host.addEventListener('change',event=>{
    const checkbox=event.target,group=groups.find(g=>g.kind===checkbox.dataset.objectKind);
    if(!group)return;
    const ordinal=Number(checkbox.dataset.objectOrdinal);
    if(!source()||!sourceCurrent()||!complete(group)||signature(group)!==group.signature||guided()||locked()||actual(group.keep).matches(':disabled')||actual(group.key).matches(':disabled')||!Number.isInteger(ordinal)||ordinal<0||ordinal>=facts(group).length){refresh();schedule();return;}
    let selected;try{selected=selection(group);}catch{refresh();return;}
    if(checkbox.checked)selected.add(ordinal);else selected.delete(ordinal);
    const values=[...selected].sort((a,b)=>a-b);
    actual(group.keep).checked=values.length>0;
    actual(group.key).value=values.length?values.join(','):'all';
    // The original owners handle plan invalidation and budget evidence changes.
    for(const name of [group.keep,group.key]){
      actual(name).dispatchEvent(new Event('input',{bubbles:true}));
      actual(name).dispatchEvent(new Event('change',{bubbles:true}));
    }
    schedule();
  });
  return {refresh};
}
