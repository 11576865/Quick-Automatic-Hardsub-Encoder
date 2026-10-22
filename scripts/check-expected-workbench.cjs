const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.QHE_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4186','--strictPort'],{stdio:'pipe'});
 let browser;
 try {
  let ready=false;
  for(let i=0;i<80;i++){
   try{if((await fetch('http://127.0.0.1:4186')).ok){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,150));
  }
  assert.ok(ready,'Vite must start');
  browser=await chromium.launch({headless:true,...(process.env.QHE_CHROMIUM_PATH?{executablePath:process.env.QHE_CHROMIUM_PATH,args:['--no-sandbox']}:{})});
  for(const width of [1440,1280,1194,1180,1024,920,834,820,768,390,320]){
   console.log(`Checking workbench ${width}px`);
   const page=await browser.newPage({viewport:{width,height:960}}),errors=[];
   if(process.env.QHE_QA_FONT_DIR){
    const fs=require('node:fs/promises'),path=require('node:path');
    await page.route('**/__qa-font/**',async route=>{
     const relative=new URL(route.request().url()).pathname.split('/__qa-font/')[1];
     await route.fulfill({body:await fs.readFile(path.join(process.env.QHE_QA_FONT_DIR,relative)),contentType:relative.endsWith('.css')?'text/css':'font/woff2'});
    });
   }
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:4186');
   if(process.env.QHE_QA_FONT_DIR){await page.addStyleTag({url:'/__qa-font/index.css'});await page.evaluate(()=>document.fonts.ready);}
   await page.locator('#expectedIntentInspector').waitFor();
   const inspector=page.locator('#expectedIntentInspector');
   assert.match(await inspector.textContent(),/尚未接入执行/);
   if(process.env.QHE_SCREENSHOT_DIR&&[1440,1194,834].includes(width)){
    await page.screenshot({path:`${process.env.QHE_SCREENSHOT_DIR}/v3-plan-${width}.png`,fullPage:true});
   }
   if(width>=768){
    const layout=await page.evaluate(()=>{
     const rect=s=>document.querySelector(s).getBoundingClientRect();
     const source=rect('.v3-source'),main=rect('.v3-main'),inspector=rect('.v3-inspector');
     return {mainRight:main.right,mainLeft:main.left,sourceRight:source.right,mainTop:main.top,inspectorLeft:inspector.left,inspectorTop:inspector.top};
    });
    assert.ok(layout.mainLeft>=layout.sourceRight,`Source must precede plan at ${width}`);
    if(width>1050)assert.ok(layout.inspectorLeft>=layout.mainRight-1,'Landscape inspector must remain beside plan');
    else assert.ok(layout.inspectorTop>layout.mainTop,'Portrait inspector must follow plan');
    assert.equal(await page.locator('.v3-editor').getAttribute('open'),null,'Detailed editor starts collapsed');
    await page.locator('[data-v3-action="preview"]').click();
    assert.equal(await page.locator('#v3Preview').isVisible(),true);
    assert.equal(await page.locator('.v3-output').isVisible(),false);
    if(width===1440){
     await page.locator('[data-media-mode="transcode"]').click();
     await page.locator('[data-v3-action="preview"]').click();
     await page.locator('[data-v3-action="generate-preview"]').click();
     assert.match(await page.locator('.v3-help').textContent(),/先选择视频并检查来源参数/,'No-source frame requests must not silently run');
     await page.keyboard.press('Escape');
     await page.locator('[data-media-mode="hardsub"]').click();
     await page.locator('[data-v3-action="preview"]').click();
    }
    if(process.env.QHE_SCREENSHOT_DIR&&[1440,1194].includes(width))await page.screenshot({path:`${process.env.QHE_SCREENSHOT_DIR}/v3-preview-${width}.png`,fullPage:true});
    await page.locator('[data-v3-action="close-preview"]').click();
    assert.equal(await page.locator('.v3-output').isVisible(),true);
    await page.locator('.v3-density select').selectOption('compact');
    assert.equal(await page.locator('.v3-source-toolbar button').first().getAttribute('aria-label'),'检查来源');
    assert.equal(await page.locator('.v3-source-toolbar button span').first().isVisible(),false);
    await page.locator('.v3-density select').selectOption('standard');
    assert.equal(await page.locator('.v3-source-toolbar button span').first().isVisible(),true);
    await page.locator('[data-v3-action="location"]').click();
    assert.equal(await page.locator('.v3-help').isVisible(),true);
    assert.match(await page.locator('.v3-help').textContent(),/保存方式/);
    await page.keyboard.press('Escape');
    await page.locator('[data-v3-action="artifact"]').click();
    assert.equal(await page.locator('.v3-artifact').isVisible(),true,'Artifact audit must have a composed view');
    assert.equal(await page.locator('[data-v3-action="save-artifact"]').isDisabled(),await page.locator('#taskSave').isDisabled(),'Audit save mirrors actual save gate');
    if(process.env.QHE_SCREENSHOT_DIR&&width===1440)await page.screenshot({path:`${process.env.QHE_SCREENSHOT_DIR}/v3-artifact-${width}.png`,fullPage:true});
    await page.locator('.v3-path [data-v3-action="plan"]').click();
    await page.locator('[data-v3-action="compare"]').click();
    assert.equal(await page.locator('.v3-comparison').isVisible(),true);
    assert.equal(await inspector.locator('[data-intent-tab="decision"]').getAttribute('aria-selected'),'true');
    if(process.env.QHE_SCREENSHOT_DIR&&width===1440)await page.screenshot({path:`${process.env.QHE_SCREENSHOT_DIR}/v3-comparison-${width}.png`,fullPage:true});
    await page.locator('.v3-path [data-v3-action="plan"]').click();
    await inspector.locator('[data-expected-live]').click();
    assert.notEqual(await page.locator('.v3-editor').getAttribute('open'),null,'Actual-plan inspector link must open detailed editor');
    await page.setViewportSize({width:390,height:960});
    await page.waitForFunction(()=>!document.body.classList.contains('workbench-v3')&&document.documentElement.dataset.uiShell==='phone');
    if(await page.locator('[data-mobile-stage-target="prepare"]').isVisible())await page.locator('[data-mobile-stage-target="prepare"]').click();
    await page.locator('#assWebPicker').waitFor({state:'visible'});
    await page.setViewportSize({width,height:960});
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#inputCard').evaluate(el=>!!el.closest('.v3-source')),true);
    assert.equal(await page.locator('.v3-editor').evaluate(el=>el.open),true,'Orientation/viewport changes must retain user editor disclosure choice');
    await page.locator('.v3-editor>summary').click();
   }
   for(const operation of ['hardsub','transcode','copy']){
    await page.locator(`[data-media-mode="${operation}"]`).click();
    await page.waitForFunction(op=>document.body.dataset.mediaOperation===op,operation);
    await page.waitForTimeout(50);
    const before=await page.locator('#mediaTaskForm').evaluate(form=>JSON.stringify([...new FormData(form)]));
    await inspector.locator('[data-intent-tab="decision"]').click();
    if(operation==='copy'){
     assert.equal(await inspector.locator('[data-intent-field="goal"]').isVisible(),false);
     await inspector.locator('[data-intent-control="cut"]').selectOption('exact');
    }else{
     await inspector.locator('[data-intent-control="goal"]').selectOption('time');
     await inspector.locator('[data-intent-control="comparison"]').selectOption('resolution');
    }
    assert.equal(await page.locator('#mediaTaskForm').evaluate(form=>JSON.stringify([...new FormData(form)])),before,'Draft controls must never write executable parameters');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`Overflow at ${width}/${operation}`);
   }
   // Keyboard tabs, reset and per-operation drafts remain usable on all sizes.
   await inspector.locator('#expected-tab-decision').focus();
   await page.keyboard.press('ArrowRight');
   assert.equal(await inspector.locator('#expected-tab-delivery').getAttribute('aria-selected'),'true');
   await inspector.locator('[data-intent-control="verification"]').selectOption('player');
   await inspector.locator('[data-expected-reset]').click();
   assert.equal(await inspector.locator('[data-intent-control="verification"]').inputValue(),'structure');
   await page.locator('[data-media-mode="transcode"]').click();
   await inspector.locator('[data-intent-tab="decision"]').click();
   await page.waitForTimeout(50);
   assert.equal(await inspector.locator('[data-intent-control="goal"]').inputValue(),'time','Changing mode must retain that mode draft');
   if(width===1440){
    await page.locator('[data-media-mode="copy"]').click();
    await page.evaluate(()=>{for(const name of ['start','end'])document.querySelector('#mediaTaskForm').elements.namedItem(name).disabled=true;});
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-v3-time="start"]').isDisabled(),true,'Cut proxy must obey execution lock');
    const lockedStart=await page.locator('#mediaTaskForm [name="start"]').inputValue();
    await page.locator('[data-v3-time="start"]').evaluate(el=>{el.value='99';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#mediaTaskForm [name="start"]').inputValue(),lockedStart,'Locked proxy events cannot modify actual parameters');
    await page.evaluate(()=>{for(const name of ['start','end'])document.querySelector('#mediaTaskForm').elements.namedItem(name).disabled=false;});
    await page.locator('[data-media-mode="hardsub"]').click();
    await page.evaluate(()=>{
     const image=document.createElement('img');image.src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><title>subtitle-frame</title></svg>';image.dataset.qaFrame='true';document.querySelector('#preview').append(image);
     const frame=document.querySelector('#taskFramePreviewImage');frame.src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><title>source-frame</title></svg>';frame.hidden=false;
    });
    await page.waitForTimeout(50);
    assert.match(await page.locator('[data-v3-frame]').getAttribute('src'),/subtitle-frame/);
    await page.locator('[data-media-mode="transcode"]').click();await page.waitForTimeout(50);
    assert.match(await page.locator('[data-v3-frame]').getAttribute('src'),/source-frame/,'Transcode must not reuse retained subtitle preview');
    await page.evaluate(()=>{document.querySelector('[data-qa-frame]').remove();const frame=document.querySelector('#taskFramePreviewImage');frame.removeAttribute('src');frame.hidden=true;});
   }
   // Equal metadata on distinct File objects must not reuse another source's draft.
   await page.locator('[data-media-mode="hardsub"]').click();
   const pick=async content=>page.evaluate(data=>{
    const file=new File([data],'same.mp4',{type:'video/mp4',lastModified:123});
    const transfer=new DataTransfer();transfer.items.add(file);
    const input=document.querySelector('#video');input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
   },content);
   await pick('aaaa');await page.waitForTimeout(50);
   await inspector.locator('[data-intent-tab="media"]').click();
   await inspector.locator('[data-intent-control="subtitle"]').selectOption('embedded');
   if(width===1440){
    await page.locator('[data-v3-action="preview"]').click();
    await page.evaluate(()=>{
     const image=document.createElement('img');image.src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><title>old-source-frame</title></svg>';
     image.dataset.qaOldSource='true';document.querySelector('#preview').prepend(image);
    });
    await page.waitForFunction(()=>document.querySelector('[data-v3-frame]')?.getAttribute('src')?.includes('old-source-frame'));
   }
   await pick('bbbb');await page.waitForTimeout(50);
   assert.equal(await inspector.locator('[data-intent-control="subtitle"]').inputValue(),'external');
   if(width===1440){
    assert.equal(await page.locator('[data-v3-frame]').getAttribute('src'),null,'A new File object must not inherit the previous source frame');
    assert.equal(await page.locator('[data-v3-frame]').isHidden(),true);
   }
   await page.locator(width>=768?'[data-v3-action="source"]':'[data-expected-jump="source"]').click();
   assert.equal(await page.locator('#inputCard').evaluate(el=>el===document.activeElement),true);
   assert.deepEqual(errors,[]);
   await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(250);
   if(process.env.QHE_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.QHE_SCREENSHOT_DIR}/expected-${width}.png`,fullPage:true});
   await page.close();
  }
  console.log('EXPECTED_WORKBENCH_BROWSER_PASS: 11 widths x 3 workflows; Figma v3 geometry, preview, density, help, draft isolation, execution locks, workflow previews, keyboard and reset');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
