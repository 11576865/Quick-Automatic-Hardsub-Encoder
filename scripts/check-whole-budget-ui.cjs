const assert=require('node:assert/strict');
// Real production workspace; only source/encode/save callbacks are simulated.
module.exports=async(browser,baseUrl)=>{
 const page=await browser.newPage();
 await page.route('**/whole-budget-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><section id="inputCard"></section></body></html>'}));
 try{
  await page.goto(baseUrl+'/whole-budget-fixture');
  await page.evaluate(async()=>{
   const {mountMediaWorkspace}=await import('/src/media-workspace.js');
   const state=window.budgetTest={source:'A',busy:false,saves:0,bytes:1100000,tasks:[]};
   const media={duration:5,fps:24,videoTracks:1,audioTracks:1,audioCodecs:['flac'],audioStreams:[{codec:'flac'}],formatName:'matroska'};
   mountMediaWorkspace({busy:()=>state.busy,setBusy:v=>state.busy=v,isWindows:()=>true,hasNvenc:()=>false,platformKey:()=>({}),videoIdentity:()=>state.source,sourceName:()=>state.source,mediaSnapshot:()=>media,prepare:async()=>media,validate:async()=>{},log:()=>{},cancel:()=>{},save:()=>{state.saves++;return {ok:true};},measureBudget:async()=>({version:1,scope:'full-source',audioPacketBytes:[1000],subtitlePacketBytes:[],attachmentBytes:[]}),run:async task=>{state.tasks.push(task);return {outputBytes:state.bytes,verified:true};}});
   const form=document.querySelector('#mediaTaskForm');
   const set=(key,value)=>{const el=form.elements.namedItem(key);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));};
   set('operation','transcode');set('rateMode','size');set('targetSize','1');set('budgetPolicy','strict-ceiling');
   state.set=set;
  });
  assert.match(await page.locator('[data-review="plan-status"]').textContent(),/未检查/);
  await page.click('#taskMeasureBudget');
  await page.click('#taskInspect');
  assert.equal(await page.locator('#taskObjectReview').getAttribute('data-plan-checked'),'true');
  assert.match(await page.locator('[data-review="plan-rows"]').textContent(),/音频 #0.*复制/);
  assert.match(await page.locator('#taskBudgetLedger').textContent(),/固定流\/附件.*0.00 MB/);
  await page.evaluate(()=>{const s=window.budgetTest;s.set('configName','budget-fixture');document.querySelector('#taskStore').click();});
  assert.equal(await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.getItem('media-workspace-configs-v2'))).includes('audioPacketBytes')),false);
  await page.click('#taskRun');await page.waitForFunction(()=>!window.budgetTest.busy);
  assert.equal(await page.locator('#taskSave').isDisabled(),true);
  assert.match(await page.locator('#taskStatus').textContent(),/禁止交付/);
  assert.equal(await page.evaluate(()=>window.budgetTest.saves),0);
  assert.match(await page.locator('[data-review="artifact-status"]').textContent(),/禁止交付/);
  await page.evaluate(()=>window.budgetTest.bytes=1000000);
  await page.click('#taskRun');await page.waitForFunction(()=>!window.budgetTest.busy);
  assert.equal(await page.locator('#taskSave').isDisabled(),false);
  await page.click('#taskSave');assert.equal(await page.evaluate(()=>window.budgetTest.saves),1);
  await page.locator('[data-media-mode="copy"]').click();
  assert.equal(await page.locator('[name="budgetPolicy"]').inputValue(),'best-effort');
  await page.evaluate(()=>{window.budgetTest.set('start','0');window.budgetTest.set('end','2');});
  await page.click('#taskAddClip');await page.click('#taskExportClips');
  await page.waitForFunction(()=>!window.budgetTest.busy);
  assert.equal(await page.evaluate(()=>window.budgetTest.tasks.at(-1).operation),'copy');
  await page.locator('[data-media-mode="transcode"]').click();
  await page.evaluate(()=>{window.budgetTest.source='B';document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));});
  assert.equal(await page.locator('#taskInspect').isVisible(),true,'new source must retain plan inspection after a saved artifact');
  assert.match(await page.locator('[data-review="artifact-status"]').textContent(),/上一任务/);
  assert.match(await page.locator('[data-review="artifact-facts"]').textContent(),/^A/);
  assert.equal(await page.locator('#taskObjectReview').getAttribute('data-plan-checked'),'false');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'review must fit phone');
  await page.screenshot({path:'media-workspace-task-review-mobile.png',fullPage:true});
  await page.click('#taskInspect');assert.match(await page.locator('#taskStatus').textContent(),/成本未知/);
 }finally{await page.close();}
 console.log('Whole-file workspace budget, strict save gate, config exclusion and source invalidation passed (simulated media backend).');
};
