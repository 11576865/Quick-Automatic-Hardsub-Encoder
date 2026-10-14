// WU10: compile the ORIGINAL protected user intent from the Native /api/probe
// rather than substituting a hand-written ffmpeg command. The formal task is
// passed unchanged to the same Native /api/encode endpoint as Manual.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {compileTask} from '../src/media-task.js';
const [probePath,outPath,sourceKey]=process.argv.slice(2);
if(!probePath||!outPath||!sourceKey)throw Error('Usage: build-wu10-preserved-audio-task.mjs probe.json job.json source-key');
const p=JSON.parse(readFileSync(probePath,'utf8'));
assert.equal(p.ok,true);
assert.equal(p.videoTracks,1);assert.equal(p.audioTracks,2);
const media={
 duration:Number(p.duration),fps:Number(p.fps||12),
 videoTracks:p.videoTracks,videoStreams:p.videoStreams,
 audioTracks:p.audioTracks,audioStreams:p.audioStreams,
 subtitleTracks:p.subtitleTracks||0,attachmentTracks:p.attachmentTracks||0,
 formatName:p.format,sourceName:'two-audio-source.mkv',sourceIdentity:sourceKey,
 videoCodec:p.videoCodec,audioCodecs:p.audioCodecs
};
assert(Number.isFinite(media.duration)&&media.duration>0);
const raw={
 operation:'transcode',codec:'h264',encoder:'libx264',preset:'fast',
 rateMode:'quality',quality:24,videoStreams:'0',
 start:0,end:media.duration,videoRange:'full',
 audio:'copy',audioTrack:'all',audioRange:'full',
 audioPlan:[{sourceOrdinal:0,action:'copy',range:'full'},
  {sourceOrdinal:1,action:'aac',range:'full',bitrate:96000}],
 mustCopyAudioOrdinals:'[0]',audioKeepSourceIdentity:sourceKey,
 subtitleRange:'full',outputContainer:'mkv',
 keepSubtitles:false,keepAttachments:false,keepMetadata:true,
 keepChapters:true,rotation:'none',deinterlace:'none',
 fpsMode:'auto',pixelFormat:'yuv420p',
 crop:'',codecParams:'',lookahead:'',maxrate:'',bufsize:'',gop:'',bf:'',
 refs:'',sampleLength:'15',squarePixels:false,
 multipass:'disabled',twoPass:false
};
assert.throws(()=>compileTask({...raw,audioKeepSourceIdentity:'other-source'},media),/来源身份/);
assert.throws(()=>compileTask({...raw,audioPlan:[{sourceOrdinal:0,action:'aac',range:'full',bitrate:96000},{sourceOrdinal:1,action:'copy',range:'full'}]},media),/必须 Copy/);
const task=compileTask(raw,media);
assert.equal(task.version,4);
assert.equal(task.operation,'transcode');
assert.deepEqual(task.mustCopyAudioOrdinals,[0]);
assert.equal(task.expectedAudioTracks,2);
assert.deepEqual(task.audioPlan.map(a=>a.action),['copy','aac']);
assert.equal(task.outputPlan.audio[0].mustCopy,true);
assert.equal(task.outputPlan.audio[1].mustCopy,false);
assert.equal(task.outputPlan.audio[0].sourceOrdinal,0);
const args=task.outputArgs.map(String).join(' ');
assert.match(args,/-map 0:a:0/);
assert.match(args,/-map 0:a:1/);
assert.match(args,/-c:a:0 copy/);
assert.match(args,/-c:a:1 aac/);
writeFileSync(outPath,JSON.stringify({request:{
 task,codec:'h264',mode:'crf',goal:'manual',
 expectedDuration:media.duration,expectedAudioTracks:2,
 suggestedName:'wu10-protected-flac-aac-mix.mkv'
}},null,2));
console.log('WU10 formal v4 source-locked FLAC Copy / AAC transcode job compiled; negative identity/drop/recode guarded');
