import test from 'node:test';
import assert from 'node:assert/strict';
import {assessIsolatedTrimCopyPreflight} from './trim-copy-preflight.js';

const request=()=>({version:1,mode:'isolated-trim-copy',
 start:.35,end:1.75,outputFormat:'matroska',
 audioOrdinals:[0,1],subtitleOrdinals:[0]});
const stamp=()=>({length:915601,writeTicks:'638960827860000000'});
const full=()=>({version:1,scope:'full-source',
 audioPacketBytes:[90000,120000],subtitlePacketBytes:[15000]});
const receipt=()=>({version:1,scope:'isolated-trim-copy-observation',
 method:'ffmpeg-isolated-auxiliary-copy-remux-then-independent-ffprobe-v1',
 observationOnly:true,canReplaceFullSourceBudget:false,
 sourceLength:915601,sourceWriteTicks:'638960827860000000',
 start:.35,end:1.75,outputFormat:'matroska',
 audioOrdinals:[0,1],subtitleOrdinals:[0],
 audioPacketBytes:[40000,42000],subtitlePacketBytes:[1300]});
const assess=extra=>assessIsolatedTrimCopyPreflight({
 receipt:receipt(),request:request(),sourceStat:stamp(),fullSourceEvidence:full(),...extra
});
test('independent two-audio/ASS preflight is explicitly observation-only and preserves whole-source reserve',()=>{
 const a=assess();
 assert.equal(a.ok,true);
 assert.equal(a.observedBytes,83300);
 assert.equal(a.reservedWholeSourceBytes,225000);
 assert.equal(a.observedDeltaBytes,141700);
 assert.equal(a.canReplaceFullSourceBudget,false);
 assert.equal(a.canCertifyFinalMux,false);
 assert.equal(a.mapped.length,3);
 assert.equal(a.mapped[2].kind,'subtitle');
});
test('the observed remux may exceed a source reservation but cannot amend it',()=>{
 const x=receipt();x.audioPacketBytes=[99000,128000];
 const a=assess({receipt:x});
 assert.equal(a.ok,true);
 assert.equal(a.observedDeltaBytes,225000-(99000+128000+1300));
 assert.equal(a.canReplaceFullSourceBudget,false);
});
test('changed source bytes/stat ticks and unsafe JS rounded filetime are rejected',()=>{
 const x=receipt();x.sourceLength++;
 assert.equal(assess({receipt:x}).reason,'incompatible-isolated-remux-receipt');
 const y=receipt();y.sourceWriteTicks='638960827860000001';
 assert.equal(assess({receipt:y}).reason,'incompatible-isolated-remux-receipt');
 assert.equal(assess({sourceStat:{length:915601,writeTicks:638960827860000000}}).reason,
   'invalid-trim-preflight-request');
});
test('the exact trim interval, selected ordinals and mux container must match',()=>{
 const x=receipt();x.start=.351;
 assert.equal(assess({receipt:x}).reason,'incompatible-isolated-remux-receipt');
 const y=receipt();y.audioOrdinals=[1,0];
 assert.equal(assess({receipt:y}).reason,'incompatible-isolated-remux-receipt');
 const z=receipt();z.outputFormat='mp4';
 assert.equal(assess({receipt:z}).reason,'incompatible-isolated-remux-receipt');
});
test('missing source whole-file packet ledger refuses favorable observed rate',()=>{
 assert.equal(assess({fullSourceEvidence:null}).reason,'missing-authoritative-whole-source-packets');
 const x=full();x.audioPacketBytes=[null,5000];
 assert.equal(assess({fullSourceEvidence:x}).reason,'source-packet-ledger-incomplete');
});
test('fabricated negative, noninteger or unknown auxiliary packet bytes fail closed',()=>{
 for(const bytes of [-1,5.25,'0',null,Number.MAX_SAFE_INTEGER+1]){
  const x=receipt();x.audioPacketBytes[0]=bytes;
  assert.equal(assess({receipt:x}).reason,'incompatible-isolated-remux-receipt');
 }
});
test('unsupported source ordinals, duplicated stream selection and invalid clips refuse scanning',()=>{
 for(const overrides of [
  {audioOrdinals:[0,0]}, {subtitleOrdinals:[77]}, {end:.35},
  {start:-1},{end:4200}, {outputFormat:'wav'}
 ]){
  const x=request();Object.assign(x,overrides);
  assert.equal(assess({request:x}).reason,'invalid-trim-preflight-request');
 }
});
test('claimed authority to replace the actual size budget is rejected',()=>{
 const x=receipt();x.canReplaceFullSourceBudget=true;
 assert.equal(assess({receipt:x}).reason,'incompatible-isolated-remux-receipt');
 const y=receipt();y.observationOnly=false;
 assert.equal(assess({receipt:y}).reason,'incompatible-isolated-remux-receipt');
});
test('actual Windows isolated worker, independent output oracle and CI are wired',async()=>{
 const {readFile}=await import('node:fs/promises');
 const [worker,oracle,workflow,budget,bridge,api]=await Promise.all([
  readFile(new URL('../windows/trim-copy-preflight.ps1',import.meta.url),'utf8'),
  readFile(new URL('../scripts/check-trim-copy-preflight.ps1',import.meta.url),'utf8'),
  readFile(new URL('../.github/workflows/windows-local-smoke.yml',import.meta.url),'utf8'),
  readFile(new URL('./media-planning.js',import.meta.url),'utf8'),
  readFile(new URL('../windows/trim-copy-preflight-bridge.ps1',import.meta.url),'utf8'),
  readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8')
 ]);
 assert.match(worker,/trim-packet-audit\.ps1/);
 assert.match(worker,/canReplaceFullSourceBudget=\$false/);
 assert.match(worker,/sourceWriteTicks=\(\[string\]\$originalTicks\)/);
 assert.match(oracle,/\$ffprobe -v error -select_streams/);
 assert.match(oracle,/Duplicated source stream ordinal/);
 assert.match(workflow,/check-trim-copy-preflight\.ps1/);
 assert.match(budget,/copiedTrimReserveBytes \+= total/);
 assert.match(budget,/full-source/);
 assert.match(bridge,/function Start-IsolatedTrimPreflight\(/);
 assert.match(bridge,/function Get-IsolatedTrimPreflightStatus\(/);
 assert.match(bridge,/Stop-StaleTrimPreflight/);
 assert.match(api,/Start-IsolatedTrimPreflight \$body/);
 assert.match(api,/Get-IsolatedTrimPreflightStatus/);
});
