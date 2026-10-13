// Same verification principles as Manual's VBR gate, but an incompatible,
// subtitle-rendered FFV1 reference. A short result is not a whole-film claim.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const near=(a,b,t=.001)=>Math.abs(a-b)<=t;
export function verifyGuidedNativeVbr({
  plan,referenceScope,windows,samples,targetSsim,expectedEncoder
}={}){
  if(!plan||plan.mode!=='budget-rate'||plan.sizeBudgetPolicy!=='best-effort'||
     !['h264','h265','av1'].includes(plan.codec)||!finite(plan.targetVideoBitrate)||
     !Number.isSafeInteger(plan.targetVideoBitrate)||plan.targetVideoBitrate<=0||
     !Number.isSafeInteger(plan.sizeCeiling)||plan.sizeCeiling<=0||
     !finite(targetSsim)||targetSsim<.8||targetSsim>.9999||
     typeof referenceScope!=='string'||!referenceScope.includes('guided-ass-rendered')||
     typeof expectedEncoder!=='string'||!expectedEncoder.length ||
     !Array.isArray(windows)||windows.length<2||windows.length>3||
     !Array.isArray(samples)||samples.length!==windows.length)
    return {ok:false,reason:'invalid-guided-vbr-request'};
  const ordered=[...windows].sort((a,b)=>a.start-b.start);
  if(ordered.some((w,i)=>!finite(w?.start)||!finite(w?.duration)||w.start<0||w.duration<=0||
       w.duration>8||i>0&&w.start<ordered[i-1].start+ordered[i-1].duration-.001))
    return {ok:false,reason:'invalid-paired-vbr-windows'};
  const results=[];
  let origin=null,fonts=null;
  for(const window of ordered){
    const matching=samples.filter(x=>x?.window?.start===window.start&&x.window.duration===window.duration);
    if(matching.length!==1)return {ok:false,reason:'missing-or-duplicate-guided-window'};
    const {sample,assTextSha256}=matching[0],r=sample?.nativeEvidence;
    if(!r||r.schemaVersion!==1||
       r.method!=='windows-native-exact-guided-ass-vbr-v1'||
       r.referenceDomain!=='guided-ass-rendered'||
       r.referenceMetric!==(plan.outputWidth>0?'ass-rendered-bicubic-upscale-ssim-v1':'ass-rendered-yuv420p-ssim-v1')||
       r.identityKind!=='file-stat-snapshot-plus-staged-asset-sha256'||
       r.mode!=='bitrate'||r.requestedRate!==plan.targetVideoBitrate||
       r.requestedQuality!==null||r.codec!==plan.codec||
       r.encoder!==expectedEncoder||sample.encoder!==expectedEncoder||
       r.preset!==plan.preset||r.multipass!=='disabled'||r.videoStream!==0||
       r.pixelFormat!=='yuv420p'||
       r.outputWidth!==(plan.outputWidth||0)||r.outputHeight!==(plan.outputHeight||0)||
       (plan.outputWidth>0&&(r.referenceWidth!==plan.referenceWidth||r.referenceHeight!==plan.referenceHeight))||
       typeof r.assTextSha256!=='string'||r.assTextSha256!==assTextSha256||
       !/^[a-f0-9]{64}$/.test(r.assTextSha256)||
       !/^[a-f0-9]{64}$/.test(r.fontContentSha256||'')||
       !Number.isSafeInteger(r.fontCount)||r.fontCount<0)
      return {ok:false,reason:'incompatible-guided-rendered-receipt'};
    if(!finite(r.requestedStart)||!near(r.requestedStart,window.start)||
       !finite(r.requestedDuration)||!near(r.requestedDuration,window.duration)||
       !finite(r.actualDuration)||r.actualDuration<=0||
       Math.abs(r.actualDuration-window.duration)>Math.max(.10,window.duration*.025)||
       !finite(sample.duration)||!near(sample.duration,r.actualDuration)||
       !finite(sample.ssim)||sample.ssim<0||sample.ssim>1||
       !finite(sample.totalVideoBytes)||sample.totalVideoBytes<=0||
       !finite(sample.elapsedSeconds)||sample.elapsedSeconds<=0)
      return {ok:false,reason:'invalid-guided-vbr-measurement'};
    const id=JSON.stringify([r.sourceToken,r.runtimeToken]);
    if(!r.sourceToken||!r.runtimeToken||origin!==null&&origin!==id)
      return {ok:false,reason:'guided-origin-drift'};
    if(fonts!==null&&fonts!==r.fontContentSha256)
      return {ok:false,reason:'guided-font-bytes-drift'};
    origin=id;fonts=r.fontContentSha256;
    results.push({start:window.start,duration:r.actualDuration,ssim:sample.ssim,
      videoBitrate:sample.totalVideoBytes*8/r.actualDuration,
      encodeSeconds:sample.elapsedSeconds});
  }
  const lowest=Math.min(...results.map(x=>x.ssim));
  return {ok:true,passed:lowest>=targetSsim,
    kind:'native-guided-ass-rendered-short-vbr-v1',
    referenceScope,sourceRuntimeStamp:origin,fontContentSha256:fonts,
    requestedVideoBitrate:plan.targetVideoBitrate,budgetBytes:plan.sizeCeiling,
    targetSsim,minimumSsim:lowest,observations:results,
    averageVideoBitrate:results.reduce((sum,x)=>sum+x.videoBitrate,0)/results.length,
    measuredWindows:results.length,outputBytesVerified:false,
    wholeMovieQualityVerified:false,canAutoAdopt:false};
}
