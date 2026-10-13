import {guidedResolutionCandidates} from './compression-resolutions.js';
// Finite, explicitly selected experiments; no claim of global optimization.
export function manualCandidateSet(policy='codecs',geometry={}) {
 if(!['codecs','codecs-presets','codecs-presets-resolutions'].includes(policy)||!Number.isSafeInteger(geometry.width)||!Number.isSafeInteger(geometry.height)||geometry.width<=0||geometry.height<=0)throw Error('候选策略或参考尺寸无效');
 const presets=policy!=='codecs'?['medium','fast']:['medium'];
 const candidates=presets.flatMap(preset=>[
  {id:'h264-x264'+(preset==='medium'?'':'-'+preset),codec:'h264',encoder:'libx264',preset},
  {id:'h265-x265'+(preset==='medium'?'':'-'+preset),codec:'h265',encoder:'libx265',preset}
 ]).map(c=>({...c,outputWidth:geometry.width,outputHeight:geometry.height,pixelFormat:'yuv420p'}));
 const sizes=policy==='codecs-presets-resolutions'?guidedResolutionCandidates(geometry):[];
 if(policy==='codecs-presets-resolutions'&&!sizes.length)throw Error('不支持的参考尺寸');
 const expanded=sizes.length?sizes.flatMap(size=>candidates.map(c=>({...c,id:c.id+'@'+size.id,outputWidth:size.displayWidth,outputHeight:size.displayHeight,scaleAlgorithm:'bicubic'}))):candidates;
 return {candidates:expanded,maxRequests:expanded.length*2*3};
}
