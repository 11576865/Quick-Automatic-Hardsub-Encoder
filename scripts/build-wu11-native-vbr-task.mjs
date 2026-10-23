// WU11 bounded same-source real VBR -> formal v4 Native task.
// Production compilers remain the only authority; this fixture is an automated
// explicit acceptance, not a claim that a real user clicked in the browser.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {compileTask} from '../src/media-task.js';
import {compileGuidedCpuHandoff,commitGuidedCpuHandoff} from '../src/guided-cpu-compiler-contract.js';

const [probePath,budgetPath,taskPath,planPath,sourceKey]=process.argv.slice(2);
assert(probePath&&budgetPath&&taskPath&&planPath&&/^sha256:[a-f0-9]{64}$/.test(sourceKey||''),
  'Usage: build-wu11-native-vbr-task.mjs probe.json budget.json task.json plan.json sha256:source');
const probe=JSON.parse(readFileSync(probePath,'utf8'));
const budget=JSON.parse(readFileSync(budgetPath,'utf8'));
assert.equal(probe.ok,true);
assert.equal(probe.videoTracks,1);
assert.equal(probe.audioTracks,2);
assert.equal(probe.subtitleTracks,1);
assert.equal(probe.attachmentTracks,1);
assert.equal(budget.version,1);
assert.equal(budget.scope,'full-source');
assert.ok(budget.measurementId);
assert.equal(budget.audioPacketBytes.length,2);
assert.ok(budget.audioPacketBytes.every(x=>Number.isSafeInteger(x)&&x>0));
const media={
 duration:Number(probe.duration),fps:12,
 videoTracks:probe.videoTracks,videoStreams:probe.videoStreams,
 audioTracks:probe.audioTracks,audioStreams:probe.audioStreams,
 subtitleTracks:probe.subtitleTracks,subtitleStreams:probe.subtitleStreams,
 attachmentTracks:probe.attachmentTracks,attachmentStreams:probe.attachmentStreams,
 formatName:probe.format,sourceName:'source.mkv',sourceIdentity:sourceKey,
 videoCodec:probe.videoCodec,audioCodecs:probe.audioCodecs,
 budgetEvidence:budget
};
assert.ok(media.duration>4&&media.duration<6);
const defaults={
 operation:'hardsub',codec:'h264',encoder:'libx264',preset:'medium',
 rateMode:'size',targetSize:1,sizeUnit:'MB',sizeReserve:4,twoPass:false,
 start:0,end:'',videoStreams:'0',videoRange:'full',
 audio:'copy',audioTrack:'all',audioRange:'full',subtitleRange:'full',
 audioPlan:'',outputContainer:'mkv',keepSubtitles:false,keepAttachments:false,
 keepMetadata:true,keepChapters:true,
 fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'bicubic',
 subtitleRenderOrder:'before-scale',rotation:'none',deinterlace:'none',
 crop:'',codecParams:'',lookahead:'',maxrate:'',bufsize:'',gop:'',bf:'',refs:'',
 sampleLength:'15',squarePixels:false
};
// The per-stream choice is explicit intent for THIS source, not an old
// copy/copy Guided proof. Recompute full-file costs *before* Native samples:
 // FLAC a:0 retains all packet bytes, AAC a:1 must be encoded at 96 kbps.
const explicitAudioPlan=[
 {sourceOrdinal:0,action:'copy',range:'full'},
 {sourceOrdinal:1,action:'aac',range:'full',bitrate:96000}
];
const intent={...defaults,audioPlan:explicitAudioPlan,
 mustCopyAudioOrdinals:[0],audioKeepSourceIdentity:sourceKey};
const preliminary=compileTask(intent,media);
assert.equal(preliminary.sizePlan.fixedPayloadBytes,budget.audioPacketBytes[0]);
assert.ok(preliminary.sizePlan.encodedAudioBytes>0);
assert.ok(preliminary.sizePlan.fixedPayloadBytes<
 budget.audioPacketBytes[0]+budget.audioPacketBytes[1],
 'mixed strategy must not reserve the old all-copy total');
assert.equal(preliminary.sizePlan.targetBytes,1000000);
const plan={
 codec:'h264',mode:'budget-rate',goal:'sizeBudget',preset:'medium',
 sizeBudgetPolicy:'best-effort',sizeCeiling:preliminary.sizePlan.targetBytes,
 targetVideoBitrate:preliminary.bitrate,
 containerReserveBytes:preliminary.sizePlan.containerReserveBytes,
 fixedPayloadBytes:preliminary.sizePlan.fixedPayloadBytes,
 encodedAudioBytes:preliminary.sizePlan.encodedAudioBytes,
 outputWidth:0,outputHeight:0
};
const snapshot={plan,audio:{
 audio:'copy',intent:'explicit-per-stream-v1',
 sourceIdentity:sourceKey,mustCopyAudioOrdinals:[0],
 audioPlan:explicitAudioPlan
},container:'mkv'};
const contract=compileGuidedCpuHandoff({
 snapshot,defaults:intent,media,evidence:budget,sourceKey,evidenceSourceKey:sourceKey
});
assert.equal(contract.ok,true,JSON.stringify(contract));
assert.equal(contract.nativeVbrCertificateTransferAllowed,false);
assert.equal(contract.requiresFreshExecutionValidation,true);
let manual={...defaults};
const applied=commitGuidedCpuHandoff({
 contract,media,evidence:budget,
 expectedSourceIdentity:sourceKey,sourceIdentity:()=>sourceKey,
 read:()=>({...manual}),apply:settings=>{manual={...settings};}
});
assert.equal(applied.ok,true,JSON.stringify(applied));
const task=applied.task;
assert.equal(task.version,4);
assert.equal(task.operation,'hardsub');
assert.equal(task.rateMode,'size');
assert.equal(task.encoder,'libx264');
assert.equal(task.bitrate,plan.targetVideoBitrate);
assert.equal(task.sizePlan.targetBytes,plan.sizeCeiling);
assert.equal(task.sizePlan.fixedPayloadBytes,plan.fixedPayloadBytes);
assert.equal(task.audio,'copy');
assert.equal(task.expectedAudioTracks,2);
assert.deepEqual(task.audioPlan.map(x=>x.action),['copy','aac']);
assert.deepEqual(task.mustCopyAudioOrdinals,[0]);
assert.equal(task.sizePlan.encodedAudioBytes,plan.encodedAudioBytes);
assert.ok(plan.encodedAudioBytes>0);
assert.equal(task.subtitleRenderOrder,'before-scale');
assert.equal(task.outputArgs[task.outputArgs.indexOf('-vf')+1],
 'ass=__ASS__:fontsdir=__FONTS__,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0');
assert.ok(task.outputArgs.includes('-b:v'));
assert.equal(task.outputArgs[task.outputArgs.indexOf('-b:v')+1],String(plan.targetVideoBitrate));
assert.ok(!task.outputArgs.includes('-crf'));
assert.ok(task.outputArgs.includes('-c:a:0'));
assert.ok(task.outputArgs.includes('-c:a:1'));
assert.equal(task.outputArgs[task.outputArgs.indexOf('-c:a:0')+1],'copy');
assert.equal(task.outputArgs[task.outputArgs.indexOf('-c:a:1')+1],'aac');
assert.ok(!task.outputArgs.includes('-crf'));
assert.equal(task.budgetEvidence.measurementId,budget.measurementId);
// Deliberately refuse stale measurement origins. No certificate from Native
// short-sample SSIM is accepted as an executable authorization.
assert.equal(compileGuidedCpuHandoff({
 snapshot,defaults:intent,media,evidence:budget,sourceKey,evidenceSourceKey:'sha256:'+'0'.repeat(64)
}).reason,'stale-source-budget-evidence');
writeFileSync(taskPath,JSON.stringify({request:{task,suggestedName:'wu11-guided-vbr-mixed-audio.mkv'}},null,2));
writeFileSync(planPath,JSON.stringify({
 kind:'wu11-source-scoped-guided-vbr-plan-v1',sourceSha256:sourceKey,
 measurementId:budget.measurementId,plan,
 audioPolicy:'FLAC-copy-AAC-reencode-explicit-source-locked',
 explicitAudioPlan, mustCopyAudioOrdinals:[0],
 fixedPayloadBytes:plan.fixedPayloadBytes,
 encodedAudioBytes:plan.encodedAudioBytes,
 explicitUserClickObserved:false,fullMovieQualityVerified:false,
 nativeVbrCertificateTransferAllowed:false
},null,2));
console.log(JSON.stringify({kind:'wu11-native-formal-vbr-plan',targetBytes:plan.sizeCeiling,
 videoRate:plan.targetVideoBitrate,measuredCopyBytes:plan.fixedPayloadBytes,
 plannedEncodedAudioBytes:plan.encodedAudioBytes,
 nativeVbrCertificateTransferAllowed:false}));
