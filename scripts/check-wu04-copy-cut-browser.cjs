// WU04 real Chromium: inspect source-bound copy-cut advice and deliberately
// choose transcoded trim. Controlled run transport, NOT real PTS/DTS proof.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
async function main(){
 const port=4191,origin='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js',
  '--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  let log='';server.stdout.on('data',x=>log+=x);server.stderr.on('data',x=>log+=x);
  let online=false;
  for(let i=0;i<95;i++){
   try{if((await fetch(origin)).ok){online=true;break}}catch{}
   await new Promise(r=>setTimeout(r,200));
  }
  if(!online)throw Error('Vite unavailable '+log);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:850}});
  await page.goto(origin);
  await page.locator('#mediaWorkspace').waitFor({state:'attached'});
  await page.evaluate(async()=>{
   document.body.innerHTML=[
    '<section id="hardsubControlDeck"><button data-hardsub-strategy="guided">Guided</button>',
    '<button data-hardsub-strategy="manual">Manual</button></section>',
    '<section id="planCard"><button id="guidedToManual">Transfer</button></section>',
    '<section id="encodeCard"></section>','<section id="subtitleCard"></section>',
    '<section id="hardsubManualMount"></section>',
    '<section id="sharedMediaOutputMount"></section>',
    '<section id="inputCard"></section>'
   ].join('');
   const {mountMediaWorkspace}=await import('/src/media-workspace.js');
   window.cutSource='copy-video-1';
   window.cutApprove=false;
   window.confirm=()=>window.cutApprove;
   window.cutRuns=[];
   window.cutMedia={duration:6,sourceName:'source.mkv',
     videoTracks:1,audioTracks:0,videoCodec:'h264',
     fps:12,width:320,height:180,formatName:'matroska,webm',
     videoStreams:[{codec:'h264',width:320,height:180,fps:12,
       pixelFormat:'yuv420p',bitDepth:8,unsafeColorPipeline:false}]};
   window.cutWorkbench=mountMediaWorkspace({
     isWindows:()=>false,hasNvenc:()=>false,platformKey:()=>({}),
     videoIdentity:()=>window.cutSource,
     mediaSnapshot:()=>window.cutMedia,
     sourceName:()=>window.cutMedia.sourceName,
     guidedSnapshot:()=>null,
     busy:()=>false,setBusy:()=>{},log:()=>{},
     prepare:async()=>window.cutMedia,
     waveform:async()=>({
       duration:6,keyframes:[0,2,4,6],
       keyframesTruncated:false,url:null,audioTrack:0
     }),
     run:async(task,media,progress)=>{
       window.cutRuns.push(task);
       progress?.(1,'controlled reencode');
       return {task,name:'transcoded.mkv',verified:true,
         outputBytes:90000,outputDuration:task.expectedDuration};
     },
     save:()=>({ok:true})
   });
   document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  await page.locator('[data-media-mode="copy"]').click();
  await page.locator('[name="start"]').fill('3.500');
  await page.locator('[name="end"]').fill('5.500');
  await page.locator('[name="start"]').dispatchEvent('change');
  const panel=page.locator('#taskCopyStrategyPanel');
  if(await panel.isHidden())throw Error('Copy-cut decision does not appear for trim');
  let state=await page.locator('#taskCopyStrategyStatus').getAttribute('data-state');
  if(state!=='unknown')throw Error('Unmeasured source should not claim a cut: '+state);
  await page.locator('#taskWaveformLoad').click();
  await page.waitForFunction(()=>
   document.querySelector('#taskCopyStrategyStatus')?.dataset.state==='predicted-early');
  const prediction=await page.locator('#taskCopyStrategyStatus').textContent();
  if(!prediction.includes('1.500'))throw Error('Expected keyframe backtracking warning: '+prediction);
  if(await page.locator('[name="operation"]').inputValue()!=='copy')
   throw Error('Cut feasibility silently switched out of Stream Copy');
  await page.evaluate(()=>{
   window.cutSource='changed-source';
   document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  state=await page.locator('#taskCopyStrategyStatus').getAttribute('data-state');
  if(state!=='unknown')throw Error('Old source keyframes reused after input change: '+state);
  await page.evaluate(()=>{
   window.cutSource='copy-video-1';
   document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  await page.locator('#taskPreferTranscodeTrim').click();
  if(await page.locator('[name="operation"]').inputValue()!=='copy')
   throw Error('Cancel in confirm dialog changed copy operation');
  await page.evaluate(()=>window.cutApprove=true);
  await page.locator('#taskPreferTranscodeTrim').click();
  if(await page.locator('[name="operation"]').inputValue()!=='transcode')
   throw Error('Opt-in transcoded trim did not select transcode');
  if(await page.locator('[name="start"]').inputValue()!=='3.500'||
     await page.locator('[name="end"]').inputValue()!=='5.500')
    throw Error('Trim choice discarded requested IN/OUT');
  if(!(await page.locator('#taskCopyStrategyPanel').isHidden()))
    throw Error('Copy-only decision panel remained open in transcode mode');
  await page.locator('#taskRun').click();
  await page.waitForFunction(()=>window.cutRuns.length===1);
  const task=await page.evaluate(()=>window.cutRuns[0]);
  if(task.operation!=='transcode'||task.encoder==='copy'||
     task.videoRange!=='trim'||task.start!==3.5||task.end!==5.5)
    throw Error('User-directed clip was not compiled as a bounded transcode task: '+JSON.stringify(task));
  if(task.cutVerified===true||task.actualFirstPresentation!=null)
    throw Error('Browser cut decision fabricated output-timestamp evidence');
  console.log('WU04 Chromium user-directed cut strategy + stale source gate + compiled transcode PASS (controlled transport)');
 }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
