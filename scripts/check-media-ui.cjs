const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4179','--strictPort'],{stdio:'pipe'});
 let browser;
 try {
  let startupLog='';server.stdout.on('data',data=>{startupLog+=data;});server.stderr.on('data',data=>{startupLog+=data;});
  let ready=false;for(let attempt=0;attempt<100;attempt++){try{if((await fetch('http://127.0.0.1:4179/')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
  if(!ready)throw Error('Vite startup timeout: '+startupLog);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4179/');
  await page.locator('#mediaWorkspace').waitFor({state:'attached'});
  if(await page.locator('#mediaWorkspace').isVisible())throw Error('Guided hardsub still exposes the precise parameter workspace');
  if(await page.locator('#workflowStrip span').count()!==5)throw Error('Hardsub workflow strip does not expose five semantic stages');
  await page.evaluate(()=>['subtitleCard','planCard','encodeCard'].forEach(id=>document.querySelector('#'+id)?.classList.remove('hidden')));
  await page.screenshot({path:'media-workspace-hardsub-goal-desktop.png',fullPage:true});
  await page.evaluate(()=>document.querySelector('[data-hardsub-strategy="manual"]').click());
  if(!await page.locator('#mediaWorkspace').isVisible())throw Error('Parameter-controlled hardsub did not reveal the parameter workspace');
  if(await page.locator('#planCard').isVisible() || await page.locator('#encodeCard').isVisible())throw Error('Parameter-controlled hardsub exposes the goal execution surface on desktop');
  await page.screenshot({path:'media-workspace-hardsub-parameters-desktop.png',fullPage:true});
  await page.evaluate(()=>document.querySelector('[data-hardsub-strategy="guided"]').click());
  if(await page.locator('#mediaWorkspace').isVisible())throw Error('Returning to goal-controlled hardsub left the parameter workspace visible');
  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'copy');
  await page.screenshot({path:'media-workspace-copy.png',fullPage:true});
  if(!await page.locator('[name=width]').isDisabled())throw Error('Copy controls remain enabled');
  if(await page.locator('.input-ass').isVisible())throw Error('Copy still requests subtitles');
  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'transcode');
  await page.fill('[name=start]','3：57.250');
  await page.locator('[name=start]').blur();
  if(await page.inputValue('[name=start]')!=='3:57.25')throw Error('Full-width clock input did not normalize');
  await page.click('#taskWaveformLoad');
  await page.waitForFunction(()=>document.querySelector('#taskWaveformStatus').textContent.includes('第 1 条音轨'));
  if(await page.locator('#taskWaveformImage').isHidden())throw Error('Waveform image did not become visible');
  const waveformBox=await page.locator('#taskWaveformTrack').boundingBox();
  if(!waveformBox)throw Error('Waveform track has no layout box');
  await page.mouse.click(waveformBox.x+waveformBox.width*0.25,waveformBox.y+waveformBox.height*0.5);
  await page.click('#taskWaveformSetStart');
  if(!/^[0-9]+:[0-5][0-9]/.test(await page.inputValue('[name=start]')))throw Error('Waveform cursor did not write a clock-form start time');
  await page.fill('[name=start]','0');
  await page.locator('[name=start]').blur();

  if(await page.locator('#workflowStrip span').count()!==3)throw Error('Transcode workflow strip did not collapse to three stages');
  if(!await page.locator('#mediaWorkspace').isVisible())throw Error('Transcode workspace is not visible');
  if((await page.locator('#taskLoadPreset').textContent()).trim()!=='恢复推荐方案')throw Error('Recommended-plan recovery is not explained in user language');
  if(!(await page.locator('.media-decision-hint').textContent()).includes('不确定时直接保留推荐方案'))throw Error('Core parameter area lacks uncertainty guidance');
  if(!(await page.locator('[name=preset] option:checked').textContent()).includes('均衡'))throw Error('Preset selector does not expose human-readable intent');
  if(!await page.evaluate(()=>document.querySelector('#taskPlanSummary').compareDocumentPosition(document.querySelector('#taskEncoding')) & Node.DOCUMENT_POSITION_FOLLOWING))throw Error('Plan summary does not precede detailed parameter controls');
  if(await page.locator('.media-video-details').getAttribute('open')!==null)throw Error('Detailed video parameters are expanded by default');
  if(await page.locator('.media-track-panel').getAttribute('open')!==null)throw Error('Audio/track details are expanded by default');
  if(await page.locator('#taskLoadPreset').evaluate(el=>el.closest('.task-plan-summary')===null))throw Error('Recommended-plan action is detached from the plan summary');
  if(await page.locator('[name=quality]').isDisabled())throw Error('Quality control is unavailable in quality mode');
  if(!await page.locator('[name=targetSize]').isDisabled())throw Error('Target-size control remains active outside size mode');
  if(await page.locator('[name=targetSize]').isVisible())throw Error('Target-size control remains visibly active outside size mode');
  await page.locator('.media-video-details > summary').click();
  await page.fill('[name=width]','1280');await page.fill('[name=quality]','18');
  await page.click('#taskLoadPreset');
  if(await page.inputValue('[name=width]')!=='1280')throw Error('Preset overwrote resolution');
  await page.selectOption('[name=rateMode]','size');
  if(await page.locator('[name=targetSize]').isDisabled())throw Error('Size controls are unavailable');
  if(!await page.locator('[name=targetSize]').isVisible())throw Error('Size controls are hidden in size mode');
  if(!await page.locator('[name=quality]').isDisabled())throw Error('Quality control conflicts with size mode');
  if(await page.locator('[name=quality]').isVisible())throw Error('Quality control remains visibly active in size mode');
  await page.selectOption('[name=rateMode]','quality');
  if(!await page.locator('[name=targetSize]').isDisabled())throw Error('Target-size control reactivates after leaving size mode');
  if(await page.locator('[name=targetSize]').isVisible())throw Error('Target-size control remains visible after leaving size mode');
  if(await page.locator('[name=quality]').isDisabled())throw Error('Quality control did not reactivate after leaving size mode');
  await page.selectOption('[name=rateMode]','size');
  await page.locator('.media-sample-panel > summary').click();
  await page.fill('[name=configName]','720p60');await page.fill('[name=fps]','60');await page.selectOption('[name=fpsMode]','cfr');
  await page.click('#taskStore');await page.fill('[name=fps]','30');await page.click('#taskRestore');
  if(await page.inputValue('[name=fps]')!=='60')throw Error('Saved configuration did not restore frame rate');
  await page.locator('.media-video-details > summary').click();
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:'media-workspace-desktop.png' ,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:'media-workspace-mobile.png',fullPage:true});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile horizontal overflow: '+JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,id:el.id,class:el.className,right:el.getBoundingClientRect().right})).filter(el=>el.right>innerWidth+1).slice(0,12))));
  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'hardsub');
  await page.evaluate(()=>{document.body.dataset.mobileStage='produce';document.querySelector('[data-hardsub-strategy="guided"]').click();});
  if(await page.locator('#mediaWorkspace').isVisible())throw Error('Goal-controlled hardsub exposes parameter controls on mobile');
  await page.screenshot({path:'media-workspace-hardsub-goal-mobile.png',fullPage:true});
  await page.evaluate(()=>document.querySelector('[data-hardsub-strategy="manual"]').click());
  if(!await page.locator('#mediaWorkspace').isVisible())throw Error('Parameter-controlled hardsub is hidden from the mobile produce stage');
  if(await page.locator('#planCard').isVisible() || await page.locator('#encodeCard').isVisible()){
    const gateState=await page.evaluate(()=>Object.fromEntries(['planCard','encodeCard','mediaWorkspace'].map(id=>{
      const el=document.querySelector('#'+id);
      return [id,{className:el?.className||'',display:el?getComputedStyle(el).display:null,hidden:!!el?.hidden}];
    }).concat([['body',{mediaOperation:document.body.dataset.mediaOperation||'',hardsubStrategy:document.body.dataset.hardsubStrategy||'',mobileStage:document.body.dataset.mobileStage||'',className:document.body.className}]])));
    throw Error('Parameter-controlled hardsub exposes the goal execution surface on mobile: '+JSON.stringify(gateState));
  }
  await page.screenshot({path:'media-workspace-hardsub-parameters-mobile.png',fullPage:true});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Hardsub mobile horizontal overflow');
  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'transcode');
  if(await page.evaluate(()=>document.body.dataset.mobileStage)!=='prepare')throw Error('Leaving hardsub did not reset the mobile stage');
  if(!await page.locator('#mediaWorkspace').isVisible())throw Error('Transcode workspace remained hidden after leaving hardsub on mobile');
  await page.evaluate(async()=>{
    // Isolate the task-planning smoke from the production mount. The production
    // workspace owns MutationObservers that may legally re-host its section;
    // removing only the DOM node leaves those owners alive and can resurrect
    // the old workspace during a second mount.
    document.body.innerHTML='<section id="inputCard"></section>';
    const {mountMediaWorkspace}=await import('/src/media-workspace.js');
    window.taskRuns=[];
    mountMediaWorkspace({
      isWindows:()=>false,
      hasNvenc:()=>false,
      platformKey:()=>({}),
      busy:()=>false,
      setBusy:()=>{},
      log:()=>{},
      cancel:()=>{},
      save:()=>({pending:true}),
      prepare:async()=>({duration:2181.384,fps:60,audioTracks:1,formatName:'mov,mp4,m4a,3gp,3g2,mj2',sourceName:'ui.mp4',videoCodec:'h264',audioCodec:'aac',audioCodecs:['aac']}),
      waveform:async()=>({url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',duration:2181.384,audioTrack:0,width:2400,height:160}),
      run:async(task,media,progress)=>{
        window.taskRuns.push(task);
        progress?.(.42,'正在处理 · 90.0 秒',{state:'encoding',timeSec:90,duration:task.expectedDuration,speed:2.5});
        return {
          outputBytes:530000000,
          outputDuration:task.expectedDuration,
          verified:true,
          ...(task.expectedDuration>100?{jobId:'ui-smoke-job',name:'ui-smoke.'+task.outputExtension}:{})
        };
      }
    });
  });
  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'transcode');
  await page.locator('.media-track-panel > summary').click();await page.selectOption('[name=audio]','aac');
  await page.selectOption('[name=rateMode]','size');await page.fill('[name=targetSize]','500');
  await page.click('#taskInspect');await page.waitForTimeout(100);
  const inspectState=await page.evaluate(()=>({
    estimate:document.querySelector('#taskEstimate').textContent,
    status:document.querySelector('#taskStatus').textContent,
    operation:document.querySelector('[name=operation]').value,
    audio:document.querySelector('[name=audio]').value,
    rateMode:document.querySelector('[name=rateMode]').value,
    targetSize:document.querySelector('[name=targetSize]').value
  }));
  if(!inspectState.estimate.includes('500.00 MB'))throw Error('Size inspection failed: '+JSON.stringify(inspectState));
  if(!(await page.locator('#taskPlanTitle').textContent()).includes('纯视频转码'))throw Error('Task plan summary does not explain the selected operation');
  if(!(await page.locator('#taskContainerDecision').textContent()).includes('MP4'))throw Error('Auto container did not resolve to MP4 for H.264/AAC: '+await page.locator('#taskContainerDecision').textContent());
  if(!(await page.locator('#taskPlanOutput').textContent()).includes('MP4'))throw Error('Plan summary did not expose the resolved container');
  if(await page.locator('.task-technical-details').getAttribute('open')!==null)throw Error('Raw FFmpeg command is expanded by default');
  await page.click('#taskRun');await page.waitForFunction(()=>document.querySelector('#taskStatus').textContent.includes('超出体积预算'));
  if(await page.locator('#mediaWorkspace').getAttribute('data-task-state')!=='verified')throw Error('Completed output did not enter verified-not-saved state');
  if(await page.locator('#taskSave').isDisabled())throw Error('Oversized full output was discarded');
  if(!await page.locator('#taskSave').evaluate(el=>el.classList.contains('task-primary-action')))throw Error('Verified output did not promote Save as primary action');
  if((await page.locator('#taskRun').textContent()).trim()!=='重新压制')throw Error('Encode action did not demote after verification');
  if((await page.locator('#taskPercent').textContent()).trim()!=='100%')throw Error('Completed task did not expose 100% progress');
  if(await page.locator('#taskReport').isDisabled())throw Error('Report unavailable');

  await page.click('#taskSave');
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='saving');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('quick-hardsub-native-export-result',{detail:{ok:false,jobId:'ui-smoke-job',error:'simulated publish failure'}})));
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='save_failed');
  if((await page.locator('#taskSave').textContent()).trim()!=='重试保存成品')throw Error('Publish failure did not expose retry action');
  if(!(await page.locator('#taskStatus').textContent()).includes('无需重新压制'))throw Error('Publish failure did not preserve verified-output recovery guidance');
  await page.click('#taskSave');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('quick-hardsub-native-export-result',{detail:{ok:true,jobId:'ui-smoke-job',bytes:530000000,path:'C:\\output.mkv'}})));
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='saved');

  await page.locator('.media-sample-panel > summary').click();await page.click('#taskSamples');
  await page.waitForFunction(()=>document.querySelector('#taskStatus').textContent.includes('三组试压完成'));
  if(await page.locator('.task-sample').count()!==3)throw Error('Three sample results missing');
  const runs=await page.evaluate(()=>window.taskRuns);
  if(runs.length!==4 || runs.slice(1).some(t=>t.expectedDuration!==15))throw Error('Sample duration or run count is wrong');
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Desktop/mobile UI, mode gating, preset preservation: passed');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
