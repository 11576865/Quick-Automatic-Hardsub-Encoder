import test from 'node:test';
import assert from 'node:assert/strict';
import {compileTask} from './media-task.js';
import {projectReadOnlyDeliveryContract} from './delivery-contract-projection.js';
const media={
 duration:6,fps:24,formatName:'matroska',sourceName:'multitrack.mkv',
 videoTracks:1,audioTracks:2,subtitleTracks:1,attachmentTracks:1,
 videoCodec:'ffv1',
 videoStreams:[{codec:'ffv1',width:320,height:180,fps:24,index:0}],
 audioStreams:[{codec:'flac',index:1,channels:2},{codec:'aac',index:2,channels:2}],
 subtitleStreams:[{codec:'ass',index:3,tags:{language:'eng'}}],
 attachmentStreams:[{codec:'ttf',index:4,tags:{filename:'font.ttf'}}]
};
const base={
 operation:'transcode',codec:'h264',encoder:'libx264',preset:'medium',
 rateMode:'quality',quality:23,start:0,end:6,videoStreams:'0',
 videoRange:'full',audio:'copy',audioTrack:'all',audioRange:'full',
 subtitleRange:'full',outputContainer:'mkv',
 keepSubtitles:false,keepAttachments:false,keepMetadata:true,
 keepChapters:true,scaleAlgorithm:'bicubic',
 rotation:'none',deinterlace:'none',pixelFormat:'yuv420p',
 fpsMode:'auto',crop:'',twoPass:false
};
test('P1 real v4 mixed-MKV transcode read-only projection shows every dropped/retained source',()=>{
 const task=compileTask(base,media);
 const before=structuredClone(task);
 const view=projectReadOnlyDeliveryContract({task,media,sourceIdentity:'source-1'});
 assert.equal(view.sourceAsset.identity,'source-1');
 assert.deepEqual(view.sourceStreams.audio.map(s=>s.action),['copy','copy']);
 assert.deepEqual(view.sourceStreams.subtitles.map(s=>s.action),['drop']);
 assert.deepEqual(view.sourceStreams.attachments.map(s=>s.action),['drop']);
 assert.equal(view.userIntent.provenance,'inferred-from-compiled-user-settings-not-a-separate-signed-intent');
 assert.equal(view.trace.status,'compiled-map-consistent');
 assert.deepEqual(task,before,'pure read-only projection changed authoritative compiler task');
 assert.equal(Object.isFrozen(view.executablePlanView.rawOutputArgs),true);
 assert.equal(Object.isFrozen(task.outputArgs),false);
});
test('P1 hardsub/read-only projection does not relabel omitted soft subtitle or fonts as retained',()=>{
 const task=compileTask({...base,operation:'hardsub'},media);
 const v=projectReadOnlyDeliveryContract({task,media,sourceIdentity:'S'});
 assert.equal(v.userIntent.subtitleBurnIn,true);
 assert.equal(v.sourceStreams.subtitles[0].action,'not-carried-soft');
 assert.equal(v.trace.status,'compiled-map-consistent');
});
test('P1 Stream Copy still reports original codec action without silently authorizing recompression',()=>{
 const task=compileTask({...base,operation:'copy',videoRange:'trim',start:1,end:4},media);
 const v=projectReadOnlyDeliveryContract({task,media,sourceIdentity:'S'});
 assert.equal(v.userIntent.codecAction,'copy');
 assert.equal(v.executablePlanView.encoder,'copy');
 assert.equal(v.outputPlan.video[0].action,'copy');
 assert.equal(v.artifactRecord.status,'not-produced-by-this-projection');
});
test('P1 detected command mismatch is advisory, never rewrites real FFmpeg arguments',()=>{
 const compiled=compileTask(base,media);
 const mutated=structuredClone(compiled);
 mutated.outputArgs=mutated.outputArgs.filter((arg,i,a)=>!(arg==='-map'&&a[i+1]==='0:v:0')&&!(arg==='0:v:0'&&a[i-1]==='-map'));
 const original=structuredClone(mutated.outputArgs);
 const v=projectReadOnlyDeliveryContract({task:mutated,media});
 assert.equal(v.trace.status,'review-required');
 assert.match(v.trace.warnings.join(' '),/未在编译参数/);
 assert.deepEqual(mutated.outputArgs,original);
 assert.ok(v.trace.warnings.some(s=>s.includes('稳定来源身份')));
});
