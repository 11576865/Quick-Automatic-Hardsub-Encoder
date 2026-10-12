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
      let busy=false,applied=0;
      const hooks={
        settings:()=>raw,sourceIdentity:()=> 'synthetic-playwright-source',
        mediaSnapshot:()=>media,prepare:async()=>media,validate:async()=>{},
        isWindows:()=>true,busy:()=>busy,setBusy:v=>{busy=v;},
        applyQuality:()=>{applied++;},applyBitrate:()=>{applied++;},
        log:()=>{},
        calibrationSample:async({codec,encoder,preset,quality,start,duration})=>{
          const rate=({18:1600000,28:850000,40:420000})[quality]*
            (encoder==='libx265'?.91:1);
          const ssim=({18:.988,28:.95,40:.91})[quality]+
            (encoder==='libx265'?.004:0);
          return {encoder,ssim,duration,elapsedSeconds:.02,
            totalVideoBytes:Math.round(rate*duration/8),
            nativeEvidence:{
              schemaVersion:1,method:'windows-native-exact-cq-v1',
              referenceMetric:'source-sdr-yuv420p-ssim-v1',
              sourceToken:'stat-sha256:playwright-source',
              runtimeToken:'stat-sha256:playwright-runtime',
              referenceToken:'direct-source-v0-yuv420p-setpts-ssim-v1',
              filterToken:'no-video-filters-sdr-yuv420p-v1',
              identityKind:'file-stat-snapshot-not-content-hash',
              videoStream:0,pixelFormat:'yuv420p',mode:'quality',
              requestedRate:0,requestedQuality:quality,
              requestedStart:start,requestedDuration:duration,
              actualDuration:duration,encoder,preset
            }};
        }
      };
      mountTranscodeCurves(section,hooks);
      window.__curveMock={get applied(){return applied;},section,raw};
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
    await page.locator('#taskExploreTarget').fill('0.975');
    assert.equal(await page.locator('#taskCompareCandidates li').count(),2);
    assert.equal(await page.locator('#taskEfficiencyChart .curve-fit').count(),1);
    await page.locator('#taskEfficiencyChart').focus();
    await page.keyboard.press('ArrowRight');
    assert.ok((await page.locator('#taskCurveReadout').textContent()).includes('当前建议'));
    assert.equal(await page.evaluate(()=>window.__curveMock.applied),0,
      'Read-only comparison must never automatically adopt codec or bitrate');
    await page.screenshot({path:'media-workspace-manual-compare-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.deepEqual(await overflow(),[],
      'Candidate curve labels must fit the single SVG on small screens');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),
      'Optional comparison must not create global horizontal overflow');
    await page.screenshot({path:'media-workspace-manual-compare-mobile.png',fullPage:true});
    await page.locator('#taskCompareSingle').click();
    assert.equal(await page.locator('#taskCompareSingle').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.__curveMock.applied),0);
    // Fail closed for a source/processing setting that cannot be reproduced
    // by the exact SDR/yuv420p native sample protocol.
    await page.evaluate(()=>{window.__curveMock.raw.pixelFormat='p010le';});
    await page.locator('#taskCompareStart').click();
    await page.waitForFunction(()=>/本次对比不可用于推荐/.test(
      document.querySelector('#taskCompareStatus')?.textContent||''
    ));
    assert.match(await page.locator('#taskCompareStatus').textContent(),/无额外滤镜/);
    assert.equal(await page.locator('#taskEfficiencyChart .curve-fit').count(),0);
    assert.equal(await page.evaluate(()=>window.__curveMock.applied),0);
    console.log('Single curve + Manual native-mocked comparison: desktop, phone, keyboard, and fail-closed unsupported protocol passed');
  } finally {await page.close();}
};
