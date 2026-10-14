const assert = require('node:assert/strict');

module.exports = async function checkCurveDesign(browser, baseUrl) {
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  await page.route('**/curve-design-test', route=>route.fulfill({
    contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/media-workspace-ui.css"></head><body><main style="max-width:1100px;margin:40px auto;padding:20px"><h2>压制前 · 实测曲线</h2><div class="media-curve-grid" id="charts"></div></main></body></html>'
  }));
  try {
    await page.goto(baseUrl+'/curve-design-test');
    await page.evaluate(async()=>{
      const {renderRateDistortionSvg}=await import('/src/curve-chart-svg.js');
      const {fitRateDistortionModel,createSizeQualityFrontier}=await import('/src/rate-distortion-model.js');
      const {buildSizeFrontierPlot}=await import('/src/size-frontier-ui.js');
      const raw=[
        {iteration:1,qualitySetting:36,sampleBitrate:2e6,ssim:.930,averageSsim:.945,meetsTarget:false,sampleMeasurements:[{ssim:.930},{ssim:.960}]},
        {iteration:2,qualitySetting:20,sampleBitrate:12e6,ssim:.985,averageSsim:.991,meetsTarget:true,sampleMeasurements:[{ssim:.985},{ssim:.997}]},
        {iteration:3,qualitySetting:28,sampleBitrate:6e6,ssim:.977,averageSsim:.982,meetsTarget:false,sampleMeasurements:[{ssim:.977},{ssim:.987}]},
        {iteration:4,qualitySetting:24,sampleBitrate:8e6,ssim:.983,averageSsim:.988,meetsTarget:true,sampleMeasurements:[{ssim:.983},{ssim:.993}]}
      ];
      const frontier=createSizeQualityFrontier(fitRateDistortionModel(raw),{durationSeconds:25200});
      const p=buildSizeFrontierPlot(frontier,{selectedTargetBytes:frontier.minimumEvidenceTargetBytes});
      document.querySelector('#charts').innerHTML=[
        '<div><strong>体积—质量曲线 · 原始观测与保序拟合</strong><div class="media-curve-viewport"><svg id="efficiency" viewBox="0 0 720 300">'+renderRateDistortionSvg(p)+'</svg></div><div class="media-curve-legend"><span class="legend-observed">原始观测</span><span class="legend-fit">保序拟合</span><span class="legend-band">范围插值</span><span class="legend-whisker">场景范围</span></div></div>'
      ].join('');
    });
    await page.evaluate(()=>document.fonts.ready);
    const overflow=()=>page.evaluate(()=>[...document.querySelectorAll('svg text')].filter(el=>{
      const b=el.getBBox(),v=el.closest('svg').viewBox.baseVal;
      return b.x<0 || b.y<0 || b.x+b.width>v.width || b.y+b.height>v.height;
    }).map(el=>el.textContent));
    assert.deepEqual(await overflow(),[],'Chart labels must stay inside the SVG');
    assert.equal(await page.locator('#efficiency .curve-observation').count(),4);
    assert.equal(await page.locator('svg').count(),1,'The calibration UI has one visible curve');
    assert.ok((await page.locator('#efficiency .curve-selection-label').textContent()).includes('估计'));
    await page.screenshot({path:'media-workspace-curves-design-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.deepEqual(await overflow(),[]);
    const geometry=await page.evaluate(()=>({
      document:document.documentElement.scrollWidth,width:innerWidth,
      charts:[...document.querySelectorAll('.media-curve-viewport')].map(el=>({width:el.clientWidth,scroll:el.scrollWidth}))
    }));
    assert.ok(geometry.document<=geometry.width,'Narrow charts must not overflow the whole page');
    assert.equal(geometry.charts.length,1);
    assert.ok(geometry.charts.every(c=>c.scroll>c.width),'Narrow curve keeps local scrolling');
    await page.screenshot({path:'media-workspace-curves-design-mobile.png',fullPage:true});
    // Separate synthetic multibranch preview: one foreground decision curve and
    // two bounded candidate context lines, never two independent control charts.
    await page.setViewportSize({width:1280,height:900});
    await page.evaluate(async()=>{
      const {fitRateDistortionModel}=await import('/src/rate-distortion-model.js');
      const {createMultiBranchFrontier}=await import('/src/compression-decision.js');
      const {buildSizeFrontierPlot}=await import('/src/size-frontier-ui.js');
      const {renderRateDistortionSvg}=await import('/src/curve-chart-svg.js');
      const branch=(id,values)=>({
        id,measurementScope:'synthetic-common-reference',
        model:fitRateDistortionModel(values.map(([sampleBitrate,ssim])=>({sampleBitrate,ssim})))
      });
      const f=createMultiBranchFrontier([
        branch('H264',[[1e6,.915],[2e6,.951],[3e6,.962]]),
        branch('HEVC',[[1e6,.927],[2e6,.947],[3e6,.975]])
      ],{durationSeconds:120,audioBitrate:0,reservePercent:0});
      if(!f.ok)throw Error('Synthetic multibranch model invalid: '+f.reason);
      const plot=buildSizeFrontierPlot(f,{selectedTargetBytes:
        Math.sqrt(f.minimumEvidenceTargetBytes*f.maximumEvidenceTargetBytes)});
      document.querySelector('h2').textContent='单张主决策曲线 · 候选方案参考线（合成测试数据）';
      document.querySelector('#efficiency').innerHTML=renderRateDistortionSvg(plot);
    });
    assert.equal(await page.locator('svg').count(),1);
    assert.equal(await page.locator('#efficiency .curve-fit').count(),1);
    assert.equal(await page.locator('#efficiency .curve-branch-ghost').count(),2);
    assert.deepEqual(await overflow(),[]);
    await page.screenshot({path:'media-workspace-branch-context-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('svg').count(),1);
    assert.deepEqual(await overflow(),[]);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'media-workspace-branch-context-mobile.png',fullPage:true});
    console.log('Bounded comparison reference curves checked in synthetic desktop/mobile fixture');
    // Independent Playwright UI interaction fixture: mock Native transport
    // but exercise the real Manual panel and session/decision model.
    await page.setViewportSize({width:1280,height:900});
    await page.evaluate(async()=>{
      const {mountTranscodeCurves}=await import('/src/transcode-calibration-panel.js');
      // Earlier static-curve fixture has already been captured and checked.
      // Remove it so this screenshot represents ONLY the Manual workspace.
      document.querySelector('main>h2')?.remove();
      document.querySelector('#charts')?.remove();
      const section=document.createElement('section');
      section.id='manual-compare-test';
      section.innerHTML='<div id="taskEncoding"></div>';
      document.querySelector('main').append(section);
      const media={duration:6,videoTracks:1,videoCodec:'h264',fps:30,
        videoStreams:[{ordinal:0,width:320,height:180,codec:'h264',pixelFormat:'yuv420p',bitDepth:8}],
        audioTracks:0,audioStreams:[]};
      const raw={operation:'transcode',codec:'h264',encoder:'libx264',preset:'medium',
        rateMode:'quality',quality:23,start:0,end:'',videoStreams:'0',videoRange:'trim',
        audio:'none',audioTrack:'all',audioRange:'trim',subtitleRange:'trim',
        fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'lanczos',
        rotation:'none',deinterlace:'none',multipass:'disabled',outputContainer:'mkv',
        lookahead:'',aqStrength:''};
      let busy=false,applied=0,sampleCalls=0;
      let budgetEvidence=null;
      const hooks={
        budgetEvidence:()=>budgetEvidence,
        settings:()=>raw,sourceIdentity:()=> 'synthetic-playwright-source',
        mediaSnapshot:()=>media,prepare:async()=>media,validate:async()=>{},
        isWindows:()=>true,busy:()=>busy,setBusy:v=>{busy=v;},
        applyQuality:()=>{applied++;},applyBitrate:()=>{applied++;},
        adoptCandidate:({candidate,bitrate,wholeBudget,expectedSettings,expectedSourceIdentity})=>{
          if(JSON.stringify(raw)!==JSON.stringify(expectedSettings)||
             expectedSourceIdentity!=='synthetic-playwright-source')
            return {ok:false,reason:'stale-adoption-settings'};
          Object.assign(raw,{codec:candidate.codec,encoder:candidate.encoder,
            preset:candidate.preset,...(candidate.scaleAlgorithm==='bicubic'?{width:candidate.outputWidth,height:candidate.outputHeight,scaleAlgorithm:'bicubic'}:{}),rateMode:'bitrate',bitrate:String(bitrate),
            multipass:'disabled',twoPass:false,...(wholeBudget?{rateMode:'size',targetSize:wholeBudget.targetBytes/1e6,sizeUnit:'MB',sizeReserve:wholeBudget.reservePercent,budgetPolicy:wholeBudget.budgetPolicy}:{})});
          applied++;
          return {ok:true};
        },
        log:()=>{},
        calibrationSample:async({codec,encoder,preset,multipass,quality,start,duration,mode='quality',bitrate,commonReference,outputWidth,outputHeight,referenceWidth,referenceHeight})=>{
          sampleCalls++;
          const isVbr=mode==='bitrate';
          const rate=isVbr?bitrate:({18:1600000,28:850000,40:420000})[quality]*
            (encoder==='libx265'?.91:1)*(preset==='fast'?.9:1);
          const ssim=isVbr?.99:({18:.988,28:.95,40:.91})[quality]+
            (encoder==='libx265'?.004:0);
          return {encoder,ssim,duration,elapsedSeconds:.02,
            totalVideoBytes:Math.round(rate*duration/8),
            nativeEvidence:{
              schemaVersion:1,method:isVbr?'windows-native-exact-vbr-v1':'windows-native-exact-cq-v1',
              referenceMetric:commonReference?'source-sdr-bicubic-upscale-ssim-v1':'source-sdr-yuv420p-ssim-v1',
              outputWidth,outputHeight,referenceWidth,referenceHeight,
              sourceToken:'stat-sha256:playwright-source',
              runtimeToken:'stat-sha256:playwright-runtime',
              referenceToken:'direct-source-v0-yuv420p-setpts-ssim-v1',
              filterToken:'no-video-filters-sdr-yuv420p-v1',
              identityKind:'file-stat-snapshot-not-content-hash',
              videoStream:0,pixelFormat:'yuv420p',mode:isVbr?'bitrate':'quality',
              requestedRate:isVbr?bitrate:0,requestedQuality:isVbr?null:quality,
              requestedStart:start,requestedDuration:duration,
              actualDuration:duration,encoder,preset,multipass
            }};
        }
      };
      mountTranscodeCurves(section,hooks);
      window.__curveMock={media,get sampleCalls(){return sampleCalls;},get applied(){return applied;},section,raw,hooks,setBudget:v=>{budgetEvidence=v;}};
    });
    assert.equal(await page.locator('#manual-compare-test svg').count(),1,
      'Optional codec comparison must reuse the one Manual SVG');
    await page.locator('#taskCompareStart').click();
    await page.waitForFunction(()=>/双编码器实测完成|本次对比不可用于推荐/.test(
      document.querySelector('#taskCompareStatus')?.textContent||''
    ),{timeout:15000});
    const compareStatus=await page.locator('#taskCompareStatus').textContent();
    assert.match(compareStatus,/双编码器实测完成/,
      'Native-mocked browser test must complete and render a comparable model: '+compareStatus);
    assert.equal(await page.locator('svg').count(),1);
    assert.equal(await page.locator('#manual-compare-test svg').count(),1);
    assert.equal(await page.locator('#taskCompareCandidates li').count(),2);
    assert.equal(await page.locator('#taskCompareDetails').getAttribute('open'),'');
    assert.equal(await page.locator('#taskVerifyCurveRate').isVisible(),false);
    assert.equal(await page.locator('#taskExploreCurve').isVisible(),false);
    assert.equal(await page.locator('.media-curve-legend .legend-fit').textContent(),'候选择优上包络');
    assert.equal(await page.locator('#taskEfficiencyChart .curve-fit').count(),1);
    // A decision-threshold-only change must reuse costly completed evidence.
    await page.evaluate(()=>{
      const target=document.querySelector('#taskExploreTarget');
      target.value='0.975';
      target.dispatchEvent(new Event('input',{bubbles:true}));
    });
    assert.equal(await page.locator('#taskCompareCandidates li').count(),2);
    assert.equal(await page.locator('#taskEfficiencyChart .curve-fit').count(),1);
    await page.locator('#taskEfficiencyChart').focus();
    await page.keyboard.press('ArrowRight');
    assert.ok((await page.locator('#taskCurveReadout').textContent()).includes('当前建议'));
    assert.equal(await page.evaluate(()=>window.__curveMock.applied),0,
      'Read-only comparison must never automatically adopt codec or bitrate');
    await page.locator('#taskCompareVerify').click();
    await page.waitForFunction(()=>/VBR 短样已验证|VBR 验证失败/.test(
      document.querySelector('#taskCompareStatus')?.textContent||''
    ));
    const verified=await page.locator('#taskCompareStatus').textContent();
    assert.match(verified,/VBR 短样已验证/,
      'Browser-mocked VBR must pass reference and window receipt admission: '+verified);
    assert.match(verified,/正式编码方案仍未改变/);
    assert.match(await page.locator('#taskCurveReadout').textContent(),/VBR 短样已通过/);
    assert.doesNotMatch(await page.locator('#taskCurveReadout').textContent(),/未执行目标码率验证/);
    assert.equal(await page.evaluate(()=>window.__curveMock.applied),0);
    assert.equal(await page.locator('#taskCompareAdopt').isVisible(),true);
    await page.screenshot({path:'media-workspace-manual-compare-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.deepEqual(await overflow(),[],
      'Candidate curve labels must fit the single SVG on small screens');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),
      'Optional comparison must not create global horizontal overflow');
    await page.screenshot({path:'media-workspace-manual-compare-mobile.png',fullPage:true});
    await page.locator('#taskEfficiencyChart').focus();
    await page.keyboard.press('ArrowLeft');
    assert.doesNotMatch(await page.locator('#taskCurveReadout').textContent(),/VBR 短样已通过/);
    assert.match(await page.locator('#taskCurveReadout').textContent(),/未执行目标码率验证/);
    assert.match(await page.locator('#taskCompareStatus').textContent(),/预算已改变/);
    assert.equal(await page.locator('#taskCompareAdopt').isVisible(),false);
    await page.locator('#taskCompareSingle').click();
    assert.equal(await page.locator('#taskCompareSingle').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.__curveMock.applied),0);
    // A new matched CQ/VBR certificate can be explicitly adopted. Nothing
    // changes before this confirm button is clicked.
    await page.locator('#taskCompareStart').click();
    await page.waitForFunction(()=>/双编码器实测完成|本次对比不可用于推荐/.test(
      document.querySelector('#taskCompareStatus')?.textContent||''
    ));
    assert.match(await page.locator('#taskCompareStatus').textContent(),/双编码器实测完成/);
    await page.locator('#taskCompareVerify').click();
    await page.waitForFunction(()=>/VBR 短样已验证|VBR 验证失败/.test(
      document.querySelector('#taskCompareStatus')?.textContent||''
    ));
    assert.match(await page.locator('#taskCompareStatus').textContent(),/VBR 短样已验证/);
    assert.equal(await page.evaluate(()=>window.__curveMock.applied),0);
    await page.locator('#taskCompareAdopt').click();
    await page.waitForFunction(()=>/已按明确确认写入|未写入编码方案/.test(
      document.querySelector('#taskCompareStatus')?.textContent||''
    ));
    assert.match(await page.locator('#taskCompareStatus').textContent(),/已按明确确认写入/);
    assert.equal(await page.evaluate(()=>window.__curveMock.applied),1);
    const committed=await page.evaluate(()=>window.__curveMock.raw);
    assert.equal(committed.rateMode,'size');
    assert.ok(+committed.targetSize>0);
    assert.equal(committed.multipass,'disabled');
    assert.ok(['libx264','libx265'].includes(committed.encoder));
    assert.ok(+committed.bitrate>0);
    assert.equal(await page.locator('#taskCompareAdopt').isVisible(),false);
    await page.locator('#taskComparePolicy').selectOption('codecs-presets');
    assert.equal(await page.locator('#taskCompareCandidates li').count(),0,'candidate policy change clears old evidence');
    await page.locator('#taskCompareStart').click();
    await page.waitForFunction(()=>/编码器与 preset 实测完成|本次对比未形成/.test(document.querySelector('#taskCompareStatus')?.textContent||''));
    assert.match(await page.locator('#taskCompareStatus').textContent(),/编码器与 preset 实测完成.*24 次/);
    assert.equal(await page.locator('#taskCompareCandidates li').count(),4);
    assert.equal(await page.evaluate(()=>window.__curveMock.applied),1,'four-candidate comparison cannot auto-apply');
    await page.locator('#taskCompareVerify').click();
    await page.waitForFunction(()=>/VBR 短样已验证|VBR 验证失败/.test(document.querySelector('#taskCompareStatus')?.textContent||''));
    assert.match(await page.locator('#taskCompareStatus').textContent(),/VBR 短样已验证/);
    await page.locator('#taskCompareAdopt').click();
    await page.waitForFunction(()=>/已按明确确认写入|未写入编码方案/.test(document.querySelector('#taskCompareStatus')?.textContent||''));
    assert.equal(await page.evaluate(()=>window.__curveMock.raw.preset),'fast');
    assert.equal(await page.evaluate(()=>window.__curveMock.applied),2);
    await page.evaluate(()=>{window.__curveMock.media.videoStreams[0].width=3840;window.__curveMock.media.videoStreams[0].height=2160;});
    await page.locator('#taskComparePolicy').selectOption('codecs-presets-resolutions');
    await page.locator('#taskCompareStart').click();
    await page.waitForFunction(()=>/实测完成|本次对比不可用于推荐/.test(document.querySelector('#taskCompareStatus')?.textContent||''));
    assert.match(await page.locator('#taskCompareStatus').textContent(),/实测完成.*72 次/);
    assert.equal(await page.locator('#taskCompareCandidates li').count(),12);
    await page.locator('#taskCompareVerify').click();
    await page.waitForFunction(()=>/VBR 短样已验证|VBR 验证失败/.test(document.querySelector('#taskCompareStatus')?.textContent||''));
    assert.match(await page.locator('#taskCompareStatus').textContent(),/VBR 短样已验证/);
    await page.locator('#taskCompareAdopt').click();
    await page.waitForFunction(()=>/已按明确确认写入|未写入编码方案/.test(document.querySelector('#taskCompareStatus')?.textContent||''));
    assert.match(await page.locator('#taskCompareStatus').textContent(),/已按明确确认写入/);
    assert.equal(await page.evaluate(()=>window.__curveMock.raw.scaleAlgorithm),'bicubic');
    assert.ok(await page.evaluate(()=>[2160,1080,720].includes(+window.__curveMock.raw.height)));
    assert.equal(await page.evaluate(()=>window.__curveMock.applied),3);
    await page.evaluate(()=>{window.__curveMock.raw.width='';window.__curveMock.raw.height='';});
    // Same video measurements support two coordinates; no new encodes on axis switch.
    await page.evaluate(()=>{const s=window.__curveMock;s.raw.rateMode='quality';s.raw.audio='copy';s.raw.keepAttachments=true;s.raw.attachmentStreams='all';s.raw.budgetPolicy='strict-ceiling';s.media.audioTracks=1;s.media.audioStreams=[{codec:'flac'}];s.media.attachmentTracks=1;s.setBudget(null);});
    await page.locator('#taskCompareStart').click();
    await page.waitForFunction(()=>/本次对比不可用于推荐/.test(document.querySelector('#taskCompareStatus').textContent));
    assert.match(await page.locator('#taskCompareStatus').textContent(),/成本未知/);
    await page.evaluate(()=>window.__curveMock.setBudget({version:1,scope:'full-source',audioPacketBytes:[100000],attachmentBytes:[10000]}));
    await page.locator('#taskCompareStart').click();
    await page.waitForFunction(()=>/实测完成|本次对比不可用于推荐/.test(document.querySelector('#taskCompareStatus').textContent));
    assert.match(await page.locator('#taskCurveReadout').textContent(),/成品目标体积.*固定流\/附件/);
    await page.locator('#taskCompareVerify').click();
    await page.waitForFunction(()=>/VBR 短样已验证|VBR 验证失败/.test(document.querySelector('#taskCompareStatus').textContent));
    assert.match(await page.locator('#taskCompareStatus').textContent(),/VBR 短样已验证/);
    const beforeAxis=await page.evaluate(()=>window.__curveMock.sampleCalls);
    await page.locator('#taskCompareBudgetBasis').selectOption('video');
    assert.equal(await page.locator('#taskCompareAdopt').isVisible(),false);
    assert.match(await page.locator('#taskCurveReadout').textContent(),/视频估算预算/);
    await page.locator('#taskCompareBudgetBasis').selectOption('whole');
    assert.match(await page.locator('#taskCurveReadout').textContent(),/成品目标体积/);
    assert.equal(await page.evaluate(()=>window.__curveMock.sampleCalls),beforeAxis,'axis projection cannot rerun CQ measurement');
    await page.locator('#taskCompareVerify').click();
    await page.waitForFunction(()=>/VBR 短样已验证|VBR 验证失败/.test(document.querySelector('#taskCompareStatus').textContent));
    await page.locator('#taskCompareAdopt').click();
    await page.waitForFunction(()=>/已按明确确认写入|未写入编码方案/.test(document.querySelector('#taskCompareStatus').textContent));
    assert.equal(await page.evaluate(()=>window.__curveMock.raw.budgetPolicy),'strict-ceiling');
    assert.equal(await page.evaluate(()=>window.__curveMock.raw.rateMode),'size');
    assert.equal(await page.evaluate(()=>window.__curveMock.applied),4);
    await page.evaluate(()=>{const s=window.__curveMock;s.raw.width='';s.raw.height='';s.raw.audio='none';s.raw.keepAttachments=false;s.raw.rateMode='quality';s.raw.budgetPolicy='best-effort';});
    // Fail closed for a source/processing setting that cannot be reproduced
    // by the exact SDR/yuv420p native sample protocol.
    await page.evaluate(()=>{window.__curveMock.raw.pixelFormat='p010le';});
    await page.locator('#taskCompareStart').click();
    await page.waitForFunction(()=>/本次对比不可用于推荐/.test(
      document.querySelector('#taskCompareStatus')?.textContent||''
    ));
    assert.match(await page.locator('#taskCompareStatus').textContent(),/无额外滤镜/);
    assert.equal(await page.locator('#taskEfficiencyChart .curve-fit').count(),0);
    assert.equal(await page.evaluate(()=>window.__curveMock.applied),4);
    console.log('Single curve + Manual native-mocked comparison: desktop, phone, keyboard, and fail-closed unsupported protocol passed');
  } finally {await page.close();}
};
