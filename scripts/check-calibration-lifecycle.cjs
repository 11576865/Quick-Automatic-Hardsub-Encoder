const assert = require('node:assert/strict');

// Mount the production panel in a real DOM. Only the native media boundary is
// simulated: deferred promises make changes during each await deterministic.
module.exports = async function checkCalibrationLifecycle(browser, baseUrl) {
  const page = await browser.newPage();
  await page.route('**/calibration-lifecycle-test', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body></body></html>'
  }));
  await page.goto(baseUrl + '/calibration-lifecycle-test');
  const setup = async stage => page.evaluate(async stage => {
    const { mountTranscodeCurves } = await import('/src/transcode-calibration-panel.js');
    document.body.innerHTML = '<section id="host"><div id="taskEncoding"></div></section>';
    const state = window.calibrationTest = {
      stage, source: 'video-A', busy: false, validations: 0, samples: 0, applied: [],
      raw: {
        operation:'transcode',codec:'h264',encoder:'libx264',preset:'medium',
        rateMode:'quality',quality:23,start:0,end:'',videoStreams:'0',videoRange:'trim',
        audio:'none',audioTrack:'all',audioRange:'trim',subtitleRange:'trim',
        fpsMode:'auto',pixelFormat:'yuv420p',rotation:'none',deinterlace:'none',
        multipass:'fullres',outputContainer:'mkv'
      }
    };
    const hold = async at => {
      if (state.stage !== at) return;
      state.waiting = at;
      await new Promise(resolve => { state.release = resolve; });
      state.waiting = null;
    };
    state.controller = mountTranscodeCurves(document.querySelector('#host'), {
      settings:()=>({...state.raw}),sourceIdentity:()=>state.source,
      busy:()=>state.busy,isWindows:()=>true,setBusy:v=>{state.busy=v;},
      prepare:async()=>{
        await hold('prepare');
        return {duration:60,fps:30,width:320,height:180,pixelFormat:'yuv420p',
          videoTracks:1,videoCodec:'h264',audioTracks:0,formatName:'matroska',
          videoStreams:[{ordinal:0,codec:'h264',width:320,height:180,fps:30,
            pixelFormat:'yuv420p',bitDepth:8,unsafeColorPipeline:false}]};
      },
      validate:async()=>{state.validations++;await hold('validate');},
      calibrationSample:async({quality,duration,mode})=>{
        state.samples++;
        await hold('sample');
        return {ssim:Object.hasOwn(state,'sampleOverride')?state.sampleOverride:
          mode==='bitrate'?.998:1-quality/1000,
          totalVideoBytes:(64-quality)*1000,duration,elapsedSeconds:.1};
      },
      applyQuality:q=>state.applied.push(['quality',q]),
      applyBitrate:b=>state.applied.push(['bitrate',b])
    });
    document.querySelector('#taskCurveProfile').value='quick';
  }, stage);
  const start = () => page.click('#taskExploreCurve');
  const settle = () => page.waitForFunction(()=>!window.calibrationTest.busy);
  const hold = stage => page.waitForFunction(stage=>window.calibrationTest.waiting===stage,stage);
  const release = () => page.evaluate(()=>{
    const s=window.calibrationTest;s.stage='';s.release();
  });
  try {
    await setup('prepare');await start();await hold('prepare');
    await page.evaluate(()=>{
      const s=window.calibrationTest;s.raw.preset='slow';s.controller.invalidate();
    });
    await release();await settle();
    assert.equal(await page.evaluate(()=>window.calibrationTest.validations),0,
      'Changing settings during prepare must stop before validating the obsolete task');
    assert.equal(await page.evaluate(()=>window.calibrationTest.samples),0);

    await setup('validate');await start();await hold('validate');
    await page.evaluate(()=>{window.calibrationTest.source='video-B';});
    await release();await settle();
    assert.equal(await page.evaluate(()=>window.calibrationTest.samples),0,
      'A source change during validation must not sample a different input');

    await setup('sample');await start();await hold('sample');
    // Number inputs emit input before blur/change. Stop before the next sample.
    await page.fill('#taskExploreTarget','0.990');
    await release();await settle();
    assert.equal(await page.evaluate(()=>window.calibrationTest.samples),1,
      'Editing the SSIM target must discard the pending sample immediately');
    assert.equal(await page.locator('.media-curve-measurement').count(),0);

    await setup('');await start();await settle();
    assert.ok(await page.locator('.media-curve-measurement').count()>1);
    const beforeReuse = await page.evaluate(()=>({
      samples:window.calibrationTest.samples,
      count:document.querySelectorAll('.media-curve-measurement').length
    }));
    await page.fill('#taskExploreTarget','0.995');
    assert.deepEqual(await page.evaluate(()=>({
      samples:window.calibrationTest.samples,
      count:document.querySelectorAll('.media-curve-measurement').length
    })),beforeReuse,'Changing a completed SSIM target must reuse the same measured points');
    assert.match(await page.locator('#taskCurveStatus').textContent(),/无需重新试压/);
    await page.evaluate(()=>{const s=window.calibrationTest;s.raw.audio='aac';s.raw.audioBitrate='192000';s.controller.invalidate();});
    assert.deepEqual(await page.evaluate(()=>({
      samples:window.calibrationTest.samples,
      count:document.querySelectorAll('.media-curve-measurement').length
    })),beforeReuse,'Audio-budget changes must retain existing video quality observations');
    await page.click('#taskMeasuredQualitySummary');
    await page.locator('.media-curve-measurement button').first().click();
    assert.equal(await page.evaluate(()=>window.calibrationTest.applied.length),1,
      'Current evidence must remain usable');
    assert.equal(await page.locator('#taskAdoptCurveRate').isDisabled(),true,
      'CQ predictions alone must not enable VBR adoption');
    await page.click('#taskVerifyCurveRate');
    await settle(); // Click dispatches an async native-sampling handler; wait for its final render.
    assert.equal(await page.locator('#taskAdoptCurveRate').isDisabled(),false,
      await page.locator('#taskCurveStatus').textContent());
    await page.click('#taskAdoptCurveRate');
    assert.equal(await page.evaluate(()=>window.calibrationTest.applied[1]?.[0]),'bitrate',
      'Current measured frontier must allow adopting bitrate');
    await page.evaluate(()=>{window.calibrationTest.busy=true;});
    await page.locator('.media-curve-measurement button').first().click();
    await page.click('#taskAdoptCurveRate');
    assert.equal(await page.evaluate(()=>window.calibrationTest.applied.length),2,
      'Another active media operation must block both adoption actions');
    await page.evaluate(()=>{window.calibrationTest.busy=false;});
    // A source identity can change without a form event. Guard at activation.
    await page.evaluate(()=>{window.calibrationTest.source='video-B';});
    await page.locator('.media-curve-measurement button').first().click();
    await page.click('#taskAdoptCurveRate');
    assert.equal(await page.evaluate(()=>window.calibrationTest.applied.length),2,
      'Stale evidence must not change quality or bitrate');

    await setup('');await page.evaluate(()=>{window.calibrationTest.sampleOverride=false;});
    await start();await settle();
    assert.equal(await page.locator('.media-curve-measurement').count(),0,
      'A boolean SSIM returned from the native boundary must never become measured zero');
    assert.match(await page.locator('#taskCurveStatus').textContent(),/缺少有效 SSIM/);

    await setup('sample');await start();await hold('sample');
    await page.evaluate(()=>window.calibrationTest.controller.dispose());
    await release();await settle();
    assert.equal(await page.evaluate(()=>window.calibrationTest.samples),1,
      'Unmounting the panel must stop further native samples');
    console.log('Calibration lifecycle: stale fences, completed evidence reuse, raw validation, adoption, dispose passed');
  } finally { await page.close(); }
};
