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

  // Exercise the real browser refresh boundary for Windows Native. The launch
  // URL is intentionally one-shot; the second load must reconnect from
  // tab-scoped sessionStorage after the query credentials have been stripped.
  const windowsPage=await browser.newPage({viewport:{width:1280,height:900}});
  let windowsHealthRequests=0;
  await windowsPage.route('http://127.0.0.1:9347/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/health'){
      windowsHealthRequests++;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        backend:'windows-native',platform:'windows',available:true,
        cpu:'CI CPU',gpus:['CI GPU'],ffmpeg:'C:\\ffmpeg.exe',ffprobe:'C:\\ffprobe.exe',
        ffmpegVersion:'ci',ffmpegSource:'ci',encoders:[],bridgeVersion:4,taskSchemaVersion:3,
        fpsModeSupported:true,globalOptions:[],multipassSupported:false,multipassFullresSupported:false,hasAss:true
      })});
      return;
    }
    if(url.pathname==='/api/history'){
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({records:[]})});
      return;
    }
    if(url.pathname==='/api/self-test'){
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,x264EncodeSmoke:true,x265EncodeSmoke:true,svtAv1EncodeSmoke:true,dav1d:true,ssim:true})});
      return;
    }
    await route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({ok:false,error:'not mocked'})});
  });
  await windowsPage.goto('http://127.0.0.1:4179/?windowsNative=http%3A%2F%2F127.0.0.1%3A9347&token=ui-smoke-token');
  await windowsPage.waitForFunction(()=>document.querySelector('#runtimeModeBadge')?.textContent.trim()==='WINDOWS NATIVE');
  if(new URL(windowsPage.url()).searchParams.has('token'))throw Error('Windows launch token remained in the visible URL after connection');
  if((await windowsPage.locator('#runtimeModeTitle').textContent()).trim()!=='Windows 本机后端已连接')throw Error('Windows runtime identity is not persistent in the main chrome');
  await windowsPage.reload();
  await windowsPage.waitForFunction(()=>document.querySelector('#runtimeModeBadge')?.textContent.trim()==='WINDOWS NATIVE');
  if(windowsHealthRequests<2)throw Error('Windows page refresh did not reconnect to the localhost Bridge');
  if(await windowsPage.locator('body').getAttribute('data-runtime-backend')!=='windows-native')throw Error('Windows runtime identity was not reflected in semantic body state after refresh');
  await windowsPage.screenshot({path:'media-workspace-windows-native-desktop.png',fullPage:true});
  await windowsPage.close();

  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4179/');
  await page.locator('#mediaWorkspace').waitFor({state:'attached'});
  if(await page.locator('#mediaWorkspace').isVisible())throw Error('Guided hardsub still exposes the precise parameter workspace');
  if((await page.locator('#runtimeModeBadge').textContent()).trim()!=='WEB / WASM')throw Error('Browser runtime identity is not visibly labeled');
  if(await page.locator('#workflowStrip span').count()!==5)throw Error('Hardsub workflow strip does not expose five semantic stages');
  await page.evaluate(()=>['subtitleCard','planCard','encodeCard'].forEach(id=>document.querySelector('#'+id)?.classList.remove('hidden')));
  if(await page.locator('#taskAudioPlaybackWarning').isHidden())throw Error('Guided hardsub does not expose the copied-audio playback warning');
  if(!(await page.locator('#taskAudioPlaybackWarning').textContent()).includes('转为 AAC'))throw Error('Guided copied-audio warning lacks the AAC recovery action');
  await page.selectOption('[name=audio]','aac');
  if(!await page.locator('#taskAudioPlaybackWarning').isHidden())throw Error('Guided copied-audio warning remains visible after selecting AAC');
  await page.selectOption('[name=audio]','copy');
  if(await page.locator('#taskAudioPlaybackWarning').isHidden())throw Error('Guided copied-audio warning does not return after selecting copy');
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
  if(await page.locator('#workflowStrip span').count()!==3)throw Error('Transcode workflow strip did not collapse to three stages');
  if(!await page.locator('#mediaWorkspace').isVisible())throw Error('Transcode workspace is not visible');
  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'hardsub');
  if((await page.locator('#mediaWorkspaceTitle').textContent()).trim()!=='硬字幕压制工作区')throw Error('Transcode -> hardsub did not restore hardsub chrome');
  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'transcode');
  if((await page.locator('#mediaWorkspaceTitle').textContent()).trim()!=='纯视频转码工作区')throw Error('Hardsub -> transcode did not restore transcode chrome');
  if((await page.locator('#taskLoadPreset').textContent()).trim()!=='恢复推荐方案')throw Error('Recommended-plan recovery is not explained in user language');
  if(!(await page.locator('.media-decision-hint').textContent()).includes('不确定时直接保留推荐方案'))throw Error('Core parameter area lacks uncertainty guidance');
  if(!(await page.locator('[name=preset] option:checked').textContent()).includes('均衡'))throw Error('Preset selector does not expose human-readable intent');
  if(!await page.evaluate(()=>document.querySelector('#taskPlanSummary').compareDocumentPosition(document.querySelector('#taskEncoding')) & Node.DOCUMENT_POSITION_FOLLOWING))throw Error('Plan summary does not precede detailed parameter controls');
  if(await page.locator('.media-video-details').getAttribute('open')!==null)throw Error('Detailed video parameters are expanded by default');
  if(await page.locator('.media-track-panel').getAttribute('open')!==null)throw Error('Audio/track details are expanded by default');
  if(await page.locator('#taskAudioPlaybackWarning').isHidden())throw Error('Copied-audio playback warning is not visible for the default copy policy');
  if(!(await page.locator('#taskAudioPlaybackWarning').textContent()).includes('转为 AAC'))throw Error('Copied-audio playback warning does not give a recovery action');
  await page.selectOption('[name=audio]','aac');
  if(!await page.locator('#taskAudioPlaybackWarning').isHidden())throw Error('Copied-audio playback warning remains visible after selecting AAC');
  await page.selectOption('[name=audio]','copy');
  if(await page.locator('#taskAudioPlaybackWarning').isHidden())throw Error('Copied-audio playback warning does not return when copy is reselected');
  if(await page.locator('#taskLoadPreset').evaluate(el=>el.closest('.task-plan-summary')===null))throw Error('Recommended-plan action is detached from the plan summary');
  if(await page.locator('[name=quality]').isDisabled())throw Error('Quality control is unavailable in quality mode');
  if(!await page.locator('[name=targetSize]').isDisabled())throw Error('Target-size control remains active outside size mode');
  if(await page.locator('[name=targetSize]').isVisible())throw Error('Target-size control remains visibly active outside size mode');
  await page.locator('.media-video-details > summary').click();
  await page.fill('[name=width]','1280');await page.fill('[name=quality]','18');
  await page.click('#taskLoadPreset');
  if(await page.inputValue('[name=width]')!=='1280')throw Error('Preset overwrote resolution');

  await page.fill('[name=quality]','19');
  await page.locator('.media-sample-panel > summary').click();
  await page.fill('[name=configName]','quality-restore');
  await page.click('#taskStore');
  await page.fill('[name=quality]','31');
  await page.click('#taskRestore');
  if(await page.inputValue('[name=quality]')!=='19')throw Error('Saved configuration did not restore quality value');
  if(await page.inputValue('.media-inline-range')!=='19')throw Error('Saved configuration restored quality text but left the quality slider stale');
  await page.locator('.media-sample-panel > summary').click();

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
    window.taskBehavior='normal';
    window.taskCancelRequested=false;
    window.verifyFrameRequests=[];
    window.mockAudioMedia={
      duration:2181.384,
      fps:60,
      audioTracks:1,
      audioCodec:'aac',
      audioCodecs:['aac'],
      audioBitRate:192000,
      formatName:'mov,mp4,m4a,3gp,3g2,mj2',
      sourceName:'ui.mp4',
      videoCodec:'h264'
    };
    mountMediaWorkspace({
      isWindows:()=>false,
      hasNvenc:()=>false,
      platformKey:()=>({}),
      mediaSnapshot:()=>window.mockAudioMedia,
      busy:()=>false,
      setBusy:()=>{},
      log:()=>{},
      cancel:()=>{window.taskCancelRequested=true;},
      save:()=>({pending:true}),
      prepare:async()=>({duration:2181.384,fps:60,audioTracks:1,formatName:'mov,mp4,m4a,3gp,3g2,mj2',sourceName:'ui.mp4',videoCodec:'h264',audioCodec:'aac',audioCodecs:['aac']}),
      frame:async options=>({url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',time:Number(options?.time||0),width:Number(options?.width||720)}),
      waveform:async options=>({
        url:Number(window.mockAudioMedia.audioTracks||0)>0?'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=':null,
        waveformError:Number(window.mockAudioMedia.audioTracks||0)>0?null:'当前视频没有音频轨',
        duration:2181.384,audioTrack:0,width:2400,height:160,
        keyframes:options?.includeKeyframes?[0,120,240,360,480,600,720,840,960,1080,1200,1320,1440,1560,1680,1800,1920,2040,2160]:[],
        keyframesTruncated:false
      }),
      verifyFramePair:async options=>{
        window.verifyFrameRequests.push(options);
        const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
        return {
          source:{url:png,time:Number(options.sourceTime||0),width:Number(options.width||1200)},
          output:{url:png,time:Number(options.outputTime||0),width:Number(options.width||1200)}
        };
      },
      run:async(task,media,progress)=>{
        window.taskRuns.push(task);
        progress?.(.42,'正在处理 · 90.0 秒',{state:'encoding',timeSec:90,duration:task.expectedDuration,speed:2.5});
        if(window.taskBehavior==='cancel'){
          while(!window.taskCancelRequested)await new Promise(resolve=>setTimeout(resolve,10));
          throw new Error('cancelled');
        }
        if(window.taskBehavior==='fail')throw new Error('simulated encode failure');
        return {
          outputBytes:530000000,
          outputDuration:task.expectedDuration,
          verified:true,
          ...(task.expectedDuration>100?{jobId:'ui-smoke-job',name:'ui-smoke.'+task.outputExtension}:{})
        };
      }
    });
  });

  if((await page.locator('#taskAudioPlaybackWarning').getAttribute('data-state'))!=='info')throw Error('AAC copy guidance is not rendered as informational');
  if(!(await page.locator('#taskAudioPlaybackWarning').textContent()).includes('AAC · 1 轨 · 192 kb/s'))throw Error('AAC codec-aware guidance does not expose probed audio facts');
  await page.evaluate(()=>{
    window.mockAudioMedia={...window.mockAudioMedia,audioCodec:'dts',audioCodecs:['dts'],audioBitRate:1536000};
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  if((await page.locator('#taskAudioPlaybackWarning').getAttribute('data-state'))!=='warning')throw Error('DTS copy guidance is not rendered as a warning');
  if(!(await page.locator('#taskAudioPlaybackWarning').textContent()).includes('DTS · 1 轨 · 1536 kb/s'))throw Error('DTS codec-aware guidance does not expose probed audio facts');
  if(!(await page.locator('#taskAudioPlaybackWarning').textContent()).includes('转为 AAC'))throw Error('DTS copy guidance lacks AAC recovery action');
  await page.evaluate(()=>{
    window.mockAudioMedia={...window.mockAudioMedia,audioCodec:'aac',audioCodecs:['aac'],audioBitRate:192000};
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  await page.evaluate(value=>{const control=document.querySelector('[name=audio]');control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}));},'aac');
  if(!await page.locator('#taskAudioPlaybackWarning').evaluate(el=>el.hidden))throw Error('Codec-aware copy guidance remains active after explicit AAC transcode');
  await page.evaluate(value=>{const control=document.querySelector('[name=audio]');control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}));},'copy');
  if(await page.locator('#taskAudioPlaybackWarning').evaluate(el=>el.hidden))throw Error('Codec-aware copy guidance does not return after selecting copy');
  if((await page.locator('#taskAudioPlaybackWarning').getAttribute('data-state'))!=='info')throw Error('Restored AAC copy guidance lost informational state');

  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'transcode');
  await page.click('#taskWaveformLoad');
  await page.waitForFunction(()=>document.querySelector('#taskWaveformStatus').textContent.includes('第 1 条音轨'));
  if(await page.locator('#taskWaveformImage').isHidden())throw Error('Waveform image did not become visible');
  await page.waitForFunction(()=>!document.querySelector('#taskFramePreviewImage').hidden);
  if(!(await page.locator('#taskFramePreviewStatus').textContent()).includes('源视频解码帧'))throw Error('Timeline cursor source-frame preview did not become ready');
  const waveformBox=await page.locator('#taskWaveformTrack').boundingBox();
  if(!waveformBox)throw Error('Waveform track has no layout box');
  await page.mouse.click(waveformBox.x+waveformBox.width*0.25,waveformBox.y+waveformBox.height*0.5);
  await page.waitForFunction(()=>document.querySelector('#taskFramePreviewTime').textContent!=='—');
  await page.click('#taskWaveformSetStart');
  if(!/^[0-9]+:[0-5][0-9]/.test(await page.inputValue('[name=start]')))throw Error('Waveform cursor did not write a clock-form start time');
  await page.fill('[name=start]','0');
  await page.locator('[name=start]').blur();

  await page.evaluate(()=>{
    window.mockAudioMedia={...window.mockAudioMedia,audioTracks:0,audioCodec:'',audioCodecs:[],audioBitRate:0};
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  await page.click('#taskWaveformLoad');
  await page.waitForFunction(()=>document.querySelector('#taskWaveformStatus').textContent.includes('无音频波形 · 时间范围仍可用'));
  if((await page.locator('#taskWaveformStatus').textContent()).includes('失败'))throw Error('No-audio transcode timeline still reports analysis failure');
  await page.waitForFunction(()=>!document.querySelector('#taskFramePreviewImage').hidden);
  if(await page.locator('#taskFramePreviewImage').isHidden())throw Error('No-audio transcode timeline lost source-frame preview');
  await page.evaluate(()=>{
    window.mockAudioMedia={...window.mockAudioMedia,audioTracks:1,audioCodec:'aac',audioCodecs:['aac'],audioBitRate:192000};
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });

  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'copy');
  await page.click('#taskWaveformLoad');
  await page.waitForFunction(()=>document.querySelector('#taskWaveformStatus').textContent.includes('关键帧 19'));
  if(await page.locator('#taskKeyframeLane .media-keyframe-mark').count()<10)throw Error('Keyframe lane did not render the scanned keyframes');
  await page.fill('[name=start]','8:20');
  await page.locator('[name=start]').blur();
  if(!(await page.locator('#taskActualStartTime').textContent()).includes('8:00'))throw Error('Copy timeline did not preview the previous keyframe as actual start: '+await page.locator('#taskActualStartTime').textContent());
  if(!(await page.locator('#taskKeyframeDelta').textContent()).includes('20.000'))throw Error('Copy timeline did not expose requested-vs-actual start delta');
  await page.waitForFunction(()=>!document.querySelector('#taskRequestedFrameImage').hidden && !document.querySelector('#taskActualFrameImage').hidden);
  if((await page.locator('#taskRequestedFrameTime').textContent()).trim()!=='8:20')throw Error('Requested boundary frame time is wrong');
  if((await page.locator('#taskActualFrameTime').textContent()).trim()!=='8:00')throw Error('Actual boundary frame time is wrong');
  await page.click('#taskRequestedFrameImage');
  if(await page.locator('#taskFrameFullscreen').evaluate(el=>el.hidden))throw Error('Boundary frame click did not open fullscreen comparison');
  if(await page.locator('#taskFrameFullscreenCompare').evaluate(el=>el.hidden))throw Error('Fullscreen boundary view did not enter wipe comparison mode');
  if((await page.locator('#taskFrameFullscreenTitle').textContent()).trim()!=='请求 IN ↔ 实际无损 IN')throw Error('Fullscreen comparison title is wrong');
  await page.evaluate(()=>{
    const slider=document.querySelector('#taskFrameFullscreenWipe');
    slider.value='73';
    slider.dispatchEvent(new Event('input',{bubbles:true}));
  });
  const fullscreenCompareStyle=await page.locator('#taskFrameFullscreenCompare').getAttribute('style');
  if(!fullscreenCompareStyle?.includes('27%'))throw Error('Fullscreen wipe slider did not update clip position: '+fullscreenCompareStyle);
  await page.keyboard.press('Escape');
  if(!await page.locator('#taskFrameFullscreen').evaluate(el=>el.hidden))throw Error('Escape did not close fullscreen frame comparison');
  await page.screenshot({path:'media-workspace-copy-keyframes-mobile.png',fullPage:true});
  await page.click('#taskKeyframeSnapStart');
  if((await page.inputValue('[name=start]'))!=='8:00')throw Error('Snap-to-keyframe did not align IN to the actual keyframe');
  if(!(await page.locator('#taskKeyframeDelta').textContent()).includes('已经位于关键帧'))throw Error('Aligned IN did not report keyframe alignment');
  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'transcode');
  await page.evaluate(()=>{
    const width=document.querySelector('[name=width]');
    width.value='1280';
    width.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.fill('[name=start]','0');
  await page.locator('[name=start]').blur();
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
  if(await page.locator('#taskOutputVerification').isHidden())throw Error('Verified transcode did not expose output verification');
  await page.fill('#taskVerifyOutputTime','0:10');
  await page.locator('#taskVerifyOutputTime').blur();
  if(!(await page.locator('#taskVerifyMapping').textContent()).includes('源 0:10'))throw Error('Output verification did not map output time to source time');
  await page.click('#taskVerifyFrames');
  await page.waitForFunction(()=>!document.querySelector('#taskVerifySourceImage').hidden && !document.querySelector('#taskVerifyOutputImage').hidden);
  const verifyRequests=await page.evaluate(()=>window.verifyFrameRequests);
  if(verifyRequests.length!==1 || Math.abs(verifyRequests[0].sourceTime-10)>.001 || Math.abs(verifyRequests[0].outputTime-10)>.001)throw Error('Output verification requested wrong time pair: '+JSON.stringify(verifyRequests));
  if(await page.locator('#taskVerifyTransformWarning').isHidden())throw Error('Spatial-transform verification warning did not appear for resized output');
  await page.click('#taskVerifySourceImage');
  if((await page.locator('#taskFrameFullscreenTitle').textContent()).trim()!=='源帧 ↔ 转码成品')throw Error('Output verification did not reuse fullscreen wipe comparison');
  if((await page.locator('#taskFrameFullscreenLeftLabel').textContent()).includes('源素材')===false)throw Error('Fullscreen output verification lacks source label');
  await page.keyboard.press('Escape');
  if(!await page.locator('#taskFrameFullscreen').evaluate(el=>el.hidden))throw Error('Escape did not close output verification fullscreen');
  await page.evaluate(()=>{
    const slider=document.querySelector('#taskVerifyOutputSlider');
    slider.value='12';
    slider.dispatchEvent(new Event('input',{bubbles:true}));
  });
  if(!await page.locator('#taskVerifySourceImage').isHidden())throw Error('Changing verification time left stale frame evidence visible');

  await page.selectOption('[name=rateMode]','quality');
  if(await page.locator('#mediaWorkspace').getAttribute('data-completed-stale')!=='true')throw Error('Changing task settings did not mark the verified artifact as belonging to the previous task');
  if((await page.locator('#taskSave').textContent()).trim()!=='保存上一成品')throw Error('Verified prior artifact is not clearly labeled after settings change');
  if((await page.locator('#taskRun').textContent()).trim()!=='开始视频转码')throw Error('Run action still claims re-encode after current settings diverged from the completed task');
  if(!await page.locator('#taskSave').evaluate(el=>el.classList.contains('task-primary-action')))throw Error('Unsaved previous artifact lost primary save action after settings change');

  await page.click('#taskSave');
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='saving');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('quick-hardsub-native-export-result',{detail:{ok:false,jobId:'ui-smoke-job',error:'simulated publish failure'}})));
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='save_failed');
  if((await page.locator('#taskSave').textContent()).trim()!=='重试保存上一成品')throw Error('Publish failure lost previous-artifact identity');
  if(!(await page.locator('#taskStatus').textContent()).includes('无需重新压制'))throw Error('Publish failure did not preserve verified-output recovery guidance');
  await page.click('#taskSave');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('quick-hardsub-native-export-result',{detail:{ok:true,jobId:'ui-smoke-job',bytes:530000000,path:'C:\\output.mkv'}})));
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='saved');
  if((await page.locator('#taskSave').textContent()).trim()!=='再次保存上一成品')throw Error('Saved prior artifact lost identity after current settings diverged');

  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'copy');
  if((await page.locator('#taskRun').textContent()).trim()!=='开始无损剪切')throw Error('Mode change after completion retained stale re-encode label');
  if((await page.locator('#taskSave').textContent()).trim()!=='再次保存上一成品')throw Error('Mode change discarded access to the previous saved artifact');
  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'transcode');

  await page.locator('.media-sample-panel > summary').click();await page.click('#taskSamples');
  await page.waitForFunction(()=>document.querySelector('#taskStatus').textContent.includes('三组试压完成'));
  if(await page.locator('.task-sample').count()!==3)throw Error('Three sample results missing');
  const runs=await page.evaluate(()=>window.taskRuns);
  if(runs.length!==4 || runs.slice(1).some(t=>t.expectedDuration!==15))throw Error('Sample duration or run count is wrong');

  await page.evaluate(()=>{window.taskBehavior='cancel';window.taskCancelRequested=false;});
  await page.click('#taskRun');
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='encoding');
  await page.click('#taskCancel');
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='idle');
  if(!(await page.locator('#taskStatus').textContent()).includes('任务已取消'))throw Error('English Native cancellation was misclassified as failure');
  if((await page.locator('#taskEta').textContent()).trim()!=='已取消')throw Error('Cancelled task did not expose terminal cancellation state');
  if(await page.locator('#taskRun').isDisabled())throw Error('Run action stayed disabled after cancellation');

  await page.evaluate(()=>{window.taskBehavior='fail';window.taskCancelRequested=false;});
  await page.click('#taskRun');
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='failed');
  if(!(await page.locator('#taskStatus').textContent()).includes('simulated encode failure'))throw Error('Failure reason was not surfaced');
  if((await page.locator('#taskEta').textContent()).trim()!=='处理失败')throw Error('Failed task did not expose terminal failure state');
  if(await page.locator('#taskRun').isDisabled())throw Error('Run action stayed disabled after failure');

  await page.evaluate(()=>{window.taskBehavior='normal';window.taskCancelRequested=false;});
  await page.click('#taskRun');
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='verified');
  if(await page.locator('#taskSave').isDisabled())throw Error('Successful rerun after failure did not restore save handoff');

  if(errors.length)throw Error(errors.join('\n'));
  console.log('Desktop/mobile UI, mode gating, preset preservation: passed');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
