// B21 hosted-bounded: full shipping Chromium UI, real Windows Native picker
// preauthorized ONLY by the CI runner, two distinct local MKVs, two real
// compileTask -> Bridge -> FFmpeg -> verified user-dir exports. No HTTP mock.
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {readFileSync,existsSync,statSync,writeFileSync}=require('node:fs');
const {join,resolve,basename}=require('node:path');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const [first,second,exportDir,receiptPath,requestedMode='copy']=process.argv.slice(2);
assert(first&&second&&exportDir&&receiptPath,'Usage: node check-b21-windows-native-batch.cjs source1 source2 exportDir receipt [copy|transcode]');
assert.ok(['copy','transcode'].includes(requestedMode),'Only explicit copy/transcode modes may be audited');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.ok(resolve(exportDir).startsWith(resolve(process.env.RUNNER_TEMP)+'\\'));
assert.ok(existsSync(first)&&existsSync(second)&&existsSync(exportDir));
assert.notEqual(resolve(first),resolve(second));
const fileHash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const origin='http://127.0.0.1:4195',bridgeOrigin='http://127.0.0.1:9361';
const token='wu02-ci-token';
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4195','--strictPort'],{stdio:'pipe'});
let browser;
(async()=>{
 try{
  let log='',ready=false;
  for(const stream of [vite.stdout,vite.stderr])stream.on('data',chunk=>{log+=chunk});
  for(let i=0;i<100;i++){
   try{if((await fetch(origin)).ok){ready=true;break}}catch{}
   await new Promise(r=>setTimeout(r,180));
  }
  assert.ok(ready,'Real Vite failed: '+log);
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1400,height:940}});
  await context.grantPermissions(['local-network-access'],{origin});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.dismiss());
  await page.goto(origin+'/?windowsNative='+encodeURIComponent(bridgeOrigin)+'&token='+encodeURIComponent(token));
  await page.waitForFunction(()=>document.body.dataset.runtimeBackend==='windows-native',null,{timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#videoMeta')?.textContent.includes('source.mkv'),null,{timeout:30000});
  // Capture original JS client calls while forwarding them unchanged. This
  // records the two distinct jobs but never manufactures a completed state.
  await page.evaluate(()=>{
   const bridge=globalThis.NativeHardsub;
   globalThis.b21Proof={activations:[],starts:[],exports:[]};
   const activate=bridge.activateNativeBatchVideo.bind(bridge);
   bridge.activateNativeBatchVideo=async(id)=>{
    const result=await activate(id);
    b21Proof.activations.push({id:result.id,name:result.file?.name,
      probedName:result.probe?.sourceOriginalName,ok:result.probe?.ok});
    return result;
   };
   const start=bridge.startNativeEncode.bind(bridge);
   bridge.startNativeEncode=async(json,ass)=>{
    const result=JSON.parse(await start(json,ass));
    const source=b21Proof.activations[b21Proof.activations.length-1];
    b21Proof.starts.push({jobId:result.jobId,sourceGrantId:source?.id,
      sourceName:source?.name,request:JSON.parse(json),assLength:(ass||'').length});
    return JSON.stringify(result);
   };
   const save=bridge.requestNativeExport.bind(bridge);
   bridge.requestNativeExport=(jobId,name)=>save(jobId,name).then(result=>{
    b21Proof.exports.push({jobId,name,...result});return result;
   });
  });
  await page.locator('[data-media-mode="'+requestedMode+'"]').click();
  await page.waitForFunction(mode=>document.body.dataset.mediaOperation===mode,requestedMode);
  if(requestedMode==='transcode'){
   // These are the actual user-visible controls used by the production V3
   // compiler; do not inject a hand-built/parallel FFmpeg request.
   await page.locator('#mediaTaskForm [name="codec"]').selectOption('h264');
   await page.locator('#mediaTaskForm [name="encoder"]').selectOption('libx264');
   await page.locator('#mediaTaskForm [name="rateMode"]').selectOption('quality');
   await page.locator('#mediaTaskForm [name="quality"]').fill('27');
   await page.locator('#mediaTaskForm [name="audio"]').selectOption('aac');
   await page.locator('#mediaTaskForm [name="audioBitrate"]').fill('96000');
  }
  // Single source-bound queue owner is hidden in V3's details until expanded.
  const editor=page.locator('.v3-editor');
  if(!await editor.evaluate(el=>el.open))await editor.locator(':scope > summary').click();
  const panel=page.locator('#taskMultiSourcePanel');
  await page.waitForFunction(()=>document.querySelector('#taskMultiSourcePanel')?.hidden===false);
  if(!await panel.evaluate(el=>el.open))await panel.locator(':scope > summary').click();
  const choose=page.locator('#taskChooseNativeBatchSources');
  assert.equal(await choose.isVisible(),true,'Shipping Native multi-source picker entry missing');
  assert.equal(await choose.isEnabled(),true);
  await choose.click(); // CI-only Bridge preauthorization is the native chooser
  await page.waitForFunction(()=>document.querySelectorAll('#taskMultiSourceList li').length===2,
   null,{timeout:30000});
  const rows=await page.locator('#taskMultiSourceList li').allTextContents();
  assert.ok(rows.some(t=>t.includes(basename(first))));
  assert.ok(rows.some(t=>t.includes(basename(second))));
  const run=page.locator('#taskRunBatchSources');
  assert.equal(await run.isEnabled(),true,'Cannot execute two Native batch sources');
  await run.click();
  try {
   await page.waitForFunction(()=>document.querySelector('#taskMultiSourceStatus')?.textContent.includes('全部 Native 来源已独立'),
    null,{timeout:180000});
  }catch(error){
   const state=await page.evaluate(()=>({
    status:document.querySelector('#taskMultiSourceStatus')?.textContent,
    taskState:document.querySelector('#mediaWorkspace')?.dataset.taskState,
    rows:[...document.querySelectorAll('#taskMultiSourceList li')].map(e=>e.textContent),
    proof:globalThis.b21Proof
   }));
   throw Error('Two real Native batch outputs did not finish: '+JSON.stringify({state,errors})+'; '+error.message);
  }
  const proof=await page.evaluate(()=>globalThis.b21Proof);
  assert.equal(proof.starts.length,2,'Expected two separate official FFmpeg jobs');
  assert.equal(proof.exports.length,2,'Each job must have its own native Save receipt');
  assert.equal(new Set(proof.starts.map(x=>x.jobId)).size,2);
  assert.deepEqual(proof.starts.map(x=>x.request.task.operation),[requestedMode,requestedMode]);
  if(requestedMode==='transcode'){
   assert.ok(proof.starts.every(x=>x.request.task.encoder==='libx264'),'H.264 software encoder must be the executable authority');
   assert.ok(proof.starts.every(x=>x.request.task.audio==='aac'),'Both sources must receive independent AAC transcode plans');
   assert.ok(proof.starts.every(x=>Number(x.request.task.quality)===27),'Frozen per-source CRF 27 must reach both jobs');
  }
  assert.equal(proof.activations.length,2,'Native picker grants were not activated twice');
  assert.deepEqual(proof.activations.map(x=>x.probedName),[basename(first),basename(second)],
   'Native Bridge did not independently FFprobe two distinct selected sources');
  assert.deepEqual(proof.starts.map(x=>x.sourceGrantId),proof.activations.map(x=>x.id),
   'The two real FFmpeg jobs were not started under their sequential Native source grants');
  assert.ok(proof.starts.every(x=>x.request.task.operation===requestedMode));
  const published=[];
  for(let i=0;i<2;i++){
   const save=proof.exports[i],start=proof.starts[i];
   assert.equal(save.ok,true,'Real Native export failed: '+JSON.stringify(save));
   assert.equal(save.jobId,start.jobId);
   assert.ok(save.path&&resolve(save.path).startsWith(resolve(exportDir)+'\\'));
   assert.ok(existsSync(save.path)&&statSync(save.path).size>0);
   assert.equal(fileHash(save.path),save.sha256,'Saved disk bytes differ from Native SHA receipt');
   const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration,size','-show_entries','stream=codec_type,codec_name','-of','json',save.path],{encoding:'utf8'}));
   const input=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-show_entries','stream=codec_type,codec_name,width,height','-of','json',i===0?first:second],{encoding:'utf8'}));
   const srcVideo=input.streams.find(x=>x.codec_type==='video');
   const outputVideo=probe.streams.find(x=>x.codec_type==='video');
   assert.ok(outputVideo,'Saved batch artifact lacks video');
   assert.deepEqual([outputVideo.width,outputVideo.height],[srcVideo.width,srcVideo.height],
    'Output dimensions borrowed a prior source or were unexpectedly changed');
   const srcAudio=input.streams.filter(x=>x.codec_type==='audio');
   const outputAudio=probe.streams.filter(x=>x.codec_type==='audio');
   assert.equal(outputAudio.length,srcAudio.length,'Output borrowed prior source audio stream plan/count');
   if(requestedMode==='transcode'){
    assert.equal(outputVideo.codec_name,'h264','Expected independent H.264 re-encoded video, not FFV1 copy');
    assert.ok(outputAudio.every(x=>x.codec_name==='aac'),'All audio tracks must be actually encoded to AAC');
   }else{
    assert.equal(outputVideo.codec_name,srcVideo.codec_name,'Stream Copy must preserve video codec');
    assert.deepEqual(outputAudio.map(x=>x.codec_name),srcAudio.map(x=>x.codec_name));
   }
   // Decode actual compressed picture packets; probing only container fields
   // is not sufficient evidence of a playable result.
   execFileSync('ffmpeg',['-v','error','-i',save.path,'-map','0:v:0','-frames:v','4','-f','null','-'],
     {stdio:['ignore','pipe','pipe'],timeout:30000});
   published.push({source:i===0?basename(first):basename(second),jobId:start.jobId,
    bytes:statSync(save.path).size,sha256:save.sha256,path:save.path,streams:probe.streams,
    sourceWidth:srcVideo.width,sourceHeight:srcVideo.height,sourceAudioTracks:srcAudio.length});
  }
  assert.deepEqual(errors,[],'Shipping main.js emitted browser exceptions');
  const receipt={kind:'b21-two-real-source-native-'+requestedMode+'-batch-v2',mode:requestedMode,result:'PASS',
   productionMainLoaded:true,realWindowsNative:true,originalNativeTransport:true,
   ciPreauthorizedPicker:true,interactiveOsPickerVerified:false,
   sourceCount:2,jobCount:2,savedCount:2,activations:proof.activations,artifacts:published,
   strictSizeVerified:false,longMovieVerified:false,physicalDeviceVerified:false};
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({kind:receipt.kind,result:'PASS',mode:requestedMode,sourceCount:2,jobCount:2,
   savedCount:2,artifacts:published.map(({source,jobId,bytes,sha256})=>({source,jobId,bytes,sha256}))}));
 }finally{
  if(browser)await browser.close().catch(()=>{});
  vite.kill();
 }
})().catch(error=>{console.error(error.stack||String(error));process.exitCode=1});
