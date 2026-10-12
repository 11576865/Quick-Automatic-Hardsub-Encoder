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
  await require('./check-curve-design.cjs')(browser,'http://127.0.0.1:4179');
  await require('./check-calibration-lifecycle.cjs')(browser,'http://127.0.0.1:4179');
  await require('./check-vvc-ui.cjs')(browser,'http://127.0.0.1:4179');

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
        ffmpegVersion:'ci',ffmpegSource:'ci',encoders:[],bridgeVersion:4,taskSchemaVersion:4,
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


  // An independent responsive page prevents viewport state from spilling into
  // the long guided/manual task smoke. Audit real computed layout, not CSS text.
  const viewportPage=await browser.newPage({viewport:{width:320,height:720}});
  await viewportPage.goto('http://127.0.0.1:4179/');
  await viewportPage.locator('#mediaWorkspace').waitFor({state:'attached'});
  for (const width of [320,390,640,768,919,920,1024,1180,1280]) {
    await viewportPage.setViewportSize({width,height:800});
    const expectedShell=width<=640?'phone':width<=1180?'tablet':'desktop';
    await viewportPage.waitForFunction(expected=>document.documentElement.dataset.uiShell===expected,expectedShell);
    const layout=await viewportPage.evaluate(()=>{
      const rect=selector=>document.querySelector(selector)?.getBoundingClientRect();
      const workspace=document.querySelector('.workspace-layout');
      const overview=document.querySelector('#taskOverviewRail');
      return {
        shell:document.documentElement.dataset.uiShell,
        gridDisplay:getComputedStyle(workspace).display,
        gridColumns:getComputedStyle(workspace).gridTemplateColumns,
        viewport:innerWidth,
        scrollWidth:document.documentElement.scrollWidth,
        main:rect('.workflow-main'),
        runtime:rect('.platform-rail'),
        overview:rect('#taskOverviewRail'),
        overviewVisible:overview&&getComputedStyle(overview).display!=='none'
      };
    });
    if(layout.scrollWidth>width+1)
      throw Error('Horizontal overflow at '+width+'px: '+JSON.stringify(layout));
    if(width<=640) {
      if(layout.shell!=='phone')throw Error('Phone shell mismatch at '+width+': '+layout.shell);
      const studio=await viewportPage.evaluate(()=>{
        const rect=el=>el?.getBoundingClientRect();
        const mode=document.querySelector('.media-mode-switcher');
        const help=document.querySelector('.mobile-runtime-help');
        const work=document.querySelector('.workspace-layout');
        const nav=[...mode.querySelectorAll('[data-media-mode]')].map(button=>{
          const r=rect(button);return {text:button.querySelector('strong')?.textContent,pressed:button.getAttribute('aria-pressed'),left:r.left,right:r.right,height:r.height};
        });
        return {mode:rect(mode),work:rect(work),help:rect(help),helpVisible:getComputedStyle(help).display!=='none',nav};
      });
      if(studio.nav.length!==3||studio.nav.some(btn=>btn.left<0||btn.right>width+.5||btn.height<44))
        throw Error('Studio phone mode controls are clipped: '+JSON.stringify(studio));
      if(studio.helpVisible && studio.help.top<studio.work.bottom-3)
        throw Error('Installation tutorials obscure the phone task before inputs: '+JSON.stringify(studio));
      if(studio.mode.top>studio.work.top+140)
        throw Error('Mode selection no longer starts the phone task: '+JSON.stringify(studio));
      if(await viewportPage.locator('#sharedMediaOutputMount').isVisible())
        throw Error('Unprepared phone hard-sub shows audio/export policy before production stage');
    }else if(width<=1180) {
      if(layout.shell!=='tablet'||layout.gridDisplay!=='grid')
        throw Error('Tablet grid was lost at '+width+': '+JSON.stringify(layout));
      if(layout.runtime.top>layout.main.top+1)
        throw Error('Tablet runtime entry fell below main work area at '+width+': '+JSON.stringify(layout));
      if(width<920 && layout.overviewVisible)
        throw Error('Compact tablet should not reserve a competing summary column');
      if(width>=920 && (!layout.overviewVisible||layout.overview.left<=layout.main.right-5))
        throw Error('Wide tablet overview not visible alongside task: '+JSON.stringify(layout));
    }else if(layout.shell!=='desktop'||layout.gridDisplay!=='grid'){
      throw Error('Desktop composition lost at '+width+': '+JSON.stringify(layout));
    }
  }
  // Source/media/inspector architecture must be visible in an actual browser.
  await viewportPage.setViewportSize({width:1280,height:820});
  await viewportPage.waitForFunction(()=>document.documentElement.dataset.uiShell==='desktop');
  const professionalLayout=await viewportPage.evaluate(()=>{
    const rect=selector=>{
      const r=document.querySelector(selector)?.getBoundingClientRect();
      return r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width}:null;
    };
    const stage=document.querySelector('#studioEmptyStage');
    return {mode:rect('#studioModeDock'),asset:rect('#inputCard'),
      viewer:rect('#studioEmptyStage'),inspector:rect('#taskOverviewRail'),
      modeCount:document.querySelectorAll('#studioModeDock [data-media-mode]').length,
      placeholderVisible:!!stage&&getComputedStyle(stage).display!=='none'};
  });
  if(professionalLayout.modeCount!==3||
     professionalLayout.mode.bottom>professionalLayout.asset.top+1)
    throw Error('Work mode dock is not ahead of source shelf: '+JSON.stringify(professionalLayout));
  if(!professionalLayout.placeholderVisible||
     professionalLayout.viewer.left<professionalLayout.asset.right+8||
     professionalLayout.viewer.width<410)
    throw Error('Large video stage is not beside source shelf: '+JSON.stringify(professionalLayout));
  if(professionalLayout.inspector.left<professionalLayout.viewer.right+7)
    throw Error('Inspector overlaps the media workspace: '+JSON.stringify(professionalLayout));
  await viewportPage.screenshot({path:'media-workspace-studio-v3-desktop.png',fullPage:true});
  // A desktop screenshot revealed the previously untested transcode/copy
  // editor had been reparented under the 250px source shelf, leaving the
  // central stage empty. The real editor must use the central work surface.
  for(const mode of ['transcode','copy']){
    await viewportPage.locator('#studioModeDock [data-media-mode="'+mode+'"]').click();
    const modeGeometry=await viewportPage.evaluate(()=>{
      const rect=selector=>{const r=document.querySelector(selector)?.getBoundingClientRect();return r?{left:r.left,right:r.right,width:r.width,top:r.top}:null;};
      const editor=document.querySelector('#mediaWorkspace');
      return {source:rect('#inputCard'),editor:rect('#mediaWorkspace'),parent:editor?.parentElement?.id,
        visible:!!editor&&getComputedStyle(editor).display!=='none'};
    });
    if(!modeGeometry.visible||modeGeometry.parent!=='hardsubManualMount'||
       modeGeometry.editor.left<modeGeometry.source.right+8||
       modeGeometry.editor.width<400)
      throw Error('Desktop '+mode+' editor collapsed into source shelf: '+JSON.stringify(modeGeometry));
    await viewportPage.screenshot({path:'media-workspace-studio-v3-'+mode+'-desktop.png',fullPage:true});
  }
  await viewportPage.locator('#studioModeDock [data-media-mode="hardsub"]').click();


  await viewportPage.setViewportSize({width:320,height:720});
  await viewportPage.waitForFunction(()=>document.documentElement.dataset.uiShell==='phone');
  for(const mode of ['transcode','copy']){
    await viewportPage.locator('#studioModeDock [data-media-mode="'+mode+'"]').click();
    if(!await viewportPage.locator('#mediaWorkspace').isVisible())
      throw Error('Phone '+mode+' editor became unreachable after central mounting');
  }
  await viewportPage.locator('#studioModeDock [data-media-mode="hardsub"]').click();
  const phoneLegibility=await viewportPage.evaluate(()=>{
    const size=s=>parseFloat(getComputedStyle(document.querySelector(s)).fontSize);
    const header=document.querySelector('.app-header .hero-state');
    const runtime=document.querySelector('#runtimeModeBanner');
    return {
      duplicateHeaderVisible:getComputedStyle(header).display!=='none',
      runtimeVisible:getComputedStyle(runtime).display!=='none',
      metadata:size('#videoMeta'),
      fontInfo:size('#fontMeta'),
      backend:size('#runtimeModeDetail'),
      picker:size('#videoWebPicker')
    };
  });
  if(phoneLegibility.duplicateHeaderVisible||!phoneLegibility.runtimeVisible)
    throw Error('Phone duplicates or hides the backend identity: '+JSON.stringify(phoneLegibility));
  if(['metadata','fontInfo','backend','picker'].some(key=>phoneLegibility[key]<12))
    throw Error('Phone critical metadata fell below 12px: '+JSON.stringify(phoneLegibility));
  const pickerFocus=await viewportPage.evaluate(()=>{
    document.querySelector('#video').focus();
    const picker=document.querySelector('#videoWebPicker');
    const style=getComputedStyle(picker);
    return {outline:style.outlineStyle,width:style.outlineWidth};
  });
  if(pickerFocus.outline==='none'||parseFloat(pickerFocus.width)<2)
    throw Error('Keyboard-focused video picker has no visible focus indication: '+JSON.stringify(pickerFocus));
  await viewportPage.evaluate(()=>document.documentElement.style.fontSize='24px');
  const scaledPhone=await viewportPage.evaluate(()=>{
    const tabs=[...document.querySelectorAll('.media-mode-switcher [data-media-mode]')];
    return {overflow:document.documentElement.scrollWidth-innerWidth,
      tabs:tabs.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height};})};
  });
  if(scaledPhone.overflow>1||scaledPhone.tabs.some(t=>t.left<0||t.right>320.5||t.height<44))
    throw Error('150% root font scaling clips the 320px task intake: '+JSON.stringify(scaledPhone));
  await viewportPage.screenshot({path:'media-workspace-studio-phone-150pct-text.png',fullPage:true});
  await viewportPage.evaluate(()=>document.documentElement.style.fontSize='');
  await viewportPage.screenshot({path:'media-workspace-studio-intake-320.png',fullPage:true});
  await viewportPage.evaluate(()=>{
    document.body.dataset.mobileStage='produce';
    document.querySelector('[data-hardsub-strategy="guided"]')?.click();
    ['subtitleCard','planCard','encodeCard'].forEach(id=>document.getElementById(id)?.classList.remove('hidden'));
  });
  if(!await viewportPage.locator('#sharedMediaOutputMount').isVisible())
    throw Error('Audio policy was not restored for phone hard-sub production');
  await viewportPage.screenshot({path:'media-workspace-studio-produce-320.png',fullPage:true});
  const narrowTabs=await viewportPage.locator('#planCard .plan-mode-tab').evaluateAll(nodes=>
    nodes.map(el=>{const r=el.getBoundingClientRect();return {x:r.left,right:r.right,height:r.height,visible:getComputedStyle(el).display!=='none'};}));
  if(narrowTabs.length!==3||narrowTabs.some(x=>!x.visible||x.x<0||x.right>320.5||x.height<44))
    throw Error('320px guided task modes are clipped or too short: '+JSON.stringify(narrowTabs));
  await viewportPage.screenshot({path:'media-workspace-guided-phone-320.png',fullPage:true});
  await viewportPage.setViewportSize({width:1024,height:768});
  await viewportPage.screenshot({path:'media-workspace-tablet-1024.png',fullPage:true});
  await viewportPage.close();

  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4179/');
  await page.locator('#mediaWorkspace').waitFor({state:'attached'});
  if(await page.locator('#mediaWorkspace').isVisible())throw Error('Guided hardsub still exposes the precise parameter workspace');
  // The focused desktop composition is not just an imported stylesheet:
  // verify the actual browser's layout and the task rail's footprint.
  const focusedDesktop=await page.locator('.workspace-layout').evaluate(el=>{
    const layout=getComputedStyle(el);
    const rail=document.querySelector('.task-overview-rail');
    return {display:layout.display,columns:layout.gridTemplateColumns,
      railWidth:rail?.getBoundingClientRect().width||0};
  });
  if(focusedDesktop.display!=='grid'||focusedDesktop.columns.split(' ').length!==2)
    throw Error('Focused desktop workspace did not resolve to a two-column workbench: '+JSON.stringify(focusedDesktop));
  if(focusedDesktop.railWidth<190||focusedDesktop.railWidth>300)
    throw Error('Focused desktop overview rail is outside intended compact width: '+focusedDesktop.railWidth);
  const supportStack=await page.evaluate(()=>{
    const overview=document.querySelector('#taskOverviewRail').getBoundingClientRect();
    const runtime=document.querySelector('.platform-rail').getBoundingClientRect();
    return {gap:runtime.top-overview.bottom,overviewRight:overview.right,runtimeRight:runtime.right};
  });
  if(supportStack.gap<0||supportStack.gap>26)
    throw Error('Desktop runtime entry is stranded below an empty grid row: '+JSON.stringify(supportStack));
  if(Math.abs(supportStack.overviewRight-supportStack.runtimeRight)>3)
    throw Error('Supporting cards are misaligned: '+JSON.stringify(supportStack));
  if(await page.locator('.media-workflow-notes').count()!==1)
    throw Error('Manual task architecture must remain available in a single disclosure');

  if((await page.locator('#runtimeModeBadge').textContent()).trim()!=='WEB / WASM')throw Error('Browser runtime identity is not visibly labeled');
  if(await page.locator('#workflowStrip span').count()!==5)throw Error('Hardsub workflow strip does not expose five semantic stages');
  await page.evaluate(()=>['subtitleCard','planCard','encodeCard'].forEach(id=>document.querySelector('#'+id)?.classList.remove('hidden')));
  if(!await page.evaluate(()=>{
    const plan=document.querySelector('#planCard');
    const output=document.querySelector('#sharedMediaOutputMount');
    const encode=document.querySelector('#encodeCard');
    return !!(plan&&output&&encode&&
      (plan.compareDocumentPosition(output)&Node.DOCUMENT_POSITION_FOLLOWING)&&
      (output.compareDocumentPosition(encode)&Node.DOCUMENT_POSITION_FOLLOWING));
  }))throw Error('Guided audio/output choices must follow the encode plan and precede execution');
  if(await page.locator('.media-output-audio-details').evaluate(el=>el.open))
    throw Error('Detailed audio tuning is expanded by default');
  if(!await page.locator('.media-output-core-grid [name=audio]').isVisible() ||
     !await page.locator('.media-output-core-grid [name=outputContainer]').isVisible())
    throw Error('The primary audio and container controls must remain directly visible');
  await page.locator('.media-output-audio-details > summary').click();
  if(!await page.locator('[name=audioBitrate]').isVisible())
    throw Error('Optional audio bitrate control cannot be revealed');
  await page.locator('.media-output-audio-details > summary').click();
  if(await page.locator('#taskAudioPlaybackWarning').isHidden())throw Error('Guided hardsub does not expose the copied-audio playback warning');
  if(!(await page.locator('#taskAudioPlaybackWarning').textContent()).includes('转为 AAC'))throw Error('Guided copied-audio warning lacks the AAC recovery action');
  await page.selectOption('[name=audio]','aac');
  if(!await page.locator('#taskAudioPlaybackWarning').isHidden())throw Error('Guided copied-audio warning remains visible after selecting AAC');
  await page.selectOption('[name=audio]','copy');
  if(await page.locator('#taskAudioPlaybackWarning').isHidden())throw Error('Guided copied-audio warning does not return after selecting copy');
  await page.screenshot({path:'media-workspace-hardsub-goal-desktop.png',fullPage:true});
  await page.evaluate(()=>document.querySelector('[data-hardsub-strategy="manual"]').click());
  if(!await page.locator('#mediaWorkspace').isVisible())throw Error('Parameter-controlled hardsub did not reveal the parameter workspace');
  if(await page.locator('.media-workflow-notes').evaluate(el=>el.open))
    throw Error('Verbose task architecture is expanded in the default manual editor');
  await page.locator('.media-workflow-notes > summary').click();
  if(!await page.locator('.media-workflow-notes .media-branch-map').isVisible())
    throw Error('Manual task architecture is not discoverable when requested');
  await page.locator('.media-workflow-notes > summary').click();

  if(await page.locator('#planCard').isVisible() || await page.locator('#encodeCard').isVisible())throw Error('Parameter-controlled hardsub exposes the goal execution surface on desktop');
  await page.screenshot({path:'media-workspace-hardsub-parameters-desktop.png',fullPage:true});
  await page.evaluate(()=>document.querySelector('[data-hardsub-strategy="guided"]').click());
  if(await page.locator('#mediaWorkspace').isVisible())throw Error('Returning to goal-controlled hardsub left the parameter workspace visible');
  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'copy');
  if(!await page.locator('#taskRun').isDisabled() ||
     (await page.locator('#taskRun').getAttribute('data-input-requirement'))!=='video')
    throw Error('Copy shows enabled execution without a selected video');
  if(await page.locator('#taskClipQueuePanel').isHidden())
    throw Error('Copy mode did not expose the optional multi-segment panel');
  if(!await page.locator('#taskAddClip').isDisabled())
    throw Error('Copy queue can be populated before video probe');
  await page.screenshot({path:'media-workspace-copy.png',fullPage:true});
  if(!await page.locator('[name=width]').isDisabled())throw Error('Copy controls remain enabled');
  if(await page.locator('.input-ass').isVisible())throw Error('Copy still requests subtitles');
  await page.evaluate(mode=>{const control=document.querySelector('[name=operation]');control.value=mode;control.dispatchEvent(new Event('change',{bubbles:true}));},'transcode');
  await page.fill('[name=start]','3：57.250');
  await page.locator('[name=start]').blur();
  if(await page.inputValue('[name=start]')!=='3:57.25')throw Error('Full-width clock input did not normalize');
  if(await page.locator('#workflowStrip span').count()!==3)throw Error('Transcode workflow strip did not collapse to three stages');
  if(!await page.locator('#mediaWorkspace').isVisible())throw Error('Transcode workspace is not visible');
  if(!await page.locator('#taskClipQueuePanel').isHidden())
    throw Error('Copy-only clip queue appeared in Transcode mode');
  if(!await page.locator('#taskRun').isDisabled())
    throw Error('Transcode shows enabled execution without a selected video');
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
  const phonePlanTabs=await page.locator('#planCard .plan-mode-tab').evaluateAll(tabs=>
    tabs.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,visible:getComputedStyle(el).display!=='none'};}));
  if(phonePlanTabs.length!==3||phonePlanTabs.some(t=>!t.visible||t.left<-1||t.right>390.5||t.width<80))
    throw Error('Phone guided strategy hides or clips one of three goal choices: '+JSON.stringify(phonePlanTabs));
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
    window.clipBatchMockActive=false;
    window.clipExportRequests=[];
    window.mockSourcePresent=false;
    window.mockProbeReady=false;
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
      mediaSnapshot:()=>window.mockProbeReady?window.mockAudioMedia:null,
      videoIdentity:()=>window.mockSourcePresent?'ui.mp4|8000000|1':'',
      busy:()=>false,
      setBusy:()=>{},
      log:()=>{},
      cancel:()=>{window.taskCancelRequested=true;},
      save:result=>{
        if(window.clipBatchMockActive){
          window.clipExportRequests.push({name:result.name,jobId:result.jobId||''});
          return result.jobId?{pending:true}:{ok:true,kind:'browser-download'};
        }
        return {pending:true};
      },
      prepare:async()=>window.mockAudioMedia,
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
          name:'ui-smoke.'+task.outputExtension,
          ...(task.expectedDuration>100?{jobId:'ui-smoke-job'}:{})
        };
      }
    });
  });

  if(!await page.locator('#taskRun').isDisabled() ||
     (await page.locator('#taskRun').textContent()).trim()!=='先选择视频')
    throw Error('Run did not require a video in the isolated manual task');
  await page.evaluate(()=>{
    window.mockSourcePresent=true;
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  if(!await page.locator('#taskRun').isDisabled() ||
     (await page.locator('#taskRun').textContent()).trim()!=='先读取视频参数')
    throw Error('Run became enabled before video probing');
  await page.evaluate(()=>{
    window.mockProbeReady=true;
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  if(await page.locator('#taskRun').isDisabled() ||
     (await page.locator('#taskRun').textContent()).trim()!=='使用当前参数开始硬压')
    throw Error('Run did not enable after video selection and probing');
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
  const fullscreenCompareLayerStyle=await page.locator('#taskFrameFullscreenCompareLayer').getAttribute('style');
  if(!fullscreenCompareLayerStyle?.includes('27%'))throw Error('Fullscreen wipe slider did not update clip position: '+fullscreenCompareLayerStyle);
  await page.click('[data-frame-zoom="200"]');
  const fullscreenViewport=await page.evaluate(()=>({
    base:document.querySelector('#taskFrameFullscreenBase').style.transform,
    compare:document.querySelector('#taskFrameFullscreenCompare').style.transform,
    zoom:document.querySelector('#taskFrameFullscreenZoomStatus').textContent,
    pressed:document.querySelector('[data-frame-zoom="200"]').getAttribute('aria-pressed')
  }));
  if(fullscreenViewport.base!==fullscreenViewport.compare || !fullscreenViewport.base.includes('scale('))throw Error('Fullscreen zoom is not synchronized: '+JSON.stringify(fullscreenViewport));
  if(fullscreenViewport.zoom.trim()!=='200%' || fullscreenViewport.pressed!=='true')throw Error('Fullscreen zoom preset chrome is wrong: '+JSON.stringify(fullscreenViewport));
  await page.click('#taskFrameFullscreenReset');
  if((await page.locator('#taskFrameFullscreenZoomStatus').textContent()).trim()!=='Fit')throw Error('Fullscreen reset did not restore Fit viewport');
  if((await page.inputValue('#taskFrameFullscreenWipe'))!=='50')throw Error('Fullscreen reset did not restore 50/50 wipe');
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
  if((await page.locator('#taskRun').textContent()).trim()!=='开始视频流复制 / 剪辑')throw Error('Mode change after completion retained stale re-encode label');
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

  // Restore the original smoke's independent scenario boundary: all its
  // existing assertions run with the original single-video input fixture.
  // Only the final add-on E2E mutates the mock into a two-stream source.
  await page.evaluate(()=>{
    window.mockAudioMedia={
      ...window.mockAudioMedia,
      videoTracks:2,
      videoStreams:[
        {ordinal:0,codec:'h264',width:1920,height:1080,fps:60,pixelFormat:'yuv420p',bitDepth:8,unsafeColorPipeline:false},
        {ordinal:1,codec:'h264',width:1280,height:720,fps:30,pixelFormat:'yuv420p',bitDepth:8,unsafeColorPipeline:false}
      ]
    };
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });

  // Isolated final Browser E2E: prove user-facing multi-stream/time-policy controls compile into
  // the exact task handed to the execution hook, rather than only existing in DOM.
  await page.evaluate(()=>{
    const set=(name,value)=>{
      const control=document.querySelector('[name='+name+']');
      control.value=value;
      control.dispatchEvent(new Event(control.tagName==='SELECT'?'change':'input',{bubbles:true}));
      if(control.tagName!=='SELECT')control.dispatchEvent(new Event('change',{bubbles:true}));
    };
    set('operation','transcode');
    set('videoStreams','0,1');
    set('videoRange','trim');
    set('audio','copy');
    set('audioTrack','all');
    set('audioRange','full');
    set('start','0:01');
    set('end','0:03');
    set('rateMode','quality');
  });
  if(!(await page.locator('#taskPlanOutput').textContent()).includes('视频 #0 / #1'))throw Error('Multi-video UI summary did not preserve selected stream set');
  const planNote=await page.locator('#taskPlanNote').textContent();
  if(!planNote.includes('视频IN/OUT') || !planNote.includes('音频完整'))throw Error('Independent video/audio time policy is not visible in plan summary');
  await page.click('#taskRun');
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='verified');
  const uiStreamPlanTask=await page.evaluate(()=>window.taskRuns.at(-1));
  if(JSON.stringify(uiStreamPlanTask.videoStreams)!=='[0,1]')throw Error('UI multi-video selection did not reach compiled task: '+JSON.stringify(uiStreamPlanTask.videoStreams));
  if(uiStreamPlanTask.expectedVideoTracks!==2)throw Error('Compiled UI task lost multi-video output count');
  if(uiStreamPlanTask.videoRange!=='trim' || uiStreamPlanTask.audioRange!=='full')throw Error('Independent UI time policies did not reach compiled task');
  if(uiStreamPlanTask.expectedVideoDuration!==2 || Math.abs(uiStreamPlanTask.expectedAudioDuration-2181.384)>.001)throw Error('Compiled UI task produced wrong independent stream durations: '+JSON.stringify({video:uiStreamPlanTask.expectedVideoDuration,audio:uiStreamPlanTask.expectedAudioDuration}));
  if(uiStreamPlanTask.outputArgs.filter((x,i,a)=>x==='-map' && /^1:v:[01]$/.test(a[i+1]||'')).length!==2)throw Error('Compiled UI task did not map both selected video streams from trimmed input');
  if(!uiStreamPlanTask.outputArgs.some((x,i,a)=>x==='-map' && a[i+1]==='0:a?'))throw Error('Compiled UI task did not map audio from full source input');




  // Queue E2E after all legacy single-job tests: the first long clip emulates
  // a Native save dialog. No next encoding is allowed before its acknowledgment.
  await page.click('#taskSave');
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='saving');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('quick-hardsub-native-export-result',{
    detail:{ok:true,jobId:'ui-smoke-job',path:'C:\\exported.mkv'}
  })));
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='saved');
  await page.evaluate(()=>{
    const set=(name,value)=>{
      const field=document.querySelector('[name='+name+']');field.value=value;
      field.dispatchEvent(new Event('change',{bubbles:true}));
    };
    set('operation','copy');set('videoStreams','0');
    set('videoRange','trim');set('audioRange','trim');set('subtitleRange','trim');
    set('start','0:00');set('end','2:05');
  });
  if(await page.locator('#taskClipQueuePanel').isHidden())throw Error('Copy queue hidden for prepared source');
  await page.click('#taskAddClip');
  if(await page.locator('#taskClipQueueList li').count()!==1)throw Error('Failed to add first clip');
  await page.evaluate(()=>{
    const start=document.querySelector('[name=start]'),end=document.querySelector('[name=end]');
    start.value='2:10';end.value='2:15';
    start.dispatchEvent(new Event('change',{bubbles:true}));
    end.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.click('#taskAddClip');
  await page.click('#taskAddClip');
  if(await page.locator('#taskClipQueueList li').count()!==2)throw Error('Duplicate or missing queued clip');
  // Editing an unsaved row must update that row, not silently append a third.
  await page.locator('#taskClipQueueList button[data-clip-action="edit"]').first().click();
  if((await page.locator('#taskAddClip').textContent()).trim()!=='更新片段'||
     !await page.locator('#taskCancelClipEdit').isVisible())
    throw Error('Queue did not enter explicit in-place edit state');
  await page.evaluate(()=>{
    const end=document.querySelector('[name=end]');
    end.value='2:04';end.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.click('#taskAddClip');
  if(await page.locator('#taskClipQueueList li').count()!==2||
     !(await page.locator('#taskClipQueueList li').first().textContent()).includes('2:04'))
    throw Error('Edited clip was appended or old range stayed unchanged');
  // Cancelling an edit is not deletion, and leaves the original interval.
  await page.locator('#taskClipQueueList button[data-clip-action="edit"]').last().click();
  await page.evaluate(()=>{
    const end=document.querySelector('[name=end]');end.value='2:16';
    end.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.click('#taskCancelClipEdit');
  if(await page.locator('#taskClipQueueList li').count()!==2||
     (await page.locator('#taskAddClip').textContent()).trim()!=='加入片段'||
     !(await page.locator('#taskClipQueueList li').last().textContent()).includes('2:15'))
    throw Error('Cancelled clip edit modified the existing queue');
  await page.screenshot({path:'media-workspace-copy-segment-queue-390.png',fullPage:true});
  await page.evaluate(()=>{window.clipBatchMockActive=true;window.clipExportRequests=[];});
  const previousRuns=await page.evaluate(()=>window.taskRuns.length);
  await page.click('#taskExportClips');
  await page.waitForFunction(()=>document.querySelector('#taskClipQueueList li small')?.textContent==='正在保存');
  await page.waitForTimeout(100);
  if(await page.evaluate(()=>window.taskRuns.length)!==previousRuns+1)
    throw Error('Second clip started before first Native save was acknowledged');
  if(!await page.locator('#taskStopClips').isVisible())
    throw Error('Batch cancellation affordance missing');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('quick-hardsub-native-export-result',{
    detail:{ok:true,jobId:'ui-smoke-job',path:'C:\\clip-01.mkv'}
  })));
  await page.waitForFunction(()=>{
    const rows=[...document.querySelectorAll('#taskClipQueueList li small')];
    return rows.length===2&&rows.every(row=>row.textContent==='已导出');
  });
  const result=await page.evaluate(beforeBatch=>({
    tasks:window.taskRuns.slice(beforeBatch).map(task=>({
      operation:task.operation,start:task.start,end:task.end,
      videoRange:task.videoRange,audioRange:task.audioRange
    })),
    names:window.clipExportRequests.map(row=>row.name)
  }),previousRuns);
  if(result.tasks.length!==2||result.names.length!==2||
     result.tasks.some(task=>task.operation!=='copy'||task.videoRange!=='trim'||task.audioRange!=='trim')||
     result.tasks[0].start!==0||result.tasks[0].end!==124||
     result.tasks[1].start!==130||result.tasks[1].end!==135)
    throw Error('Queue did not compile separate Stream Copy IN/OUT intervals: '+JSON.stringify(result));
  if(!result.names[0].includes('-clip-01.')||!result.names[1].includes('-clip-02.')||
     result.names[0]===result.names[1])
    throw Error('Queue output names were not unique: '+JSON.stringify(result.names));
  if(!await page.locator('#taskExportClips').isDisabled())
    throw Error('Already-exported queue still offers duplicate batch run');
  // Saved clips are immutable: reusing a range must not mutate its exported row.
  await page.locator('#taskClipQueueList button[data-clip-action="reuse"]').first().click();
  if((await page.locator('#taskAddClip').textContent()).trim()!=='加入片段'||
     await page.locator('#taskClipQueueList li').count()!==2||
     !(await page.locator('#taskClipQueueList li').first().textContent()).includes('已导出'))
    throw Error('Reusing completed clip unexpectedly edits existing export record');


  // A verified Native clip that fails at Save must survive for a save-only
  // retry; no new stream-copy encode is allowed during the pending save.
  await page.evaluate(()=>{
    const set=(name,value)=>{
      const field=document.querySelector('[name='+name+']');
      field.value=value;
      field.dispatchEvent(new Event('change',{bubbles:true}));
    };
    set('start','3:00');set('end','5:05');
  });
  await page.click('#taskAddClip');
  if(await page.locator('#taskClipQueueList li').count()!==3)
    throw Error('Third interval not queued for save failure regression');
  const encodesBeforeFailure=await page.evaluate(()=>window.taskRuns.length);
  await page.click('#taskExportClips');
  await page.waitForFunction(()=>{
    const rows=[...document.querySelectorAll('#taskClipQueueList li small')];
    return rows.at(-1)?.textContent==='正在保存';
  });
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('quick-hardsub-native-export-result',{
    detail:{ok:false,jobId:'ui-smoke-job',error:'simulated native disk failure'}
  })));
  await page.waitForFunction(()=>{
    const rows=[...document.querySelectorAll('#taskClipQueueList li small')];
    return rows.at(-1)?.textContent==='待重试保存';
  });
  if(await page.evaluate(()=>window.taskRuns.length)!==encodesBeforeFailure+1)
    throw Error('Save failure unexpectedly launched another clip job');
  if(!await page.locator('#taskRun').isDisabled()||!await page.locator('#taskExportClips').isDisabled())
    throw Error('Unpublished clip output can be overwritten by another run');
  await page.evaluate(()=>document.querySelector('#mediaTaskForm').requestSubmit());
  if(await page.evaluate(()=>window.taskRuns.length)!==encodesBeforeFailure+1)
    throw Error('Direct form submit overwrote a verified unpublished clip');
  if(await page.locator('#taskClipQueueList button[data-clip-action="retry-save"]').count()!==1)
    throw Error('Failed Native save has no clip-specific save-only retry');
  if(!(await page.locator('#taskClipQueueStatus').textContent()).includes('重试保存'))
    throw Error('Failed Native save lacked recovery guidance');
  const encodedBeforeRetry=await page.evaluate(()=>window.taskRuns.length);
  await page.locator('#taskClipQueueList button[data-clip-action="retry-save"]').click();
  await page.waitForFunction(()=>document.querySelector('#mediaWorkspace').dataset.taskState==='saving');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('quick-hardsub-native-export-result',{
    detail:{ok:true,jobId:'not-the-current-job',path:'C:\\wrong.mkv'}
  })));
  if(await page.locator('#mediaWorkspace').getAttribute('data-task-state')!=='saving')
    throw Error('Unrelated Native save result incorrectly completed clip retry');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('quick-hardsub-native-export-result',{
    detail:{ok:true,jobId:'ui-smoke-job',path:'C:\\recovered-clip03.mkv'}
  })));
  await page.waitForFunction(()=>{
    const rows=[...document.querySelectorAll('#taskClipQueueList li small')];
    return rows.length===3&&rows.every(row=>row.textContent==='已导出');
  });
  if(await page.evaluate(()=>window.taskRuns.length)!==encodedBeforeRetry)
    throw Error('Retry Save re-encoded a verified clip');
  if(!await page.locator('#taskExportClips').isDisabled())
    throw Error('Successfully recovered queue still wants a duplicate export');

  if(errors.length)throw Error(errors.join('\n'));
  console.log('Desktop/mobile UI, mode gating, preset preservation: passed');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
