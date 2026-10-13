const assert=require('node:assert/strict');
module.exports=async(browser,baseUrl)=>{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 try{
  await page.goto(baseUrl);
  const result=await page.evaluate(async()=>{
   const {mountAudioStreamPlan}=await import('/src/audio-stream-plan-ui.js');
   const form=document.createElement('form');form.id='audio-fixture';
   form.innerHTML='<input name="audio" value="copy"><input name="audioTrack" value="all"><input name="audioBitrate" value="96000"><input name="audioRange" value="trim">';
   document.body.replaceChildren(form);let source='one';
   const view=mountAudioStreamPlan({container:form,form,media:()=>({audioTracks:2,audioStreams:[{codec:'aac'},{codec:'flac'}]}),sourceIdentity:()=>source});
   const global=form.elements.namedItem('audio');global.value='aac';global.dispatchEvent(new Event('change',{bubbles:true}));
   const actions=view.panel.querySelectorAll('[aria-label$="输出动作"]');actions[1].value='drop';actions[1].dispatchEvent(new Event('change',{bubbles:true}));
   await Promise.resolve();const first=JSON.parse(form.elements.namedItem('audioPlan').value);
   form.elements.namedItem('audioPlan').value=JSON.stringify([{sourceOrdinal:0,action:'libopus',bitrate:64000,range:'full'},{sourceOrdinal:1,action:'copy',range:'trim'}]);
   view.refresh();const loaded=[...view.panel.querySelectorAll('[aria-label$="输出动作"]')].map(x=>x.value);
   source='two';view.refresh();await Promise.resolve();
   return {first,loaded,reset:form.elements.namedItem('audioPlan').value};
  });
  assert.equal(result.first[0].action,'aac');assert.equal(result.first[0].bitrate,96000);assert.equal(result.first[1].action,'drop');
  assert.deepEqual(result.loaded,['libopus','copy']);assert.equal(result.reset,'');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }finally{await page.close();}
 console.log('Per-track audio UI ownership, global defaults, config refresh and source reset passed.');
};
