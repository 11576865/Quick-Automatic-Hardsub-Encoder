import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveGuidedSizePolicy,GUIDED_SIZE_POLICIES,assessGuidedBudget} from './guided-size-policy.js';

test('best effort remains explicit and default for existing sessions',()=>{
 assert.deepEqual(resolveGuidedSizePolicy({
  mode:'budget-rate',codec:'h265',backend:'windows-native',ceilingBytes:999999
 }),{ok:true,policy:'best-effort',twoPass:false,strict:false,softwareEncoder:null});
 assert.equal(GUIDED_SIZE_POLICIES.length,3);
});
test('accurate and strict are explicit software H264 choices only',()=>{
 for(const policy of ['two-pass','strict-ceiling']){
  const ok=resolveGuidedSizePolicy({mode:'budget-rate',codec:'h264',
   backend:'windows-native',ceilingBytes:5000000,policy});
  assert.equal(ok.ok,true);
  assert.equal(ok.softwareEncoder,'libx264');
  assert.equal(ok.twoPass,true);
  assert.equal(ok.strict,policy==='strict-ceiling');
  assert.equal(resolveGuidedSizePolicy({mode:'budget-rate',codec:'h265',
   backend:'windows-native',ceilingBytes:5000000,policy}).ok,false);
  assert.equal(resolveGuidedSizePolicy({mode:'budget-rate',codec:'h264',
   backend:'android-native',ceilingBytes:5000000,policy}).ok,false);
 }
});
test('strict fails closed on missing or unsafe byte ceiling and incompatible modes',()=>{
 assert.equal(resolveGuidedSizePolicy({mode:'budget-rate',codec:'h264',
  backend:'windows-native',policy:'strict-ceiling',ceilingBytes:0}).reason,
  'missing-byte-ceiling');
 assert.equal(resolveGuidedSizePolicy({mode:'budget-rate',codec:'h264',
  backend:'windows-native',policy:'strict-ceiling',ceilingBytes:1e30}).ok,false);
 assert.equal(resolveGuidedSizePolicy({mode:'crf',policy:'two-pass'}).reason,'not-a-budget-job');
 assert.equal(resolveGuidedSizePolicy({mode:'budget-rate',policy:'auto'}).reason,'unknown-policy');
});

test('guided budget reports exact floor-based capacity boundary and actionable deficit',()=>{
 const input={durationSeconds:3600,audioBitrate:384000,reservePercent:4,
  containerReservePercent:1,fixedReserveBytes:256*1024,minimumVideoBitrate:150001};
 const tooSmall=assessGuidedBudget({...input,targetBytes:20*1024*1024});
 assert.equal(tooSmall.status,'infeasible');
 assert.ok(tooSmall.shortfallBytes>0);
 assert.ok(tooSmall.audioPayloadBytes>20*1024*1024);
 const boundary=tooSmall.minimumTargetBytes;
 assert.equal(assessGuidedBudget({...input,targetBytes:boundary-1}).status,'infeasible');
 const feasible=assessGuidedBudget({...input,targetBytes:boundary});
 assert.equal(feasible.status,'feasible');
 assert.equal(feasible.shortfallBytes,0);
 assert.ok(feasible.availableVideoBitrate>=150001);
 const noAudio=assessGuidedBudget({...input,audioBitrate:0,targetBytes:boundary});
 assert.ok(noAudio.minimumTargetBytes<boundary);
 assert.equal(noAudio.status,'feasible');
});

test('guided feasibility distinguishes capacity from invalid inputs and reserve dominance',()=>{
 assert.equal(assessGuidedBudget({targetBytes:100,durationSeconds:0}).status,'invalid');
 assert.equal(assessGuidedBudget({targetBytes:1.5,durationSeconds:60}).status,'invalid');
 assert.equal(assessGuidedBudget({targetBytes:500000,durationSeconds:60,audioBitrate:-1}).status,'invalid');
 for(const fixedReserveBytes of [0,256*1024,2*1024*1024]){
  const options={durationSeconds:300,audioBitrate:96000,
   reservePercent:4,containerReservePercent:1,fixedReserveBytes,minimumVideoBitrate:150001};
  const minimum=assessGuidedBudget({...options,targetBytes:1}).minimumTargetBytes;
  assert.equal(assessGuidedBudget({...options,targetBytes:minimum-1}).status,'infeasible');
  assert.equal(assessGuidedBudget({...options,targetBytes:minimum}).status,'feasible');
 }
});
