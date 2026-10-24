// WU12: execute the COMPLETE production main.js / V3 workbench on a real
// Windows Native Bridge. Unlike WU11's minimal fixture host this imports
// the shipping index.html, restores a selected MKV, imports its embedded
// ASS/font through production UI, runs real preflight+preview and submits
// a user-edited formal Manual plan to FFmpeg. NO fake Native transport.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {readFileSync,writeFileSync,statSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const [source,formalPath,receiptPath]=process.argv.slice(2);
assert(source&&formalPath&&receiptPath,'Usage: check-wu12-production-main-native.cjs source formal-plan receipt');
const sha=p=>'sha256:'+createHash('sha256').update(readFileSync(p)).digest('hex');
const sourceSha=sha(source),stat=statSync(source);
const formal=JSON.parse(readFileSync(formalPath,'utf8'));
assert.equal(formal.sourceSha256,sourceSha);
const origin='http://127.0.0.1:4194',bridgeOrigin='http://127.0.0.1:9361';
const token='wu02-ci-token';
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4194','--strictPort'],{stdio:'pipe'});
let browser;
(async()=>{
 try{
  let startupLog='';
  for(const stream of [vite.stdout,vite.stderr])stream.on('data',b=>{startupLog+=b});
  let ready=false;
  for(let i=0;i<100;i++){
   try{if((await fetch(origin)).ok){ready=true;break}}catch{}
   await new Promise(resolve=>setTimeout(resolve,160));
  }
  assert.ok(ready,'Vite startup: '+startupLog);
  const ping=await fetch(bridgeOrigin+'/api/health',{
   headers:{'X-Quick-Hardsub-Token':token,'Origin':origin}
  });
  assert.equal(ping.status,200);
  assert.equal((await ping.json()).backend,'windows-native');
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1300,height:900}});
  // Simulate a user granting Chrome's site-scoped Local Network Access.
  // Do not globally switch off the browser's private-network security.
  await context.grantPermissions(['local-network-access'],{origin});
  const page=await context.newPage(),pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(origin+'/?windowsNative='+encodeURIComponent(bridgeOrigin)+'&token='+encodeURIComponent(token));
  await page.waitForFunction(()=>document.body.dataset.runtimeBackend==='windows-native',null,{timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#videoMeta')?.textContent.includes('source.mkv'),null,{timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#embeddedAssStream')?.options.length===1,null,{timeout:45000});
  assert.equal(await page.locator('#mediaWorkspace').count(),1);
  assert.equal(await page.locator('.v3-shell').count(),1,
   'This scenario must mount the actual production V3 main.js, not a test-only shell');
  const selected=await page.evaluate(async()=>{
   const data=JSON.parse(await globalThis.NativeHardsub.readSelectedVideoInfo());
   return {ok:data.ok,name:data.name,size:data.size};
  });
  assert.deepEqual(selected,{ok:true,name:'source.mkv',size:stat.size});
  // Observe the REAL production import and encode methods, forwarding to the
  // same original Native JS client. This is receipt capture, NOT a stub.
  await page.evaluate(()=>{
   const bridge=globalThis.NativeHardsub;
   globalThis.wu12Proof={embedded:null,request:null,assText:null,jobId:null,completed:null};
   const originalImport=bridge.importEmbeddedAss.bind(bridge);
   bridge.importEmbeddedAss=async(...args)=>{
    const output=await originalImport(...args);wu12Proof.embedded=output;return output;
   };
   const originalEncode=bridge.startNativeEncode.bind(bridge);
   bridge.startNativeEncode=async(requestJson,assText)=>{
    wu12Proof.request=JSON.parse(requestJson);wu12Proof.assText=assText;
    const output=await originalEncode(requestJson,assText);
    const started=JSON.parse(output);wu12Proof.jobId=started.jobId||null;
    return output;
   };
   const originalStatus=bridge.getNativeJobStatus.bind(bridge);
   bridge.getNativeJobStatus=async jobId=>{
    const output=await originalStatus(jobId);
    const result=JSON.parse(output);
    if(result.state==='completed')wu12Proof.completed=result;
    return output;
   };
   const originalMeasure=bridge.measureSourceBudget.bind(bridge);
   bridge.measureSourceBudget=async()=>{
    const output=await originalMeasure();
    wu12Proof.budget=JSON.parse(output);
    return output;
   };
  });
  // Enter through the ACTUAL visible V3 source-import menu.
  const entry=page.getByRole('button',{name:'导入 ASS 与字体',exact:true});
  await entry.click();
  assert.equal(await page.locator('[data-import-action=embedded]').isDisabled(),false);
  // The production V3 import action deliberately *reveals* the real
  // dependencies owner and focuses the native ASS-track selector; it does
  // NOT silently import the first track. Complete the second explicit user
  // action using the actually visible source-bound Native importer.
  await page.locator('[data-import-action=embedded]').click();
  assert.equal(await page.locator('.v3-dependencies').getAttribute('open'),'',
   'V3 import entry must expand the source dependencies owner');
  assert.equal(await page.locator('#embeddedAssStream').isVisible(),true);
  await page.locator('#embeddedAssStream').selectOption('0');
  await page.locator('#importEmbeddedAss').click();
  await page.waitForFunction(()=>document.querySelector('#embeddedAssStatus')?.textContent.includes('已导入 ASS'),null,{timeout:45000});
  assert.match(await page.locator('#assMeta').textContent(),/内封 ASS/);
  assert.ok((await page.evaluate(()=>wu12Proof.embedded?.fonts?.length))===1,'Actual source font import missing');
  // The production preflight and Native libass preview are required before
  // a hard-sub job may start. Do not manufacture readiness in window.state.
  await page.locator('#analyze').evaluate(el=>el.click());
  await page.waitForFunction(()=>document.querySelector('#previewBtn')?.disabled===false,null,{timeout:60000});
  // Generate the true Native libass reference using the visible shipping
  // V3 action; the V3 frame is a projection of the ONE legacy preview owner.
  await page.locator('[data-v3-action="preview"]').click();
  await page.locator('[data-v3-action="generate-preview"]').click();
  await page.waitForFunction(()=>!!document.querySelector('#previewImage')?.getAttribute('src'),null,{timeout:90000});
  await page.waitForFunction(()=>!!document.querySelector('[data-v3-frame]')?.getAttribute('src'),null,{timeout:30000});
  assert.equal(await page.locator('[data-v3-frame]').isVisible(),true);
  const preflight=await page.evaluate(()=>({
   nativePreviewVisible:!!document.querySelector('#previewImage')?.getAttribute('src'),
   acceptedWarnings:document.querySelector('#acceptWarnings')?.checked===true,
   warningPanelHidden:document.querySelector('#warningAccept')?.classList.contains('hidden')
  }));
  assert.equal(preflight.nativePreviewVisible,true);
  assert.equal(preflight.warningPanelHidden,true,
   'Source-local ASS/font warnings must be resolved instead of silently accepted');
  await page.locator('[data-v3-action="close-preview"]').click();
  // Switch the fully initialized production app to its REAL Manual task and
  // interact with the one visible V3 audio owner (no second test compiler).
  await page.locator('[data-hardsub-strategy=manual]').click();
  assert.equal(await page.locator('body').getAttribute('data-hardsub-strategy'),'manual');
  const field=name=>page.locator('[data-basic-field="'+name+'"]');
  await field('codec').selectOption('h264');
  await field('rateMode').selectOption('size');
  await field('targetSize').fill('1');
  await field('sizeUnit').selectOption('MB');
  await field('budgetPolicy').selectOption('best-effort');
  await field('outputContainer').selectOption('mkv');
  const audio=page.locator('.v3-audio-plan');
  assert.equal(await audio.count(),1);
  await audio.locator('summary').click();
  await audio.getByRole('combobox',{name:'音轨 0 时间范围'}).selectOption('full');
  await audio.getByRole('combobox',{name:'音轨 1 时间范围'}).selectOption('full');
  await audio.getByRole('combobox',{name:'音轨 1 输出动作'}).selectOption('aac');
  await audio.getByRole('spinbutton',{name:'音轨 1 码率 bit/s'}).fill('96000');
  await audio.getByRole('checkbox',{name:'音轨 0 必须 Copy 保留'}).check();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(document.querySelector('[name=audioPlan]').value).map(a=>a.action)),['copy','aac']);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(document.querySelector('[name=mustCopyAudioOrdinals]').value)),[0]);
  await page.locator('#taskMeasureBudget').evaluate(el=>el.click());
  await page.waitForFunction(()=>document.querySelector('#taskBudgetLedger')?.textContent.includes('已测量'),null,{timeout:100000});
  assert.equal(await page.locator('body').getAttribute('data-runtime-backend'),'windows-native');
  const run=page.locator('[data-v3-action=run]');
  await page.waitForFunction(()=>!document.querySelector('#taskRun')?.disabled,null,{timeout:30000});
  await run.click();
  await page.waitForFunction(()=>globalThis.wu12Proof?.jobId&&globalThis.wu12Proof.completed?.state==='completed',
   null,{timeout:150000});
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace')?.dataset.taskState==='verified',
   null,{timeout:150000});
  const receipt=await page.evaluate(()=>({
    kind:'wu12-production-main-to-windows-native-v1',
    productionMainLoaded:true,sourceRecoveredFromNative:true,
    fullAppSourceImportClicked:true,preflightAndNativePreviewCompleted:true,
    browserExplicitClicksObserved:true,bridgeTransport:'production-windows-native-client',
    task:wu12Proof.request?.task,request:wu12Proof.request,
    jobId:wu12Proof.jobId,nativeResult:wu12Proof.completed,
    sourceImport:wu12Proof.embedded,
    importedSourceBound:wu12Proof.embedded?.sourceBound,
    importedAssBase64:wu12Proof.embedded?.ass?.base64,
    importedFontBase64:wu12Proof.embedded?.fonts?.[0]?.base64,
    assText:wu12Proof.assText,
    browserBudgetMeasurementId:wu12Proof.budget?.measurementId,
    browserBudget:wu12Proof.budget,
    displayedTaskState:document.querySelector('#mediaWorkspace')?.dataset.taskState
  }));
  receipt.sourceKey=sourceSha;
  assert.equal(receipt.request.goal,'manual');
  assert.equal(receipt.task.version,4);
  assert.equal(receipt.task.operation,'hardsub');
  assert.equal(receipt.task.rateMode,'size');
  assert.equal(receipt.nativeResult.state,'completed');
  assert.deepEqual(receipt.task.audioPlan.map(a=>a.action),['copy','aac']);
  assert.deepEqual(receipt.task.mustCopyAudioOrdinals,[0]);
  assert.equal(receipt.task.budgetEvidence.measurementId,receipt.browserBudgetMeasurementId);
  assert.equal(receipt.task.sizePlan.targetBytes,1000000);
  assert.equal(receipt.task.bitrate,formal.plan.targetVideoBitrate,
    'Production main.js must compile the same budget as the independent native fixture');
  assert.equal(receipt.task.nativeVbrCertificate,undefined);
  assert.equal(receipt.displayedTaskState,'verified');
  assert.deepEqual(pageErrors,[],'Actual production app page errors');
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({kind:receipt.kind,result:'PASS',
    sourceSha256:sourceSha,jobId:receipt.jobId,
    budgetMeasurementId:receipt.browserBudgetMeasurementId,
    formalBitrate:receipt.task.bitrate,sourceImported:true,
    fullMainJs:true,realNativeEncode:true,realNativePreview:true}));
 }finally{await browser?.close();vite.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
