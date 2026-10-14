import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFlacEncodeObservation} from './flac-encode-preflight.js';
import {sizeBudget} from './media-planning.js';

const request=()=>({version:1,mode:'isolated-flac-encode',start:.4,end:2.4,
 outputFormat:'matroska',tracks:[
 {action:'flac',sourceOrdinal:0,range:'full',channels:null,sampleRate:null},
 {action:'flac',sourceOrdinal:1,range:'trim',channels:1,sampleRate:48000}]});
const sourceStat=()=>({length:123456,writeTicks:'638960827860000000'});
const ledger=()=>({version:1,scope:'full-source',audioPacketBytes:[120000,130000]});
const receipt=()=>({version:1,scope:'isolated-flac-encode-observation',
 method:'ffmpeg-flac-full-input-trim-input-independent-ffprobe-v1',
 observationOnly:true,canReplaceFormalBudget:false,canCertifyFinalMux:false,
 sourceLength:123456,sourceWriteTicks:'638960827860000000',
 start:.4,end:2.4,outputFormat:'matroska',
 tracks:[{sourceOrdinal:0,range:'full',channels:null,sampleRate:null,packetBytes:58000},
 {sourceOrdinal:1,range:'trim',channels:1,sampleRate:48000,packetBytes:32000}]});
const assess=overrides=>assessFlacEncodeObservation({
 request:request(),sourceStat:sourceStat(),fullSourceEvidence:ledger(),
 receipt:receipt(),...overrides});
test('a real full+trim dual FLAC packet measurement remains observation-only',()=>{
 const r=assess();
 assert.equal(r.ok,true);
 assert.equal(r.observedBytes,90000);
 assert.equal(r.tracks.length,2);
 assert.equal(r.tracks[1].range,'trim');
 assert.equal(r.canReplaceFormalBudget,false);
 assert.equal(r.canCertifyFinalMux,false);
 assert.equal(r.requiresFinalMuxValidation,true);
});
test('changing source length or a single losslessly serialized FILETIME tick invalidates receipt',()=>{
 const a=receipt();a.sourceLength++;
 assert.equal(assess({receipt:a}).reason,'incompatible-flac-receipt');
 const b=receipt();b.sourceWriteTicks='638960827860000001';
 assert.equal(assess({receipt:b}).reason,'incompatible-flac-receipt');
 assert.equal(assess({sourceStat:{length:123456,writeTicks:638960827860000000}}).reason,
 'invalid-flac-preflight-request');
});
test('same codec but different ordinal, range, channel layout or sample rate rejects',()=>{
 for(const mutation of [
  o=>o.tracks[0].sourceOrdinal=1,
  o=>o.tracks[0].range='trim',
  o=>o.tracks[1].channels=2,
  o=>o.tracks[1].sampleRate=44100
 ]){
  const r=receipt();mutation(r);
  assert.equal(assess({receipt:r}).reason,'incompatible-flac-track');
 }
});
test('invalid source track mapping and missing whole-source packet evidence reject',()=>{
 assert.equal(assess({fullSourceEvidence:null}).reason,'missing-source-audio-ledger');
 const r=ledger();r.audioPacketBytes=[120000];
 assert.equal(assess({fullSourceEvidence:r}).reason,'missing-source-track-packets');
 const invalid=ledger();invalid.audioPacketBytes=[120000,null];
 assert.equal(assess({fullSourceEvidence:invalid}).reason,'missing-source-track-packets');
});
test('receipt cannot grant authorization to replace formal budget',()=>{
 const a=receipt();a.canReplaceFormalBudget=true;
 assert.equal(assess({receipt:a}).reason,'incompatible-flac-receipt');
 const b=receipt();b.canCertifyFinalMux=true;
 assert.equal(assess({receipt:b}).reason,'incompatible-flac-receipt');
 const c=receipt();c.observationOnly=false;
 assert.equal(assess({receipt:c}).reason,'incompatible-flac-receipt');
});
test('wrong method, bad intervals and changed mux reference cannot produce admission',()=>{
 const a=receipt();a.method='ffprobe-estimated-duration';
 assert.equal(assess({receipt:a}).reason,'incompatible-flac-receipt');
 const b=request();b.end=5.5;
 assert.equal(assess({request:b}).reason,'incompatible-flac-receipt');
 const c=request();c.outputFormat='mp4';
 assert.equal(assess({request:c}).reason,'invalid-flac-preflight-request');
});
test('duplicate tracks, unsupported time range, too many tracks and non-FLAC entries fail',()=>{
 for(const changed of [
  r=>r.tracks[1].sourceOrdinal=0,
  r=>r.tracks[0].action='aac',
  r=>r.end=16000,
  r=>r.tracks=Array.from({length:17},(_,i)=>({...request().tracks[0],sourceOrdinal:i})),
  r=>r.tracks[0].channels=10,
  r=>r.tracks[0].sampleRate=5000
 ]){
  const r=request();changed(r);
  assert.equal(assess({request:r}).reason,'invalid-flac-preflight-request');
 }
});
test('fraudulent packet cost values and signed integer overflow are refused',()=>{
 for(const n of [-1,1.2,null,'200',Number.MAX_SAFE_INTEGER+1]){
  const r=receipt();r.tracks[1].packetBytes=n;
  assert.equal(assess({receipt:r}).reason,'incompatible-flac-track');
 }
 const x=receipt();x.tracks[0].packetBytes=Number.MAX_SAFE_INTEGER;
 x.tracks[1].packetBytes=Number.MAX_SAFE_INTEGER;
 assert.equal(assess({receipt:x}).reason,'flac-packet-total-overflow');
});
test('formal strict-size task must still reject unverified FLAC cost even if preview exists',()=>{
 const options={rateMode:'size',targetSize:20,sizeUnit:'MB',sizeReserve:4,
  audioPlan:[{sourceOrdinal:0,action:'flac',range:'full'}],
  budgetEvidence:{...ledger(),flacPreflight:receipt()}};
 assert.throws(()=>sizeBudget(options,3,1),/FLAC.*未知/);
});
test('FLAC Native API and real Windows tests are wired without silently changing budget',async()=>{
 const {readFile}=await import('node:fs/promises');
 const [worker,bridge,router,fixture,workflow,planning]=await Promise.all([
  readFile(new URL('../windows/flac-encode-preflight.ps1',import.meta.url),'utf8'),
  readFile(new URL('../windows/flac-encode-preflight-bridge.ps1',import.meta.url),'utf8'),
  readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8'),
  readFile(new URL('../scripts/check-flac-encode-preflight.ps1',import.meta.url),'utf8'),
  readFile(new URL('../.github/workflows/windows-b16-runtime.yml',import.meta.url),'utf8'),
  readFile(new URL('./media-planning.js',import.meta.url),'utf8')
 ]);
 assert.match(worker,/trim-packet-audit\.ps1/);
 assert.match(worker,/canReplaceFormalBudget=\$false/);
 assert.match(bridge,/source-or-ledger-replaced/);
 assert.match(bridge,/Get-FlacEncodePreflightStatus/);
 assert.match(router,/Start-FlacEncodePreflight \$body/);
 assert.match(fixture,/Independent FLAC reference encode failed/);
 assert.match(workflow,/check-flac-encode-preflight\.ps1/);
 assert.match(planning,/FLAC 重编码体积成本未知/);
});
