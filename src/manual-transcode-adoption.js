// Synchronous transactional handoff for explicitly approved, short-window
// VBR-verified Manual candidates. Never runs encoders or claims final output.
// Caller must preflight certificate and native formal task first.
const valid=(v)=>typeof v==='string'&&v.length>0;
export function commitVerifiedManualCandidate({
  candidate,bitrate,wholeBudget=null,expectedSettings,expectedSourceIdentity,
  read,sourceIdentity,get,updateEncoder,updatePreset,updateRate,
  compile,media
}={}) {
  if(!candidate||!['h264','h265'].includes(candidate.codec)||
     !({h264:'libx264',h265:'libx265'}[candidate.codec]===candidate.encoder)||
     !valid(candidate.preset)||!Number.isSafeInteger(bitrate)||bitrate<=0||
     !expectedSettings||expectedSettings.operation!=='transcode'||
     !valid(expectedSourceIdentity)||typeof read!=='function'||
     typeof sourceIdentity!=='function'||typeof get!=='function'||
     typeof updateEncoder!=='function'||typeof updatePreset!=='function'||
     typeof updateRate!=='function'||typeof compile!=='function')
    return {ok:false,reason:'invalid-adoption-request'};
  if(JSON.stringify(read())!==JSON.stringify(expectedSettings)||
     sourceIdentity()!==expectedSourceIdentity)
    return {ok:false,reason:'stale-adoption-settings'};
  if(wholeBudget&&(!Number.isSafeInteger(wholeBudget.targetBytes)||wholeBudget.targetBytes<=0||wholeBudget.targetBytes>1e13||!Number.isFinite(wholeBudget.reservePercent)||wholeBudget.reservePercent<1||wholeBudget.reservePercent>30||!['best-effort','strict-ceiling'].includes(wholeBudget.budgetPolicy)))return {ok:false,reason:'invalid-whole-file-budget'};
  const sized=candidate.scaleAlgorithm==='bicubic';
  if(sized&&(!Number.isSafeInteger(candidate.outputWidth)||!Number.isSafeInteger(candidate.outputHeight)||candidate.outputWidth<2||candidate.outputHeight<2))return {ok:false,reason:'invalid-adoption-geometry'};
  const names=['codec','encoder','preset','multipass','rateMode','bitrate','twoPass',...(wholeBudget?['targetSize','sizeUnit','sizeReserve','budgetPolicy']:[]),...(sized?['width','height','scaleAlgorithm']:[])];
  const saved=new Map();
  for(const name of names){
    const el=get(name);
    if(!el)return {ok:false,reason:'missing-form-control'};
    saved.set(name,{value:el.value,checked:el.checked});
  }
  function assign(){
    get('codec').value=candidate.codec;
    if(get('codec').value!==candidate.codec)throw Error('unsupported-codec');
    updateEncoder();
    get('encoder').value=candidate.encoder;
    if(get('encoder').value!==candidate.encoder)throw Error('unsupported-encoder');
    updatePreset();
    get('preset').value=candidate.preset;
    if(get('preset').value!==candidate.preset)throw Error('unsupported-preset');
    get('multipass').value='disabled';
    get('rateMode').value=wholeBudget?'size':'bitrate';
    get('bitrate').value=String(bitrate);
    get('twoPass').checked=false;
    if(sized){get('width').value=String(candidate.outputWidth);get('height').value=String(candidate.outputHeight);get('scaleAlgorithm').value='bicubic';}
    if(wholeBudget){get('targetSize').value=String(wholeBudget.targetBytes/1e6);get('sizeUnit').value='MB';get('sizeReserve').value=String(wholeBudget.reservePercent);get('budgetPolicy').value=wholeBudget.budgetPolicy;}
    updateRate();
    const actual=read();
    if(sized&&(Number(actual.width)!==candidate.outputWidth||Number(actual.height)!==candidate.outputHeight||actual.scaleAlgorithm!=='bicubic'))throw Error('form-geometry-diverged');
    if(actual.codec!==candidate.codec||actual.encoder!==candidate.encoder||
      actual.preset!==candidate.preset||actual.multipass!=='disabled'||
      actual.rateMode!==(wholeBudget?'size':'bitrate')||Number(actual.bitrate)!==bitrate||
      actual.twoPass!==false)
      throw Error('form-plan-diverged');
    const task=compile(actual,media);
    if(task.operation!=='transcode'||task.codec!==candidate.codec||
       task.encoder!==candidate.encoder||task.preset!==candidate.preset||
       task.rateMode!==(wholeBudget?'size':'bitrate')||Number(task.bitrate)!==bitrate)
      throw Error('compiled-plan-diverged');
    if(wholeBudget&&(task.sizePlan?.targetBytes!==wholeBudget.targetBytes||task.sizePlan?.reservePercent!==wholeBudget.reservePercent||task.budgetPolicy!==wholeBudget.budgetPolicy||task.sizeCeilingBytes!==(wholeBudget.budgetPolicy==='strict-ceiling'?wholeBudget.targetBytes:0)))throw Error('compiled-budget-diverged');
    if(sized&&(!task.outputArgs?.includes('scale='+candidate.outputWidth+':'+candidate.outputHeight+':flags=bicubic') && !task.outputArgs?.some(x=>String(x).includes('scale='+candidate.outputWidth+':'+candidate.outputHeight+':flags=bicubic'))))throw Error('compiled-geometry-diverged');
    return task;
  }
  try{
    const task=assign();
    // Signal only AFTER every field is updated and a full task has compiled.
    // Listening forms must see one coherent transaction, not intermediate
    // codec/encoder/preset states; a rejection must not emit an input event.
    return {ok:true,kind:'manual-explicit-vbr-handoff-v1',task};
  }catch(error){
    try{
      get('codec').value=saved.get('codec').value;
      updateEncoder();
      get('encoder').value=saved.get('encoder').value;
      updatePreset();
      for(const name of names){
        const control=get(name),previous=saved.get(name);
        if(name!=='codec'&&name!=='encoder')control.value=previous.value;
        if(name==='twoPass')control.checked=previous.checked;
      }
      updateRate();
    }catch{
      return {ok:false,reason:'adoption-rollback-failed'};
    }
    return {ok:false,reason:'adoption-rejected',detail:String(error?.message||error)};
  }
}
