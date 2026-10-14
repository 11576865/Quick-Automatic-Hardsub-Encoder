import test from 'node:test';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {makeBrowserSourceBatch,assertBrowserBatchSource} from './browser-source-batch.js';
const video=(name,bytes='abc')=>new File([bytes],name,{lastModified:1000});
const settings={operation:'transcode',codec:'h264',encoder:'libx264',
 audio:'copy',audioPlan:'',mustCopyAudioOrdinals:'',rateMode:'quality',quality:23};
test('WU08 queues separate real File object identities and freezes source settings',()=>{
 const a=video('a.mkv'),b=video('b.mkv');
 const queue=makeBrowserSourceBatch({files:[a,b],settings});
 settings.quality=31;
 assert.equal(queue.length,2);assert.equal(queue[0].settings.quality,23);
 assert.equal(Object.isFrozen(queue[0].settings),true);
 assert.equal(assertBrowserBatchSource(queue[1],b,'b.mkv|3|1000'),queue[1]);
 assert.throws(()=>assertBrowserBatchSource(queue[0],b,'a.mkv|3|1000'),/不匹配/);
});
test('WU08 source identity drift and byte limit fail closed',()=>{
 const a=video('a.mkv');
 const q=makeBrowserSourceBatch({files:[a],settings});
 assert.throws(()=>assertBrowserBatchSource(q[0],a,'wrong|3|1000'),/不匹配/);
 assert.throws(()=>makeBrowserSourceBatch({files:[video('same.mkv'),video('same.mkv')],settings}),/无法独立证明/);
 assert.throws(()=>makeBrowserSourceBatch({files:[video('zero.mkv','')],settings}),/无效/);
 assert.throws(()=>makeBrowserSourceBatch({files:[a],settings,existingCount:8}),/最多 8/);
});
test('WU08 prohibits borrowed ASS, audio lock, audio stream plans and size certificates',()=>{
 const a=video('a.mkv');
 for(const change of [
  {operation:'hardsub'},{audioPlan:'[{"sourceOrdinal":0,"action":"copy"}]'},
  {mustCopyAudioOrdinals:'[0]'},{audioKeepSourceIdentity:'foreign'},
  {rateMode:'size'},{budgetPolicy:'strict-ceiling'}
 ])assert.throws(()=>makeBrowserSourceBatch({files:[a],settings:{...settings,...change}}),/多来源/);
});
test('WU08 preserves user requested trim and per-source copy operation',()=>{
 const a=video('a.mkv'),b=video('b.mkv');
 const queue=makeBrowserSourceBatch({files:[a,b],settings:{...settings,operation:'copy',start:'2.5',end:'4.5'}});
 assert.deepEqual(queue.map(x=>x.operation),['copy','copy']);
 assert.deepEqual(queue.map(x=>x.settings.start),['2.5','2.5']);
});
