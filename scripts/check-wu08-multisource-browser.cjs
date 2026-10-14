// WU08 actual production Chromium UI: two independently user-selected
// Files, frozen source settings, official v4 compile and controlled run/save.
// No real WebAssembly FFmpeg claims from this controlled backend.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
async function main(){
 const port=4208,base='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js',
  '--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  let alive=false,logs='';
  server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
  for(let i=0;i<95;i++){try{if((await fetch(base)).ok){alive=true;break}}catch{}
    await new Promise(r=>setTimeout(r,200));}
  if(!alive)throw Error('Vite startup failed '+logs);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:860}});
  await page.goto(base);await page.locator('#mediaWorkspace').waitFor({state:'attached'});
  await page.evaluate(async()=>{
    document.body.innerHTML=[
     '<section id="hardsubControlDeck"><button data-hardsub-strategy="guided">Guided</button>',
     '<button data-hardsub-strategy="manual">Manual</button></section>',
     '<section id="planCard"><button id="guidedToManual">Transfer</button></section>',
     '<section id="encodeCard"></section>','<section id="subtitleCard"></section>',
     '<section id="hardsubManualMount"></section>',
     '<section id="sharedMediaOutputMount"></section>',
     '<section id="inputCard"></section>'
    ].join('');
    const {mountMediaWorkspace}=await import('/src/media-workspace.js');
    window.batchActive=null;window.batchRuns=[];window.batchSaves=[];
    window.batchFailSaveOnce=true;window.batchLogs=[];
    window.batchMedia=null;
    window.batchUI=mountMediaWorkspace({
      isWindows:()=>false,hasNvenc:()=>false,platformKey:()=>({}),
      supportsBrowserSourceBatch:()=>true,
      activateBrowserBatchSource:async file=>{
        window.batchActive=file;
        window.batchMedia={
          duration:file.name==='source-a.mkv'?6:8,sourceName:file.name,
          videoTracks:1,audioTracks:1,
          formatName:'matroska',videoCodec:file.name==='source-a.mkv'?'ffv1':'h264',
          videoStreams:[{codec:file.name==='source-a.mkv'?'ffv1':'h264',
            width:320,height:180,fps:12,pixelFormat:'yuv420p'}],
          audioStreams:[{codec:'aac',channels:2}]
        };
        document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
        return file;
      },
      videoIdentity:()=>{
        const x=window.batchActive;
        return x?[x.name,x.size,x.lastModified].join('|'):'';
      },
      sourceName:()=>window.batchActive?.name||'',
      mediaSnapshot:()=>window.batchMedia,
      guidedSnapshot:()=>null,
      busy:()=>false,setBusy:()=>{},log:x=>window.batchLogs.push(x),
      prepare:async()=>{
        if(!window.batchActive)throw Error('No active selected file');
        return window.batchMedia;
      },
      validate:async task=>{
        if(!task.outputArgs?.length||task.version!==4)throw Error('Invalid official compiled task');
      },
      run:async(task,media,progress)=>{
        window.batchRuns.push({source:window.batchActive?.name,task});
        progress?.(1,'controlled completed');
        return {task,name:'result.mkv',verified:true,outputBytes:78000,
          outputDuration:task.expectedDuration};
      },
      save:result=>{
        window.batchSaves.push({source:window.batchActive?.name,name:result.name});
        if(window.batchActive?.name==='source-b.mkv'&&window.batchFailSaveOnce){
          window.batchFailSaveOnce=false;throw Error('synthetic user cancelled destination');
        }
        return {ok:true,kind:'browser-download'};
      }
    });
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  await page.locator('[data-media-mode="transcode"]').click();
  await page.locator('#taskMultiSourcePanel summary').click();
  const selector=page.locator('#taskBatchSources');
  await selector.setInputFiles([
    {name:'source-a.mkv',mimeType:'video/x-matroska',buffer:Buffer.from('a-source-file')},
    {name:'source-b.mkv',mimeType:'video/x-matroska',buffer:Buffer.from('b-source-file')}
  ]);
  await page.locator('#taskQueueBatchSources').click();
  if(await page.locator('#taskMultiSourceList li').count()!==2)
    throw Error('Failed to create two separately named user source rows');
  const currentQuality=page.locator('[name="quality"]');
  await currentQuality.fill('31');await currentQuality.dispatchEvent('change');
  await page.locator('#taskRunBatchSources').click();
  await page.waitForFunction(()=>
    window.batchRuns.length===2&&document.querySelector('#taskMultiSourceStatus')
      ?.textContent?.includes('只重试保存'),null,{timeout:16000});
  const runs=await page.evaluate(()=>window.batchRuns);
  if(runs.map(x=>x.source).join(',')!=='source-a.mkv,source-b.mkv')
    throw Error('Jobs were not executed with their respective File sources');
  if(runs.some(x=>x.task.version!==4||x.task.quality!==23||x.task.operation!=='transcode'))
    throw Error('Queue used mutated user settings or nonofficial compiler tasks');
  const items=page.locator('#taskMultiSourceList li');
  if(!(await items.nth(0).textContent()).includes('已交浏览器下载')||
     !(await items.nth(1).textContent()).includes('待重试保存'))
    throw Error('Failed save overwrote successful file or lost second artifact');
  await items.nth(1).getByRole('button',{name:'仅重试保存'}).click();
  await page.waitForFunction(()=>document.querySelector('#taskMultiSourceList')
    ?.textContent?.match(/已交浏览器下载/g)?.length===2,null,{timeout:7000});
  if(await page.evaluate(()=>window.batchRuns.length)!==2)
    throw Error('Retry-save redundantly re-encoded a source');
  const saved=await page.evaluate(()=>window.batchSaves);
  if(saved.length!==3||saved[0].source!=='source-a.mkv'||saved[2].source!=='source-b.mkv')
    throw Error('Incorrect independent source save provenance');
  // Completing eight outputs must not dead-end further batches in the
  // current session. Clear only UI records, never invalidate download handoff.
  await page.locator('#taskClearBatchSources').click();
  if(await page.locator('#taskMultiSourceList li').count()!==0)
    throw Error('Completed queue records cannot be cleared to start another batch');
  await selector.setInputFiles([
    {name:'source-c.mkv',mimeType:'video/x-matroska',buffer:Buffer.from('c-source-file')},
    {name:'source-d.mkv',mimeType:'video/x-matroska',buffer:Buffer.from('d-source-file')}
  ]);
  await page.locator('#taskQueueBatchSources').click();
  if(await page.locator('#taskMultiSourceList li').count()!==2)
    throw Error('New source batch could not be queued after removing old download records');
  if(await page.evaluate(()=>window.batchRuns.length)!==2)
    throw Error('Clearing records unexpectedly restarted old source encodes');
  console.log('WU08 Chromium selected 2 user Files -> distinct official compiled tasks -> independent save and no-reencode retry PASS (controlled backend)');
 }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
