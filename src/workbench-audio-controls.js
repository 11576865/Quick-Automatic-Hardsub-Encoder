// Unnamed projections of the existing per-track editor. The original editor
// owns audioPlan, source binding, preservation locks and compiler validation.
export function mountWorkbenchAudioControls({shell,locked,schedule}){
  const original=document.querySelector('.media-audio-plan');
  if(!original)return {refresh(){}};
  const panel=document.createElement('details');panel.className='v3-audio-plan';
  panel.innerHTML='<summary>逐音轨输出计划</summary><p>各轨可覆盖全局音频策略；必须 Copy 会交由正式编译器保护。</p><div class="v3-audio-rows"></div><button type="button" data-audio-reset>恢复全局音频策略</button><p data-audio-status role="status"></p>';
  shell.querySelector('.v3-basic-audio').after(panel);
  const rows=panel.querySelector('.v3-audio-rows');
  const sourceRows=()=>original.querySelector('.media-audio-plan-rows');
  const controls=()=>[...sourceRows().querySelectorAll('input,select')];
  let shape='';
  function refresh(){
    panel.hidden=original.hidden;
    const actual=controls();
    const next=JSON.stringify([sourceRows().querySelectorAll('.media-audio-plan-row').length,
      [...sourceRows().querySelectorAll('span')].map(el=>el.textContent),
      actual.map(el=>[el.tagName,el.type,el.getAttribute('aria-label'),el.tagName==='SELECT'?[...el.options].map(o=>[o.value,o.textContent,o.disabled]):null])]);
    if(next!==shape){
      rows.replaceChildren(...[...sourceRows().children].map(row=>row.cloneNode(true)));
      for(const [index,proxy] of [...rows.querySelectorAll('input,select')].entries()){
        proxy.removeAttribute('name');proxy.removeAttribute('form');proxy.removeAttribute('id');
        proxy.dataset.audioField=String(index);
      }
      shape=next;
    }
    const busy=locked();
    for(const proxy of rows.querySelectorAll('[data-audio-field]')){
      const control=actual[Number(proxy.dataset.audioField)];
      proxy.disabled=busy||control.matches(':disabled');
      if(control.type==='checkbox')proxy.checked=control.checked;
      else if(document.activeElement!==proxy||proxy.disabled)proxy.value=control.value;
      for(const attribute of ['min','max','step','placeholder']){
        if(control.hasAttribute(attribute))proxy.setAttribute(attribute,control.getAttribute(attribute));
        else proxy.removeAttribute(attribute);
      }
    }
    const reset=original.querySelector('button');
    panel.querySelector('[data-audio-reset]').disabled=busy||reset.matches(':disabled');
    const status=original.querySelector('.note')?.textContent||'';
    if(panel.querySelector('[data-audio-status]').textContent!==status)panel.querySelector('[data-audio-status]').textContent=status;
  }
  panel.addEventListener('change',event=>{
    const proxy=event.target;
    if(!proxy.hasAttribute('data-audio-field'))return;
    const control=controls()[Number(proxy.dataset.audioField)];
    if(!control||locked()||control.matches(':disabled')){schedule();return;}
    if(control.tagName==='SELECT'&&![...control.options].some(o=>o.value===proxy.value&&!o.disabled)){schedule();return;}
    if(control.type==='checkbox')control.checked=proxy.checked;else control.value=proxy.value;
    control.dispatchEvent(new Event('change',{bubbles:true}));schedule();
  });
  panel.addEventListener('input',event=>{
    const proxy=event.target;
    if(proxy.hasAttribute('data-audio-field')&&proxy.tagName!=='SELECT'&&proxy.type!=='checkbox')proxy.dispatchEvent(new Event('change',{bubbles:true}));
  });
  panel.querySelector('[data-audio-reset]').addEventListener('click',()=>{
    const reset=original.querySelector('button');
    if(!locked()&&!reset.matches(':disabled'))reset.click();
    schedule();
  });
  panel.addEventListener('focusout',schedule);
  return {refresh};
}
