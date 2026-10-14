import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {compileTask} from '../src/media-task.js';
// WU02: make a real Native task with the shared compiler, never a second encoder.
const [probePath,outPath]=process.argv.slice(2);
if(!probePath||!outPath)throw Error('Usage: build-wu02-native-task.mjs probe.json request.json');
const probe=JSON.parse(readFileSync(probePath,'utf8'));
assert.equal(probe.ok,true);
assert.equal(probe.videoTracks,1);
assert.equal(probe.audioTracks,2);
assert.equal(probe.subtitleTracks,1);
assert.equal(probe.attachmentTracks,1);
const media={
 duration:Number(probe.duration),fps:12,
 videoTracks:probe.videoTracks,videoStreams:probe.videoStreams,
 audioTracks:probe.audioTracks,audioStreams:probe.audioStreams,
 subtitleTracks:probe.subtitleTracks,subtitleStreams:probe.subtitleStreams,
 attachmentTracks:probe.attachmentTracks,attachmentStreams:probe.attachmentStreams,
 formatName:probe.format,sourceName:'source.mkv',videoCodec:probe.videoCodec,
 audioCodecs:probe.audioCodecs
};
const raw={
 operation:'hardsub',codec:'h264',encoder:'libx264',preset:'medium',
 rateMode:'quality',quality:23,twoPass:false,
 start:0,end:'',videoStreams:'0',videoRange:'full',
 audio:'copy',audioTrack:'all',audioRange:'full',subtitleRange:'full',
 audioPlan:[
  {sourceOrdinal:0,action:'copy',range:'full'},
  {sourceOrdinal:1,action:'aac',range:'full',bitrate:96000}
 ],
 outputContainer:'mkv',keepSubtitles:false,keepAttachments:false,
 keepMetadata:true,keepChapters:true,
 fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'bicubic',
 subtitleRenderOrder:'before-scale',rotation:'none',deinterlace:'none',
 crop:'',codecParams:'',lookahead:'',maxrate:'',bufsize:'',gop:'',bf:'',refs:'',
 sampleLength:'15',squarePixels:false
};
const task=compileTask(raw,media);
assert.equal(task.operation,'hardsub');
assert.equal(task.outputFormat,'matroska');
assert.equal(task.encoder,'libx264');
assert.deepEqual(task.audioPlan.map(a=>a.action),['copy','aac']);
assert.equal(task.expectedAudioTracks,2);
assert.equal(task.outputArgs[task.outputArgs.indexOf('-vf')+1],
 'ass=__ASS__:fontsdir=__FONTS__,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0');
writeFileSync(outPath,JSON.stringify({
 request:{task,suggestedName:'wu02-embedded-burned.mkv'}
},null,2));
console.log('WU02 shared schema-v4 task compilation passed');
