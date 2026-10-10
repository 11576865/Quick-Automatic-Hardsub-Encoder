import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveGuidedSizePolicy,GUIDED_SIZE_POLICIES} from './guided-size-policy.js';

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
