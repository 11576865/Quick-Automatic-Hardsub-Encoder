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
  for(const width of [1440,1280,1194,1180,1024,920,834,820,390,320]){
   const page=await browser.newPage({viewport:{width,height:960}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:4186');
   await page.locator('#expectedIntentInspector').waitFor();
   const inspector=page.locator('#expectedIntentInspector');
   assert.match(await inspector.textContent(),/尚未接入执行/);
   if(width>=821){
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
    await page.locator('[data-v3-action="close-preview"]').click();
    assert.equal(await page.locator('.v3-output').isVisible(),true);
    await page.locator('.v3-density select').selectOption('compact');
    assert.equal(await page.locator('.v3-source-toolbar button').first().getAttribute('aria-label'),'检查来源');
    assert.equal(await page.locator('.v3-source-toolbar button span').first().isVisible(),false);
    await page.locator('.v3-density select').selectOption('standard');
    assert.equal(await page.locator('.v3-source-toolbar button span').first().isVisible(),true);
    await page.locator('[data-v3-action="location"]').click();
    assert.equal(await page.locator('.v3-help').isVisible(),true);
    assert.match(await page.locator('.v3-help').textContent(),/待接入/);
    await page.keyboard.press('Escape');
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
   await pick('bbbb');await page.waitForTimeout(50);
   assert.equal(await inspector.locator('[data-intent-control="subtitle"]').inputValue(),'external');
   await page.locator(width>=821?'[data-v3-action="source"]':'[data-expected-jump="source"]').click();
   assert.equal(await page.locator('#inputCard').evaluate(el=>el===document.activeElement),true);
   assert.deepEqual(errors,[]);
   await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(250);
   if(process.env.QHE_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.QHE_SCREENSHOT_DIR}/expected-${width}.png`,fullPage:true});
   await page.close();
  }
  console.log('EXPECTED_WORKBENCH_BROWSER_PASS: 10 widths x 3 workflows; Figma v3 geometry, preview, density, help, draft isolation, keyboard and reset');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
