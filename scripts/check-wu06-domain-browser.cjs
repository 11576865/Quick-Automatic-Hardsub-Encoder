// WU06: real Chromium exercises the production plan inspector. It must remain
// a READ-ONLY projection of the same compiler and never run or mutate output.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
async function main(){
 const port=4195,base='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js',
   '--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  let up=false,logs='';
  server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
  for(let i=0;i<95;i++){try{if((await fetch(base)).ok){up=true;break}}catch{}
   await new Promise(r=>setTimeout(r,200));
  }
  if(!up)throw Error('Vite startup failed: '+logs);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:850}});
  await page.goto(base);
  await page.locator('#mediaWorkspace').waitFor({state:'attached'});
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
    window.qheSource='p1-rich-mkv-source';
    window.qheRuns=0;
    window.qheMedia={
      duration:6,sourceName:'multi.mkv',videoTracks:1,audioTracks:2,
      subtitleTracks:1,attachmentTracks:1,formatName:'matroska',
      videoCodec:'ffv1',fps:12,
      videoStreams:[{codec:'ffv1',width:320,height:180,fps:12,pixelFormat:'yuv420p'}],
      audioStreams:[{codec:'flac',channels:2},{codec:'aac',channels:2}],
      subtitleStreams:[{codec:'ass',tags:{language:'eng'}}],
      attachmentStreams:[{codec:'ttf',tags:{filename:'font.ttf'}}]
    };
    window.qheUI=mountMediaWorkspace({
      isWindows:()=>false,hasNvenc:()=>false,platformKey:()=>({}),
      videoIdentity:()=>window.qheSource,mediaSnapshot:()=>window.qheMedia,
      sourceName:()=>window.qheMedia.sourceName,guidedSnapshot:()=>null,
      busy:()=>false,setBusy:()=>{},log:()=>{},
      prepare:async()=>window.qheMedia,run:async()=>{window.qheRuns++;throw Error('unexpected run')},
      save:()=>({pending:true})
    });
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  await page.locator('[data-media-mode="transcode"]').click();
  await page.locator('#taskInspect').click();
  await page.waitForFunction(()=>document.querySelector('[data-review-domain-projection]')
    &&document.querySelector('[data-review-domain-projection]').hidden===false);
  const detail=page.locator('[data-review-domain-projection]');
  await detail.locator('summary').click();
  let body=await detail.locator('[data-review-domain-content]').textContent();
  for(const fragment of ['SourceAsset','multi.mkv','p1-rich-mkv-source','UserIntent',
    'SourceStream · 视频 #0 / ffv1','SourceStream · 音频 #0 / flac',
    'SourceStream · 音频 #1 / aac','SourceStream · 字幕 #0 / ass',
    'SourceStream · 附件 #0 / ttf','OutputPlan','ImmutableJobPlan',
    'ArtifactRecord · 尚无','-c:v']){
    if(!body.includes(fragment))throw Error('Missing required read-only projection fragment: '+fragment+' in '+body);
  }
  if((await page.locator('[name="operation"]').inputValue())!=='transcode'||
    await page.evaluate(()=>window.qheRuns)!==0)
    throw Error('Inspecting projection changed task or executed backend');
  await page.locator('[data-media-mode="copy"]').click();
  await page.locator('#taskInspect').click();
  await page.waitForFunction(()=>document.querySelector('[data-review-domain-content]')
     ?.textContent?.includes('UserIntent · copy'));
  body=await detail.locator('[data-review-domain-content]').textContent();
  if(!body.includes('UserIntent · copy · copy')||!body.includes('-c:v copy'))
    throw Error('Copy workflow projection used transcoding FFmpeg authority: '+body);
  await page.evaluate(()=>{
    window.qheSource='different-media-source';
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  if(!(await detail.isHidden()))
    throw Error('Changed source retained obsolete compiled domain projection');
  if(await page.evaluate(()=>window.qheRuns)!==0)
    throw Error('Projection caused an encode');
  console.log('WU06 Chromium P1 compiled SourceAsset/Intent/OutputPlan/FFmpeg inspector PASS; no execution');
 }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
