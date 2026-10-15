import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {compileTask} from '../src/media-task.js';
import {compileGuidedCpuHandoff,commitGuidedCpuHandoff} from '../src/guided-cpu-compiler-contract.js';
// WU02: make a real Native task with the shared compiler, never a second encoder.
const [probePath,outPath,sourceKey]=process.argv.slice(2);
if(!probePath||!outPath||!sourceKey||!/^sha256:[a-f0-9]{64}$/.test(sourceKey))
 throw Error('Usage: build-wu02-native-task.mjs probe.json request.json sha256:source-hash');
const probe=JSON.parse(readFileSync(probePath,'utf8'));
assert.equal(probe.ok,true);
assert.equal(probe.videoTracks,1);
assert.equal(probe.audioTracks,2);
assert.equal(probe.subtitleTracks,1);
assert.equal(probe.attachmentTracks,1);
const media={
 duration:Number(probe.duration),fps:12,
 videoTracks:probe.videoTracks,videoStreams:probe.videoStreams,
 audioTracks:probe.audioTracks,audioStreams:probe.audioStreams,
 subtitleTracks:probe.subtitleTracks,subtitleStreams:probe.subtitleStreams,
 attachmentTracks:probe.attachmentTracks,attachmentStreams:probe.attachmentStreams,
 formatName:probe.format,sourceName:'source.mkv',sourceIdentity:sourceKey,videoCodec:probe.videoCodec,
 audioCodecs:probe.audioCodecs
};
const raw={
 operation:'hardsub',codec:'h264',encoder:'libx264',preset:'medium',
 rateMode:'quality',quality:23,twoPass:false,
 start:0,end:'',videoStreams:'0',videoRange:'full',
 audio:'copy',audioTrack:'all',audioRange:'full',subtitleRange:'full',
 audioPlan:[
  {sourceOrdinal:0,action:'copy',range:'full'},
  {sourceOrdinal:1,action:'aac',range:'full',bitrate:96000}
 ],
 outputContainer:'mkv',keepSubtitles:false,keepAttachments:false,
 keepMetadata:true,keepChapters:true,
 fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'bicubic',
 subtitleRenderOrder:'before-scale',rotation:'none',deinterlace:'none',
 crop:'',codecParams:'',lookahead:'',maxrate:'',bufsize:'',gop:'',bf:'',refs:'',
 sampleLength:'15',squarePixels:false
};
// WU11: follow the existing Guided -> Manual *formal compiler* route before
// executing WU02's already verified real Native ASS/font + two-audio fixture.
// Guided has only a whole-source audio policy; it MUST NOT silently inherit
// per-track locked/mixed-audio proof. The user explicitly configures that
// separate Manual intent below and a fresh schema-v4 compile is mandatory.
const snapshot={
 plan:{codec:'h264',mode:'crf',goal:'quality',crf:23,preset:'medium',
   outputWidth:0,outputHeight:0},
 audio:{audio:'copy'},container:'mkv'
};
const contract=compileGuidedCpuHandoff({
 snapshot,defaults:raw,media,sourceKey
});
assert.equal(contract.ok,true,JSON.stringify(contract));
assert.equal(contract.task.version,4);
assert.equal(contract.task.operation,'hardsub');
assert.equal(contract.nativeVbrCertificateTransferAllowed,false);
assert.equal(contract.requiresFreshExecutionValidation,true);
let manualForm={...raw};
const applied=commitGuidedCpuHandoff({
 contract,media,sourceIdentity:()=>sourceKey,expectedSourceIdentity:sourceKey,
 read:()=>({...manualForm}),
 apply:settings=>{manualForm={...settings};}
});
assert.equal(applied.ok,true,JSON.stringify(applied));
assert.equal(applied.requiresFreshExecutionValidation,true);
assert.equal(applied.task.audio,'copy');
assert.equal(applied.task.expectedAudioTracks,2);
// Explicit Manual audio action: preserve original FLAC a:0 by formal source
// lock and re-encode a:1 to AAC. No Guided SSIM/VBR proof is transferred.
const finalSettings={...manualForm,
 audioPlan:raw.audioPlan,
 mustCopyAudioOrdinals:'[0]',audioKeepSourceIdentity:sourceKey};
assert.throws(()=>compileTask({...finalSettings,
 audioKeepSourceIdentity:'sha256:'+'0'.repeat(64)},media),/来源身份/);
assert.throws(()=>compileTask({...finalSettings,
 audioPlan:[{sourceOrdinal:0,action:'aac',range:'full',bitrate:96000},
 {sourceOrdinal:1,action:'copy',range:'full'}]},media),/必须 Copy/);
const task=compileTask(finalSettings,media);
assert.deepEqual(task.mustCopyAudioOrdinals,[0]);
assert.equal(task.outputPlan.audio[0].mustCopy,true);
assert.equal(task.outputPlan.audio[1].mustCopy,false);
assert.deepEqual(task.audioPlan.map(x=>x.action),['copy','aac']);
assert.equal(task.operation,'hardsub');
assert.equal(task.outputFormat,'matroska');
assert.equal(task.encoder,'libx264');
assert.deepEqual(task.audioPlan.map(a=>a.action),['copy','aac']);
assert.equal(task.expectedAudioTracks,2);
assert.equal(task.outputArgs[task.outputArgs.indexOf('-vf')+1],
 'ass=__ASS__:fontsdir=__FONTS__,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0');
writeFileSync(outPath,JSON.stringify({
 request:{task,suggestedName:'wu02-embedded-burned.mkv'}
},null,2));
console.log('WU11 bounded Guided-to-Manual formal compile -> source-locked mixed-audio WU02 Native task passed; independent output verification remains required');
