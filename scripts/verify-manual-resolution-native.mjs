import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createManualTranscodeSession} from '../src/manual-transcode-session.js';
import {verifyManualNativeVbrCandidate} from '../src/manual-transcode-vbr-verification.js';
const f=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(f.branches.length,8);assert.equal(f.samples.length,32);
const first=f.samples[0].result.nativeEvidence;
assert.equal(first.referenceMetric,'source-sdr-bicubic-upscale-ssim-v1');
const protocol={method:first.method,referenceMetric:first.referenceMetric,
 sourceToken:first.sourceToken,runtimeToken:first.runtimeToken,referenceToken:first.referenceToken,filterToken:first.filterToken,
 samplePlanVersion:'native-common-resolution-2x2-v1',mediaDuration:5,rangeStart:0,rangeEnd:5,videoStream:0,
 referenceWidth:320,referenceHeight:180,windows:f.windows};
const candidates=f.branches.map(c=>({...c,pixelFormat:'yuv420p',scaleAlgorithm:'bicubic'}));
const s=createManualTranscodeSession({protocol,candidates,maxCandidates:8,maxTotalSamples:32,maxEncodeSeconds:300});
assert.equal(s.ok,true,JSON.stringify(s));
for(const entry of f.samples){
 const candidate=candidates.find(c=>c.id===entry.id);assert.ok(candidate);
 const admitted=s.addSample({candidate,qualitySetting:entry.quality,window:entry.window,sample:entry.result});
 assert.equal(admitted.ok,true,JSON.stringify(admitted));
}
assert.ok(s.snapshot().candidates.every(c=>c.completeSettings===2));
const result=s.compare({durationSeconds:5,audioBitrate:0,audioEvidence:'no-audio',reservePercent:0});
// No extrapolation if all eight measured byte domains have no overlap.
assert.ok(result.ok||result.reason==='no-common-evidence-domain',JSON.stringify(result));
const vbr=verifyManualNativeVbrCandidate({protocol,candidate:candidates.find(c=>c.id===f.vbr.candidateId),
 bitrate:f.vbr.bitrate,targetSsim:.8,samples:f.vbr.samples});
assert.equal(vbr.ok,true,JSON.stringify(vbr));
console.log(JSON.stringify({result:'PASS',nativeCqSamples:32,completeBranches:8,
 nativeVbrWindows:vbr.measuredWindows,commonDomain:result.ok?'available':result.reason,
 qualityTargetPassed:vbr.passed,note:'320x180 and 160x90 synthetic Windows source; field acceptance pending'}));
