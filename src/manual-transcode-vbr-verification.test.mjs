import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyManualNativeVbrCandidate} from './manual-transcode-vbr-verification.js';
const protocol=()=>({
  method:'windows-native-exact-cq-v1',referenceMetric:'source-sdr-yuv420p-ssim-v1',
  sourceToken:'stat-sha256:input',runtimeToken:'stat-sha256:binary',
  referenceToken:'direct-source-v0-yuv420p-setpts-ssim-v1',
  filterToken:'no-video-filters-sdr-yuv420p-v1',samplePlanVersion:'paired-v1',
  mediaDuration:10,rangeStart:0,rangeEnd:10,videoStream:0,
  referenceWidth:320,referenceHeight:180,
  windows:[{start:.5,duration:2},{start:7,duration:2}]
});
const candidate=()=>({id:'h265-x265',codec:'h265',encoder:'libx265',preset:'medium',
  outputWidth:320,outputHeight:180,pixelFormat:'yuv420p'});
const bitrate=850000;
const makeSample=(window,ssim=.97)=>({
  encoder:'libx265',duration:window.duration,totalVideoBytes:Math.round(bitrate*window.duration/8),
  ssim,nativeEvidence:{
    schemaVersion:1,method:'windows-native-exact-vbr-v1',mode:'bitrate',
    requestedRate:bitrate,requestedQuality:null,
    sourceToken:'stat-sha256:input',runtimeToken:'stat-sha256:binary',
    referenceToken:'direct-source-v0-yuv420p-setpts-ssim-v1',
    filterToken:'no-video-filters-sdr-yuv420p-v1',
    referenceMetric:'source-sdr-yuv420p-ssim-v1',
    identityKind:'file-stat-snapshot-not-content-hash',videoStream:0,pixelFormat:'yuv420p',
    encoder:'libx265',preset:'medium',multipass:'disabled',
    requestedStart:window.start,requestedDuration:window.duration,actualDuration:window.duration
  }
});
const inputs=()=>{
  const p=protocol();
  return {protocol:p,candidate:candidate(),bitrate,targetSsim:.96,
    samples:p.windows.map(window=>({window,sample:makeSample(window)}))}
};
const verify=x=>verifyManualNativeVbrCandidate(x);

test('complete same-reference VBR windows produce a read-only bounded verification',()=>{
  const result=verify(inputs());
  assert.equal(result.ok,true);
  assert.equal(result.passed,true);
  assert.equal(result.minimumSsim,.97);
  assert.equal(result.measuredWindows,2);
  assert.equal(result.outputBytesVerified,false);
  assert.equal(result.wholeFileQualityVerified,false);
  assert.equal(result.permitsAutomaticAdoption,false);
  assert.equal(result.requestedVideoBitrate,bitrate);
  assert.equal(result.measuredMeanVideoBitrate,bitrate);
});

test('short sample can validly fail the SSIM target without granting approval',()=>{
  const inData=inputs();inData.samples[1].sample.ssim=.92;
  const result=verify(inData);
  assert.equal(result.ok,true);assert.equal(result.passed,false);
  assert.equal(result.minimumSsim,.92);
});

test('reject missing, overlapping or substituted sample windows',()=>{
  const missing=inputs();missing.samples.pop();
  assert.equal(verify(missing).reason,'incomplete-vbr-windows');
  const dup=inputs();dup.samples[1].window={...dup.samples[0].window};
  assert.equal(verify(dup).reason,'duplicate-or-missing-vbr-window');
  const shift=inputs();shift.samples[1].sample.nativeEvidence.requestedStart=6;
  assert.equal(verify(shift).reason,'incorrect-vbr-window-duration');
});

test('a CQ result, stale source, wrong runtime and wrong VBR rate cannot be accepted',()=>{
  for(const change of [
    ['method','windows-native-exact-cq-v1'],['mode','quality'],
    ['requestedRate',bitrate+1],['sourceToken','stale'],
    ['runtimeToken','other ffmpeg'],['referenceToken','different reference'],
    ['filterToken','rescale'],['identityKind','content-sha256']
  ]) {
    const data=inputs();data.samples[0].sample.nativeEvidence[change[0]]=change[1];
    assert.equal(verify(data).reason,'incompatible-native-vbr-receipt',change[0]);
  }
});

test('guard candidate preset, actual encoder, multipass, target and numeric SSIM',()=>{
  for(const change of [
    ['preset','slow'],['encoder','libx264'],['multipass','fullres']
  ]) {
    const data=inputs();data.samples[0].sample.nativeEvidence[change[0]]=change[1];
    assert.equal(verify(data).reason,'wrong-vbr-encoder-preset',change[0]);
  }
  for(const value of [NaN,Infinity,null,'0.95',1.1,-1]){
    const data=inputs();data.samples[0].sample.ssim=value;
    assert.equal(verify(data).reason,'invalid-vbr-measurement',String(value));
  }
  const wrong=inputs();wrong.targetSsim='0.98';
  assert.equal(verify(wrong).reason,'invalid-vbr-target');
  const wrongRate=inputs();wrongRate.bitrate=0;
  assert.equal(verify(wrongRate).reason,'invalid-vbr-target');
});
