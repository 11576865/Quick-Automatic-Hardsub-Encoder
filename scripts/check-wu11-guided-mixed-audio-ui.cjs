// WU11: real Chromium clicks on production Guided audio editor and handoff.
// Only the source/budget and transport are controlled fixtures. This is a
// real browser DOM authorization/compile test, NOT real Native FFmpeg output.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
async function run(){
 const port=4191,base='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1',
  '--port',String(port),'--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  let logs='';for(const st of [server.stdout,server.stderr])st.on('data',x=>logs+=x);
  let ready=false;for(let i=0;i<100;i++){
   try{if((await fetch(base)).ok){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,200));
  }
  assert.ok(ready,'Vite startup: '+logs);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1300,height:900}});
  await page.goto(base);
  await page.locator('#mediaWorkspace').waitFor({state:'attached'});
  await page.evaluate(async()=>{
   localStorage.removeItem('hardsub-control-strategy-v1');
   document.body.innerHTML=[
    '<section id="hardsubControlDeck">',
    '<button type="button" data-hardsub-strategy="guided">Guided</button>',
    '<button type="button" data-hardsub-strategy="manual">Manual</button>',
    '</section>',
    '<section id="planCard"><button type="button" id="guidedToManual">Transfer CPU</button></section>',
    '<section id="encodeCard"></section>','<section id="subtitleCard"></section>',
    '<section id="hardsubManualMount"></section>',
    '<section id="sharedMediaOutputMount"></section>','<section id="inputCard"></section>'
   ].join('');
   const {mountMediaWorkspace}=await import('/src/media-workspace.js');
   window.wu11Source='sha256:live-source-A';
   window.wu11Media={
    duration:5,fps:12,videoTracks:1,audioTracks:2,
    sourceIdentity:'sha256:live-source-A',
    formatName:'matroska,webm',sourceName:'rich.mkv',videoCodec:'ffv1',
    videoStreams:[{ordinal:0,codec:'ffv1',width:320,height:180,fps:12,
     pixelFormat:'yuv420p',bitDepth:8,unsafeColorPipeline:false}],
    audioStreams:[{ordinal:0,codec:'flac',language:'jpn'},
     {ordinal:1,codec:'aac',language:'eng'}]
   };
   window.wu11Budget={version:1,scope:'full-source',measurementId:'live-cost-1',
    audioPacketBytes:[200000,80000],subtitlePacketBytes:[1000],attachmentBytes:[8000]};
   window.wu11Snapshot={
    plan:{codec:'h264',mode:'budget-rate',goal:'sizeBudget',preset:'medium',
     sizeBudgetPolicy:'best-effort',sizeCeiling:1000000,
     // An earlier copy-all Guided estimate is intentionally different.
     targetVideoBitrate:1000000,containerReserveBytes:40000,
     fixedPayloadBytes:280000,encodedAudioBytes:0,
     outputWidth:0,outputHeight:0},
    audio:{audio:'copy'},container:'mkv'
   };
   window.wu11Alerts=[];window.wu11Runs=[];
   window.alert=text=>window.wu11Alerts.push(String(text));
   window.wu11Mounted=mountMediaWorkspace({
    isWindows:()=>false,hasNvenc:()=>false,platformKey:()=>({}),
    busy:()=>false,setBusy:()=>{},
    log:x=>window.wu11Alerts.push(String(x)),
    guidedSnapshot:()=>window.wu11Snapshot,
    mediaSnapshot:()=>window.wu11Media,videoIdentity:()=>window.wu11Source,
    sourceName:()=> 'rich.mkv',
    measureBudget:async()=>window.wu11Budget,
    prepare:async()=>window.wu11Media,
    run:async(task,media,progress)=>{
     window.wu11Runs.push(task);progress?.(1,'Fixture-only transport');return {
      verified:true,name:'wu11-mixed.mkv',outputBytes:490000,outputDuration:5};
    },
    save:()=>({pending:true})
   });
   document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  assert.equal(await page.locator('body').getAttribute('data-hardsub-strategy'),'guided');
  const panel=page.locator('details.media-audio-plan');
  assert.equal(await panel.count(),1,'Guided reuses existing one owned audioPlan editor');
  assert.equal(await panel.isVisible(),true,'Guided must expose per-stream audio choices');
  await panel.locator('summary').click();
  await page.getByRole('button',{name:/测量完整/}).count().then(async n=>{
   if(n)await page.getByRole('button',{name:/测量完整/}).click();
   else await page.locator('#taskMeasureBudget').click();
  });
  await page.waitForFunction(()=>document.querySelector('#taskBudgetLedger').textContent.includes('已测量'));
  await page.getByRole('combobox',{name:'音轨 1 输出动作'}).selectOption('aac');
  await page.getByRole('spinbutton',{name:'音轨 1 码率 bit/s'}).fill('96000');
  await page.getByRole('combobox',{name:'音轨 0 时间范围'}).selectOption('full');
  await page.getByRole('combobox',{name:'音轨 1 时间范围'}).selectOption('full');
  await page.getByRole('checkbox',{name:'音轨 0 必须 Copy 保留'}).check();
  const pre=await page.evaluate(()=>({
   plan:document.querySelector('[name=audioPlan]').value,
   lock:document.querySelector('[name=mustCopyAudioOrdinals]').value,
   source:document.querySelector('[name=audioKeepSourceIdentity]').value
  }));
  assert.deepEqual(JSON.parse(pre.plan).map(x=>x.action),['copy','aac']);
  assert.deepEqual(JSON.parse(pre.lock),[0]);assert.equal(pre.source,'sha256:live-source-A');
  // Without the owner's explicit opt-in, clicking the existing CPU handoff
  // cannot silently lose the configured per-stream plan.
  await page.locator('#guidedToManual').click();
  assert.equal(await page.locator('body').getAttribute('data-hardsub-strategy'),'guided');
  assert.ok((await page.evaluate(()=>window.wu11Alerts)).some(x=>x.includes('请勾选明确采用')));
  await page.locator('#guidedMixedAudioConfirm').check();
  await page.locator('#guidedToManual').click();
  assert.equal(await page.locator('body').getAttribute('data-hardsub-strategy'),'manual');
  assert.equal(await page.locator('#guidedMixedAudioConfirm').isChecked(),false);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(document.querySelector('[name=audioPlan]').value).map(x=>x.action)),['copy','aac']);
  const consent=await page.evaluate(()=>({
   must:JSON.parse(document.querySelector('[name=mustCopyAudioOrdinals]').value),
   source:document.querySelector('[name=audioKeepSourceIdentity]').value,
   budget:document.querySelector('[name=targetSize]').value
  }));
  assert.deepEqual(consent.must,[0]);assert.equal(consent.source,'sha256:live-source-A');
  assert.equal(Number(consent.budget),1);
  await page.locator('#taskRun').click();
  await page.waitForFunction(()=>window.wu11Runs.length===1);
  const executed=await page.evaluate(()=>window.wu11Runs[0]);
  assert.equal(executed.version,4);
  assert.equal(executed.operation,'hardsub');
  assert.equal(executed.codec,'h264');
  assert.equal(executed.rateMode,'size');
  assert.equal(executed.bitrate,1120000,
   'Actual user-approved mixed audio must cause an authoritative budget recompute');
  assert.equal(executed.sizePlan.targetBytes,1000000);
  assert.equal(executed.sizePlan.fixedPayloadBytes,200000);
  assert.equal(executed.sizePlan.encodedAudioBytes,60000);
  assert.deepEqual(executed.audioPlan.map(x=>x.action),['copy','aac']);
  assert.deepEqual(executed.mustCopyAudioOrdinals,[0]);
  assert.equal(executed.audioKeepSourceIdentity,'sha256:live-source-A');
  assert.equal(executed.nativeVbrCertificate,undefined);
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='verified');
  console.log('WU11 real Guided per-stream user DOM clicks, explicit consent, budget recompile, Manual controlled task: PASS (Native transport simulated)');
 }finally{await browser?.close();server.kill();}
}
run().catch(e=>{console.error(e);process.exitCode=1});
