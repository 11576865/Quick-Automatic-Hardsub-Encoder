import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileAuxiliaryMuxObservation as check} from './auxiliary-mux-reconciliation.js';
const source='source-identity-v1';
const ledger='measured-whole-source-01';
const base=()=>({
 task:{
  start:.4,end:2.4,outputFormat:'matroska',
  budgetEvidence:{version:1,scope:'full-source',measurementId:ledger},
  outputPlan:{audio:[
   {sourceOrdinal:0,action:'flac',range:'full',outputOrdinal:0},
   {sourceOrdinal:1,action:'flac',range:'trim',outputOrdinal:1,channels:1,sampleRate:48000}
  ],subtitles:[]}
 },
 completed:{verified:true,jobId:'native-b16-7',outputBytes:127000,
  outputPacketEvidence:{version:1,scope:'completed-artifact',
   artifactBytes:127000,artifactWriteTicks:'638960827860011111',artifactJobId:'native-b16-7',
   audioPacketBytes:[39300,27599],subtitlePacketBytes:[]}},
 preflight:{sourceKey:source,measurementId:ledger,
  sourceStat:{length:123456,writeTicks:'638960827860000000'},
  request:{version:1,mode:'isolated-flac-encode',start:.4,end:2.4,outputFormat:'matroska',
   tracks:[{sourceOrdinal:0,range:'full',channels:null,sampleRate:null},
    {sourceOrdinal:1,range:'trim',channels:1,sampleRate:48000}]},
  receipt:{version:1,scope:'isolated-flac-encode-observation',
   measurementId:ledger,canReplaceFormalBudget:false,canCertifyFinalMux:false,
   sourceLength:123456,sourceWriteTicks:'638960827860000000',
   start:.4,end:2.4,outputFormat:'matroska',
   tracks:[{sourceOrdinal:0,range:'full',channels:null,sampleRate:null,packetBytes:39300},
    {sourceOrdinal:1,range:'trim',channels:1,sampleRate:48000,packetBytes:27599}]}
 },currentSourceKey:source
});
test('real-payload match is scoped to this completed mixed-media artifact only',()=>{
 const r=check(base());assert.equal(r.status,'exact-observed-payload-match');
 assert.equal(r.observedPreflightBytes,66899);assert.equal(r.observedFinalMuxBytes,66899);
 assert.equal(r.comparedStreamCount,2);
 assert.equal(r.canReplaceFormalBudget,false);
 assert.equal(r.canCertifyFutureMux,false);
});
test('changed completed mixed mux packet size is an observed delta, not silent equivalence',()=>{
 const x=base();x.completed.outputPacketEvidence.audioPacketBytes[1]+=8192;
 const r=check(x);assert.equal(r.status,'observed-packet-delta');
 assert.equal(r.deltaBytes,8192);assert.equal(r.canCertifyFutureMux,false);
});
test('mixing another source, ledger, timeline or output container invalidates reconciliation',()=>{
 for(const mutate of [
  x=>x.currentSourceKey='other',
  x=>x.task.budgetEvidence.measurementId='other',
  x=>x.preflight.receipt.measurementId='other',
  x=>x.task.start=.5,
  x=>x.task.end=2.2,
  x=>x.completed.actualStart=.2,
  x=>x.preflight.receipt.sourceWriteTicks='638960827860000001',
  x=>x.preflight.receipt.end=2.3,
  x=>x.task.outputFormat='mp4',
  x=>x.preflight=null
 ]){
  const x=base();mutate(x);
  assert.equal(check(x).comparable,false);
 }
});
test('no completed verified packet evidence means no final-mux comparison',()=>{
 for(const mutate of [
  x=>x.completed.verified=false,
  x=>x.completed.outputPacketEvidence.scope='full-source',
  x=>x.completed.outputPacketEvidence=null
 ]){const x=base();mutate(x);assert.equal(check(x).comparable,false);}
});
test('selected output order may differ from source order but must match actual source ordinal',()=>{
 const x=base();
 // Authoritative task compiler emits ordinal per *array position*, so
 // reverse the selected source order rather than creating a false mapping.
 x.task.outputPlan.audio.reverse();
 x.task.outputPlan.audio[0].outputOrdinal=0;
 x.task.outputPlan.audio[1].outputOrdinal=1;
 x.completed.outputPacketEvidence.audioPacketBytes=[27599,39300];
 const r=check(x);assert.equal(r.status,'exact-observed-payload-match');
 assert.equal(r.rows[0].outputOrdinal,1);
});
test('track codec, trim/full policy, channels and sample rate cannot be borrowed',()=>{
 for(const mutate of [
  x=>x.task.outputPlan.audio[0].action='copy',
  x=>x.task.outputPlan.audio[1].range='full',
  x=>x.task.outputPlan.audio[1].channels=2,
  x=>x.task.outputPlan.audio[1].sampleRate=44100,
  x=>x.preflight.receipt.tracks[1].sourceOrdinal=0
 ]){
  const x=base();mutate(x);assert.equal(check(x).comparable,false);
 }
});
test('missing, overflowed and forged negative packet data cannot match',()=>{
 for(const invalid of [-1,null,1.25,'27599',Number.MAX_SAFE_INTEGER+1]){
  const x=base();x.completed.outputPacketEvidence.audioPacketBytes[1]=invalid;
  assert.equal(check(x).comparable,false);
 }
});
test('unrelated Native job, modified output FILETIME, or wrong completed bytes cannot impersonate current artifact',()=>{
 for(const mutate of [
  x=>x.completed.jobId='another-task',
  x=>x.completed.outputPacketEvidence.artifactJobId='other-job',
  x=>x.completed.outputPacketEvidence.artifactBytes=127001,
  x=>x.completed.outputPacketEvidence.artifactWriteTicks='',
  x=>x.completed.outputPacketEvidence.artifactWriteTicks=638960827860011111,
  x=>x.completed.outputBytes=127002
 ]){
  const x=base();mutate(x);
  const r=check(x);
  assert.equal(r.comparable,false);
  assert.equal(r.reason,'finished-artifact-job-or-stat-mismatch');
 }
});
test('missing, extra, reordered or forged completed audio output mapping cannot be adopted',()=>{
 for(const mutate of [
  x=>x.completed.outputPacketEvidence.audioPacketBytes=[39300],
  x=>x.completed.outputPacketEvidence.audioPacketBytes.push(200),
  x=>x.task.outputPlan.audio[1].outputOrdinal=0,
  x=>x.task.outputPlan.audio[0].outputOrdinal=1
 ]){
  const x=base();mutate(x);
  assert.equal(check(x).reason,'final-audio-stream-map-missing');
 }
});
test('copy source/track binding includes preserved soft subtitle and exact output ordinals',()=>{
 const x=base();
 x.task.outputPlan={audio:[{sourceOrdinal:1,action:'copy',range:'trim',outputOrdinal:0}],
   subtitles:[{sourceOrdinal:0,action:'copy'}]};
 x.task.subtitleRange='trim';
 x.completed.outputPacketEvidence={version:1,scope:'completed-artifact',
  artifactBytes:127000,artifactWriteTicks:'638960827860011111',artifactJobId:'native-b16-7',
  audioPacketBytes:[40000],subtitlePacketBytes:[1300]};
 x.preflight.request={version:1,mode:'isolated-trim-copy',start:.4,end:2.4,
  audioOrdinals:[1],subtitleOrdinals:[0]};
 x.preflight.receipt={version:1,scope:'isolated-trim-copy-observation',
  measurementId:ledger,canReplaceFullSourceBudget:false,
  sourceLength:123456,sourceWriteTicks:'638960827860000000',
  start:.4,end:2.4,outputFormat:'matroska',
  audioPacketBytes:[40000],subtitlePacketBytes:[1300]};
 const a=check(x);assert.equal(a.status,'exact-observed-payload-match');
 const y=base();Object.assign(y,x);
 y.task.outputPlan.subtitles=[{sourceOrdinal:1,action:'copy'}];assert.equal(check(y).comparable,false);
 const z=base();z.task.outputPlan=x.task.outputPlan;z.task.outputPlan.subtitles=['all'];assert.equal(check(z).comparable,false);
});
test('the authoritative compileTask output-plan shape maps explicit subtitle selection only',async()=>{
 const {compileTask}=await import('./media-task.js');
 const media={duration:6,videoTracks:1,audioTracks:2,subtitleTracks:2,
  videoStreams:[{index:0,codec:'h264'}],audioStreams:[{index:1,codec:'pcm_s16le'},{index:2,codec:'pcm_s16le'}]};
 const task=compileTask({operation:'copy',videoStreams:'0',videoRange:'trim',
  start:.4,end:2.4,outputContainer:'mkv',
  audioPlan:[{sourceOrdinal:1,action:'copy',range:'trim'}],
  keepSubtitles:true,subtitleStreams:'1',subtitleRange:'trim'},media);
 assert.deepEqual(task.outputPlan.subtitles,[{sourceOrdinal:1,action:'copy'}]);
 const x=base();
 x.task=task;
 x.task.budgetEvidence={version:1,scope:'full-source',measurementId:ledger};
 x.completed.outputPacketEvidence={version:1,scope:'completed-artifact',
  artifactBytes:127000,artifactWriteTicks:'638960827860011111',artifactJobId:'native-b16-7',
  audioPacketBytes:[40000],subtitlePacketBytes:[1300]};
 x.preflight.request={version:1,mode:'isolated-trim-copy',
  start:.4,end:2.4,audioOrdinals:[1],subtitleOrdinals:[1]};
 x.preflight.receipt={version:1,scope:'isolated-trim-copy-observation',
  measurementId:ledger,canReplaceFullSourceBudget:false,
  sourceLength:123456,sourceWriteTicks:'638960827860000000',
  start:.4,end:2.4,outputFormat:'matroska',
  audioPacketBytes:[40000],subtitlePacketBytes:[1300]};
 assert.equal(check(x).status,'exact-observed-payload-match');
});
test('one observed copy stream cannot authorize moving next job formal budget',()=>{
 const x=base();x.preflight.receipt.canReplaceFormalBudget=true;
 const r=check(x);assert.equal(r.canReplaceFormalBudget,false);
});
test('static workbench/report integration keeps preflight as observation only',async()=>{
 const {readFile}=await import('node:fs/promises');
 const [ui,report]=await Promise.all([
  readFile(new URL('./media-workspace.js',import.meta.url),'utf8'),
  readFile(new URL('./media-planning.js',import.meta.url),'utf8')]);
 assert.match(ui,/reconcileAuxiliaryMuxObservation/);
 assert.match(ui,/auxiliaryParity/);
 assert.match(report,/FLAC 重编码体积成本未知/);
 const [bridge,fixture,ci]=await Promise.all([
  readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8'),
  readFile(new URL('../scripts/check-flac-native-http-lifecycle.ps1',import.meta.url),'utf8'),
  readFile(new URL('../.github/workflows/windows-b16-runtime.yml',import.meta.url),'utf8')
 ]);
 assert.match(bridge,/\$needsFlac=@\(\$Job.Task.audioPlan \| Where-Object/);
 assert.match(bridge,/if\(-not \$needsFlac -and -not \$needsCopy\)/);
 assert.match(fixture,/source-or-ledger-replaced/);
 assert.match(fixture,/\/api\/flac-encode-preflight/);
 assert.match(ci,/check-flac-native-http-lifecycle\.ps1/);
});
