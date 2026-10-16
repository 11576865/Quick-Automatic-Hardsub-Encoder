const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.QHE_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4187','--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:4187')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready);
  browser=await chromium.launch({headless:true,...(process.env.QHE_CHROMIUM_PATH?{executablePath:process.env.QHE_CHROMIUM_PATH,args:['--no-sandbox']}:{})});
  const page=await browser.newPage({viewport:{width:1194,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/basic-fixture',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/studio-v3.css"></head><body><div class="app-shell"><div id="studioModeDock"></div><div class="workspace-layout"><main class="workflow-main"><section id="inputCard" class="card"><div class="card-heading"><h2>来源</h2><p>素材</p></div><div class="grid two"><div class="input-ass">ASS 已选择</div></div><button id="analyze">分析视频与字幕</button></section><section id="subtitleCard"></section><div class="production-region"><div class="production-controls"><section id="hardsubControlDeck"><button data-hardsub-strategy="guided">引导</button><button data-hardsub-strategy="manual">参数</button></section><div id="hardsubManualMount"></div><section id="planCard"></section><div id="sharedMediaOutputMount"></div><section id="encodeCard"><button id="encodeBtn" disabled>开始</button><button id="cancelEncodeBtn" class="hidden">取消</button></section></div></div><button id="previewBtn" disabled>预览</button></main><aside class="support-rail"></aside></div></div></body></html>`}));
  await page.goto('http://127.0.0.1:4187/basic-fixture');
  await page.evaluate(async()=>{
   const {mountMediaWorkspace}=await import('/src/media-workspace.js');
   const {mountExpectedWorkbench}=await import('/src/expected-workbench.js');
   const state=window.basicFixture={busy:false,tasks:[],saves:0,probes:0,saveFailure:false,defer:false};
   const file=new File(['fixture'],'source.mkv',{lastModified:1}),media={duration:2,width:320,height:180,fps:24,videoCodec:'h264',formatName:'matroska',videoTracks:1,videoStreams:[{ordinal:0,index:0,width:320,height:180,codec:'h264',pixelFormat:'yuv420p',bitDepth:8}],audioTracks:1,audioCodecs:['aac'],audioStreams:[{ordinal:0,index:1,codec:'aac',channels:2}],subtitleTracks:1,subtitleStreams:[{index:2,codec_name:'ass'}],attachmentTracks:1,attachmentStreams:[{index:3,codec_name:'ttf',tags:{filename:'font.ttf'}}]};
   document.querySelector('#analyze').onclick=()=>state.probes++;
   mountMediaWorkspace({busy:()=>state.busy,setBusy:v=>{state.busy=v;document.querySelector('#analyze').disabled=v},isWindows:()=>true,hasNvenc:()=>false,platformKey:()=>({}),videoIdentity:()=>file.name,sourceName:()=>file.name,mediaSnapshot:()=>media,prepare:async()=>media,validate:async()=>{},log:()=>{},cancel:()=>state.reject?.(Error('已取消')),save:()=>{state.saves++;return state.saveFailure?{ok:false,error:'provider failed'}:{ok:true,kind:'browser-download'}},run:async task=>{state.tasks.push(task);if(state.defer)return new Promise((resolve,reject)=>state.reject=reject);return {outputBytes:1000,verified:true,name:'output.mkv'}}});
   mountExpectedWorkbench({source:()=>file,media:()=>media});
  });
  await page.locator('[data-media-mode="transcode"]').click();
  const control=name=>page.locator(`[data-basic-field="${name}"]`);
  assert.equal(await control('outputContainer').count(),1,'New workspace must expose a real container setting');
  await control('outputContainer').selectOption('mkv');
  await control('codec').selectOption('h265');await control('preset').selectOption('fast');await control('quality').fill('25');await control('quality').blur();
  await control('audio').selectOption('aac');
  await page.locator('.v3-basic-streams>summary').click();
  for(const name of ['keepSubtitles','keepAttachments','keepChapters','keepMetadata'])await control(name).check();
  await page.locator('[data-v3-action="source-inspect"]').click();assert.equal(await page.evaluate(()=>basicFixture.probes),1);
  const actualBefore=await page.locator('#mediaTaskForm').evaluate(f=>JSON.stringify([...new FormData(f)]));
  await page.locator('[data-intent-tab="decision"]').click();await page.locator('[data-intent-control="goal"]').selectOption('time');
  assert.equal(await page.locator('#mediaTaskForm').evaluate(f=>JSON.stringify([...new FormData(f)])),actualBefore,'Advanced draft stays separate from formal basic settings');
  await page.locator('[data-v3-action="inspect"]').click();await page.waitForFunction(()=>!basicFixture.busy);
  assert.equal(await page.locator('#taskObjectReview').getAttribute('data-plan-checked'),'true');
  await page.locator('.v3-footer [data-v3-action="run"]').click();await page.waitForFunction(()=>!basicFixture.busy&&basicFixture.tasks.length===1);
  const task=await page.evaluate(()=>basicFixture.tasks[0]);assert.equal(task.codec,'h265');assert.equal(task.preset,'fast');assert.equal(task.quality,25);assert.equal(task.outputContainer,'mkv');assert.equal(task.audio,'aac');assert.equal(task.keepAttachments,true);
  await page.locator('[data-v3-action="artifact"]').click();assert.equal(await page.locator('[data-v3-action="save-artifact"]').isEnabled(),true);
  await page.evaluate(()=>basicFixture.saveFailure=true);await page.locator('[data-v3-action="save-artifact"]').click();await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='save_failed');
  await page.evaluate(()=>basicFixture.saveFailure=false);await page.locator('[data-v3-action="save-artifact"]').click();await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='saved');
  assert.equal(await page.evaluate(()=>basicFixture.tasks.length),1,'Save retry does not re-encode');assert.equal(await page.evaluate(()=>basicFixture.saves),2);
  await page.locator('.v3-path [data-v3-action="plan"]').click();
  await control('quality').fill('26');await control('quality').blur();
  assert.equal(await page.locator('#taskObjectReview').getAttribute('data-plan-checked'),'false','Changing basic controls invalidates checked formal plan');
  await page.waitForFunction(()=>document.querySelector('[data-v3-action="location"]').textContent.includes('上一'));
  await page.evaluate(()=>basicFixture.defer=true);await page.locator('.v3-footer [data-v3-action="run"]').click();await page.waitForFunction(()=>basicFixture.busy&&basicFixture.tasks.length===2);
  await page.waitForFunction(()=>document.querySelector('[data-basic-field="quality"]').disabled);
  assert.equal(await control('quality').isDisabled(),true);
  const locked=await page.locator('#mediaTaskForm [name="quality"]').inputValue();
  await control('quality').evaluate(el=>{el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}))});
  assert.equal(await page.locator('#mediaTaskForm [name="quality"]').inputValue(),locked,'Disabled proxy cannot mutate executing task');
  await page.locator('[data-basic-action="cancel"]').click();await page.waitForFunction(()=>!basicFixture.busy);
  await page.locator('[data-v3-action="source-more"]').click();assert.equal(await page.locator('.v3-source-menu').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('.v3-source-menu').isVisible(),false);
  for(const width of [1440,1194,834,768]){await page.setViewportSize({width,height:960});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`Basic controls overflow at ${width}`)}
  assert.deepEqual(errors,[]);await page.close();
  console.log('WORKBENCH_BASIC_PASS: formal settings -> real task compiler/execution -> verified save/retry; probe, cancellation, lock, plan invalidation, draft isolation and 4 widths (media transport simulated)');
 }finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
