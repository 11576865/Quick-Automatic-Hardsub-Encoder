// The existing form remains the only authority. These unnamed controls are views
// of that form: all writes pass through its original input/change handlers.
import {mountWorkbenchAudioControls} from './workbench-audio-controls.js';
import {mountWorkbenchImportControls} from './workbench-import-controls.js';
import {mountWorkbenchStreamControls} from './workbench-stream-controls.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timeFields=new Set(['start','end','videoRange','audioRange','subtitleRange']);
const pictureFields=new Set(['width','height','scaleAlgorithm','fpsMode','fps']);
const fields={videoRange:'视频时间轴',audioRange:'音频默认时间轴',subtitleRange:'软字幕时间轴',width:'输出宽度 px',height:'输出高度 px',scaleAlgorithm:'缩放算法',fpsMode:'帧率策略',fps:'目标帧率',codec:'编码格式',encoder:'编码器',preset:'编码速度',rateMode:'质量 / 码率方式',quality:'质量值 CRF / CQ',bitrate:'视频码率（bit/s）',targetSize:'目标成品体积',sizeUnit:'体积单位',budgetPolicy:'体积交付策略',audio:'音频策略',keepSubtitles:'保留内封软字幕',keepAttachments:'保留附件 / 字体',keepChapters:'保留章节',keepMetadata:'保留元数据'};
export function mountWorkbenchBasicControls({shell,source,media,showEditor,showHelp,schedule}){
  const $=s=>document.querySelector(s),q=s=>shell.querySelector(s),form=$('#mediaTaskForm');
  const actual=name=>form.elements.namedItem(name);
  const disabled=control=>control.matches(':disabled');
  const markup=name=>{
    const original=actual(name);
    return `<label class="v3-basic-field" data-basic-label="${name}"><span>${fields[name]||'输出容器'}</span>${original.tagName==='SELECT'?`<select data-basic-field="${name}" aria-label="${fields[name]||'输出容器'}"></select>`:original.type==='checkbox'?`<input type="checkbox" data-basic-field="${name}">`:`<input data-basic-field="${name}" inputmode="${name==='fps'?'text':pictureFields.has(name)?'numeric':'decimal'}" placeholder="${escape(original.placeholder)}" autocomplete="off">`}</label>`;
  };
  const container=q('[data-v3-container]'),select=document.createElement('select');
  select.dataset.v3Container='';select.dataset.basicField='outputContainer';select.setAttribute('aria-label','输出容器');container.replaceWith(select);
  const strategy=q('[data-v3-strategy]'),choice=document.createElement('select');
  choice.dataset.basicStrategy='';choice.dataset.v3Strategy='';choice.setAttribute('aria-label','形成计划');choice.innerHTML='<option value="guided">引导目标</option><option value="manual">手动参数</option>';strategy.replaceWith(choice);
  q('.v3-decisions').insertAdjacentHTML('beforeend',`<section class="v3-basic-video"><h3>正式视频参数</h3><div class="v3-basic-grid">${['codec','encoder','preset','rateMode','quality','bitrate','targetSize','sizeUnit','budgetPolicy'].map(markup).join('')}</div><details class="v3-basic-picture"><summary>画幅与帧率</summary><div class="v3-basic-grid">${['width','height','scaleAlgorithm','fpsMode','fps'].map(markup).join('')}</div><p>宽高均留空时不主动缩放；只填一项时，另一项按比例计算并对齐编码所需尺寸。目标帧率支持 24000/1001 等分数，填写时须选择恒定帧率 CFR；留空由所选帧率策略决定。</p><p>画幅与帧率会影响画面和时间参考，原有测量结果不代表修改后的输出质量。字幕叠加次序沿用正式计划。</p></details><p>修改会使已检查的计划失效，开始前重新检查；预期意图草稿单独保留。</p></section><p class="v3-basic-guided">引导模式使用已有目标探索与正式采用流程。切换到手动参数后，可在这里直接编辑编码设置。</p>`);
  q('.v3-basic-video').insertAdjacentHTML('beforeend','<section class="v3-basic-budget" aria-label="完整文件预算"><h3>源流与附件成本</h3><p data-basic-budget-status role="status"></p><button type="button" data-basic-action="measure-budget">测量源流与附件成本</button><button type="button" data-basic-action="review-budget">检查预算分项</button><p>测量不会开始编码。目标体积还需分配音频、附件和封装余量；最终大小以成品验证为准。</p></section>');
  q('[data-v3-range-policies]').innerHTML=['videoRange','audioRange','subtitleRange'].map(markup).join('');
  q('.v3-output').insertAdjacentHTML('beforeend',`<div class="v3-basic-audio">${markup('audio')}</div><details class="v3-basic-streams"><summary>音轨、字幕与附件去向</summary><div class="v3-basic-checks">${['keepSubtitles','keepAttachments','keepChapters','keepMetadata'].map(markup).join('')}</div><p>更多流设置可在完整正式参数中调整。</p></details>`);
  q('.v3-footer').insertAdjacentHTML('beforeend','<button type="button" data-basic-action="cancel" hidden>取消任务</button>');
  q('.v3-footer').insertAdjacentHTML('beforebegin','<section class="v3-basic-progress" hidden aria-label="实际任务进度"><div><strong data-basic-stage></strong><span data-basic-percent></span></div><progress max="1" value="0"></progress><p data-basic-progress-note></p></section>');
  const more=q('.v3-source-toolbar [data-v3-action="parameters"]');more.dataset.v3Action='source-more';more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls','v3SourceMenu');
  q('.v3-source-toolbar').insertAdjacentHTML('afterend','<div id="v3SourceMenu" class="v3-source-menu" role="group" aria-label="来源操作" hidden><button type="button" data-basic-action="probe">检查来源</button><button type="button" data-basic-action="dependencies">字幕、字体与依赖</button><button type="button" data-basic-action="parameters">完整正式参数</button></div>');
  const location=q('[data-v3-action="location"]');location.parentElement.firstChild.textContent='保存方式';
  const text=(selector,value)=>{const el=q(selector);if(el.textContent!==value)el.textContent=value;};
  const feedback=message=>{const el=q('.v3-feedback');el.hidden=false;if(el.textContent!==message)el.textContent=message;};
  const taskState=()=>$('#mediaWorkspace').dataset.taskState;
  const optionSignatures=new WeakMap();
  let rangeOperation='';
  const guided=()=>document.body.dataset.mediaOperation==='hardsub'&&document.body.dataset.hardsubStrategy==='guided';
  const guarded=name=>guided()&&(pictureFields.has(name)||timeFields.has(name));
  const cancelTarget=()=>!$('#taskCancel').disabled?$('#taskCancel'):$('#cancelEncodeBtn')&&!$('#cancelEncodeBtn').classList.contains('hidden')&&!$('#cancelEncodeBtn').disabled?$('#cancelEncodeBtn'):null;
  const locked=()=>!!cancelTarget()||['preparing','encoding','verifying','cancelling','saving'].includes(taskState())||!!$('#video')?.disabled;
  const importControls=mountWorkbenchImportControls({shell,source,media,locked,feedback});
  const audioControls=mountWorkbenchAudioControls({shell,source,locked,schedule});
  const streamControls=mountWorkbenchStreamControls({shell,form,source,media,locked,schedule});
  const closeMenu=()=>{q('.v3-source-menu').hidden=true;more.setAttribute('aria-expanded','false');};
  function probe(){
    closeMenu();const button=$('#analyze');
    if(!source()){feedback('请先在来源栏选择视频。');return;}
    if(!button||button.disabled){feedback(button?.textContent||'来源检查暂不可用，请等待当前任务完成。');return;}
    button.click();feedback('已请求来源检查；读取结果和依赖提示显示在来源栏。');
  }
  function refresh(){
    const busy=locked(),operation=document.body.dataset.mediaOperation||'hardsub',guided=operation==='hardsub'&&document.body.dataset.hardsubStrategy==='guided';
    for(const proxy of shell.querySelectorAll('[data-basic-field]')){
      const original=actual(proxy.dataset.basicField);proxy.disabled=busy||disabled(original)||guarded(proxy.dataset.basicField);
      if(original.tagName==='SELECT'){
        const options=[...original.options],signature=JSON.stringify(options.map(o=>[o.value,o.disabled,o.textContent]));
        if(optionSignatures.get(proxy)!==signature){proxy.innerHTML=options.map(o=>`<option value="${escape(o.value)}" ${o.disabled?'disabled':''}>${escape(o.textContent)}</option>`).join('');optionSignatures.set(proxy,signature);}
      }
      if(['start','end'].includes(proxy.dataset.basicField))proxy.setCustomValidity(original.validationMessage);
      if(original.type==='checkbox')proxy.checked=original.checked;
      else if(document.activeElement!==proxy||proxy.disabled)proxy.value=original.value;
      if(proxy.dataset.basicField==='quality')q('[data-basic-label="quality"]>span').textContent=actual('codec').value==='h266'?'质量值 QP':'质量值 CRF / CQ';
    }
    if(operation!==rangeOperation){q('.v3-time-range').open=operation==='copy';rangeOperation=operation;}
    q('.v3-range-controls').hidden=guided;q('.v3-range-guided').hidden=!guided;
    choice.value=guided?'guided':'manual';choice.disabled=busy||operation!=='hardsub';
    q('.v3-basic-video').hidden=guided||operation==='copy';q('.v3-basic-guided').hidden=!guided;q('.v3-basic-streams').hidden=guided;
    for(const name of ['quality','bitrate','targetSize','sizeUnit','budgetPolicy'])q(`[data-basic-label="${name}"]`).hidden=disabled(actual(name));
    const budget=q('.v3-basic-budget'),measure=$('#taskMeasureBudget');
    budget.hidden=actual('rateMode').value!=='size';
    text('[data-basic-budget-status]',$('#taskBudgetLedger').textContent);
    q('[data-basic-action="measure-budget"]').disabled=busy||!source()||!measure||measure.disabled;
    q('[data-basic-action="review-budget"]').disabled=busy||!source();
    const cancel=cancelTarget(),cancelButton=q('[data-basic-action="cancel"]');cancelButton.hidden=!cancel;cancelButton.disabled=taskState()==='cancelling';
    const state=taskState(),progress=q('.v3-basic-progress');progress.hidden=['idle','failed'].includes(state);
    progress.querySelector('progress').value=Number($('#taskProgress').value)||0;
    text('[data-basic-stage]',$('#taskStage').textContent||'实际任务');text('[data-basic-percent]',$('#taskPercent').textContent||'0%');text('[data-basic-progress-note]',$('#taskStatus').textContent||'');
    if(cancel)text('[data-v3-footer-state]',$('#taskStatus').textContent||'任务运行中');
    const native=document.body.dataset.runtimeBackend&&document.body.dataset.runtimeBackend!=='web';
    location.textContent=$('#taskSave').disabled?(native?'验证后由系统选择位置…':'验证后交给浏览器下载'):`${$('#taskSave').textContent}…`;
    location.disabled=busy;
    importControls.refresh();
    audioControls.refresh();
    streamControls.refresh();
  }
  shell.addEventListener('change',event=>{
    const proxy=event.target,name=proxy.dataset.basicField;
    if(name){
      const original=actual(name);
      if(locked()||disabled(original)||guarded(name)){schedule();return;}
      if(original.tagName==='SELECT'&&![...original.options].some(o=>o.value===proxy.value&&!o.disabled)){schedule();return;}
      if(original.type==='checkbox'?original.checked===proxy.checked:original.value===proxy.value)return;
      if(original.type==='checkbox')original.checked=proxy.checked;else original.value=proxy.value;
      original.dispatchEvent(new Event('input',{bubbles:true}));original.dispatchEvent(new Event('change',{bubbles:true}));
      feedback('正式参数已更新；开始前请重新检查当前计划。');schedule();
    }else if(proxy===choice){
      if(locked()||choice.disabled){schedule();return;}
      document.querySelector(`[data-hardsub-strategy="${choice.value}"]`)?.click();schedule();
    }
  });
  // Commit text edits through the same real-form handlers as its original inputs.
  shell.addEventListener('input',event=>{const name=event.target.dataset.basicField;if(name&&actual(name).tagName!=='SELECT'&&actual(name).type!=='checkbox')event.target.dispatchEvent(new Event('change',{bubbles:true}));});
  shell.addEventListener('focusout',event=>{
    const name=event.target.dataset.basicField;if(!name)return;
    if(['start','end'].includes(name)&&!locked()&&!disabled(actual(name))&&!guarded(name)){
      actual(name).dispatchEvent(new Event('blur'));event.target.setCustomValidity(actual(name).validationMessage);
    }
    schedule();
  });
  shell.addEventListener('click',event=>{
    const command=event.target.closest('[data-v3-action]')?.dataset.v3Action,own=event.target.closest('[data-basic-action]')?.dataset.basicAction;
    if(!['source-inspect','source-more','validate','location'].includes(command)&&!own)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(command==='source-inspect'||own==='probe'){probe();return;}
    if(command==='source-more'){const open=q('.v3-source-menu').hidden;q('.v3-source-menu').hidden=!open;more.setAttribute('aria-expanded',String(open));if(open)q('.v3-source-menu button').focus();return;}
    if(command==='validate'||own==='dependencies'){closeMenu();$('.v3-dependencies').open=true;if(command==='validate')probe();else $('#inputCard').scrollIntoView({block:'start'});return;}
    if(own==='measure-budget'){
      const target=$('#taskMeasureBudget');
      if(!locked()&&source()&&target&&!target.disabled)target.click();
      schedule();return;
    }
    if(own==='review-budget'){if(!locked())showEditor('#taskBudgetTools');return;}
    if(own==='parameters'){closeMenu();showEditor('#mediaWorkspace');return;}
    if(own==='cancel'){const target=cancelTarget();if(target&&!target.disabled)target.click();schedule();return;}
    if(command==='location'){
      if(locked())return;
      if(!$('#taskSave').disabled){$('#taskSave').click();return;}
      const native=document.body.dataset.runtimeBackend&&document.body.dataset.runtimeBackend!=='web';
      showHelp('保存方式',native?'成品完成并通过验证后，由系统选择保存位置。取消选择或保存失败后可以重试，无需重新编码。':'成品完成并通过验证后交给浏览器下载，实际目录由浏览器的下载设置决定。当前没有预先申请目录权限。');
    }
  },true);
  shell.addEventListener('keydown',event=>{if(event.key==='Escape'&&!q('.v3-source-menu').hidden){event.preventDefault();closeMenu();more.focus();}});
  return {refresh};
}
