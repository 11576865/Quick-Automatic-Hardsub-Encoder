import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTaskReview,taskReviewOverview} from './task-review.js';
const task={operation:'transcode',encoder:'libx265',outputContainer:'mkv',outputPlan:{video:[{sourceOrdinal:0,action:'encode'}],audio:[{sourceOrdinal:1,action:'copy',range:'full'}],droppedAudio:[{sourceOrdinal:0}],subtitles:[],attachments:[{sourceOrdinal:2,action:'copy'}],metadata:true,chapters:false}};
test('unprobed source and unchecked plan remain unknown',()=>{const m=buildTaskReview({hasSource:true});assert.match(m.source.status,/未读取/);assert.match(m.plan.status,/未检查/);assert.deepEqual(m.plan.rows,[]);assert.equal(m.artifact.available,false);});
test('compiled output plan exposes retained and removed source rows',()=>{const m=buildTaskReview({media:{duration:5,width:1280,height:720,audioTracks:2},hasSource:true,task});assert.match(m.plan.rows.join(' '),/音频 #1.*复制/);assert.match(m.plan.rows.join(' '),/音频 #0.*不输出/);assert.match(m.plan.rows.join(' '),/附件 #2/);assert.match(m.plan.rows.join(' '),/章节.*不保留/);});
test('editing a plan cannot relabel the earlier artifact encoder or source',()=>{const artifact={source:'原始素材',task,report:{verified:true,deliveryAllowed:true,outputBytes:1234}};const m=buildTaskReview({task:{...task,encoder:'libx264'},artifact,stale:true,state:'saved'});assert.match(m.artifact.status,/上一任务/);assert.equal(m.artifact.encoder,'libx265');assert.equal(m.artifact.source,'原始素材');assert.equal(m.plan.encoder,'libx264');assert.equal(artifact.task.encoder,'libx265');});
test('unverified or rejected output never claims verified delivery',()=>{const m=buildTaskReview({artifact:{task,report:{verified:null,deliveryAllowed:false,outputBytes:null}},state:'failed'});assert.match(m.artifact.status,/禁止交付/);assert.match(m.artifact.verification,/未提供/);assert.equal(m.artifact.bytes,null);});
test('saved status distinguishes browser handoff from file-system confirmation',()=>{const m=buildTaskReview({artifact:{task,report:{verified:true,deliveryAllowed:true,outputBytes:10},saveKind:'browser-download'},state:'saved'});assert.match(m.artifact.status,/浏览器/);assert.match(m.artifact.playback,/未验证/);});

test('checked budget discloses full-source reservation for trimmed copied streams',()=>{
 const m=buildTaskReview({task:{...task,sizePlan:{targetBytes:1000000,fixedPayloadBytes:200000,encodedAudioBytes:0,containerReserveBytes:40000,copiedTrimReserveBytes:200000}}});
 assert.match(m.plan.budget.join(' '),/裁切复制流.*完整源流.*0.20 MB/);
 const full=buildTaskReview({task:{...task,sizePlan:{targetBytes:1000000,fixedPayloadBytes:200000,encodedAudioBytes:0,containerReserveBytes:40000,copiedTrimReserveBytes:0}}});
 assert.doesNotMatch(full.plan.budget.join(' '),/裁切复制流/);
});


test('collapsed review retains unprobed, unchecked and absent artifact states',()=>{
 const model=buildTaskReview({hasSource:true});
 const overview=taskReviewOverview(model);
 assert.match(overview,/来源未读取参数/);assert.match(overview,/当前方案未检查/);assert.match(overview,/尚无成品/);
});
test('collapsed review distinguishes stale save retry from current checked plan and rejected delivery',()=>{
 const model=buildTaskReview({task,artifact:{task,source:'old',report:{verified:true,outputBytes:100}},stale:true,state:'save_failed'});
 assert.match(taskReviewOverview(model),/当前方案已检查/);
 assert.match(taskReviewOverview(model),/上一任务.*保存失败，可重试/);
 const rejected=buildTaskReview({artifact:{task,report:{deliveryAllowed:false}},state:'failed'});
 assert.match(taskReviewOverview(rejected),/禁止交付/);
});

test('saved Native file evidence remains attached to the original artifact',()=>{
 const deliveryReceipt={kind:'native-saved-file',jobId:'job-a',path:'C:/out.mkv',bytes:10,sha256:'ab'.repeat(32)};
 const artifact={task,report:{verified:true,deliveryAllowed:true,outputBytes:10,deliveryReceipt}};
 assert.deepEqual(buildTaskReview({artifact,state:'saved'}).artifact.deliveryReceipt,deliveryReceipt);
 assert.equal(buildTaskReview({artifact:{task,report:{verified:true,outputBytes:10}},state:'saved'}).artifact.deliveryReceipt,null);
});
