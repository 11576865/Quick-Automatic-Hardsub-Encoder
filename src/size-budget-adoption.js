// Confirmed size selection keeps the current encoder; rollback is local to budget fields.
export function commitVerifiedSizeBudget({budget,expectedSettings,expectedSourceIdentity,read,sourceIdentity,get,updateRate,compile,media}={}){
 if(!budget||!Number.isSafeInteger(budget.targetBytes)||budget.targetBytes<=0||budget.targetBytes>1e13||!Number.isSafeInteger(budget.bitrate)||budget.bitrate<=0||!Number.isFinite(budget.reservePercent)||budget.reservePercent<1||budget.reservePercent>30||!['best-effort','strict-ceiling'].includes(budget.budgetPolicy)||!expectedSourceIdentity||!expectedSettings||typeof read!=='function'||typeof sourceIdentity!=='function'||typeof get!=='function'||typeof updateRate!=='function'||typeof compile!=='function')return {ok:false,reason:'invalid-budget-selection'};
 if(sourceIdentity()!==expectedSourceIdentity||JSON.stringify(read())!==JSON.stringify(expectedSettings))return {ok:false,reason:'stale-budget-selection'};
 const names=['rateMode','bitrate','targetSize','sizeUnit','sizeReserve','budgetPolicy','twoPass'],saved=new Map();
 for(const name of names){const el=get(name);if(!el)return {ok:false,reason:'missing-budget-control'};saved.set(name,{value:el.value,checked:el.checked});}
 try{
  const values={rateMode:'size',bitrate:String(budget.bitrate),targetSize:String(budget.targetBytes/1e6),sizeUnit:'MB',sizeReserve:String(budget.reservePercent),budgetPolicy:budget.budgetPolicy};
  for(const [k,v] of Object.entries(values))get(k).value=v;
  get('twoPass').checked=false;updateRate();
  const actual=read(),task=compile(actual,media);
  if(actual.twoPass!==false||task.rateMode!=='size'||task.bitrate!==budget.bitrate||task.sizePlan?.targetBytes!==budget.targetBytes||task.sizePlan?.reservePercent!==budget.reservePercent||task.budgetPolicy!==budget.budgetPolicy||task.sizeCeilingBytes!==(budget.budgetPolicy==='strict-ceiling'?budget.targetBytes:0)||['codec','encoder','preset'].some(k=>actual[k]!==expectedSettings[k]||task[k]!==expectedSettings[k]))throw Error('compiled-budget-selection-diverged');
  return {ok:true,task};
 }catch(error){try{for(const [k,v] of saved){get(k).value=v.value;get(k).checked=v.checked;}updateRate();}catch{return {ok:false,reason:'budget-rollback-failed'};}return {ok:false,reason:'budget-selection-rejected',detail:error.message};}
}
