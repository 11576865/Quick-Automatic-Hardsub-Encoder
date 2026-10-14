// R19 §06 / R24 §09: keyframes are an informed preflight hint,
// NOT a guarantee about output first frame, B-frame decoding or PTS/DTS.
export function assessCopyCutStart({requestedIn,keyframes=[],truncated=false,evidenceCurrent=false,tolerance=.0005}={}){
 const start=Number(requestedIn);
 if(!Number.isFinite(start)||start<0)throw Error('Requested IN must be nonnegative');
 if(start===0)return Object.freeze({state:'beginning',requestedIn:start,estimatedIn:0,delta:0,
  description:'从源文件起点快速复制；仍须检查成品首帧与时间戳。'});
 if(!evidenceCurrent||!Array.isArray(keyframes)||!keyframes.length)
  return Object.freeze({state:'unknown',requestedIn:start,estimatedIn:null,delta:null,
   description:'尚无当前视频流的有效关键帧证据；无法预测实际快速复制切入点。'});
 const usable=keyframes.map(Number).filter(k=>Number.isFinite(k)&&k>=0&&k<=start+tolerance)
   .sort((a,b)=>a-b);
 const last=keyframes.map(Number).filter(Number.isFinite).reduce((a,b)=>Math.max(a,b),-1);
 if(!usable.length||(truncated&&start>last+tolerance))
  return Object.freeze({state:'unknown',requestedIn:start,estimatedIn:null,delta:null,
   description:'关键帧信息不覆盖该 IN 位置；不能推断真实切点。'});
 const estimatedIn=usable.at(-1),delta=Math.max(0,start-estimatedIn);
 if(delta<=tolerance)
  return Object.freeze({state:'predicted-aligned',requestedIn:start,estimatedIn,delta,
   description:'已检测到邻近请求 IN 的关键帧，但不能保证成品帧精确。'});
 return Object.freeze({state:'predicted-early',requestedIn:start,estimatedIn,delta,
  description:'按关键帧估计，快速复制可能提前切入；结果仍须逐包和实际 PTS/DTS 验证。'});
}
