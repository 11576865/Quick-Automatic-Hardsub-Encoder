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
 completed:{verified:true,outputPacketEvidence:{version:1,scope:'completed-artifact',
  audioPacketBytes:[39300,27599],subtitlePacketBytes:[]}},
 preflight:{sourceKey:source,measurementId:ledger,
  request:{version:1,mode:'isolated-flac-encode',start:.4,end:2.4,outputFormat:'matroska',
   tracks:[{sourceOrdinal:0,range:'full',channels:null,sampleRate:null},
    {sourceOrdinal:1,range:'trim',channels:1,sampleRate:48000}]},
  receipt:{version:1,scope:'isolated-flac-encode-observation',
   measurementId:ledger,canReplaceFormalBudget:false,canCertifyFinalMux:false,
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
 x.task.outputPlan.audio[0].outputOrdinal=1;
 x.task.outputPlan.audio[1].outputOrdinal=0;
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
test('copy source/track binding includes preserved soft subtitle and exact output ordinals',()=>{
 const x=base();
 x.task.outputPlan={audio:[{sourceOrdinal:1,action:'copy',range:'trim',outputOrdinal:0}],
   subtitles:[0]};
 x.task.subtitleRange='trim';
 x.completed.outputPacketEvidence={version:1,scope:'completed-artifact',
  audioPacketBytes:[40000],subtitlePacketBytes:[1300]};
 x.preflight.request={version:1,mode:'isolated-trim-copy',start:.4,end:2.4,
  audioOrdinals:[1],subtitleOrdinals:[0]};
 x.preflight.receipt={version:1,scope:'isolated-trim-copy-observation',
  measurementId:ledger,canReplaceFullSourceBudget:false,
  audioPacketBytes:[40000],subtitlePacketBytes:[1300]};
 const a=check(x);assert.equal(a.status,'exact-observed-payload-match');
 const y=base();Object.assign(y,x);
 y.task.outputPlan.subtitles=['all'];assert.equal(check(y).comparable,false);
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
});
