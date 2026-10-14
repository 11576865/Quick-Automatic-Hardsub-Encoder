// WU09 real production Chromium module/UI regression. Deliberately no
// Native SSIM fixture: we certify decision gating semantics and UI default
// controls, NOT actual Windows samples or whole-film output.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
async function main(){
 const port=4219,base='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js',
   '--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe'});
 let browser;
 try{
  let ready=false,log='';
  server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
  for(let i=0;i<95;i++){try{if((await fetch(base)).ok){ready=true;break}}catch{}
    await new Promise(r=>setTimeout(r,200));}
  if(!ready)throw Error('Vite unavailable '+log);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:850}});
  await page.goto(base);
  await page.locator('#mediaWorkspace').waitFor({state:'attached'});
  const evidence=await page.evaluate(async()=>{
    const {evaluateSharedEvidenceDecision}=await import('/src/shared-evidence-decision.js');
    const {fitRateDistortionModel}=await import('/src/rate-distortion-model.js');
    const {createMultiBranchFrontier}=await import('/src/compression-decision.js');
    const scope=t=>JSON.stringify(['decision-reference-v1',t,'source','runtime','reference']);
    const model=(a,b)=>fitRateDistortionModel([
      {sampleBitrate:1e6,ssim:a,averageSsim:a},
      {sampleBitrate:2e6,ssim:b,averageSsim:b}
    ]);
    const results=[];
    for(const [workflow,domain] of [['guided','guided-ass-rendered'],['manual','manual-source-sdr']]){
      const ref=scope(domain);
      const f=createMultiBranchFrontier([
        {id:'h264',model:model(.9,.94),measurementScope:ref},
        {id:'h265',model:model(.94,.97),measurementScope:ref}
      ],{durationSeconds:120,audioBitrate:0,reservePercent:4});
      if(!f.ok)throw Error('Real browser frontier failed '+f.reason);
      const target=Math.sqrt(f.minimumEvidenceTargetBytes*f.maximumEvidenceTargetBytes);
      const common={workflow,frontier:f,targetBytes:target,referenceScope:ref,currentReferenceScope:ref};
      const whole=evaluateSharedEvidenceDecision({...common,budgetCoordinate:'whole-modeled'});
      const diagnostic=evaluateSharedEvidenceDecision({...common,budgetCoordinate:workflow==='guided'?'whole-estimated':'video-only'});
      const crossed=evaluateSharedEvidenceDecision({...common,currentReferenceScope:scope(workflow==='guided'?'manual-source-sdr':'guided-ass-rendered'),budgetCoordinate:'whole-modeled'});
      results.push({workflow,whole:whole.phase,branch:whole.candidate?.branchId,
        diagnostic:diagnostic.phase,crossed:crossed.reason,
        canCommit:whole.canCommit});
    }
    return results;
  });
  if(evidence.some(x=>x.whole!=='recommendation'||x.branch!=='h265'||
       x.diagnostic!=='diagnosis-only'||x.crossed!=='wrong-reference-domain'||x.canCommit))
    throw Error('Shared decision semantics diverged inside real production browser '+JSON.stringify(evidence));
  const manual=page.locator('#taskCompareBudgetBasis');
  if(await manual.count()===0)throw Error('Manual candidate budget selector absent');
  if(await manual.inputValue()!=='whole')throw Error('Manual default budget should be full file, not video-only');
  await manual.selectOption('video');
  if(await manual.inputValue()!=='video')throw Error('User cannot explicitly choose diagnostic video-only axis');
  await manual.selectOption('whole');
  console.log('WU09 production Chromium shared Guided/Manual recommendation and diagnostic-only budget gates PASS (synthetic fitted models; no Native samples)');
 }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
