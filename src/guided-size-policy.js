// One user-visible execution policy. A size target is not automatically a hard byte ceiling.
export const GUIDED_SIZE_POLICIES=Object.freeze(['best-effort','two-pass','strict-ceiling']);
export function resolveGuidedSizePolicy({mode,codec,backend,policy='best-effort',ceilingBytes=0}={}){
  if(mode!=='budget-rate')return {ok:policy==='best-effort',reason:policy==='best-effort'?null:'not-a-budget-job',policy:'best-effort',twoPass:false,strict:false};
  if(!GUIDED_SIZE_POLICIES.includes(policy))return {ok:false,reason:'unknown-policy'};
  const software=policy!=='best-effort';
  if(software&&(codec!=='h264'||backend!=='windows-native'))
    return {ok:false,reason:'software-h264-windows-only',policy};
  if(policy==='strict-ceiling'&&!(Number.isSafeInteger(ceilingBytes)&&ceilingBytes>0))
    return {ok:false,reason:'missing-byte-ceiling',policy};
  return {ok:true,policy,twoPass:software,strict:policy==='strict-ceiling',
    softwareEncoder:software?'libx264':null};
}
