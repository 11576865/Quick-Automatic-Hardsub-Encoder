// A native VBR evidence gate for one candidate selected from a Manual CQ
// comparison. This proves only the tested short windows, NOT whole-file output.
// It never changes the formal media task, codec, encoder, quality or bitrate.
import {normalizeManualComparisonProtocol} from './manual-transcode-comparison.js';

const finite=n=>typeof n==='number' && Number.isFinite(n);
const near=(a,b,tolerance=.001)=>Math.abs(a-b)<=tolerance;
const allowedMetric='source-sdr-yuv420p-ssim-v1';

export function verifyManualNativeVbrCandidate({
  protocol,candidate,bitrate,targetSsim,samples
}={}) {
  const norm=normalizeManualComparisonProtocol(protocol);
  if(!norm.ok)return norm;
  const p=norm.protocol;
  if(!candidate||typeof candidate.id!=='string'||!candidate.id ||
     typeof candidate.encoder!=='string'||!candidate.encoder ||
     typeof candidate.codec!=='string'||!candidate.codec ||
     typeof candidate.preset!=='string'||!candidate.preset ||
     candidate.outputWidth!==p.referenceWidth ||
     candidate.outputHeight!==p.referenceHeight ||
     candidate.pixelFormat!=='yuv420p')
    return {ok:false,reason:'invalid-vbr-candidate'};
  if(!Number.isSafeInteger(bitrate)||bitrate<=0 ||
     !finite(targetSsim)||targetSsim<.8||targetSsim>.9999)
    return {ok:false,reason:'invalid-vbr-target'};
  if(!Array.isArray(samples)||samples.length!==p.windows.length)
    return {ok:false,reason:'incomplete-vbr-windows'};
  const readings=[];
  for(const window of p.windows) {
    const matching=samples.filter(entry=>entry?.window?.start===window.start &&
      entry.window.duration===window.duration);
    if(matching.length!==1)return {ok:false,reason:'duplicate-or-missing-vbr-window'};
    const sample=matching[0].sample,receipt=sample?.nativeEvidence;
    if(!receipt||receipt.schemaVersion!==1 ||
       receipt.method!=='windows-native-exact-vbr-v1' ||
       receipt.mode!=='bitrate' || receipt.requestedRate!==bitrate ||
       receipt.requestedQuality!==null ||
       receipt.sourceToken!==p.sourceToken ||
       receipt.runtimeToken!==p.runtimeToken ||
       receipt.referenceToken!==p.referenceToken ||
       receipt.filterToken!==p.filterToken ||
       receipt.referenceMetric!==allowedMetric ||
       receipt.referenceMetric!==p.referenceMetric ||
       receipt.identityKind!=='file-stat-snapshot-not-content-hash' ||
       receipt.videoStream!==p.videoStream ||
       receipt.pixelFormat!=='yuv420p')
      return {ok:false,reason:'incompatible-native-vbr-receipt'};
    if(receipt.encoder!==candidate.encoder ||
       sample.encoder!==candidate.encoder ||
       receipt.preset!==candidate.preset ||
       receipt.multipass!=='disabled')
      return {ok:false,reason:'wrong-vbr-encoder-preset'};
    const elapsed=receipt.actualDuration;
    if(!finite(receipt.requestedStart) ||
       !near(receipt.requestedStart,window.start) ||
       !finite(receipt.requestedDuration) ||
       !near(receipt.requestedDuration,window.duration) ||
       !finite(elapsed) || elapsed<=0 ||
       Math.abs(elapsed-window.duration)>Math.max(.10,window.duration*.025) ||
       !finite(sample.duration) ||
       !near(sample.duration,elapsed,.001))
      return {ok:false,reason:'incorrect-vbr-window-duration'};
    if(!finite(sample.ssim) || sample.ssim<0 || sample.ssim>1 ||
       !finite(sample.totalVideoBytes) || sample.totalVideoBytes<=0)
      return {ok:false,reason:'invalid-vbr-measurement'};
    readings.push({
      start:window.start,duration:elapsed,
      ssim:sample.ssim,videoBitrate:sample.totalVideoBytes*8/elapsed
    });
  }
  const minSsim=Math.min(...readings.map(x=>x.ssim));
  const measuredVideoBitrate=readings.reduce((s,x)=>s+x.videoBitrate,0)/readings.length;
  return {
    ok:true,passed:minSsim>=targetSsim,
    kind:'native-manual-short-window-vbr-v1',
    candidateId:candidate.id,codec:candidate.codec,
    encoder:candidate.encoder,preset:candidate.preset,
    requestedVideoBitrate:bitrate,
    targetSsim,minimumSsim:minSsim,
    measuredMeanVideoBitrate:measuredVideoBitrate,
    sourceToken:p.sourceToken,runtimeToken:p.runtimeToken,
    referenceToken:p.referenceToken,
    measuredWindows:readings.length,
    observations:readings,
    outputBytesVerified:false,
    wholeFileQualityVerified:false,
    permitsAutomaticAdoption:false
  };
}
