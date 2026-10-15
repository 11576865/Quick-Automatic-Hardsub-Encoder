import {INTENT_FIELDS,expectedIntent,restoreExpectedIntent,updateExpectedIntent} from './expected-workbench-model.js';
import './expected-workbench.css';

const MODES={hardsub:['ASS 硬字幕','把字幕正确渲染进画面，明确保留哪些原始对象。'],transcode:['纯视频转码','改变视频编码，让音轨、字幕与附件各有明确去向。'],copy:['无损剪切','保留压缩视频包，核对请求切点与实际输出边界。']};
const GROUPS={media:['媒体与保留',['subtitle','color','preservation']],decision:['决策与成本',['goal','sampling','comparison','cut']],delivery:['成品与验证',['verification']]};

export function mountExpectedWorkbench({source=()=>null}={}) {
  const dock=document.querySelector('#studioModeDock');
  const workspace=document.querySelector('#mediaWorkspace');
  if(!dock||!workspace)return;
  document.body.classList.add('expected-workbench');
  const header=document.createElement('section');
  header.className='expected-context';
  header.setAttribute('aria-label','媒体交付工作台');
  header.innerHTML=`<div class="expected-context-title"><div><span class="expected-eyebrow">QHE / MEDIA DELIVERY</span><h2 data-expected-title></h2><p data-expected-description></p></div><span class="expected-version">预期模型 UI <i>设计预览</i></span></div>
  <nav class="expected-stages" aria-label="工作台对象导航">
    <button type="button" data-expected-jump="source"><span>01 / SOURCE</span><strong>来源与依赖</strong><small data-expected-source>尚未选择视频</small></button>
    <button type="button" data-expected-jump="plan"><span>02 / OUTPUT PLAN</span><strong>输出计划与决策</strong><small data-expected-plan>当前方案未检查</small></button>
    <button type="button" data-expected-jump="artifact"><span>03 / ARTIFACT</span><strong>成品与验证</strong><small data-expected-artifact>尚无成品</small></button>
  </nav>`;
  dock.after(header);
  const inspector=document.createElement('section');
  inspector.id='expectedIntentInspector';
  inspector.className='card expected-inspector';
  inspector.setAttribute('aria-label','预期输出意图设计');
  inspector.innerHTML=`<div class="expected-inspector-head"><div><span class="expected-eyebrow">OUTPUT INTENT</span><h2>输出意图</h2></div><span class="expected-draft-badge">待接入</span></div>
  <p class="expected-draft-notice">以下为预期功能的设计草稿，可配置；尚未接入执行，不会改变当前压制参数。</p>
  <div class="expected-inspector-tabs" role="tablist" aria-label="输出意图类别">${Object.entries(GROUPS).map(([id,[label]],i)=>`<button type="button" role="tab" id="expected-tab-${id}" aria-controls="expected-panel-${id}" aria-selected="${i===0}" tabindex="${i===0?0:-1}" data-intent-tab="${id}">${label.split('与')[0]}</button>`).join('')}</div>
  ${Object.entries(GROUPS).map(([id,[label,fields]],i)=>`<div role="tabpanel" id="expected-panel-${id}" aria-labelledby="expected-tab-${id}" ${i?'hidden':''}><h3>${label}</h3>${fields.map(field=>`<label class="expected-field" data-intent-field="${field}"><span>${INTENT_FIELDS[field].label}<em>待接入</em></span><select data-intent-control="${field}">${INTENT_FIELDS[field].options.map(([value,text])=>`<option value="${value}">${text}</option>`).join('')}</select></label>`).join('')}<p class="expected-panel-note" data-intent-note="${id}"></p></div>`).join('')}
  <div class="expected-draft-footer"><span data-expected-draft-status role="status">本次会话草稿 · 未应用</span><button type="button" data-expected-reset>重置</button></div>
  <button type="button" class="expected-live-link" data-expected-live>查看实际执行计划 ↗</button>`;
  document.querySelector('.support-rail')?.prepend(inspector);

  // Draft ownership uses the actual File object, never filename/size/mtime equivalence.
  const sourceIds=new WeakMap(),drafts=new Map();
  let sourceSequence=0,currentKey='',draft=expectedIntent(),frame=0;
  const text=(selector,value)=>{const element=header.querySelector(selector);if(element.textContent!==value)element.textContent=value;};
  const mode=()=>MODES[document.body.dataset.mediaOperation]?document.body.dataset.mediaOperation:'hardsub';
  const read=selector=>workspace.querySelector(selector)?.textContent?.trim();
  function refresh() {
    frame=0;
    const operation=mode(),file=source();
    let identity='empty';
    if(file&&typeof file==='object') {
      if(!sourceIds.has(file))sourceIds.set(file,`session-source-${++sourceSequence}`);
      identity=sourceIds.get(file);
    }
    const key=`${operation}:${identity}`;
    if(key!==currentKey) {
      currentKey=key;
      draft=restoreExpectedIntent(drafts.get(key)||'{}',operation,identity);
      for(const select of inspector.querySelectorAll('[data-intent-control]'))select.value=draft[select.dataset.intentControl];
      inspector.querySelector('[data-expected-draft-status]').textContent='本次会话草稿 · 未应用';
    }
    const [title,description]=MODES[operation];
    text('[data-expected-title]',title);
    text('[data-expected-description]',description);
    text('[data-expected-source]',file?.name||'尚未选择视频');
    text('[data-expected-plan]',read('[data-review="plan-status"]')||'当前方案未检查');
    text('[data-expected-artifact]',read('[data-review="artifact-status"]')||'尚无成品');
    for(const field of ['goal','sampling','comparison'])inspector.querySelector(`[data-intent-field="${field}"]`).hidden=operation==='copy';
    inspector.querySelector('[data-intent-field="cut"]').hidden=operation!=='copy';
    inspector.querySelector('[data-intent-field="subtitle"]').hidden=operation==='copy';
    inspector.querySelector('[data-intent-field="color"]').hidden=operation==='copy';
    inspector.querySelector('[data-intent-note="media"]').textContent=operation==='hardsub'?'预期：选择内封 ASS 后联动解析附件字体，并逐对象确认保留关系。':'预期：保留、转换和排除分别记录，交付时逐对象核对。';
    inspector.querySelector('[data-intent-note="decision"]').textContent=operation==='copy'?'Stream Copy 不进行质量—体积寻优。精确切点不可满足时应提示取舍。':'预期：一个主图展示质量—完整体积关系；实测点、不确定区间和候选分支分开表达。没有测量时不生成曲线。';
    inspector.querySelector('[data-intent-note="delivery"]').textContent='预期：预测 → 执行 → 实际成品 → 差异验证。播放器复开与三端能力分别记录。';
  }
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(refresh);};
  function reveal(target) {
    // Use the existing mobile stage controller so hidden stages become reachable.
    const mobile=document.querySelector(`[data-mobile-stage-target="${target==='source'?'prepare':'produce'}"]`);
    if(mobile&&!mobile.disabled)mobile.click();
    let element;
    if(target==='source')element=document.querySelector('#inputCard');
    else {
      if(target==='artifact') {
        const review=workspace.querySelector('#taskReviewDetails');
        if(review)review.open=true;
      }
      const candidates=target==='artifact'?[workspace.querySelector('#taskReviewDetails'),workspace,document.querySelector('#encodeCard')]:[document.querySelector('#planCard'),workspace,document.querySelector('#hardsubControlDeck')];
      element=candidates.find(el=>el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
      if(!element)element=document.querySelector('#inputCard');
    }
    if(element) {
      element.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
      element.setAttribute('tabindex','-1');element.focus({preventScroll:true});
    }
  }
  header.addEventListener('click',event=>{const button=event.target.closest('[data-expected-jump]');if(button)reveal(button.dataset.expectedJump);});
  inspector.querySelector('[data-expected-live]').addEventListener('click',()=>reveal('plan'));
  inspector.addEventListener('change',event=>{
    const field=event.target.dataset.intentControl;if(!field)return;
    const value=event.target.value;refresh();
    draft=updateExpectedIntent(draft,field,value);
    event.target.value=value;
    drafts.set(currentKey,JSON.stringify(draft));
    inspector.querySelector('[data-expected-draft-status]').textContent='草稿已保留 · 未应用到执行';
  });
  function selectTab(button) {
    for(const tab of inspector.querySelectorAll('[role="tab"]')) {
      const selected=tab===button;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
      inspector.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden=!selected;
    }
  }
  inspector.addEventListener('click',event=>{const tab=event.target.closest('[data-intent-tab]');if(tab)selectTab(tab);});
  inspector.querySelector('[role="tablist"]').addEventListener('keydown',event=>{
    const tabs=[...inspector.querySelectorAll('[role="tab"]')],index=tabs.indexOf(document.activeElement);
    if(index<0||!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;
    selectTab(tabs[next]);tabs[next].focus();
  });
  inspector.querySelector('[data-expected-reset]').addEventListener('click',()=>{drafts.delete(currentKey);currentKey='';refresh();});
  new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['data-media-operation','data-mobile-stage']});
  new MutationObserver(schedule).observe(workspace,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-task-state']});
  document.addEventListener('quick-hardsub-media-info-changed',schedule);
  refresh();
}
