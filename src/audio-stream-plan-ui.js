// Rows are views of one JSON form field; no second task state is owned here.
export function mountAudioStreamPlan({container,form,media,sourceIdentity}){
  const panel=document.createElement('details');panel.className='media-audio-plan';
  const summary=document.createElement('summary');summary.textContent='逐音轨输出计划';
  const field=document.createElement('input');field.type='hidden';field.name='audioPlan';field.setAttribute('form',form.id);
  const rows=document.createElement('div');rows.className='media-audio-plan-rows';
  const reset=document.createElement('button');reset.type='button';reset.className='secondary';reset.textContent='恢复全局音频策略';
  const status=document.createElement('p');status.className='note';status.textContent='读取素材后可独立设置每条音轨；未设置时沿用全局策略。';
  panel.append(summary,field,rows,reset,status);container.append(panel);
  let identity=sourceIdentity(),rowControls=[];
  const commit=()=>{
    field.value=JSON.stringify(rowControls.map(({sourceOrdinal,action,bitrate,range,channels,sampleRate})=>({sourceOrdinal,action:action.value,
      ...(['aac','libopus'].includes(action.value)?{bitrate:Number(bitrate.value)}:{}),
      ...(!['copy','drop'].includes(action.value)&&channels.value?{channels:Number(channels.value)}:{}),
      ...(!['copy','drop'].includes(action.value)&&sampleRate.value?{sampleRate:Number(sampleRate.value)}:{}),range:range.value})));
    field.dispatchEvent(new Event('change',{bubbles:true}));
    status.textContent='逐轨计划已生效；全局音频策略作为默认值保留。';
  };
  const refresh=()=>{
    const next=sourceIdentity();
    if(next!==identity){identity=next;field.value='';field.dispatchEvent(new Event('change',{bubbles:true}));}
    const info=media();const count=Number(info?.audioTracks||0);
    rows.replaceChildren();rowControls=[];
    if(count>32){status.textContent='当前逐轨界面最多 32 条音轨；请使用全局策略。';return;}
    let plan=[];try{plan=JSON.parse(field.value||'[]');}catch{status.textContent='音轨配置无效；请恢复全局策略。';return;}
    for(let sourceOrdinal=0;sourceOrdinal<count;sourceOrdinal++){
      const fact=info?.audioStreams?.[sourceOrdinal]||{};const selected=plan.find(a=>a.sourceOrdinal===sourceOrdinal);
      const row=document.createElement('div');row.className='media-audio-plan-row';
      const title=document.createElement('span');title.textContent='a:'+sourceOrdinal+' · '+(fact.codec||'未知编码')+(fact.language?' · '+fact.language:'');
      const action=document.createElement('select');action.setAttribute('aria-label','音轨 '+sourceOrdinal+' 输出动作');
      for(const [value,label] of [['copy','复制'],['aac','AAC'],['libopus','Opus'],['flac','FLAC'],['drop','不输出']]){
        const option=document.createElement('option');option.value=value;option.textContent=label;action.append(option);
      }
      const globalAction=form.elements.namedItem('audio')?.value||'copy';
      const globalTrack=form.elements.namedItem('audioTrack')?.value||'all';
      const defaultAction=globalAction==='none'||globalTrack!=='all'&&Number(globalTrack)!==sourceOrdinal?'drop':globalAction;
      action.value=selected?.action||(field.value?'drop':defaultAction);
      const bitrate=document.createElement('input');bitrate.type='number';bitrate.min='8000';bitrate.max='1024000';
      bitrate.value=String(selected?.bitrate??form.elements.namedItem('audioBitrate')?.value??128000);bitrate.setAttribute('aria-label','音轨 '+sourceOrdinal+' 码率 bit/s');
      const range=document.createElement('select');range.setAttribute('aria-label','音轨 '+sourceOrdinal+' 时间范围');
      for(const [value,label] of [['trim','按 IN/OUT'],['full','完整音轨']]){const o=document.createElement('option');o.value=value;o.textContent=label;range.append(o);}
      range.value=selected?.range||form.elements.namedItem('audioRange')?.value||'trim';
      const channels=document.createElement('input');channels.type='number';channels.min='1';channels.max='8';channels.placeholder='源声道';
      channels.value=String(selected?.channels??'');channels.setAttribute('aria-label','音轨 '+sourceOrdinal+' 输出声道');
      const sampleRate=document.createElement('input');sampleRate.type='number';sampleRate.placeholder='源采样率';
      sampleRate.value=String(selected?.sampleRate??'');sampleRate.setAttribute('aria-label','音轨 '+sourceOrdinal+' 采样率 Hz');
      const changed=()=>{bitrate.disabled=!['aac','libopus'].includes(action.value);channels.disabled=sampleRate.disabled=['copy','drop'].includes(action.value);commit();};
      bitrate.disabled=!['aac','libopus'].includes(action.value);
      channels.disabled=sampleRate.disabled=['copy','drop'].includes(action.value);
      action.onchange=changed;bitrate.onchange=changed;range.onchange=changed;channels.onchange=changed;sampleRate.onchange=changed;
      row.append(title,action,bitrate,range,channels,sampleRate);rows.append(row);rowControls.push({sourceOrdinal,action,bitrate,range,channels,sampleRate});
    }
  };
  reset.onclick=()=>{field.value='';field.dispatchEvent(new Event('change',{bubbles:true}));status.textContent='已恢复全局音频策略。';refresh();};
  field.addEventListener('change',event=>{if(event.target===field)queueMicrotask(refresh);});
  const defaultsChanged=event=>{if(['audio','audioTrack','audioRange','audioBitrate'].includes(event.target?.name))refresh();};
  form.addEventListener('change',defaultsChanged);form.addEventListener('input',defaultsChanged);
  refresh();return {refresh,panel};
}
