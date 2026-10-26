import {outputReport} from './media-planning.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {savedArtifactReceipt} from './saved-artifact-receipt.js';
const completed={jobId:'job-a',outputBytes:1234};
const receipt={ok:true,jobId:'job-a',path:'C:\\Exports\\movie.mkv',bytes:1234,sha256:'ab'.repeat(32)};
test('retain a same-job Native saved artifact receipt as an independent copy',()=>{
 const result=savedArtifactReceipt(completed,receipt);
 assert.deepEqual(result,{kind:'native-saved-file',jobId:'job-a',path:receipt.path,bytes:1234,sha256:receipt.sha256});
 receipt.path='changed';assert.notEqual(result.path,receipt.path);receipt.path='C:\\Exports\\movie.mkv';
});
test('never promote failed, missing-job or other-job callbacks to saved evidence',()=>{
 for(const override of [{ok:false},{jobId:'job-b'},{jobId:null},{sha256:'invalid'},{bytes:1235},{bytes:0},{path:''}])
  assert.equal(savedArtifactReceipt(completed,{...receipt,...override}),null);
 assert.equal(savedArtifactReceipt({},receipt),null);
 assert.equal(savedArtifactReceipt(completed,{ok:true,kind:'browser-download'}),null);
});

test('a later output audit preserves the recorded saved-file receipt',()=>{
 const deliveryReceipt=savedArtifactReceipt(completed,receipt);
 const report=outputReport({operation:'transcode'},{...completed,verified:true,deliveryReceipt},1);
 assert.deepEqual(report.deliveryReceipt,deliveryReceipt);
});
