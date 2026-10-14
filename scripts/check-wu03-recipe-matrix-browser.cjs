// B21: production workbench DOM, two truly different v4 jobs, independent
// verified outputs and save-only failure retry. Fake transport is intentional;
// this does not assert FFmpeg or Windows Native runtime acceptance.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
async function main(){
 const port=4189,origin='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js',
  '--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  let logs='';server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(origin)).ok){ready=true;break}}catch{}
    await new Promise(r=>setTimeout(r,180));
  }
  if(!ready)throw Error('Vite failed '+logs);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(origin);
  await page.locator('#mediaWorkspace').waitFor({state:'attached'});
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
    window.alert=()=>{};
    window.recipeSource='batch-source-1';
    window.recipeAsset='source-ass-font-a';
    window.recipeRuns=[];window.recipeSaves=[];window.failFirstSave=true;
    window.recipeMedia={
      duration:5,fps:12,videoTracks:1,audioTracks:0,
      sourceName:'rich.mkv',videoCodec:'ffv1',
      videoStreams:[{codec:'ffv1',width:320,height:180,fps:12,pixelFormat:'yuv420p'}]
    };
    window.matrix=mountMediaWorkspace({
      isWindows:()=>false,hasNvenc:()=>false,platformKey:()=>({}),
      mediaSnapshot:()=>window.recipeMedia,
      sourceName:()=> 'rich.mkv',
      videoIdentity:()=>window.recipeSource,
      recipeAssetIdentity:()=>window.recipeAsset,
      guidedSnapshot:()=>null,
      busy:()=>false,setBusy:()=>{},
      prepare:async()=>window.recipeMedia,
      validate:async()=>{},
      log:()=>{},
      run:async(task,media,progress)=>{
        window.recipeRuns.push({codec:task.codec,encoder:task.encoder,
          op:task.operation,source:window.recipeSource,args:[...task.outputArgs]});
        progress?.(1,'controlled transport');
        return {task,verified:true,name:'rich-result.mkv',
          outputBytes:110000+window.recipeRuns.length*1000,
          outputDuration:task.expectedDuration};
      },
      save:result=>{
        window.recipeSaves.push(result.name);
        if(window.failFirstSave){window.failFirstSave=false;throw Error('simulated save failure');}
        return {ok:true,kind:'browser-download'};
      }
    });
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  await page.locator('[data-media-mode="transcode"]').click();
  await page.locator('#taskRecipeMatrixPanel').evaluate(el=>el.open=true);
  await page.locator('#taskAddRecipe').click();
  if(await page.locator('#taskRecipeMatrixList > li').count()!==1)throw Error('H264 recipe not added');
  await page.locator('[name="codec"]').selectOption('h265');
  await page.locator('#taskAddRecipe').click();
  if(await page.locator('#taskRecipeMatrixList > li').count()!==2)
    throw Error('Second independent recipe not added');
  // A different source cannot start the accumulated matrix.
  await page.evaluate(()=>{
    window.recipeSource='unrelated-input';
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  if(!(await page.locator('#taskRunRecipes').isDisabled()))
    throw Error('Foreign source should block batch execution');
  await page.evaluate(()=>{
    window.recipeSource='batch-source-1';
    document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
  });
  await page.locator('#taskRunRecipes').click();
  await page.waitForFunction(()=>
    document.querySelector('#taskRecipeMatrixStatus')?.textContent?.includes('只重试保存')||
    document.querySelector('#taskRecipeMatrixStatus')?.textContent?.includes('重试保存'),
    {timeout:20000});
  if(await page.evaluate(()=>window.recipeRuns.length)!==1)
    throw Error('Save failure should stop before the second encoding');
  await page.locator('[data-recipe-action="retry-save"]').click();
  await page.waitForFunction(()=>document.querySelector('#taskRecipeMatrixList li small')?.textContent==='已保存');
  if(await page.evaluate(()=>window.recipeRuns.length)!==1)
    throw Error('Save-only retry re-encoded the first output');
  await page.locator('#taskRunRecipes').click();
  await page.waitForFunction(()=>window.recipeRuns.length===2);
  await page.waitForFunction(()=>
    [...document.querySelectorAll('#taskRecipeMatrixList li small')]
      .every(x=>x.textContent==='已保存'));
  const evidence=await page.evaluate(()=>({
    runs:window.recipeRuns.map(x=>({codec:x.codec,encoder:x.encoder,operation:x.op,source:x.source})),
    saves:window.recipeSaves,
    status:document.querySelector('#taskRecipeMatrixStatus').textContent
  }));
  if(evidence.runs.map(x=>x.encoder).join(',')!=='libx264,libx265')
    throw Error('Frozen per-recipe codec choices diverged: '+JSON.stringify(evidence));
  if(evidence.saves.length!==3 ||
     evidence.saves[0]!=='rich-result-variant-01.mkv' ||
     evidence.saves[1]!=='rich-result-variant-01.mkv' ||
     evidence.saves[2]!=='rich-result-variant-02.mkv')
    throw Error('Independent outputs or save-only retry diverged: '+JSON.stringify(evidence));
  console.log('WU03: actual Chromium matrix + frozen codec variants + source gate + save-only retry PASS (controlled transport)');
 }finally{await browser?.close();server.kill();}
}
main().catch(err=>{console.error(err);process.exitCode=1;});
