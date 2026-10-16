import {previewAspect,toolbarDensity,sourceObjects} from './workbench-v3-model.js';
import './workbench-v3.css';
import {mountWorkbenchBasicControls} from './workbench-basic-controls.js';

const icon=name=>`<img class="v3-icon" src="${import.meta.env.BASE_URL}ui-icons/${name}.svg" alt="" aria-hidden="true">`;
const action=(name,label,command)=>`<button type="button" class="v3-action" data-v3-action="${command}" aria-label="${label}" title="${label}">${icon(name)}<span>${label}</span></button>`;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Layout projection only: the existing editor owns all executable state and gates.
export function mountWorkbenchV3({source,media}) {
  const $=s=>document.querySelector(s);
  const layout=$('.workspace-layout'),input=$('#inputCard'),inspector=$('#expectedIntentInspector');
  const sourceHome=document.createComment('v3-source-home'),inspectorHome=document.createComment('v3-inspector-home');
  input.before(sourceHome);inspector.before(inspectorHome);
  const dependencies=document.createElement('details');dependencies.className='v3-dependencies';
  dependencies.innerHTML='<summary>字幕、字体与运行信息</summary>';
  input.append(dependencies);
  const dependencyHomes=[];
  for(const node of input.querySelectorAll('.input-ass,.input-font,.input-engine')){
    const home=document.createComment('v3-dependency-home');node.before(home);dependencyHomes.push([home,node]);
  }
  const shell=document.createElement('section');shell.className='v3-shell';
  shell.setAttribute('aria-label','媒体交付工作台');
  shell.innerHTML=`<header class="v3-appbar"><strong class="v3-brand">QHE</strong><span data-v3-identity>尚未选择来源 / 硬字幕任务</span><div class="v3-app-actions">${action('list','任务队列','queue')}${action('settings','设置','settings')}${action('info','帮助','help')}</div></header>
  <div class="v3-mode-row"><div data-v3-mode-slot></div><label class="v3-density">标签密度 <select aria-label="标签密度"><option value="auto">自动</option><option value="standard">标准</option><option value="compact">紧凑</option></select></label></div>
  <nav class="v3-path" aria-label="工作台对象导航"><button data-v3-action="source">${icon('video')}来源 · <span data-v3-source-state>未选择</span></button><span>›</span><button data-v3-action="plan">${icon('sliders')}输出计划 · <span data-v3-plan-state>未检查</span></button><span>›</span><button data-v3-action="artifact">${icon('unknown')}成品 · <span data-v3-artifact-state>未生成</span></button></nav>
  <div class="v3-grid"><aside class="v3-source"><h2>来源与依赖</h2><div data-v3-source-slot></div><section class="v3-objects"><h3>轨道与附件</h3><div data-v3-objects>读取视频参数后显示真实对象。</div><p>来源对象只读；去向见输出计划。</p></section></aside>
  <main class="v3-main"><div class="v3-plan-view"><section class="v3-card v3-cut" hidden><h2>切点与实际边界</h2><div class="v3-cut-fields"><label>请求切入<input data-v3-time="start" value="0" aria-label="请求切入时间"></label><span>→</span><label>请求切出<input data-v3-time="end" placeholder="片尾" aria-label="请求切出时间"></label></div><p data-v3-cut-state>关键帧位置尚未探测；实际切入、切出与偏差须在探测及成品审计后确认。</p><button data-v3-action="timeline">探测可实现切点</button></section>
  <section class="v3-card v3-output"><h2>拟输出文件</h2><p class="v3-filename" data-v3-output-name>选择来源后形成输出计划</p><div class="v3-targets"><label>输出容器<button data-v3-action="container" data-v3-container>Auto · 按正式参数选择</button></label><label>保存位置 · 待接入<button data-v3-action="location">执行前选择…</button></label></div><dl class="v3-output-rows" data-v3-output-rows><div><dt>来源对象</dt><dd>尚未读取</dd></div><div><dt>正式计划</dt><dd>检查后显示逐流去向</dd></div></dl></section>
  <section class="v3-card v3-decisions"><h2>目标与编码决策</h2><div class="v3-targets"><label>形成计划<button data-v3-action="parameters" data-v3-strategy>手动参数 / 引导目标</button></label><label>体积约束<button data-v3-action="budget" data-v3-budget>按正式参数配置</button></label></div><p data-v3-current-plan>当前正式参数尚未检查。</p><div class="v3-button-pair"><button data-v3-action="compare">比较编码器</button><button data-v3-action="parameters">检查正式参数</button></div></section>
  <section class="v3-preview-entry"><button data-v3-action="preview" aria-expanded="false" aria-controls="v3Preview">展开画面预览 · 按源画幅显示</button></section></div>
  <section id="v3Preview" class="v3-card v3-preview" hidden><div class="v3-section-head"><h2>画面预览</h2><button data-v3-action="close-preview">返回输出计划</button></div><p data-v3-aspect>来源画幅尚未读取</p><div class="v3-viewport"><img data-v3-frame alt="实际生成的预览帧" hidden><div data-v3-frame-empty>${icon('video')}<span>尚未加载预览帧</span></div></div><div class="v3-button-pair"><button data-v3-action="generate-preview">生成实际预览</button><button data-v3-action="timeline">定位与逐帧检查</button></div><p>预览帧来自现有媒体预览流程；无帧时保持空状态。</p></section>
  <details class="v3-editor"><summary>正式参数、执行与成品检查</summary><div data-v3-editor-slot></div></details></main><aside class="v3-inspector" data-v3-inspector-slot></aside></div>
  <footer class="v3-footer"><p data-v3-footer-state>执行前将检查来源、依赖与正式计划</p><button data-v3-action="inspect">查看执行计划</button><button class="v3-primary" data-v3-action="run">检查并开始压制</button></footer>
  <p class="v3-feedback" role="status" aria-live="polite" hidden></p>
  <dialog class="v3-help" aria-labelledby="v3HelpTitle"><form method="dialog"><div class="v3-section-head"><h2 id="v3HelpTitle">工作台帮助</h2><button aria-label="关闭帮助">关闭</button></div><p data-v3-help-text></p></form></dialog>`;
  layout.before(shell);
  const q=s=>shell.querySelector(s),editor=q('.v3-editor'),dock=$('#studioModeDock'),modeNav=dock.querySelector('.media-mode-switcher');
  editor.insertAdjacentHTML('beforebegin',`<section class="v3-comparison" hidden><section class="v3-card"><div class="v3-section-head"><h2>候选比较 · 质量与完整体积</h2><button data-v3-action="plan">返回输出计划</button></div><p>当前正式计划保持不变；推荐方案须明确采用。</p><div class="v3-comparison-empty">${icon('sliders')}<strong>测量与候选比较</strong><span>请打开实际比较面板，查看当前来源的观测、适用范围与候选证据。</span></div><div class="v3-button-pair"><button data-v3-action="open-comparison">打开实际测量与比较</button><button data-v3-action="comparison-help">比较与参考域说明</button></div></section><section class="v3-card"><h2>当前正式参数</h2><dl class="v3-audit-facts"><div><dt>编码器</dt><dd data-v3-compare-codec>尚未检查</dd></div><div><dt>质量 / 体积</dt><dd data-v3-compare-rate>尚未检查</dd></div><div><dt>推荐采用</dt><dd>不会自动应用候选</dd></div></dl></section></section>
  <section class="v3-artifact" hidden><section class="v3-card"><div class="v3-section-head"><h2>实际成品 · 验证与交付</h2><button data-v3-action="plan">返回输出计划</button></div><p class="v3-audit-status" data-v3-audit-status>尚无成品</p><dl class="v3-audit-facts"><div><dt>实际文件</dt><dd data-v3-audit-facts>尚未生成</dd></div><div><dt>验证证据</dt><dd data-v3-audit-evidence>尚无验证结果</dd></div></dl><p>拟输出计划与实际成品分别记录，实际结果以完成后的检查为准。</p></section><section class="v3-card"><h2>成品检查</h2><p data-v3-save-reason>尚无可保存成品。</p><div class="v3-button-pair"><button data-v3-action="audit-details">查看必需检查与报告</button><button data-v3-action="verify-frames">提取对比帧（可选）</button></div><p>播放器复开属于独立检查，不额外设为所有成品的保存门槛。</p></section><section class="v3-card"><h2>交付成品</h2><div class="v3-button-pair"><button data-v3-action="report">导出检查报告</button><button class="v3-primary" data-v3-action="save-artifact" disabled>保存成品</button></div></section></section>`);
  const modeHome=document.createComment('v3-mode-home');modeNav.before(modeHome);
  for(const [mode,label] of Object.entries({hardsub:'ASS 硬字幕',transcode:'纯视频转码',copy:'无损剪切'}))modeNav.querySelector(`[data-media-mode="${mode}"] strong`).textContent=label;
  const modeNames={hardsub:'硬字幕',transcode:'转码',copy:'剪切'};
  function showView(view) {
    shell.dataset.view=view;
    for(const [name,selector] of Object.entries({plan:'.v3-plan-view',preview:'#v3Preview',comparison:'.v3-comparison',artifact:'.v3-artifact'}))q(selector).hidden=name!==view;
    q('[data-v3-action="preview"]').setAttribute('aria-expanded',String(view==='preview'));
  }
  showView('plan');
  const setText=(selector,value)=>{const el=q(selector);if(el&&el.tagName!=='SELECT'&&el.textContent!==String(value))el.textContent=String(value);};
  const read=selector=>$(selector)?.textContent?.trim()||'';
  const pref=q('.v3-density select');try{pref.value=localStorage.getItem('qhe-toolbar-density')||'auto';}catch{}
  if(!pref.value)pref.value='auto';
  const pending=(title,body)=>{q('#v3HelpTitle').textContent=title;q('[data-v3-help-text]').textContent=body;q('.v3-help').showModal();};
  function showEditor(target) {
    editor.open=true;
    // Reveal enclosing disclosures without touching backend-controlled visibility.
    let node=$(target)||$('#mediaWorkspace');
    for(let p=node?.parentElement;p&&p!==shell;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
    if(node&&!node.getClientRects().length)node=editor;
    node?.scrollIntoView({block:'start',behavior:'instant'});
    node?.setAttribute('tabindex','-1');node?.focus({preventScroll:true});
  }
  function actualPreview() {
    const frame=document.body.dataset.mediaOperation==='hardsub'?$('#preview img'):$('#taskFramePreviewImage');
    const ready=frame?.getAttribute('src')&&!frame.hidden;
    const img=q('[data-v3-frame]');img.hidden=!ready;q('[data-v3-frame-empty]').hidden=!!ready;
    if(ready&&img.getAttribute('src')!==frame.getAttribute('src'))img.src=frame.getAttribute('src');
    if(!ready)img.removeAttribute('src');
  }
  let basic,queued=false,lastObjects='',lastRows='',lastOperation='';
  function refresh() {
    queued=false;
    if(!shell.isConnected||!$('#mediaTaskForm'))return;
    const operation=document.body.dataset.mediaOperation||'hardsub',file=source(),m=media(),form=$('#mediaTaskForm');
    if(lastOperation&&lastOperation!==operation)showView('plan');lastOperation=operation;
    const field=name=>form.elements.namedItem(name);
    setText('[data-v3-identity]',`${file?.name||'尚未选择来源'} / ${modeNames[operation]}任务`);
    setText('[data-v3-source-state]',file?'已选择':'未选择');
    setText('[data-v3-plan-state]',read('[data-review="plan-status"]')||'未检查');
    setText('[data-v3-artifact-state]',read('[data-review="artifact-status"]')||'未生成');
    setText('[data-v3-output-name]',file?`${file.name.replace(/\.[^.]+$/,'')}_${operation==='copy'?'cut':'delivery'} · 容器以正式检查结果为准`:'选择来源后形成输出计划');
    setText('[data-v3-container]',field('outputContainer').selectedOptions[0]?.textContent||'Auto');
    setText('[data-v3-strategy]',operation==='hardsub'&&document.body.dataset.hardsubStrategy==='guided'?'引导目标':'手动参数');
    setText('[data-v3-budget]',field('rateMode').value==='size'?`${field('targetSize').value} ${field('sizeUnit').value} · ${field('budgetPolicy').selectedOptions[0].textContent}`:'按正式质量 / 码率参数');
    setText('[data-v3-current-plan]',read('#taskPlanNote')||'当前正式参数尚未检查。');
    q('.v3-cut').hidden=operation!=='copy';q('.v3-decisions').hidden=operation==='copy';
    for(const control of shell.querySelectorAll('[data-v3-time]')){
      const actual=field(control.dataset.v3Time);control.disabled=actual.disabled;
      if(document.activeElement!==control||actual.disabled)control.value=actual.value;
    }
    const boundary=read('#taskCopyStrategyDescription');if(boundary)setText('[data-v3-cut-state]',boundary);
    const aspect=previewAspect(m);q('.v3-viewport').style.aspectRatio=aspect?String(aspect):'16 / 9';
    q('.v3-viewport').style.setProperty('--v3-aspect',String(aspect||16/9));
    setText('[data-v3-aspect]',aspect?`来源 ${m.width} × ${m.height} · 按显示画幅呈现`:'来源画幅尚未读取 · 空视口不代表源比例');
    const objects=sourceObjects(m).map(s=>`<div class="v3-object">${icon(s.glyph)}<div><strong>${escape(s.name)}</strong><small>${escape(s.properties)}</small></div></div>`);
    if(m&&!objects.length)objects.push(`<div class="v3-object">${icon('video')}<div><strong>视频</strong><small>${escape([m.codec,m.width&&`${m.width}×${m.height}`].filter(Boolean).join(' · ')||'已读取媒体')}</small></div></div>`);
    const objectHTML=objects.join('')||'读取视频参数后显示真实对象。';
    if(objectHTML!==lastObjects){q('[data-v3-objects]').innerHTML=objectHTML;lastObjects=objectHTML;}
    const rows=[...document.querySelectorAll('[data-review="plan-rows"] li')].map(el=>`<div><dt>${escape(el.textContent)}</dt><dd>正式计划</dd></div>`).join('')||'<div><dt>来源对象</dt><dd>尚未形成逐流计划</dd></div><div><dt>对象去向</dt><dd>检查正式参数后显示</dd></div>';
    if(rows!==lastRows){q('[data-v3-output-rows]').innerHTML=rows;lastRows=rows;}
    const guided=operation==='hardsub'&&document.body.dataset.hardsubStrategy==='guided';
    const run=$(guided?'#encodeBtn':'#taskRun');
    const saving=shell.dataset.view==='artifact',save=$('#taskSave');
    q('[data-v3-action="run"]').disabled=saving?save.disabled:!!file&&!!run?.disabled;
    setText('[data-v3-action="run"]',saving?save.textContent:`检查并开始${operation==='hardsub'?'压制':modeNames[operation]}`);
    const saveReason=save.disabled?`${read('[data-review="artifact-status"]')||'尚无可保存成品'} · 请查看实际检查状态与报告`:'已有保存许可，可调用当前成品保存流程。';
    setText('[data-v3-footer-state]',saving?saveReason:!file?'请先选择来源，再检查依赖与正式计划':run?.disabled?'来源或依赖尚未就绪，请读取参数并完成正式计划检查':read('#taskStatus')==='未开始'?'执行前将检查来源、依赖与正式计划':read('#taskStatus'));
    setText('[data-v3-audit-status]',read('[data-review="artifact-status"]')||'尚无成品');
    setText('[data-v3-audit-facts]',read('[data-review="artifact-facts"]')||'尚未生成');
    setText('[data-v3-audit-evidence]',read('[data-review="artifact-evidence"]')||'尚无验证结果');
    setText('[data-v3-save-reason]',saveReason);
    q('[data-v3-action="save-artifact"]').disabled=save.disabled;
    setText('[data-v3-action="save-artifact"]',save.textContent);
    q('[data-v3-action="report"]').disabled=$('#taskReport').disabled;
    q('[data-v3-action="verify-frames"]').disabled=$('#taskOutputVerification').hidden||$('#taskVerifyFrames').disabled;
    setText('[data-v3-compare-codec]',read('#taskPlanEncoder')||'尚未检查');
    setText('[data-v3-compare-rate]',read('#taskPlanRate')||'尚未检查');
    shell.dataset.density=toolbarDensity(pref.value,q('.v3-source').clientWidth);actualPreview();
    basic?.refresh();
  }
  const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(refresh);}};
  let desktopMode;
  function adapt() {
    const desktop=matchMedia('(min-width:768px)').matches;
    document.body.classList.toggle('workbench-v3',desktop);
    if(desktop!==desktopMode){
      desktopMode=desktop;
      if(desktop){q('[data-v3-mode-slot]').append(modeNav);q('[data-v3-source-slot]').append(input);q('[data-v3-inspector-slot]').append(inspector);q('[data-v3-editor-slot]').append(layout);for(const [,node] of dependencyHomes)dependencies.append(node);}
      else{modeHome.after(modeNav);sourceHome.after(input);inspectorHome.after(inspector);shell.after(layout);for(const [home,node] of dependencyHomes)home.after(node);}
    }
    refresh();
  }
  shell.addEventListener('click',event=>{
    const command=event.target.closest('[data-v3-action]')?.dataset.v3Action;if(!command)return;
    if(command==='preview'||command==='close-preview'){
      const expanded=command==='preview';showView(expanded?'preview':'plan');refresh();
      (expanded?q('[data-v3-action="close-preview"]'):q('[data-v3-action="preview"]')).focus();return;
    }
    if(command==='source'||command==='source-inspect'){input.scrollIntoView({block:'start'});input.setAttribute('tabindex','-1');(command==='source-inspect'?$('#analyze'):input).focus({preventScroll:true});return;}
    if(command==='plan'){showView('plan');refresh();return;}
    if(command==='location')return pending('保存位置 · 待接入','此入口预留执行前选择位置。当前版本仍在实际执行与保存流程中选择或下载成品；尚未取得目录权限。');
    if(command==='help')return pending('工作台帮助','左侧添加来源与依赖，中央确认拟输出文件及正式参数，右侧配置预期意图草稿。标有“待接入”的设置尚未应用到执行；实际执行与保存以正式计划和已有验证结果为准。');
    if(command==='extract')return pending('提取对象 · 待接入','通用逐对象提取入口预留。内封 ASS 与附件字体可在左侧的现有导入控件中显式选择。');
    if(command==='settings'){showEditor('.platform-rail');return;}
    if(command==='run'){
      if(shell.dataset.view==='artifact'){if(!$('#taskSave').disabled)$('#taskSave').click();return;}
      if(!source()){input.querySelector('#videoNativePickerBtn:not(.hidden)')?.click();if($('#videoNativePickerBtn').classList.contains('hidden'))$('#video').click();return;}
      showEditor('#taskRunState');const guided=document.body.dataset.mediaOperation==='hardsub'&&document.body.dataset.hardsubStrategy==='guided';$(guided?'#encodeBtn':'#taskRun')?.click();return;
    }
    if(command==='inspect'){showEditor('#taskPlanSummary');$('#taskInspect').click();return;}
    if(command==='generate-preview'){
      if(document.body.dataset.mediaOperation!=='hardsub'){showEditor('#taskWaveformPanel');return;}
      if(!$('#previewBtn').disabled){$('#previewBtn').click();return;}showEditor('#analyze');return;
    }
    if(command==='timeline'){showEditor('#taskWaveformPanel');return;}
    if(command==='queue'){showEditor('#taskRecipeMatrixPanel');return;}
    if(command==='artifact'){showView('artifact');inspector.querySelector('[data-intent-tab="delivery"]').click();refresh();return;}
    if(command==='compare'){showView('comparison');inspector.querySelector('[data-intent-tab="decision"]').click();refresh();return;}
    if(command==='open-comparison'){showEditor(document.body.dataset.mediaOperation==='hardsub'?'#planCard':'#taskEncoding');return;}
    if(command==='comparison-help')return pending('比较与参考域','只比较当前来源和同一参考域下的真实观测。实际曲线、场景风险与候选采用在现有比较面板中操作；没有测量时不绘制示例曲线。');
    if(command==='audit-details'){showEditor('#taskReviewDetails');return;}
    if(command==='save-artifact'){if(!$('#taskSave').disabled)$('#taskSave').click();return;}
    if(command==='report'){if(!$('#taskReport').disabled)$('#taskReport').click();return;}
    if(command==='verify-frames'){showEditor('#taskOutputVerification');if(!q('[data-v3-action="verify-frames"]').disabled)$('#taskVerifyFrames').click();return;}
    showEditor(command==='container'?'#taskOutputPolicy':command==='budget'?'#taskEncoding':command==='validate'?'#preflightCard':'#mediaWorkspace');
  });
  shell.addEventListener('input',event=>{const name=event.target.dataset.v3Time;if(!name)return;const field=$('#mediaTaskForm').elements.namedItem(name);if(field.disabled){schedule();return;}field.value=event.target.value;field.dispatchEvent(new Event('input',{bubbles:true}));});
  shell.addEventListener('change',event=>{const name=event.target.dataset.v3Time;if(!name)return;const field=$('#mediaTaskForm').elements.namedItem(name);if(!field.disabled)field.dispatchEvent(new Event('change',{bubbles:true}));});
  pref.addEventListener('change',()=>{try{localStorage.setItem('qhe-toolbar-density',pref.value);}catch{}refresh();});
  const toolbar=document.createElement('div');toolbar.className='v3-source-toolbar';toolbar.innerHTML=action('eye','检查来源','source-inspect')+action('download','提取对象','extract')+action('shield','验证依赖','validate')+action('more','更多操作','parameters');
  q('.v3-objects').before(toolbar);
  inspector.querySelector('.expected-inspector-head').insertAdjacentHTML('beforeend',action('info','输出意图帮助','help'));
  new MutationObserver(schedule).observe(layout,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','hidden','src','disabled','data-task-state']});
  new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['data-media-operation','data-hardsub-strategy']});
  document.addEventListener('quick-hardsub-media-info-changed',schedule);
  document.addEventListener('qhe-workbench-reveal',event=>showEditor(event.detail==='artifact'?'#taskReviewDetails':'#taskPlanSummary'));
  document.addEventListener('change',schedule);window.addEventListener('resize',adapt);
  basic=mountWorkbenchBasicControls({shell,source,showEditor,showHelp:pending,schedule});
  adapt();
}
