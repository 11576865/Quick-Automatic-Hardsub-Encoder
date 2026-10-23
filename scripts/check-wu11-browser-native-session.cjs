// WU11: ONE real Windows localhost Bridge session, real Chromium clicks,
// production Guided/Manual task compiler and real FFmpeg Native output.
// The source is the reproducible rich MKV CI fixture, not a user device.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {readFileSync,writeFileSync,statSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const [source,probePath,importPath,formalPath,receiptPath]=process.argv.slice(2);
assert([source,probePath,importPath,formalPath,receiptPath].every(Boolean),
 'Usage: check-wu11-browser-native-session.cjs source probe import formal receipt');
const hash=p=>'sha256:'+createHash('sha256').update(readFileSync(p)).digest('hex');
const key=hash(source),sourceStat=statSync(source),formal=JSON.parse(readFileSync(formalPath,'utf8'));
const psProbe=JSON.parse(readFileSync(probePath,'utf8'));
const previousImport=JSON.parse(readFileSync(importPath,'utf8'));
assert.equal(formal.sourceSha256,key);
assert.equal(psProbe.ok,true);assert.equal(psProbe.audioTracks,2);
assert.equal(previousImport.sourceBound,true);
const port=4193,base='http://127.0.0.1:'+port;
const bridgeUrl='http://127.0.0.1:9361',token='wu02-ci-token';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1',
 '--port',String(port),'--strictPort'],{stdio:'pipe'});
let browser;
(async()=>{
 try{
  let output='';server.stdout.on('data',b=>{output+=b});server.stderr.on('data',b=>{output+=b});
  let available=false;
  for(let i=0;i<100;i++){try{if((await fetch(base)).ok){available=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,180));
  }
  assert.ok(available,'Vite did not start: '+output);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1300,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/wu11-real-native-ui*',route=>route.fulfill({
   contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/src/style.css"></head><body>
    <section id="hardsubControlDeck"><button data-hardsub-strategy="guided">Guided</button><button data-hardsub-strategy="manual">Manual</button></section>
    <section id="planCard"><button type="button" id="guidedToManual">将引导目标写入当前任务（CPU）</button></section>
    <section id="encodeCard"></section><section id="subtitleCard"></section>
    <section id="hardsubManualMount"></section><section id="sharedMediaOutputMount"></section><section id="inputCard"></section>
    </body></html>`
  }));
  await page.goto(base+'/wu11-real-native-ui?windowsNative='+encodeURIComponent(bridgeUrl)+'&token='+encodeURIComponent(token));
  const bootstrap=await page.evaluate(async init=>{
   localStorage.removeItem('hardsub-control-strategy-v1');
   const {detectWindowsNativeBridge}=await import('/src/windows-native-client.js');
   const {mountMediaWorkspace}=await import('/src/media-workspace.js');
   const discovered=await detectWindowsNativeBridge();
   if(!discovered||!globalThis.NativeHardsub?.__windowsNative)
     throw Error('Real Windows Native browser client failed to discover live Bridge');
   const bridge=globalThis.NativeHardsub;
   const selected=JSON.parse(await bridge.readSelectedVideoInfo());
   if(!selected.ok||selected.name!==init.sourceName||Number(selected.size)!==init.sourceSize)
     throw Error('Bridge source selection does not match the physical checked MKV: '+JSON.stringify(selected));
   const probe=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Native probe callback timed out')),25000);
    globalThis.__onNativeInputProbe=data=>{clearTimeout(timeout);resolve(data)};
    bridge.probeSelectedVideo();
   });
   if(!probe.ok||probe.videoTracks!==1||probe.audioTracks!==2||
      probe.subtitleTracks!==1||probe.attachmentTracks!==1)
    throw Error('Live Native probe is not the rich MKV: '+JSON.stringify(probe));
   const imported=await bridge.importEmbeddedAss(0,{name:selected.name,size:selected.size});
   if(!imported.ok||!imported.sourceBound||imported.fontCount!==1||!imported.ass?.base64)
    throw Error('Live Native embedded ASS/font binding failed');
   const assBytes=Uint8Array.from(atob(imported.ass.base64),c=>c.charCodeAt(0));
   const assText=new TextDecoder().decode(assBytes);
   const initialBudget=JSON.parse(await bridge.measureSourceBudget());
   if(initialBudget.version!==1||initialBudget.scope!=='full-source'||
      initialBudget.audioPacketBytes?.length!==2)throw Error('Current real-source audio ledger unavailable');
   const media={
    duration:Number(probe.duration),fps:12,videoTracks:probe.videoTracks,
    videoStreams:probe.videoStreams,audioTracks:probe.audioTracks,
    audioStreams:probe.audioStreams,subtitleTracks:probe.subtitleTracks,
    subtitleStreams:probe.subtitleStreams,attachmentTracks:probe.attachmentTracks,
    attachmentStreams:probe.attachmentStreams,formatName:probe.format,
    sourceName:selected.name,sourceIdentity:init.sourceKey,
    videoCodec:probe.videoCodec,audioCodecs:probe.audioCodecs
   };
   globalThis.wu11Session={
    media,sourceKey:init.sourceKey,assText,selected,
    nativeProbe:probe,imported,jobId:null,task:null,verifiedStatus:null,errors:[]
   };
   globalThis.alert=message=>wu11Session.errors.push(String(message));
   const copyAllBytes=initialBudget.audioPacketBytes.reduce((n,x)=>n+Number(x),0);
   globalThis.wu11Guided={
    plan:{codec:'h264',mode:'budget-rate',goal:'sizeBudget',preset:'medium',
     sizeBudgetPolicy:'best-effort',sizeCeiling:1000000,
     targetVideoBitrate:Math.floor((1000000-40000-copyAllBytes)*8/media.duration),
     containerReserveBytes:40000,fixedPayloadBytes:copyAllBytes,
     encodedAudioBytes:0,outputWidth:0,outputHeight:0},
    audio:{audio:'copy'},container:'mkv',
    nativeVbrCertificate:{passed:true,source:'old-copy-all'}
   };
   globalThis.wu11Mounted=mountMediaWorkspace({
    busy:()=>false,setBusy:()=>{},log:message=>wu11Session.errors.push('log:'+message),
    isWindows:()=>true,hasNvenc:()=>false,platformKey:()=>({available:true}),
    mediaSnapshot:()=>wu11Session.media,videoIdentity:()=>wu11Session.sourceKey,
    sourceName:()=>wu11Session.selected.name,
    guidedSnapshot:()=>globalThis.wu11Guided,
    measureBudget:async()=>{
     const measured=JSON.parse(await bridge.measureSourceBudget());
     wu11Session.budgetMeasurementId=measured.measurementId;
     return measured;
    },
    prepare:async()=>wu11Session.media,
    run:async(task,liveMedia,progress)=>{
     wu11Session.task=task;
     if(task.version!==4||task.operation!=='hardsub')throw Error('Not the formal v4 hardsub task');
     const v=liveMedia.videoStreams?.[0]||{};
     // Production Windows main.js manual-job request envelope, same transport
     // (NativeHardsub.startNativeEncode / getNativeJobStatus), no synthetic completion.
     const request={codec:task.codec||'h264',mode:task.rateMode!=='quality'?'budget-rate':'crf',
       goal:'manual',preset:task.preset||'medium',crf:Number(task.quality||23),
       targetVideoBitrate:Number(task.bitrate||0),task,expectedDuration:liveMedia.duration,
       expectedAudioTracks:task.expectedAudioTracks,
       estimatedOutputBytes:Math.max(128*1024*1024,Number(task.estimatedBytes||0)*1.15),
       sourceIdentity:wu11Session.sourceKey+'|video=0',sourceCodec:v.codec||liveMedia.videoCodec||'',
       sourcePixelFormat:v.pixelFormat||'',sourceVideoBitrate:Number(v.bitRate||0),
       sourceWidth:Number(v.width||0),sourceHeight:Number(v.height||0),
       sourceFps:Number(v.fps||liveMedia.fps||0),sourceSize:wu11Session.selected.size,
       subtitleEventCount:0,selectedFontCount:wu11Session.imported.fontCount,
       suggestedName:'wu11-clicked-guided-native.mkv'};
     const started=JSON.parse(await bridge.startNativeEncode(JSON.stringify(request),wu11Session.assText));
     if(!started.ok||!started.jobId)throw Error('Live Native task creation failed: '+JSON.stringify(started));
     wu11Session.jobId=started.jobId;
     for(let i=0;i<220;i++){
      const status=JSON.parse(await bridge.getNativeJobStatus(started.jobId));
      if(!status.ok)throw Error('Native job polling failed: '+JSON.stringify(status));
      progress?.(Number(status.progress||0),status.message||status.state,{
       state:status.state,timeSec:Number(status.timeMs||0)/1000,
       duration:Number(status.duration||task.expectedDuration||0),speed:Number(status.speed||0)
      });
      if(status.state==='completed'){
       wu11Session.verifiedStatus=status;
       return {task,jobId:started.jobId,name:request.suggestedName,
        outputBytes:status.outputBytes,outputDuration:status.outputDuration,
        outputPacketEvidence:status.outputPacketEvidence??null,
        outputPacketAuditState:status.outputPacketAuditState??null,
        verified:true,actualStart:status.actualStart??task.start};
      }
      if(['failed','cancelled'].includes(status.state))throw Error('Real Native encode failed: '+JSON.stringify(status));
      await new Promise(resolve=>setTimeout(resolve,320));
     }
     throw Error('Real Native job exceeded bounded browser polling window');
    },
    save:()=>({pending:true})
   });
   document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
   return {selectedName:selected.name,sourceBytes:selected.size,
    duration:media.duration,sourceAudioCodecs:probe.audioCodecs,
    fontCount:imported.fontCount,bridgeDiscovered:discovered,
    originalCopyBytes:copyAllBytes};
  },{sourceName:'source.mkv',sourceSize:sourceStat.size,sourceKey:key});
  assert.equal(bootstrap.bridgeDiscovered,true);
  assert.equal(bootstrap.sourceBytes,sourceStat.size);
  assert.ok(bootstrap.duration>4&&bootstrap.duration<6);
  assert.equal(bootstrap.fontCount,1);
  assert.equal(await page.locator('body').getAttribute('data-hardsub-strategy'),'guided');
  const panel=page.locator('details.media-audio-plan');
  assert.equal(await panel.count(),1);
  await panel.locator('summary').click();
  await page.locator('#taskMeasureBudget').click();
  await page.waitForFunction(()=>document.querySelector('#taskBudgetLedger')?.textContent.includes('已测量'),null,{timeout:90000});
  await page.getByRole('combobox',{name:'音轨 1 输出动作'}).selectOption('aac');
  await page.getByRole('spinbutton',{name:'音轨 1 码率 bit/s'}).fill('96000');
  await page.getByRole('combobox',{name:'音轨 0 时间范围'}).selectOption('full');
  await page.getByRole('combobox',{name:'音轨 1 时间范围'}).selectOption('full');
  await page.getByRole('checkbox',{name:'音轨 0 必须 Copy 保留'}).check();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(document.querySelector('[name=audioPlan]').value).map(x=>x.action)),['copy','aac']);
  assert.equal(await page.locator('#guidedMixedAudioConfirm').isChecked(),false);
  await page.locator('#guidedToManual').click();
  assert.equal(await page.locator('body').getAttribute('data-hardsub-strategy'),'guided');
  assert.ok((await page.evaluate(()=>wu11Session.errors)).some(x=>x.includes('请勾选明确采用')));
  await page.locator('#guidedMixedAudioConfirm').check();
  await page.locator('#guidedToManual').click();
  assert.equal(await page.locator('body').getAttribute('data-hardsub-strategy'),'manual');
  assert.equal(await page.locator('#guidedMixedAudioConfirm').isChecked(),false);
  assert.equal(await page.locator('#taskRun').isDisabled(),false);
  await page.locator('#taskRun').click();
  await page.waitForFunction(()=>wu11Session.jobId&&wu11Session.verifiedStatus?.state==='completed',
   null,{timeout:120000});
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace')?.dataset.taskState==='verified',
   null,{timeout:120000});
  const receipt=await page.evaluate(()=>({
   kind:'wu11-real-chromium-to-windows-native-v1',browserExplicitClicksObserved:true,
   bridgeTransport:'production-windows-native-client',
   sourceKey:wu11Session.sourceKey,jobId:wu11Session.jobId,
   task:wu11Session.task,nativeResult:wu11Session.verifiedStatus,
   actualProbe:wu11Session.nativeProbe,importedSourceBound:wu11Session.imported.sourceBound,
   importedAssBase64:wu11Session.imported.ass.base64,
   importedFontBase64:wu11Session.imported.fonts[0].base64,
   errors:wu11Session.errors.filter(x=>!x.startsWith('log:')),
   oldGuidedCopyRate:wu11Guided.plan.targetVideoBitrate,
   browserBudgetMeasurementId:wu11Session.budgetMeasurementId
  }));
  assert.match(receipt.jobId,/^[a-zA-Z0-9]+$/);
  assert.equal(receipt.nativeResult.state,'completed');
  assert.equal(receipt.sourceKey,key);
  assert.equal(receipt.task.rateMode,'size');
  assert.equal(receipt.task.sizePlan.targetBytes,1000000);
  assert.equal(receipt.task.bitrate,formal.plan.targetVideoBitrate,
   'A real Chromium click must produce the same bitrate as the independent source-measured formal task');
  assert.notEqual(receipt.task.bitrate,receipt.oldGuidedCopyRate);
  assert.deepEqual(receipt.task.audioPlan.map(x=>x.action),['copy','aac']);
  assert.deepEqual(receipt.task.mustCopyAudioOrdinals,[0]);
  assert.equal(receipt.task.budgetEvidence.measurementId,receipt.browserBudgetMeasurementId,
   'Browser must actually measure fresh full-source costs and freeze that identity');
  assert.match(receipt.browserBudgetMeasurementId,/^[a-f0-9]{32}$/i);
  assert.equal(receipt.task.sizePlan.fixedPayloadBytes,formal.fixedPayloadBytes);
  assert.equal(receipt.task.sizePlan.encodedAudioBytes,formal.encodedAudioBytes);
  assert.equal(receipt.task.nativeVbrCertificate,undefined);
  assert.equal(receipt.task.subtitleRenderOrder,'before-scale');
  assert.deepEqual(errors,[],'Production client and Guided DOM must not log browser page errors');
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({result:'PASS',kind:receipt.kind,
   sourceSha256:receipt.sourceKey,jobId:receipt.jobId,
   actualNativeState:receipt.nativeResult.state,
   formalVideoBitrate:receipt.task.bitrate,browserBudgetMeasurement:receipt.browserBudgetMeasurementId,
   uiClickObserved:true,browserTransportMocked:false,nativeFfmpegActual:true}));
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
