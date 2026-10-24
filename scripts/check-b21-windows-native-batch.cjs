// B21 hosted-bounded: full shipping Chromium UI, real Windows Native picker
// preauthorized ONLY by the CI runner, two distinct local MKVs, two real
// compileTask -> Bridge -> FFmpeg -> verified user-dir exports. No HTTP mock.
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {readFileSync,existsSync,statSync,writeFileSync}=require('node:fs');
const {join,resolve,basename}=require('node:path');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const [first,second,exportDir,receiptPath]=process.argv.slice(2);
assert(first&&second&&exportDir&&receiptPath,'Usage: node check-b21-windows-native-batch.cjs source1 source2 exportDir receipt');
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
   globalThis.b21Proof={starts:[],exports:[]};
   const start=bridge.startNativeEncode.bind(bridge);
   bridge.startNativeEncode=async(json,ass)=>{
    const result=JSON.parse(await start(json,ass));
    b21Proof.starts.push({jobId:result.jobId,request:JSON.parse(json),assLength:(ass||'').length});
    return JSON.stringify(result);
   };
   const save=bridge.requestNativeExport.bind(bridge);
   bridge.requestNativeExport=(jobId,name)=>save(jobId,name).then(result=>{
    b21Proof.exports.push({jobId,name,...result});return result;
   });
  });
  await page.locator('[data-media-mode="copy"]').click();
  await page.waitForFunction(()=>document.body.dataset.mediaOperation==='copy');
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
  assert.deepEqual(proof.starts.map(x=>x.request.task.operation),['copy','copy']);
  const sources=proof.starts.map(x=>x.request.sourceIdentity||'');
  assert.ok(sources[0].includes('source.mkv')&&sources[1].includes('source-second.mkv'),
   'Native jobs did not bind to distinct sources in order');
  const published=[];
  for(let i=0;i<2;i++){
   const save=proof.exports[i],start=proof.starts[i];
   assert.equal(save.ok,true,'Real Native export failed: '+JSON.stringify(save));
   assert.equal(save.jobId,start.jobId);
   assert.ok(save.path&&resolve(save.path).startsWith(resolve(exportDir)+'\\'));
   assert.ok(existsSync(save.path)&&statSync(save.path).size>0);
   assert.equal(fileHash(save.path),save.sha256,'Saved disk bytes differ from Native SHA receipt');
   const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration,size','-show_entries','stream=codec_type,codec_name','-of','json',save.path],{encoding:'utf8'}));
   assert.ok(probe.streams.some(x=>x.codec_type==='video'),'Saved batch artifact lacks video');
   published.push({source:i===0?basename(first):basename(second),jobId:start.jobId,
    bytes:statSync(save.path).size,sha256:save.sha256,path:save.path,streams:probe.streams});
  }
  assert.deepEqual(errors,[],'Shipping main.js emitted browser exceptions');
  const receipt={kind:'b21-two-real-source-native-copy-batch-v1',result:'PASS',
   productionMainLoaded:true,realWindowsNative:true,originalNativeTransport:true,
   ciPreauthorizedPicker:true,interactiveOsPickerVerified:false,
   sourceCount:2,jobCount:2,savedCount:2,artifacts:published,
   strictSizeVerified:false,longMovieVerified:false,physicalDeviceVerified:false};
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({kind:receipt.kind,result:'PASS',sourceCount:2,jobCount:2,
   savedCount:2,artifacts:published.map(({source,jobId,bytes,sha256})=>({source,jobId,bytes,sha256}))}));
 }finally{
  if(browser)await browser.close().catch(()=>{});
  vite.kill();
 }
})().catch(error=>{console.error(error.stack||String(error));process.exitCode=1});
