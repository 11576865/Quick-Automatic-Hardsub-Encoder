// Build an actual formal v4 Native Bridge request ONLY from an accepted real
// paired Native VBR certificate, using the same atomic form handoff as Manual.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {compileTask} from '../src/media-task.js';
import {commitVerifiedManualCandidate} from '../src/manual-transcode-adoption.js';
import {verifyManualNativeVbrCandidate} from '../src/manual-transcode-vbr-verification.js';

const [evidencePath,probePath,requestPath]=process.argv.slice(2);
if(!evidencePath||!probePath||!requestPath)throw Error(
  'Usage: build-manual-adopted-native-request.mjs evidence.json probe.json request.json');
const fixture=JSON.parse(readFileSync(evidencePath,'utf8'));
const probe=JSON.parse(readFileSync(probePath,'utf8'));
assert.equal(fixture.kind,'qhe-manual-windows-native-paired-v1');
assert.equal(probe.ok,true);
assert.equal(probe.videoTracks,1);
assert.equal(probe.audioTracks,1);
assert.equal(probe.videoStreams[0]?.pixelFormat,'yuv420p');
assert.ok(Math.abs(Number(probe.duration)-5)<.2);
const receipt=fixture.samples[0].result.nativeEvidence;
const protocol={
  method:receipt.method,referenceMetric:receipt.referenceMetric,
  sourceToken:receipt.sourceToken,runtimeToken:receipt.runtimeToken,
  referenceToken:receipt.referenceToken,filterToken:receipt.filterToken,
  samplePlanVersion:'windows-native-paired-real-v1',
  mediaDuration:5,rangeStart:0,rangeEnd:5,
  videoStream:0,referenceWidth:320,referenceHeight:180,
  windows:fixture.windows
};
const branch=fixture.branches.find(c=>c.id===fixture.vbrTest.candidateId);
assert.ok(branch);
assert.equal(branch.encoder,'libx265','Full output must exercise the alternate HEVC software codec');
const candidate={...branch,outputWidth:320,outputHeight:180,pixelFormat:'yuv420p'};
const rate=fixture.vbrTest.bitrate;
const certificate=verifyManualNativeVbrCandidate({
  protocol,candidate,bitrate:rate,targetSsim:fixture.vbrTest.targetSsim,
  samples:fixture.vbrTest.samples
});
assert.equal(certificate.ok,true,JSON.stringify(certificate));
assert.equal(certificate.passed,true,'Actual same-source windows must meet test threshold');
const raw={
  operation:'transcode',codec:'h264',encoder:'libx264',preset:'medium',
  rateMode:'quality',quality:'23',bitrate:'1000000',twoPass:false,
  multipass:'disabled',start:'0',end:'',videoStreams:'0',
  videoRange:'trim',audio:'copy',audioTrack:'all',
  audioRange:'trim',subtitleRange:'trim',keepSubtitles:false,
  keepAttachments:false,keepMetadata:true,keepChapters:true,
  fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'lanczos',
  rotation:'none',deinterlace:'none',outputContainer:'mkv'
};
const names=['codec','encoder','preset','multipass','rateMode','bitrate','twoPass'];
const controls=Object.fromEntries(names.map(name=>[name,{
  value:String(raw[name]),checked:raw[name]===true
}]));
const read=()=>({...raw,...Object.fromEntries(names.map(name=>[
  name,name==='twoPass'?controls[name].checked:controls[name].value
]))});
const original=read();
const committed=commitVerifiedManualCandidate({
  candidate,bitrate:rate,expectedSettings:original,
  expectedSourceIdentity:receipt.sourceToken,
  read,sourceIdentity:()=>receipt.sourceToken,
  get:name=>controls[name],
  updateEncoder:()=>{controls.encoder.value='libx264';},
  updatePreset:()=>{controls.preset.value='medium';},
  updateRate:()=>{},
  compile:compileTask,media:probe
});
assert.equal(committed.ok,true,JSON.stringify(committed));
const task=committed.task;
assert.equal(task.version,4);
assert.equal(task.operation,'transcode');
assert.equal(task.codec,'h265');
assert.equal(task.encoder,'libx265');
assert.equal(task.rateMode,'bitrate');
assert.equal(task.bitrate,rate);
assert.equal(task.expectedVideoTracks,1);
assert.equal(task.expectedAudioTracks,1);
assert.equal(task.audio,'copy');
assert.equal(task.outputFormat,'matroska');
assert.equal(task.outputExtension,'mkv');
assert.equal(task.twoPass,false);
assert.ok(task.outputArgs.includes('libx265'));
assert.ok(task.outputArgs.includes('-c:a'));
assert.ok(task.outputArgs.includes('copy'));
assert.ok(task.outputArgs.includes(String(rate)));
writeFileSync(requestPath,JSON.stringify({
  request:{task,suggestedName:'verified-hevc-full.mkv',
    sourceIdentity:receipt.sourceToken,mode:'bitrate',
    preset:candidate.preset,targetVideoBitrate:rate}
},null,2),'utf8');
console.log(JSON.stringify({
  result:'PASS',evidence:'actual Windows Native VBR certificate -> atomic form -> formal v4 task',
  encoder:task.encoder,codec:task.codec,rateMode:task.rateMode,
  bitrate:task.bitrate,audio:task.audio,
  videoTracks:task.expectedVideoTracks,audioTracks:task.expectedAudioTracks,
  sourceToken:receipt.sourceToken,
  noFinalOutputClaim:true
}));
