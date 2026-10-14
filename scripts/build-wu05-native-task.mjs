import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {compileTask} from '../src/media-task.js';
const [probePath,outPath]=process.argv.slice(2);
if(!probePath||!outPath)throw Error('Usage: build-wu05-native-task.mjs probe.json formal-job.json');
const p=JSON.parse(readFileSync(probePath,'utf8'));
assert.equal(p.ok,true);assert.equal(p.videoTracks,1);assert.equal(p.audioTracks,1);
const media={
 duration:Number(p.duration),fps:Number(p.fps||12),
 videoTracks:p.videoTracks,videoStreams:p.videoStreams,
 audioTracks:p.audioTracks,audioStreams:p.audioStreams,
 subtitleTracks:p.subtitleTracks||0,attachmentTracks:p.attachmentTracks||0,
 formatName:p.format,sourceName:'source.mkv',videoCodec:p.videoCodec,
 audioCodecs:p.audioCodecs
};
const raw={
 operation:'copy',codec:'h264',encoder:'copy',start:'2.4',end:'4.8',
 videoStreams:'0',videoRange:'trim',audioRange:'trim',
 subtitleRange:'trim',audio:'copy',audioTrack:'all',
 keepSubtitles:false,keepAttachments:false,keepMetadata:true,
 keepChapters:true,outputContainer:'mkv',
 rateMode:'quality',quality:23,fpsMode:'auto',
 rotation:'none',deinterlace:'none',pixelFormat:'yuv420p',
 crop:'',codecParams:'',lookahead:'',maxrate:'',bufsize:'',gop:'',bf:'',
 refs:'',sampleLength:'15',squarePixels:false
};
const task=compileTask(raw,media);
assert.equal(task.version,4);assert.equal(task.operation,'copy');
assert.equal(task.videoRange,'trim');assert.equal(task.hasTrimRange,true);
assert.equal(task.encoder,'copy');assert.equal(task.expectedAudioTracks,1);
assert.equal(task.start,2.4);assert.equal(task.end,4.8);
writeFileSync(outPath,JSON.stringify({request:{
 task,codec:'h264',mode:'crf',goal:'manual',
 expectedDuration:media.duration,expectedAudioTracks:1,
 suggestedName:'wu05-bframe-copy.mkv'
}},null,2));
console.log('WU05 actual v4 copy trim task compiled from real Native probe');
