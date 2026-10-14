// Read-only, session-scoped preparation of comparable Manual Transcode CQ/CRF evidence.
// This module does NOT run encoders, persist samples, infer provenance, switch codecs,
// or make whole-file output-quality/size guarantees.
import { fitRateDistortionModel } from './rate-distortion-model.js';
import { createMultiBranchFrontier } from './compression-decision.js';
import {manualSourceDecisionScope} from './decision-reference-scope.js';

const finite = v => typeof v === 'number' && Number.isFinite(v);
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
const within = (a, b, tolerance=1e-3) => Math.abs(a-b) <= tolerance;

// These fields MUST identify the same decoded source, reference comparison
// process and paired requested windows for all candidate configurations.
// Caller tokens are evidence *claims*, not a cryptographic source attestation.
export function normalizeManualComparisonProtocol(raw) {
  if (!raw || typeof raw !== 'object' ||
      !['windows-native-exact-cq-v1'].includes(raw.method) ||
      !['source-sdr-yuv420p-ssim-v1','source-sdr-bicubic-upscale-ssim-v1'].includes(raw.referenceMetric) ||
      !nonempty(raw.sourceToken) || !nonempty(raw.runtimeToken) ||
      !nonempty(raw.referenceToken) || !nonempty(raw.filterToken) ||
      !nonempty(raw.samplePlanVersion) ||
      !finite(raw.mediaDuration) || !(raw.mediaDuration>0) ||
      !finite(raw.rangeStart) || !finite(raw.rangeEnd) ||
      !(raw.rangeStart>=0 && raw.rangeEnd>raw.rangeStart) ||
      raw.rangeEnd>raw.mediaDuration + 1e-3 ||
      !Number.isSafeInteger(raw.videoStream) || raw.videoStream<0 ||
      !Number.isSafeInteger(raw.referenceWidth) || raw.referenceWidth<=0 ||
      !Number.isSafeInteger(raw.referenceHeight) || raw.referenceHeight<=0 ||
      !Array.isArray(raw.windows) || raw.windows.length===0 ||
      raw.windows.length>24) return {ok:false,reason:'invalid-protocol'};

  const windows=[];
  for(const w of raw.windows) {
    if(!finite(w?.start) || !finite(w?.duration) ||
      w.start < raw.rangeStart-1e-3 || !(w.duration>0) ||
      w.start+w.duration > raw.rangeEnd+1e-3)
      return {ok:false,reason:'invalid-sample-windows'};
    windows.push({start:w.start,duration:w.duration});
  }
  windows.sort((a,b)=>a.start-b.start);
  if(windows.some((w,i)=>i>0 && w.start<windows[i-1].start+windows[i-1].duration-1e-3))
    return {ok:false,reason:'overlapping-sample-windows'};

  const protocol={
    schemaVersion:1,method:raw.method,referenceMetric:raw.referenceMetric,
    sourceToken:raw.sourceToken,runtimeToken:raw.runtimeToken,
    referenceToken:raw.referenceToken,filterToken:raw.filterToken,
    samplePlanVersion:raw.samplePlanVersion,
    mediaDuration:raw.mediaDuration,rangeStart:raw.rangeStart,
    rangeEnd:raw.rangeEnd,videoStream:raw.videoStream,
    referenceWidth:raw.referenceWidth,referenceHeight:raw.referenceHeight,
    windows
  };
  return {ok:true,protocol,scope:JSON.stringify(protocol)};
}

export function validManualCandidateGeometry(candidate, protocol) {
  const w=candidate?.outputWidth,h=candidate?.outputHeight;
  if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<=0||h<=0||candidate.pixelFormat!=='yuv420p')return false;
  if(protocol.referenceMetric==='source-sdr-yuv420p-ssim-v1')return w===protocol.referenceWidth&&h===protocol.referenceHeight;
  return w%2===0&&h%2===0&&w<=protocol.referenceWidth&&h<=protocol.referenceHeight;
}
export function validManualReceiptGeometry(receipt,candidate,protocol) {
  if(!validManualCandidateGeometry(candidate,protocol))return false;
  return protocol.referenceMetric!=='source-sdr-bicubic-upscale-ssim-v1'||
    (receipt.outputWidth===candidate.outputWidth&&receipt.outputHeight===candidate.outputHeight&&
     receipt.referenceWidth===protocol.referenceWidth&&receipt.referenceHeight===protocol.referenceHeight);
}
function checkCandidate(candidate, protocol) {
  return candidate&&nonempty(candidate.id)&&nonempty(candidate.codec)&&nonempty(candidate.encoder)&&nonempty(candidate.preset)&&validManualCandidateGeometry(candidate,protocol)
    ?{ok:true}:{ok:false,reason:'unsupported-candidate-geometry'};
}

// Short-sample results must cover the *same requested windows* at every CQ/CRF
// measurement. A missing or mismatched segment is not a low-quality observation.
function validatePoints(points, protocol) {
  if(!Array.isArray(points) || points.length<2 || points.length>128)
    return {ok:false,reason:'insufficient-trials'};
  const rates=new Set();
  for(const p of points) {
    if(!finite(p?.sampleBitrate) || !(p.sampleBitrate>0) ||
       !finite(p?.ssim) || p.ssim<0 || p.ssim>1 ||
       !finite(p?.averageSsim) || p.averageSsim<0 || p.averageSsim>1 ||
       !Array.isArray(p?.sampleMeasurements) ||
       p.sampleMeasurements.length!==protocol.windows.length)
      return {ok:false,reason:'invalid-trial-evidence'};
    rates.add(Math.round(p.sampleBitrate));
    const measured=[...p.sampleMeasurements].sort((a,b)=>a.start-b.start);
    for(let i=0;i<measured.length;i++){
      const s=measured[i],window=protocol.windows[i];
      if(!finite(s?.start) || !within(s.start,window.start) ||
         !finite(s?.duration) || !(s.duration>0) ||
         // Tolerate frame-quantization, but reject observations over a very
         // different portion of the source timeline.
         Math.abs(s.duration-window.duration)>Math.max(.10,window.duration*.025) ||
         !finite(s?.ssim) || s.ssim<0 || s.ssim>1 ||
         !finite(s?.bitrate) || !(s.bitrate>0))
        return {ok:false,reason:'unpaired-sample-evidence'};
    }
    // Verify the published aggregate against the supplied per-window evidence.
    // A fitted quality point is not valid if it summarizes a different trial.
    const min=Math.min(...measured.map(s=>s.ssim));
    const avg=measured.reduce((sum,s)=>sum+s.ssim,0)/measured.length;
    const bitrate=measured.reduce((sum,s)=>sum+s.bitrate,0)/measured.length;
    if(!within(p.ssim,min,1e-5) || !within(p.averageSsim,avg,1e-5) ||
       Math.abs(p.sampleBitrate-bitrate)>Math.max(1,bitrate*.0001))
      return {ok:false,reason:'inconsistent-trial-summary'};
  }
  return rates.size>=2 ? {ok:true} : {ok:false,reason:'insufficient-distinct-rates'};
}

export function createManualTranscodeComparison({trials,budget,incumbentId=null,hysteresisSsim=.003}={}) {
  if(!Array.isArray(trials) || trials.length<2 || trials.length>12)
    return {ok:false,reason:'insufficient-branches'};
  if(!budget || !finite(budget.durationSeconds) || !(budget.durationSeconds>0) ||
     !finite(budget.audioBitrate) || !(budget.audioBitrate>=0) ||
     !['measured','estimated','no-audio'].includes(budget.audioEvidence) ||
     (budget.audioEvidence==='no-audio' && budget.audioBitrate!==0) ||
     !finite(budget.reservePercent) || budget.reservePercent<0 || budget.reservePercent>=100)
    return {ok:false,reason:'unknown-output-budget'};
  const first=normalizeManualComparisonProtocol(trials[0]?.protocol);
  if(!first.ok) return first;
  const referenceScope=manualSourceDecisionScope(first.protocol);
  if(!referenceScope)return {ok:false,reason:'invalid-manual-reference-scope'};
  // Output duration may be shorter than the source range on explicit transforms,
  // but the current exact Manual sample protocol forbids speed/time transforms.
  if(!within(budget.durationSeconds,first.protocol.rangeEnd-first.protocol.rangeStart,1e-3))
    return {ok:false,reason:'incompatible-output-duration'};

  const seen=new Set(),branches=[];
  for(const trial of trials){
    const normalized=normalizeManualComparisonProtocol(trial?.protocol);
    if(!normalized.ok) return normalized;
    if(normalized.scope!==first.scope || manualSourceDecisionScope(normalized.protocol)!==referenceScope)
      return {ok:false,reason:'incompatible-measurement-protocol'};
    const candidate=checkCandidate(trial.candidate,first.protocol);
    if(!candidate.ok) return candidate;
    if(seen.has(trial.candidate.id))
      return {ok:false,reason:'duplicate-candidate'};
    seen.add(trial.candidate.id);
    const validated=validatePoints(trial.points,first.protocol);
    if(!validated.ok) return validated;
    const model=fitRateDistortionModel(trial.points,{metric:'ssim'});
    if(!model.ok) return {ok:false,reason:'invalid-rate-distortion-model'};
    branches.push({
      id:trial.candidate.id,preset:trial.candidate.preset,model,
      measurementScope:first.scope
    });
  }
  const frontier=createMultiBranchFrontier(branches,{
    durationSeconds:budget.durationSeconds,
    audioBitrate:budget.audioBitrate,reservePercent:budget.reservePercent,
    incumbentId,hysteresisSsim
  });
  if(!frontier.ok) return {ok:false,reason:frontier.reason};
  return {
    ok:true,kind:'manual-comparable-candidates-v1',
    evidenceScope:first.scope,referenceScope,referenceDomain:'pure-source-sdr-no-ass',
    protocol:first.protocol,
    audioEvidence:budget.audioEvidence,branchIds:frontier.branchIds,
    // The decision engine remains read-only; adopting a different codec
    // requires a new formal task compiler run and independent VBR evidence.
    frontier,adoptionRequiresNativeVbrVerification:true,
    sessionOnly:true
  };
}


// Admission gateway for a real Windows Native CQ sample. Trust is still
// bounded by the local bridge, but a caller cannot silently relabel a stale
// bitrate-mode, changed-source, changed-preset or wrong-window result as CQ.
export function admitManualNativeCqSample({sample,protocol,candidate,window,qualitySetting}={}) {
  const norm=normalizeManualComparisonProtocol(protocol);
  if(!norm.ok) return norm;
  const p=norm.protocol,receipt=sample?.nativeEvidence;
  if(!receipt || receipt.schemaVersion!==1 ||
      receipt.method!=='windows-native-exact-cq-v1' ||
      receipt.referenceMetric!==p.referenceMetric ||
      receipt.sourceToken!==p.sourceToken ||
      receipt.runtimeToken!==p.runtimeToken ||
      receipt.referenceToken!==p.referenceToken ||
      receipt.filterToken!==p.filterToken ||
      receipt.identityKind!=='file-stat-snapshot-not-content-hash' ||
      receipt.videoStream!==p.videoStream ||
      receipt.pixelFormat!=='yuv420p' ||
      receipt.mode!=='quality' || receipt.requestedRate!==0)
    return {ok:false,reason:'incompatible-native-receipt'};
  if(!candidate || !nonempty(candidate.id) ||
      receipt.encoder!==candidate.encoder ||
      receipt.preset!==candidate.preset ||
      !validManualReceiptGeometry(receipt,candidate,p) ||
      candidate.pixelFormat!=='yuv420p')
    return {ok:false,reason:'wrong-native-encoder-or-geometry'};
  const q=Number(qualitySetting);
  const expected=p.windows.find(w=>w.start===window?.start &&
    w.duration===window?.duration);
  if(!expected || !Number.isSafeInteger(q) || q<0 || q>63 ||
      receipt.requestedQuality!==q ||
      !finite(receipt.requestedStart) ||
      !within(receipt.requestedStart,expected.start) ||
      !finite(receipt.requestedDuration) ||
      !within(receipt.requestedDuration,expected.duration) ||
      !finite(receipt.actualDuration) || !(receipt.actualDuration>0) ||
      Math.abs(receipt.actualDuration-expected.duration)>
        Math.max(.10,expected.duration*.025) ||
      !finite(sample?.duration) ||
      !within(sample.duration,receipt.actualDuration,.001))
    return {ok:false,reason:'wrong-native-quality-or-sample-window'};
  const quality=Number(sample?.ssim),bytes=Number(sample?.totalVideoBytes);
  if(!finite(sample?.ssim) || !(quality>=0&&quality<=1) ||
      !finite(sample?.totalVideoBytes) || !(bytes>0) ||
      sample.encoder!==receipt.encoder)
    return {ok:false,reason:'invalid-native-sample-measurement'};
  return {ok:true,measurement:{
    start:receipt.requestedStart,duration:receipt.actualDuration,
    ssim:quality,bitrate:bytes*8/receipt.actualDuration
  },sourceToken:p.sourceToken,runtimeToken:p.runtimeToken,
  qualitySetting:q};
}
