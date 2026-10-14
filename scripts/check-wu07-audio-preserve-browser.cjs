// WU07 production Chromium: explicit audio must-copy source lock, negative
// compile, actual v4 run, explicit unlock, and video source identity drift.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
async function main(){
 const port=4197,base='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js',
  '--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  let logs='',ready=false;
  server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
  for(let i=0;i<100;i++){try{if((await fetch(base)).ok){ready=true;break}}catch{}
    await new Promise(r=>setTimeout(r,200));}
  if(!ready)throw Error('Vite startup timeout: '+logs);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1300,height:850}});
  await page.goto(base);await page.locator('#mediaWorkspace').waitFor({state:'attached'});
  await page.evaluate(async()=>{
    document.body.innerHTML=[
      '<section id="hardsubControlDeck"><button data-hardsub-strategy="guided">Guided</button>',
      '<button data-hardsub-strategy="manual">Manual</button></section>',
      '<section id="planCard"><button id="guidedToManual">Transfer</button></section>',
      '<section id="encodeCard"></section>','<section id="subtitleCard"></section>',
      '<section id="hardsubManualMount"></section>',
      '<section id="sharedMediaOutputMount"></section>','<section id="inputCard"></section>'
    ].join('');
    const {mountMediaWorkspace}=await import('/src/media-workspace.js');
    window.qheCopySource='wu07-rich-MKV-original';
    window.qheKeepRuns=[];
    window.qheConfirm=false;window.confirm=()=>window.qheConfirm;
    window.qheMedia={
      duration:6,sourceName:'mixed.mkv',videoTracks:1,audioTracks:2,
      videoCodec:'ffv1',fps:12,formatName:'matroska',
      videoStreams:[{codec:'ffv1',width:320,height:180,fps:12,pixelFormat:'yuv420p'}],
      audioStreams:[{codec:'flac',channels:2},{codec:'aac',channels:2}]
    };
    window.qheWorkbench=mountMediaWorkspace({
      isWindows:()=>false,hasNvenc:()=>false,platformKey:()=>({}),
      videoIdentity:()=>window.qheCopySource,mediaSnapshot:()=>window.qheMedia,
      sourceName:()=>window.qheMedia.sourceName,guidedSnapshot:()=>null,
      busy:()=>false,setBusy:()=>{},log:()=>{},
      prepare:async()=>window.qheMedia,
      run:async(task,media,progress)=>{
        window.qheKeepRuns.push(task);
        progress?.(1,'controlled');
        return {task,name:'wu07-verified.mkv',verified:true,
          outputBytes:90000,outputDuration:task.expectedDuration};
      },save:()=>({pending:true})
    });
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  await page.locator('[data-media-mode="transcode"]').click();
  const panel=page.locator('.media-audio-plan');
  await panel.locator('summary').click();
  const lock=panel.locator('[aria-label="音轨 0 必须 Copy 保留"]');
  await lock.check();
  if(await panel.locator('[aria-label="音轨 0 输出动作"]').inputValue()!=='copy')
    throw Error('Lock did not request copy on original track');
  await panel.locator('[aria-label="音轨 1 输出动作"]').selectOption('aac');
  const sourceField=page.locator('[name="audioKeepSourceIdentity"]');
  if(await sourceField.inputValue()!=='wu07-rich-MKV-original')
    throw Error('Lock not bound to current media source');
  if(await page.locator('[name="mustCopyAudioOrdinals"]').inputValue()!=='[0]')
    throw Error('Owner lock not encoded as a single schema-v4 source ordinal');
  await page.locator('#taskInspect').click();
  await page.waitForFunction(()=>document.querySelector('#taskStatus')
    ?.textContent?.includes('当前方案验证通过'),null,{timeout:12000});
  const review=await page.locator('[data-review="plan-rows"]').textContent();
  if(!review.includes('必须 Copy 保留锁'))
    throw Error('Checked plan did not expose immutable audio lock to the user');
  await page.locator('#taskRun').click();
  await page.waitForFunction(()=>window.qheKeepRuns.length===1,null,{timeout:12000});
  const task=await page.evaluate(()=>window.qheKeepRuns[0]);
  if(JSON.stringify(task.mustCopyAudioOrdinals)!=='[0]'||
    task.audioPlan?.[0]?.action!=='copy'||task.audioPlan?.[1]?.action!=='aac'||
    task.outputPlan?.audio?.[0]?.mustCopy!==true)
    throw Error('Shared v4 actual executed task violated locked mixed audio: '+JSON.stringify(task));
  // The user can change codec controls, but compiler must fail closed and must
  // not silently remove the lock just to make the task execute.
  await panel.locator('[aria-label="音轨 0 输出动作"]').selectOption('aac');
  if(!(await lock.isChecked()))throw Error('Changing codec silently removed user preservation lock');
  await page.locator('#taskInspect').click();
  await page.waitForFunction(()=>document.querySelector('#taskStatus')
    ?.textContent?.includes('必须 Copy'),null,{timeout:10000});
  if(await page.evaluate(()=>window.qheKeepRuns.length)!==1)
    throw Error('Conflicted must-copy task nevertheless executed');
  await lock.uncheck();
  await page.locator('#taskInspect').click();
  await page.waitForFunction(()=>document.querySelector('#taskStatus')
    ?.textContent?.includes('当前方案验证通过'),null,{timeout:12000});
  await lock.check();
  await panel.getByRole('button',{name:'恢复全局音频策略'}).click();
  if(!(await lock.isChecked()))throw Error('Cancelled reset silently unlocked protected audio');
  await page.evaluate(()=>window.qheConfirm=true);
  await panel.getByRole('button',{name:'恢复全局音频策略'}).click();
  if(await lock.isChecked())throw Error('User-approved reset failed to unlock audio');
  await lock.check();
  await page.evaluate(()=>{
    window.qheCopySource='foreign-video-after-source-change';
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  if(await lock.isChecked()||await sourceField.inputValue()!=='')
    throw Error('A new video inherited old source audio-preservation locks');
  console.log('WU07 real Chromium source-bound audio must-copy + official compiled mixed task + fail closed/unlock PASS (controlled run)');
 }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
