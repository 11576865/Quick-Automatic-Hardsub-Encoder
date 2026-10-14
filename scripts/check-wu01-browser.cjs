// WU-01: real Chromium DOM interactions with the production Manual workbench.
// A controlled source/Guided snapshot and fake completion transport do NOT
// claim a Windows Native executable or a physical-device acceptance.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
async function runWU01Browser(){
 const port=4187,base='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js',
   '--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  let log='';server.stdout.on('data',d=>{log+=d});server.stderr.on('data',d=>{log+=d});
  let ok=false;for(let i=0;i<100;i++){
   try{if((await fetch(base)).ok){ok=true;break}}catch{}
   await new Promise(r=>setTimeout(r,200));
  }
  if(!ok)throw Error('Vite startup timeout: '+log);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:850}});
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
    '<section id="encodeCard"></section>',
    '<section id="subtitleCard"></section>',
    '<section id="hardsubManualMount"></section>',
    '<section id="sharedMediaOutputMount"></section>',
    '<section id="inputCard"></section>'
   ].join('');
   const {mountMediaWorkspace}=await import('/src/media-workspace.js');
   window.wu01Errors=[];
   window.alert=message=>window.wu01Errors.push(String(message));
   window.wu01Source='';
   window.wu01Runs=[];
   window.wu01Media={
     duration:3,fps:12,videoTracks:1,audioTracks:0,
     formatName:'matroska,webm',sourceName:'wu01-source.mkv',
     videoCodec:'ffv1',videoStreams:[{
       ordinal:0,codec:'ffv1',width:320,height:180,
       fps:12,pixelFormat:'yuv420p',bitDepth:8,unsafeColorPipeline:false
     }]
   };
   window.wu01GuidedSnapshot={
     plan:{codec:'h264',mode:'budget-rate',goal:'sizeBudget',
       preset:'medium',sizeBudgetPolicy:'best-effort',
       sizeCeiling:300000,targetVideoBitrate:768000,
       containerReserveBytes:12000,fixedPayloadBytes:0,encodedAudioBytes:0,
       outputWidth:160,outputHeight:90},
     audio:{audio:'none'},container:'mkv',
     // Inject a fake old measurement: this must NEVER enter the Manual task.
     nativeVbrCertificate:{passed:true,source:'another-video'}
   };
   window.wu01Mounted=mountMediaWorkspace({
     isWindows:()=>false,hasNvenc:()=>false,platformKey:()=>({}),
     guidedSnapshot:()=>window.wu01GuidedSnapshot,
     mediaSnapshot:()=>window.wu01Media,
     videoIdentity:()=>window.wu01Source,
     busy:()=>false,setBusy:()=>{},log:msg=>window.wu01Errors.push('log:'+msg),
     prepare:async()=>window.wu01Media,
     run:async(task,media,progress)=>{
       window.wu01Runs.push(task);
       progress?.(1,'Controlled fake transport completed');
       return {outputBytes:180000,outputDuration:task.expectedDuration,
         verified:true,name:'wu01-hardsub.mkv'};
     },
     save:()=>({pending:true})
   });
   document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  const values=()=>page.evaluate(()=>({
    strategy:document.body.dataset.hardsubStrategy,
    source:window.wu01Source,
    codec:document.querySelector('[name=codec]')?.value,
    rateMode:document.querySelector('[name=rateMode]')?.value,
    width:document.querySelector('[name=width]')?.value,
    height:document.querySelector('[name=height]')?.value,
    render:document.querySelector('[name=subtitleRenderOrder]')?.value
  }));
  const before=await values();
  if(before.strategy!=='guided')throw Error('Expected Guided strategy at fresh mount');
  // A real DOM click must fail closed with no source, not silently create a task.
  await page.locator('#guidedToManual').click();
  const rejected=await values();
  if(JSON.stringify(rejected)!==JSON.stringify(before))
    throw Error('Missing-source attempt mutated Manual task or selected strategy');
  const refused=await page.evaluate(()=>window.wu01Errors.some(x=>x.includes('missing-guided-source-or-plan')));
  if(!refused)throw Error('Missing-source handoff did not report its rejection');
  await page.evaluate(()=>{
    window.wu01Source='wu01-source-v1';
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  const errorsBefore=await page.evaluate(()=>window.wu01Errors.length);
  await page.locator('#guidedToManual').click();
  const adopted=await values();
  if(adopted.strategy!=='manual'||adopted.codec!=='h264'||
     adopted.rateMode!=='size'||adopted.width!=='160'||
     adopted.height!=='90'||adopted.render!=='before-scale')
    throw Error('Actual DOM handoff failed: '+JSON.stringify(adopted));
  if(await page.evaluate(()=>window.wu01Errors.length)!==errorsBefore)
    throw Error('Valid source-bound handoff reported an unexpected error');
  const settings=await page.evaluate(()=>({
    encoder:document.querySelector('[name=encoder]')?.value,
    preset:document.querySelector('[name=preset]')?.value,
    audio:document.querySelector('[name=audio]')?.value,
    targetSize:document.querySelector('[name=targetSize]')?.value,
    sizeReserve:document.querySelector('[name=sizeReserve]')?.value,
    sizeUnit:document.querySelector('[name=sizeUnit]')?.value,
    scale:document.querySelector('[name=scaleAlgorithm]')?.value,
    container:document.querySelector('[name=outputContainer]')?.value
  }));
  if(settings.encoder!=='libx264'||settings.preset!=='medium'||
     settings.audio!=='none'||Number(settings.targetSize)!==.3||
     settings.sizeReserve!=='4'||settings.sizeUnit!=='MB'||
     settings.scale!=='bicubic'||settings.container!=='mkv')
    throw Error('Manual form lost Guided executable intent: '+JSON.stringify(settings));
  if(await page.locator('#taskRun').isDisabled())
    throw Error('Accepted Manual form remained disabled despite probed source');
  await page.locator('#taskRun').click();
  await page.waitForFunction(()=>window.wu01Runs.length===1);
  const compiled=await page.evaluate(()=>window.wu01Runs[0]);
  const vf=compiled.outputArgs[compiled.outputArgs.indexOf('-vf')+1];
  if(compiled.operation!=='hardsub'||compiled.codec!=='h264'||
     compiled.encoder!=='libx264'||compiled.bitrate!==768000||
     compiled.sizePlan?.targetBytes!==300000||
     compiled.subtitleRenderOrder!=='before-scale'||
     vf!=='ass=__ASS__:fontsdir=__FONTS__,scale=160:90:flags=bicubic,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0'||
     compiled.nativeVbrCertificate!==undefined)
    throw Error('Actual UI executed a divergent or borrowed-evidence task: '+JSON.stringify(compiled));
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='verified');
  await page.close();
  console.log('WU01 real Chromium handoff rejection, applied UI form and executable compileTask: PASS (controlled transport)');
 }finally{await browser?.close();server.kill();}
}
runWU01Browser().catch(e=>{console.error(e);process.exitCode=1});
