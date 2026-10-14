import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileTask,firstPassArgs} from './media-task.js';
import {validatePlannedAudioOutput} from './media-stream-plan.js';
const media={duration:5,fps:24,videoTracks:1,audioTracks:3,subtitleTracks:2,attachmentTracks:2,
 audioStreams:[{index:1,codec:'flac'},{index:2,codec:'aac'},{index:3,codec:'pcm_s16le'}],
 videoStreams:[{codec:'h264',bitDepth:8}]};
const raw={operation:'transcode',codec:'h264',encoder:'libx264',preset:'medium',rateMode:'quality',quality:23,
 start:0,end:'',audio:'copy',audioTrack:'all',fpsMode:'auto',pixelFormat:'yuv420p',
 rotation:'none',deinterlace:'none',scaleAlgorithm:'lanczos',outputContainer:'mkv'};
const build=change=>compileTask({...raw,...change},media);
test('heterogeneous audio maps source identity to contiguous output indices and traceable plan',()=>{
 const t=build({audioPlan:[{sourceOrdinal:2,action:'libopus',bitrate:64000,channels:1,sampleRate:48000},
  {sourceOrdinal:0,action:'copy'},{sourceOrdinal:1,action:'drop'}]});
 assert.equal(t.expectedAudioTracks,2);
 assert.equal(t.outputArgs[t.outputArgs.indexOf('-c:a:0')+1],'libopus');
 assert.equal(t.outputArgs[t.outputArgs.indexOf('-c:a:1')+1],'copy');
 assert.ok(t.outputArgs.includes('0:a:2'));
 assert.ok(!t.outputArgs.includes('-c:a'));
 assert.equal(t.outputPlan.audio[0].sourceIndex,3);
 assert.equal(t.outputPlan.audio[1].sourceCodec,'flac');
 assert.equal(t.estimatedAudioRate,null);
 assert.equal(t.outputPlan.droppedAudio[0].sourceOrdinal,1);
 assert.doesNotThrow(()=>build({audioTrack:'99',audioPlan:[{sourceOrdinal:0,action:'copy'}]}));
 assert.ok(!firstPassArgs(t.outputArgs).some(x=>/^-c:a|^-b:a|^-ac:a|^-ar:a/.test(x)));
});
test('FLAC and independent track ranges compile without bitrate assumptions',()=>{
 const t=build({start:1,end:3,audioPlan:[{sourceOrdinal:0,action:'flac',range:'full'},
  {sourceOrdinal:1,action:'aac',bitrate:96000,range:'trim'}]});
 assert.ok(t.outputArgs.includes('0:a:0'));assert.ok(t.outputArgs.includes('1:a:1'));
 assert.equal(t.expectedAudioDuration,5);assert.equal(t.expectedDuration,5);
 assert.equal(t.outputArgs.includes('-b:a:0'),false);
 assert.equal(t.estimatedAudioRate,null);
});
test('explicit plan rejects duplicate/nonexistent source, bad bitrate and unsupported Opus sample rate',()=>{
 for(const plan of [[{sourceOrdinal:9,action:'copy'}],[{sourceOrdinal:0,action:'copy'},{sourceOrdinal:0,action:'aac'}],
  [{sourceOrdinal:0,action:'aac',bitrate:1}],[{sourceOrdinal:0,action:'libopus',sampleRate:44100}],
  [{sourceOrdinal:0,action:'exec'}]])assert.throws(()=>build({audioPlan:plan}));
});
test('explicit auxiliary selection preserves only requested subtitles and attachments',()=>{
 const t=build({keepSubtitles:true,subtitleStreams:'1',keepAttachments:true,attachmentStreams:'0'});
 assert.ok(t.outputArgs.includes('0:s:1'));assert.ok(!t.outputArgs.includes('0:s?'));
 assert.ok(t.outputArgs.includes('0:t:0'));assert.equal(t.outputPlan.subtitles[0].sourceOrdinal,1);
 assert.throws(()=>build({keepSubtitles:true,subtitleStreams:'2'}));
});
test('all auxiliary tracks compile into explicit source/output identities while keeping optional FFmpeg maps',()=>{
 const t=build({keepSubtitles:true,keepAttachments:true});
 assert.deepEqual(t.outputPlan.subtitles,[
  {sourceOrdinal:0,action:'copy'},{sourceOrdinal:1,action:'copy'}
 ]);
 assert.deepEqual(t.outputPlan.attachments,[
  {sourceOrdinal:0,action:'copy'},{sourceOrdinal:1,action:'copy'}
 ]);
 assert.ok(t.outputArgs.includes('0:s?'));
 assert.ok(t.outputArgs.includes('0:t?'));
 const unknown=compileTask({...raw,keepSubtitles:true},{...media,subtitleTracks:undefined,subtitleStreams:undefined});
 assert.deepEqual(unknown.outputPlan.subtitles,[]);
});
test('container and size decisions follow per-track actions rather than legacy global mode',()=>{
 assert.throws(()=>build({audio:'aac',outputContainer:'mp4',audioPlan:[{sourceOrdinal:0,action:'copy'}]}),/flac/);
 assert.doesNotThrow(()=>build({audio:'copy',outputContainer:'mp4',audioPlan:[{sourceOrdinal:0,action:'aac',bitrate:96000}]}));
 assert.throws(()=>build({rateMode:'size',targetSize:1,sizeUnit:'MB',audioPlan:[{sourceOrdinal:0,action:'flac'}]}),/预算|体积/);
 const known=build({rateMode:'size',targetSize:1,sizeUnit:'MB',audioPlan:[{sourceOrdinal:0,action:'aac',bitrate:64000}]});
 assert.equal(known.sizePlan.audioRate,64000);
});
test('planned output acceptance rejects substituted codecs and wrong channel counts',()=>{
 const task=build({audioPlan:[{sourceOrdinal:0,action:'copy'},{sourceOrdinal:1,action:'aac',channels:1}]});
 assert.doesNotThrow(()=>validatePlannedAudioOutput(task,[{codec:'flac'},{codec:'aac',channels:1}],media.audioStreams));
 assert.throws(()=>validatePlannedAudioOutput(task,[{codec:'aac'},{codec:'aac',channels:1}],media.audioStreams));
 assert.throws(()=>validatePlannedAudioOutput(task,[{codec:'flac'},{codec:'aac',channels:2}],media.audioStreams));
});
