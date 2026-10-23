const assert=require('node:assert/strict');
module.exports=async(browser,base)=>{
 const page=await browser.newPage({viewport:{width:1194,height:960}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 if(process.env.QHE_QA_FONT_DIR){
  const fs=require('node:fs/promises'),path=require('node:path');
  await page.route('**/__qa-font/**',async route=>{const relative=new URL(route.request().url()).pathname.split('/__qa-font/')[1];await route.fulfill({body:await fs.readFile(path.join(process.env.QHE_QA_FONT_DIR,relative)),contentType:relative.endsWith('.css')?'text/css':'font/woff2'})});
 }

 let picks={ass:0,fonts:0,video:0},imports=[],frames=[],frameFailure=false,importFailure=true,hasAss=true,pendingProbe=null,holdProbe=false,cancelNextAss=false;
 const asset=(name,text)=>({name,size:Buffer.byteLength(text),base64:Buffer.from(text).toString('base64')});
 const ass=asset('dialogue.ass','[Script Info]\nTitle: import fixture\n'),font=asset('fixture.ttf','FONT');
 const probe=()=>({ok:true,width:320,height:180,duration:2,fps:24,videoCodec:'h264',pixelFormat:'yuv420p',bitDepth:8,seekable:true,audioTracks:0,subtitleTracks:hasAss?2:0,subtitleStreams:hasAss?[{codec_name:'subrip'},{codec_name:'ass',tags:{language:'jpn',title:'Dialogue'}}]:[]});
 await page.route('http://127.0.0.1:9347/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const reply=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  if(path==='/api/health')return reply({backend:'windows-native',platform:'windows',available:true,cpu:'fixture',gpus:[],ffmpegVersion:'fixture',encoders:[],bridgeVersion:4,taskSchemaVersion:4,fpsModeSupported:true,hasAss:true});
  if(path==='/api/history')return reply({records:[]});
  if(path==='/api/self-test')return reply({ok:true,x264EncodeSmoke:true,x265EncodeSmoke:true,ssim:true});
  if(path.startsWith('/api/pick/')){
   const role=path.split('/').pop();picks[role]++;
   if(role==='ass'&&cancelNextAss){cancelNextAss=false;return reply({role,count:0,files:[]});}
   return reply({role,count:1,files:role==='video'?[{name:'source.mkv',size:8,lastModified:777}]:[role==='ass'?ass:font]});
  }
  if(path==='/api/probe'){
   if(holdProbe){pendingProbe=()=>reply(probe());return;}
   return reply(probe());
  }
  if(path==='/api/frame'){
   const request=route.request().postDataJSON();frames.push(request);
   if(frameFailure)return reply({requestId:request.requestId,ok:false,error:'fixture frame decode failed'});
   return reply({requestId:request.requestId,ok:true,time:Number(request.timeSeconds||0),width:request.width,
    url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='});
  }
  if(path==='/api/embedded-ass'){
   imports.push(route.request().postDataJSON());
   return reply(importFailure?{ok:false,error:'fixture extraction failed'}:{ok:true,sourceBound:true,sourceName:'source.mkv',sourceSize:8,ass,fonts:[font]});
  }
  return route.fulfill({status:404,contentType:'application/json',body:'{"ok":false,"error":"not mocked"}'});
 });
 try{
  await page.goto(base+'/?windowsNative=http%3A%2F%2F127.0.0.1%3A9347&token=source-import-fixture');
  await page.waitForFunction(()=>document.body.dataset.runtimeBackend==='windows-native');
  if(process.env.QHE_QA_FONT_DIR){await page.addStyleTag({url:base+'/__qa-font/index.css'});await page.evaluate(()=>document.fonts.ready)}
  const entry=page.getByRole('button',{name:'导入 ASS 与字体',exact:true}),menu=page.locator('.v3-import-menu');
  const open=async()=>{if(!await menu.isVisible())await entry.click();};
  await open();assert.equal(await page.locator('[data-import-action=embedded]').isDisabled(),true);
  assert.match(await page.locator('[data-import-status]').textContent(),/先选择视频/);
  await page.locator('[data-import-action=ass]').click();await page.waitForFunction(()=>document.querySelector('#assMeta').textContent.includes('dialogue.ass'));assert.equal(picks.ass,1);assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('[data-v3-action=extract]')),true,'External Native picker keeps a visible keyboard focus');
  const previousAss=await page.locator('#assMeta').textContent();cancelNextAss=true;await open();await page.locator('[data-import-action=ass]').click();
  await page.waitForFunction(()=>!document.querySelector('#assNativePickerBtn').disabled);
  assert.equal(picks.ass,2);assert.equal(await page.locator('#assMeta').textContent(),previousAss,'Cancelled Native picker preserves prior ASS');
  assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('[data-v3-action=extract]')),true,'Cancelled Native picker returns focus to the entry');
  await open();await page.locator('[data-import-action=fonts]').click();await page.waitForFunction(()=>document.querySelector('#fontMeta').textContent.includes('本次选择 1 个字体'));assert.equal(picks.fonts,1);
  await page.locator('#videoNativePickerBtn').click();
  await page.waitForFunction(()=>document.querySelector('#embeddedAssStream').options.length===1);
  // Full real main/client/Bridge HTTP path. No media is decoded by this fixture,
  // but the central action must reach the sole existing Native frame owner.
  await page.locator('[data-media-mode=transcode]').click();
  await page.locator('[data-v3-action=preview]').click();
  await page.locator('[data-v3-action=generate-preview]').click();
  await page.waitForFunction(()=>document.querySelector('[data-v3-frame]')?.getAttribute('src')?.startsWith('data:image/png;base64,'));
  assert.equal(frames.length,1,'Central transcode preview must issue one native frame request');
  assert.equal(frames[0].videoStream,0,'Central preview must preserve the primary selected source stream');
  assert.equal(frames[0].width,720,'Central preview must use the established bounded decoder width');
  assert.equal(await page.locator('#taskFramePreviewImage').isHidden(),true,'Collapsed original editor stays hidden but owns the frame result');
  frameFailure=true;
  await page.locator('[data-v3-action=generate-preview]').click();
  await page.waitForFunction(()=>document.querySelector('#taskFramePreviewStatus').textContent.includes('fixture frame decode failed'));
  await page.waitForFunction(()=>document.querySelector('[data-v3-frame-empty] span').textContent.includes('fixture frame decode failed'));
  assert.equal(await page.locator('[data-v3-frame]').getAttribute('src'),null,'Failed re-decode must clear previous visual proof');
  frameFailure=false;
  await page.locator('[data-v3-action=generate-preview]').click();
  await page.waitForFunction(()=>document.querySelector('[data-v3-frame]')?.getAttribute('src')?.startsWith('data:image/png;base64,'));
  assert.equal(frames.length,3,'Failed preview must remain retryable without changing task parameters');
  await page.locator('[data-media-mode=copy]').click();
  await page.evaluate(()=>{const el=document.querySelector('#mediaTaskForm [name=videoRange]');el.value='full';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('[data-v3-action=preview]').click();
  // The preceding Transcode image may already have the same data URL.
  // Wait for the *new* Copy /api/frame response, not an old populated img.src.
  const copyFrameResponse=page.waitForResponse(response=>
   new URL(response.url()).pathname==='/api/frame'&&response.request().method()==='POST');
  await page.locator('[data-v3-action=generate-preview]').click();
  const copyResponse=await copyFrameResponse;
  assert.equal(copyResponse.ok(),true,'Copy frame transport must complete');
  assert.equal(frames.length,4,'Copy mode must reuse the existing frame decoder with an untrimmed source');
  await page.waitForFunction(()=>{
   const owner=document.querySelector('#taskFramePreviewImage');
   const composed=document.querySelector('[data-v3-frame]');
   // An HTTP response arrives before the original decoder-owner callback
   // and the composed workbench requestAnimationFrame projection settle.
   return owner&&!owner.hidden&&owner.getAttribute('src')?.startsWith('data:image/png;base64,')&&
    composed&&!composed.hidden&&composed.getAttribute('src')===owner.getAttribute('src');
  });
  assert.match(await page.locator('[data-v3-frame]').getAttribute('src'),/^data:image\/png;base64,/);
  // A *different* Native source with exactly the same name/size/mtime can
  // decode to identical PNG bytes. Source identity, not URL inequality,
  // determines whether the central view can show the new generation.
  const sameMetadataProbe=page.waitForResponse(response=>
   new URL(response.url()).pathname==='/api/probe'&&response.request().method()==='POST');
  await page.locator('#videoNativePickerBtn').click();
  await sameMetadataProbe;
  await page.waitForFunction(()=>document.querySelector('#taskFramePreviewImage').hidden&&
   !document.querySelector('#taskFramePreviewImage').getAttribute('src')&&
   !document.querySelector('[data-v3-frame]').getAttribute('src'));
  assert.equal(await page.locator('#taskWaveformImage').getAttribute('src'),null,
   'The old waveform must not survive a same-metadata source replacement');
  assert.match(await page.locator('#taskWaveformStatus').textContent(),/来源已更换/,
   'Source-object replacement must explicitly invalidate stale timeline evidence');
  await page.waitForFunction(()=>!document.querySelector('#sourceVideoSummary').classList.contains('hidden'));
  if(!await page.locator('#v3Preview').isVisible())await page.locator('[data-v3-action=preview]').click();
  const replacementResponse=page.waitForResponse(response=>
   new URL(response.url()).pathname==='/api/frame'&&response.request().method()==='POST');
  await page.locator('[data-v3-action=generate-preview]').click();
  await replacementResponse;
  assert.equal(frames.length,5,'New source must request a new frame despite identical metadata');
  await page.waitForFunction(()=>{
   const frame=document.querySelector('#taskFramePreviewImage');
   const central=document.querySelector('[data-v3-frame]');
   return !frame.hidden&&!central.hidden&&!!frame.getAttribute('src')&&
    frame.getAttribute('src')===central.getAttribute('src');
  });
  assert.match(await page.locator('[data-v3-frame]').getAttribute('src'),/^data:image\/png;base64,/,
   'Identical decoded bytes for a new source must still be visible');
  await page.locator('[data-media-mode=hardsub]').click();
  await open();assert.equal(imports.length,0,'Opening import choices never extracts automatically');
  await page.locator('[data-import-action=embedded]').click();
  await page.waitForFunction(()=>document.activeElement===document.querySelector('#embeddedAssStream'));
  assert.equal(await page.locator('#embeddedAssStream').count(),1,'Original track selector is retained once');
  assert.equal(await page.locator('#embeddedAssStream').inputValue(),'1','Use subtitle ordinal, not a fabricated track ID');
  assert.equal(await page.locator('#importEmbeddedAss').isVisible(),true);assert.equal(imports.length,0,'Revealing importer requires a separate explicit import action');
  const preservation=await page.locator('#mediaTaskForm').evaluate(f=>[f.elements.keepSubtitles.checked,f.elements.keepAttachments.checked]);
  await page.locator('#importEmbeddedAss').click();await page.waitForFunction(()=>document.querySelector('#embeddedAssStatus').textContent.includes('fixture extraction failed'));
  importFailure=false;await page.locator('#importEmbeddedAss').click();
  await page.waitForFunction(()=>document.querySelector('#assMeta').textContent.includes('内封 ASS #1'));
  assert.match(await page.locator('#embeddedAssStatus').textContent(),/已导入 ASS #1 与 1 个字体附件/);
  assert.deepEqual(imports[1],{subtitleOrdinal:1,sourceName:'source.mkv',sourceSize:8});
  assert.deepEqual(await page.locator('#mediaTaskForm').evaluate(f=>[f.elements.keepSubtitles.checked,f.elements.keepAttachments.checked]),preservation,'Import does not rewrite soft-subtitle/attachment preservation');
  // Source replacement must not expose an earlier ready import while a new probe is pending.
  holdProbe=true;await page.locator('#videoNativePickerBtn').click();
  await page.waitForFunction(()=>document.querySelector('#assMeta').textContent==='未选择');
  await open();assert.equal(await page.locator('[data-import-action=embedded]').isDisabled(),true);assert.match(await page.locator('[data-import-status]').textContent(),/来源参数检查/);
  hasAss=false;holdProbe=false;assert.ok(pendingProbe);await pendingProbe();pendingProbe=null;
  await page.waitForFunction(()=>document.querySelector('#embeddedAssImportPanel').hidden);
  await entry.click();await open();assert.equal(await page.locator('[data-import-action=embedded]').isDisabled(),true);assert.match(await page.locator('[data-import-status]').textContent(),/没有可导入/);
  for(const width of [1440,1194,834,768]){await page.setViewportSize({width,height:960});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`Import menu overflow ${width}`);if(width===834&&process.env.QHE_SCREENSHOT_DIR)await page.locator('.v3-source').screenshot({path:process.env.QHE_SCREENSHOT_DIR+'/ass-import-834.png'});}
  await page.keyboard.press('Escape');await entry.focus();assert.equal(await entry.getAttribute('aria-expanded'),'false');
  await page.evaluate(()=>document.querySelector('#video').disabled=true);await open();
  assert.equal(await page.locator('[data-import-action=ass]').isDisabled(),true);assert.equal(await page.locator('[data-import-action=fonts]').isDisabled(),true);
  await page.locator('[data-import-action=ass]').evaluate(el=>el.click());assert.equal(picks.ass,2,'Locked source cannot launch an external picker');
  await page.keyboard.press('Escape');await page.evaluate(()=>document.querySelector('#video').disabled=false);
  await page.locator('[data-media-mode=transcode]').click();await open();assert.match(await page.locator('[data-import-status]').textContent(),/请先切换工作流/);
  assert.equal(await page.locator('[data-import-action=ass]').isDisabled(),true);
  const web=await browser.newPage({viewport:{width:834,height:960}});
  try{
   await web.goto(base);await web.getByRole('button',{name:'导入 ASS 与字体',exact:true}).click();
   assert.equal(await web.locator('[data-import-action=embedded]').isDisabled(),true);
   assert.match(await web.locator('[data-import-status]').textContent(),/Windows Native/);
   const choosing=web.waitForEvent('filechooser');await web.locator('[data-import-action=ass]').click();
   await (await choosing).setFiles({name:'external.ass',mimeType:'text/plain',buffer:Buffer.from('[Script Info]\nTitle: web fixture\n')});
   await web.waitForFunction(()=>document.querySelector('#assMeta').textContent.includes('external.ass'));
   assert.equal(await web.evaluate(()=>document.activeElement===document.querySelector('[data-v3-action=extract]')),true,'Web chooser returns focus to the visible import entry');
  }finally{await web.close();}
  assert.deepEqual(errors,[]);
  console.log('SOURCE_IMPORT_ENTRY_PASS: real main + Native client mocked transport; explicit external pickers, ordinal import/retry, source readiness, workflow/lock gates, preservation unchanged, 4 widths');
 }finally{if(pendingProbe)await pendingProbe();await page.close();}
};
