// WU05 real Chromium DOM: a completed source-owned Copy Trim exposes a
// read-only FFprobe receipt. Native transport is controlled in this browser
// test; separate Windows acceptance must run a real FFmpeg/FFprobe chain.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
async function main(){
 const port=4193,base='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js',
  '--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  let logs='',up=false;
  server.stdout.on('data',v=>logs+=v);server.stderr.on('data',v=>logs+=v);
  for(let i=0;i<95;i++){try{if((await fetch(base)).ok){up=true;break}}catch{}
    await new Promise(r=>setTimeout(r,200));
  }
  if(!up)throw Error('Vite unavailable '+logs);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:850}});
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
    window.alert=()=>{};
    window.timelineSource='cut-video-A';
    window.timelineJobId='job-a';
    window.timelineCalls=0;
    window.timelineWrites=0;
    window.lastReportBlob=null;
    const original=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{
      if(blob.type==='application/json')window.lastReportBlob=blob;
      return original(blob);
    };
    window.timelineMedia={duration:6,sourceName:'clip.mkv',videoTracks:1,
      audioTracks:1,formatName:'matroska',videoCodec:'h264',fps:12,
      videoStreams:[{codec:'h264',width:320,height:180,fps:12,pixelFormat:'yuv420p'}],
      audioStreams:[{codec:'aac',channels:1,sampleRate:48000}]};
    window.timelineUI=mountMediaWorkspace({
      isWindows:()=>true,hasNvenc:()=>false,platformKey:()=>({}),
      sourceName:()=>window.timelineMedia.sourceName,
      videoIdentity:()=>window.timelineSource,
      mediaSnapshot:()=>window.timelineMedia,
      busy:()=>false,setBusy:()=>{},log:()=>{},
      prepare:async()=>window.timelineMedia,
      run:async(task,media,progress)=>{
        window.timelineWrites++;
        progress?.(1,'completed');
        return {task,jobId:window.timelineJobId,name:'trim.mkv',
          verified:true,outputBytes:251257,outputDuration:task.expectedDuration,
          actualStart:2};
      },
      inspectCutTimeline:async jobId=>{
        window.timelineCalls++;
        return {ok:true,version:1,scope:'completed-artifact-first-boundary',
          jobId:window.timelineCalls===1?'wrong-job':jobId,
          artifactBytes:251257,artifactWriteTicks:'123456',executionSeekIn:2,
          actualFirstPresentation:.04,firstVideoPacketPts:.08,
          firstVideoPacketDts:0,
          audioTimeMapping:[{outputOrdinal:0,outputFirstPts:-.021,outputFirstDts:-.021}],
          copiedPacketRange:null,
          verificationStatus:'output-first-boundary-observed-source-packet-and-sync-unverified'};
      },
      save:()=>({pending:true,jobId:window.timelineJobId})
    });
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  await page.locator('[data-media-mode="copy"]').click();
  await page.locator('[name="start"]').fill('3.500');
  await page.locator('[name="end"]').fill('5.500');
  await page.locator('[name="start"]').dispatchEvent('change');
  await page.locator('#taskRun').click();
  await page.waitForFunction(()=>
    window.timelineWrites===1&&document.querySelector('#mediaWorkspace').dataset.taskState==='verified',
    null,{timeout:15000});
  const panel=page.locator('#taskCompletedCutTimeline');
  if(await panel.isHidden())throw Error('Completed Native Copy Trim has no real-artifact timeline action');
  await page.locator('#taskInspectCutTimeline').click();
  await page.waitForFunction(()=>document.querySelector('#taskCompletedCutTimelineEvidence')
    ?.textContent?.includes('检查不可用'));
  if(await page.locator('#taskSave').isDisabled())
    throw Error('Bad optional timeline receipt incorrectly blocks saving a verified artifact');
  await page.locator('#taskInspectCutTimeline').click();
  await page.waitForFunction(()=>document.querySelector('#taskCompletedCutTimelineEvidence')
    ?.textContent?.includes('首个视频编码包'));
  if(await page.evaluate(()=>window.timelineWrites)!==1)
    throw Error('Timeline inspection caused a second encode');
  const visible=await page.locator('#taskCompletedCutTimelineEvidence').textContent();
  if(!visible.includes('0.040')||!visible.includes('0.080 / 0.000')||
     !visible.includes('-0.021 / -0.021')||!visible.includes('源包区间映射与整片同步：未验证'))
    throw Error('Output timestamp fields missing/misrepresented: '+visible);
  await page.locator('#taskReport').click();
  const report=await page.evaluate(async()=>JSON.parse(await window.lastReportBlob.text()));
  if(report.cutTimelineEvidence?.actualFirstPresentation!==.04||
     report.cutTimelineEvidence?.copiedPacketRange!==null||
     report.cutTimelineEvidence?.verificationStatus!=='output-first-boundary-observed-source-packet-and-sync-unverified')
    throw Error('Output artifact receipt not exported through existing task report');
  await page.evaluate(()=>{
    window.timelineSource='other-source';
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  if(!(await panel.isHidden()))
    throw Error('Stale source can still inspect the previous completed artifact');
  console.log('WU05 Chromium optional completed cut timeline inspection + report + source drift guard PASS (controlled transport)');
 }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
