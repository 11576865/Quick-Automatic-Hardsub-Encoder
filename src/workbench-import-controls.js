// Route source actions to the original pickers/importer; they retain ownership
// of source bytes, track selection, native requests and import result state.
export function mountWorkbenchImportControls({shell,source,media,locked,feedback}){
  const $=s=>document.querySelector(s),q=s=>shell.querySelector(s);
  const trigger=q('[data-v3-action="extract"]');
  trigger.setAttribute('aria-label','导入 ASS 与字体');trigger.title='导入 ASS 与字体';
  trigger.querySelector('span').textContent='导入 ASS 与字体';
  trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','v3ImportMenu');
  q('.v3-source-toolbar').insertAdjacentHTML('afterend',`<div id="v3ImportMenu" class="v3-import-menu" role="group" aria-label="字幕与字体导入" hidden><button type="button" data-import-action="ass">选择外置 ASS…</button><button type="button" data-import-action="fonts">选择外置字体…</button><button type="button" data-import-action="embedded">选择内封 ASS 与字体…</button><p data-import-status role="status"></p></div>`);
  const menu=q('.v3-import-menu');
  const hard=()=>document.body.dataset.mediaOperation==='hardsub';
  const importing=()=>!!$('#importEmbeddedAss')?.disabled;
  const picker=role=>{
    const native=$(`#${role==='ass'?'ass':'fonts'}NativePickerBtn`);
    return native&&!native.classList.contains('hidden')&&!native.hidden?native:$(role==='ass'?'#ass':'#fonts');
  };
  function reason(){
    if(!hard())return '字幕与字体用于 ASS 硬字幕任务；请先切换工作流。软字幕保留在输出计划中设置。';
    if(locked()||importing())return '当前任务或字幕导入尚未结束，请等待完成后再操作。';
    if(document.body.dataset.runtimeBackend!=='windows-native'||typeof globalThis.NativeHardsub?.importEmbeddedAss!=='function')return '内封 ASS 与字体导入目前仅支持 Windows Native；当前可选择外置 ASS 和字体。通用对象提取尚未接入。';
    if(!source()||!media())return '请先选择视频并完成来源参数检查，再选择内封 ASS。';
    if(!$('#embeddedAssImportPanel')||$('#embeddedAssImportPanel').hidden||!$('#embeddedAssStream')?.options.length)return '当前来源没有可导入的内封 ASS；可选择外置 ASS 和字体。';
    return '';
  }
  function close(){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}
  function reveal(){
    const deps=$('.v3-dependencies');if(deps)deps.open=true;
    $('#inputCard')?.scrollIntoView({block:'start'});
  }
  function refresh(){
    const note=reason();
    for(const role of ['ass','fonts']){
      const target=picker(role);q(`[data-import-action="${role}"]`).disabled=!hard()||locked()||importing()||!target||target.matches(':disabled');
    }
    q('[data-import-action="embedded"]').disabled=!!note||!!$('#embeddedAssStream')?.disabled;
    const message=note||$('#embeddedAssStatus')?.textContent||'显式选择字幕轨，再执行原有 ASS 与字体导入。';
    if(q('[data-import-status]').textContent!==message)q('[data-import-status]').textContent=message;
  }
  shell.addEventListener('click',event=>{
    const command=event.target.closest('[data-v3-action]')?.dataset.v3Action;
    const role=event.target.closest('[data-import-action]')?.dataset.importAction;
    if(command==='source-more'){close();return;}
    if(command!=='extract'&&!role)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(command==='extract'){
      const open=menu.hidden;
      const more=q('.v3-source-menu');if(more)more.hidden=true;
      q('[data-v3-action="source-more"]')?.setAttribute('aria-expanded','false');
      refresh();menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));
      if(open){const target=menu.querySelector('button:not(:disabled)')||menu;if(target===menu)target.setAttribute('tabindex','-1');target.focus();}
      return;
    }
    if(!hard()||locked()||importing()){refresh();return;}
    if(role==='embedded'){
      const note=reason();if(note){feedback(note);refresh();return;}
      if($('#embeddedAssStream').disabled)return;
      close();reveal();$('#embeddedAssStream').focus({preventScroll:true});return;
    }
    const target=picker(role);
    if(!target||target.matches(':disabled')){refresh();return;}
    // Keep focus on a visible, stable control while the original Native picker
    // temporarily disables its button or the browser opens a file dialog.
    close();reveal();trigger.focus({preventScroll:true});target.click();
  },true);
  shell.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!menu.hidden){event.preventDefault();event.stopImmediatePropagation();close();trigger.focus();}
  });
  return {refresh};
}
