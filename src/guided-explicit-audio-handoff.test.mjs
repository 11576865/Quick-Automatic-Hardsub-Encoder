import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareGuidedExplicitAudioHandoff} from './guided-explicit-audio-handoff.js';
import {compileGuidedCpuHandoff} from './guided-cpu-compiler-contract.js';
const source='sha256:current-source';
const defaults={operation:'hardsub',codec:'h264',encoder:'libx264',preset:'medium',
 rateMode:'quality',quality:23,videoStreams:'0',audio:'copy',
 outputContainer:'mkv',keepSubtitles:false,keepAttachments:false,
 start:0,end:'',videoRange:'full',audioRange:'full',subtitleRange:'full',
 fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'bicubic',
 subtitleRenderOrder:'before-scale',rotation:'none',deinterlace:'none',
 crop:'',codecParams:'',lookahead:'',maxrate:'',bufsize:'',gop:'',bf:'',refs:'',
 sampleLength:15,squarePixels:false};
const media={duration:5,fps:12,videoTracks:1,audioTracks:2,
 audioStreams:[{codec:'flac'},{codec:'aac'}]};
const evidence={version:1,scope:'full-source',measurementId:'cost-1',
 audioPacketBytes:[200000,80000],subtitlePacketBytes:[],attachmentBytes:[]};
const plan={codec:'h264',preset:'medium',mode:'budget-rate',goal:'sizeBudget',
 sizeBudgetPolicy:'best-effort',sizeCeiling:1000000,targetVideoBitrate:1000000,
 containerReserveBytes:40000,fixedPayloadBytes:280000,encodedAudioBytes:0,
 outputWidth:0,outputHeight:0};
const snapshot={plan,audio:{audio:'copy'},container:'mkv',
 nativeVbrCertificate:{passed:true,source:'old-copy-all'}};
const settings={
 audioPlan:JSON.stringify([
  {sourceOrdinal:0,action:'copy',range:'full'},
  {sourceOrdinal:1,action:'aac',range:'full',bitrate:96000}]),
 mustCopyAudioOrdinals:'[0]',audioKeepSourceIdentity:source
};
const run=(changes={})=>prepareGuidedExplicitAudioHandoff({
 snapshot,settings,defaults,media,sourceKey:source,
 evidence,evidenceSourceKey:source,approved:true,...changes
});
test('explicit real-UI audio intent recomputes VBR whole-file rate without transferring short-sample certificate',()=>{
 const r=run();
 assert.equal(r.ok,true,r.reason||r.detail);
 assert.equal(r.snapshot.plan.targetVideoBitrate,1120000);
 assert.equal(r.snapshot.plan.fixedPayloadBytes,200000);
 assert.equal(r.snapshot.plan.encodedAudioBytes,60000);
 assert.equal(r.previousVideoBitrate,1000000);
 assert.equal(r.nativeVbrCertificateTransferAllowed,false);
 assert.equal(r.snapshot.nativeVbrCertificate,undefined);
 assert.deepEqual(r.snapshot.audio.mustCopyAudioOrdinals,[0]);
 const contract=compileGuidedCpuHandoff({
  snapshot:r.snapshot,defaults,media:r.media,sourceKey:source,
  evidence,evidenceSourceKey:source
 });
 assert.equal(contract.ok,true,contract.reason||contract.detail);
 assert.deepEqual(contract.task.audioPlan.map(x=>x.action),['copy','aac']);
 assert.deepEqual(contract.task.mustCopyAudioOrdinals,[0]);
 assert.equal(contract.task.bitrate,1120000);
});
test('explicit adoption never carries unapproved, stale, incomplete, or unknown-budget per-track settings',()=>{
 assert.equal(run({approved:false}).reason,'explicit-audio-approval-required');
 assert.equal(run({settings:{...settings,audioKeepSourceIdentity:'other'}}).reason,
  'missing-or-stale-explicit-audio-lock');
 assert.equal(run({settings:{...settings,mustCopyAudioOrdinals:'[]'}}).reason,
  'missing-or-stale-explicit-audio-lock');
 assert.equal(run({settings:{...settings,audioPlan:'not json'}}).reason,
  'missing-or-stale-explicit-audio-lock');
 assert.equal(run({settings:{...settings,audioPlan:JSON.stringify([
  {sourceOrdinal:0,action:'aac',bitrate:96000,range:'full'},
  {sourceOrdinal:1,action:'copy',range:'full'}])}}).reason,
  'incomplete-or-incompatible-guided-audio-plan');
 assert.equal(run({settings:{...settings,audioPlan:JSON.stringify([
  {sourceOrdinal:0,action:'copy',range:'trim'},
  {sourceOrdinal:1,action:'aac',range:'full',bitrate:96000}])}}).reason,
  'incomplete-or-incompatible-guided-audio-plan');
 assert.equal(run({evidence:null}).reason,'missing-current-source-audio-budget');
 assert.equal(run({evidenceSourceKey:'stale-source'}).reason,'missing-current-source-audio-budget');
 assert.equal(run({sourceKey:'another'}).reason,'missing-or-stale-explicit-audio-lock');
});
test('hypothetical plan failure keeps original Guide snapshot immutable',()=>{
 const before=structuredClone(snapshot),original=structuredClone(settings);
 const r=run({settings:{...settings,audioPlan:JSON.stringify([
  {sourceOrdinal:0,action:'copy',range:'full'},
  {sourceOrdinal:1,action:'aac',range:'full',bitrate:9000000}])}});
 assert.equal(r.ok,false);assert.equal(r.reason,'shared-budget-recompile-rejected');
 assert.deepEqual(snapshot,before);
 assert.deepEqual(settings,original);
});
