import test from 'node:test';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {makeBrowserSourceBatch,assertBrowserBatchSource,makeNativeSourceBatch,assertNativeBatchSource,nativeBatchDeliveryReceipt,formatNativeBatchDeliveryReceipt} from './browser-source-batch.js';
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

const grant=(id,name,size=4096,lastModified=1750000000000)=>({id:id.repeat(32),name,size,lastModified});
test('B21 Native source queue freezes only opaque picker grants and never paths',()=>{
 const selections=[grant('a','clip-1.mkv'),grant('b','clip-2.mkv')];
 const request={...settings,operation:'transcode'};
 const requestedQuality=request.quality;
 const rows=makeNativeSourceBatch({selections,settings:request});
 request.quality=51;
 assert.equal(rows.length,2);
 assert.equal(rows[0].settings.quality,requestedQuality);
 assert.equal(Object.isFrozen(rows[0].settings),true);
 assert.equal(rows[0].nativeId,'a'.repeat(32));
 assert.equal(rows[0].file,undefined);
 assert.equal(rows[0].path,undefined);
 assert.equal(assertNativeBatchSource(rows[1],{
   id:'b'.repeat(32),file:selections[1],probe:{ok:true}
 },'clip-2.mkv|4096|1750000000000'),rows[1]);
});
test('B21 Native grants reject missing identity, duplicates, foreign activation and stale probe',()=>{
 const a=grant('a','a.mkv'),b=grant('b','b.mkv');
 const rows=makeNativeSourceBatch({selections:[a,b],settings});
 for(const invalid of [
   [{...a,id:'../../../file'}],
   [{...a,size:0}],
   [{...a,lastModified:-1}],
   [a,a],
   [a,{...b,name:'a.mkv'}]
 ])assert.throws(()=>makeNativeSourceBatch({selections:invalid,settings}),/授权|重复/);
 assert.throws(()=>assertNativeBatchSource(rows[0],{id:b.id,file:a,probe:{ok:true}},
   'a.mkv|4096|1750000000000'),/不匹配/);
 assert.throws(()=>assertNativeBatchSource(rows[0],{id:a.id,file:a,probe:{ok:false}},
   'a.mkv|4096|1750000000000'),/FFprobe/);
 assert.throws(()=>assertNativeBatchSource(rows[0],{id:a.id,file:{...a,size:4097},probe:{ok:true}},
   'a.mkv|4096|1750000000000'),/不匹配/);
 assert.throws(()=>makeNativeSourceBatch({selections:[a],settings,existingCount:8}),/最多 8/);
});
test('B21 Native queue does not inherit ASS hard-sub, per-track audio locks or strict size budget',()=>{
 const a=grant('c','sample.mkv');
 for(const change of [
  {operation:'hardsub'},
  {audioPlan:'[{"sourceOrdinal":0,"action":"copy"}]'},
  {mustCopyAudioOrdinals:'[0]'},
  {audioKeepSourceIdentity:'foreign'},
  {rateMode:'size'},
  {budgetPolicy:'strict-ceiling'}
 ])assert.throws(()=>makeNativeSourceBatch({selections:[a],settings:{...settings,...change}}),/Native 多来源/);
});

test('B21 native per-file delivery requires real same-job published hash and byte count',()=>{
 const source=makeNativeSourceBatch({selections:[grant('c','release.mkv')],settings})[0];
 const completed={jobId:'job-123',verified:true,name:'release.mkv'};
 const receipt=nativeBatchDeliveryReceipt(source,completed,{
  jobId:'job-123',ok:true,sha256:'AB'.repeat(32),bytes:1048576,
  path:'C:\\users\\private\\video\\release.mkv'
 });
 assert.equal(receipt.kind,'native-published');
 assert.equal(receipt.sourceGrantId,source.nativeId);
 assert.equal(receipt.sha256,'ab'.repeat(32));
 assert.equal(receipt.bytes,1048576);
 assert.equal(Object.isFrozen(receipt),true);
 const formatted=formatNativeBatchDeliveryReceipt(receipt);
 assert.match(formatted,/job-123/);
 assert.match(formatted,/1048576/);
 assert.match(formatted,/ab{1}/);
 assert.ok(!formatted.includes('C:\\users\\private'),'Never copy user disk paths into receipt');
 assert.equal(receipt.path,undefined);
 for(const invalid of [
  {jobId:'other-job',ok:true,sha256:'a'.repeat(64),bytes:100},
  {jobId:'job-123',ok:false,sha256:'a'.repeat(64),bytes:100},
  {jobId:'job-123',ok:true,sha256:'incomplete',bytes:100},
  {jobId:'job-123',ok:true,sha256:'a'.repeat(64),bytes:0},
  {jobId:'job-123',ok:true,sha256:'a'.repeat(64),bytes:-1},
  {jobId:'job-123',ok:true,sha256:'a'.repeat(64),bytes:'not-a-number'}
 ])assert.throws(()=>nativeBatchDeliveryReceipt(source,completed,invalid),/保存回执/);
 assert.throws(()=>formatNativeBatchDeliveryReceipt(null),/尚无/);
});
