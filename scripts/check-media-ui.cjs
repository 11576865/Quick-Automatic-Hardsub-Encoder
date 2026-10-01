const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
(async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4179','--strictPort'],{stdio:'pipe'});
 let browser;
 try {
  let startupLog='';server.stdout.on('data',data=>{startupLog+=data;});server.stderr.on('data',data=>{startupLog+=data;});
  let ready=false;for(let attempt=0;attempt<100;attempt++){try{if((await fetch('http://127.0.0.1:4179/')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
  if(!ready)throw Error('Vite startup timeout: '+startupLog);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4179/');
  await page.locator('#mediaWorkspace').waitFor();
  await page.selectOption('[name=operation]','copy');
  if(!await page.locator('#taskEncoding').isDisabled())throw Error('Copy controls remain enabled');
  if(await page.locator('.input-ass').isVisible())throw Error('Copy still requests subtitles');
  await page.selectOption('[name=operation]','transcode');
  await page.fill('[name=width]','1280');await page.fill('[name=quality]','18');
  await page.click('#taskLoadPreset');
  if(await page.inputValue('[name=width]')!=='1280')throw Error('Preset overwrote resolution');
  await page.screenshot({path:'media-workspace-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'media-workspace-mobile.png',fullPage:true});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile horizontal overflow');
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Desktop/mobile UI, mode gating, preset preservation: passed');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
