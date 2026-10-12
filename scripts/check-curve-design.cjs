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
    console.log('Single decision curve and synthetic multi-branch context: desktop/mobile bounds passed');
  } finally {await page.close();}
};
