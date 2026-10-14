import test from 'node:test';
import assert from 'node:assert/strict';
import {compileTask} from './media-task.js';
const media={
 duration:6,fps:12,sourceIdentity:'video-v1',formatName:'matroska',
 videoTracks:1,audioTracks:2,videoCodec:'ffv1',
 videoStreams:[{codec:'ffv1',width:320,height:180,fps:12}],
 audioStreams:[{codec:'flac',channels:2},{codec:'aac',channels:2}]
};
const raw={
 operation:'transcode',codec:'h264',encoder:'libx264',
 rateMode:'quality',quality:23,preset:'medium',
 start:0,end:6,videoStreams:'0',videoRange:'full',
 audio:'copy',audioTrack:'all',audioRange:'full',
 outputContainer:'mkv',keepSubtitles:false,keepAttachments:false,
 keepMetadata:true,keepChapters:true,rotation:'none',
 pixelFormat:'yuv420p',fpsMode:'auto',deinterlace:'none',
 mustCopyAudioOrdinals:'[0]',audioKeepSourceIdentity:'video-v1'
};
test('WU07: owner lock on source FLAC compiles unchanged copy and stays visible in OutputPlan',()=>{
 const task=compileTask(raw,media);
 assert.deepEqual(task.mustCopyAudioOrdinals,[0]);
 assert.equal(task.outputPlan.audio[0].mustCopy,true);
 assert.equal(task.outputPlan.audio[1].mustCopy,false);
 assert.ok(task.outputArgs.includes('-map'));
 assert.ok(task.outputArgs.includes('-c:a'));
});
test('WU07: mixed FLAC-copy AAC-transcode preserves locked source identity',()=>{
 const task=compileTask({...raw,audioPlan:[
  {sourceOrdinal:0,action:'copy',range:'full'},
  {sourceOrdinal:1,action:'aac',bitrate:96000,range:'full'}
 ]},media);
 assert.equal(task.outputPlan.audio[0].action,'copy');
 assert.equal(task.outputPlan.audio[1].action,'aac');
 assert.equal(task.outputPlan.audio[0].mustCopy,true);
 assert.equal(task.outputPlan.audio[1].mustCopy,false);
});
test('WU07: locked source audio cannot silently transcode or drop',()=>{
 for(const action of ['aac','libopus','drop']){
  assert.throws(()=>compileTask({...raw,audioPlan:[{sourceOrdinal:0,action,range:'full'},{sourceOrdinal:1,action:'copy',range:'full'}]},media),/必须 Copy/);
 }
 assert.throws(()=>compileTask({...raw,audio:'aac'},media),/必须 Copy/);
 assert.throws(()=>compileTask({...raw,audio:'none'},media),/必须 Copy/);
});
test('WU07: lock rejects foreign, missing, invalid and duplicate source identity',()=>{
 assert.throws(()=>compileTask(raw,{...media,sourceIdentity:'video-v2'}),/来源身份/);
 assert.throws(()=>compileTask(raw,{...media,sourceIdentity:undefined}),/来源身份/);
 assert.throws(()=>compileTask({...raw,mustCopyAudioOrdinals:'[0,0]'},media),/重复/);
 assert.throws(()=>compileTask({...raw,mustCopyAudioOrdinals:'[2]'},media),/索引/);
 assert.throws(()=>compileTask({...raw,mustCopyAudioOrdinals:'["0"]'},media),/索引/);
});
test('WU07: explicit removal of lock restores normal user-controlled conversions',()=>{
 const task=compileTask({...raw,mustCopyAudioOrdinals:'[]',audioPlan:[
  {sourceOrdinal:0,action:'aac',bitrate:96000,range:'full'},
  {sourceOrdinal:1,action:'drop',range:'full'}
 ]},media);
 assert.deepEqual(task.mustCopyAudioOrdinals,[]);
 assert.equal(task.expectedAudioTracks,1);
});
