// A shared, strictly separated decision-reference identity for Manual source
// SSIM and Guided ASS-rendered SSIM. No hash is a content attestation.
// Every comparison must still verify its actual Native sample receipts.
const valid=s=>typeof s==='string'&&s.length>0;
const entry=f=>[String(f?.name||''),Number(f?.size||0),Number(f?.lastModified||0)];
const canonical=o=>Object.entries(o||{}).sort(([a],[b])=>a.localeCompare(b,'en')).map(([a,b])=>[String(a),String(b)]);
function signature(str){
  // Fast cache invalidation only; NOT cryptographic provenance. Include length.
  let h=0xcbf29ce484222325n;
  for(let i=0;i<str.length;i++){
    h^=BigInt(str.charCodeAt(i));
    h=BigInt.asUintN(64,h*0x100000001b3n);
  }
  return str.length+':'+h.toString(16).padStart(16,'0');
}
export function guidedAssDecisionScope({
  sourceKey,runtimeKey,assText,fonts=[],fontBindings={},
  autoFontFallbacks={},renderer='windows-libass',revision='guided-ass-rendered-v1'
}={}){
  if(!valid(sourceKey)||!valid(runtimeKey)||!valid(assText)||
     !valid(renderer)||!valid(revision)||!Array.isArray(fonts)||
     fonts.some(f=>!f||!valid(f.name)||!Number.isFinite(Number(f.size))||
       Number(f.size)<0||!Number.isFinite(Number(f.lastModified))))return null;
  const render=JSON.stringify([
    assText,fonts.map(entry).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en')),
    canonical(fontBindings),canonical(autoFontFallbacks),renderer,revision
  ]);
  return JSON.stringify(['decision-reference-v1','guided-ass-rendered',
    sourceKey,runtimeKey,signature(render)]);
}
export function manualSourceDecisionScope(protocol){
  if(!protocol||protocol.method!=='windows-native-exact-cq-v1'||
     !['source-sdr-yuv420p-ssim-v1','source-sdr-bicubic-upscale-ssim-v1']
       .includes(protocol.referenceMetric)||
     !['sourceToken','runtimeToken','referenceToken','filterToken','samplePlanVersion']
       .every(k=>valid(protocol[k]))||
     !Array.isArray(protocol.windows)||!protocol.windows.length)return null;
  return JSON.stringify(['decision-reference-v1','manual-source-sdr',
    protocol.sourceToken,protocol.runtimeToken,protocol.referenceToken,
    protocol.filterToken,protocol.referenceMetric,protocol.samplePlanVersion,
    protocol.windows.map(w=>[w.start,w.duration])]);
}
export function sameDecisionReference(left,right){
  return valid(left)&&valid(right)&&left===right;
}
