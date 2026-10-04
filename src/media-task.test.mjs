import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTask, taskSourceArgs } from './media-task.js';
import { parseMediaTime, formatMediaTimeInput } from './media-time.js';
import { EncoderEngine } from './engine.js';
import schema from './task-argument-schema.json' with {type:'json'};

const media={
  duration:6,fps:30,formatName:'mov,mp4,m4a,3gp,3g2,mj2',sourceName:'source.mp4',
  videoTracks:2,
  videoStreams:[
    {ordinal:0,codec:'h264',width:1920,height:1080,fps:30,pixelFormat:'yuv420p',bitDepth:8,unsafeColorPipeline:false},
    {ordinal:1,codec:'h264',width:1280,height:720,fps:24,pixelFormat:'yuv420p',bitDepth:8,unsafeColorPipeline:false}
  ],
  videoCodec:'h264',audioTracks:2,audioCodec:'aac',audioCodecs:['aac','aac'],
  audioStreams:[{ordinal:0,codec:'aac',bitRate:96000},{ordinal:1,codec:'aac',bitRate:128000}]
};

export const defaults={
  operation:'transcode',codec:'h264',encoder:'libx264',preset:'medium',rateMode:'quality',quality:23,
  start:0,end:'',videoStreams:'0',videoRange:'trim',
  audio:'copy',audioTrack:'all',audioRange:'trim',subtitleRange:'trim',
  fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'lanczos',rotation:'none',deinterlace:'none',
  multipass:'fullres',lookahead:'',aqStrength:'',outputContainer:'auto'
};
const build=(changes={})=>compileTask({...defaults,...changes},media);

test('human media time accepts seconds, clock forms and full-width punctuation',()=>{
  assert.equal(parseMediaTime('3.57'),3.57);
  assert.equal(parseMediaTime('3:57'),237);
  assert.equal(parseMediaTime('3:57.250'),237.25);
  assert.equal(parseMediaTime('1:03:57.250'),3837.25);
  assert.equal(parseMediaTime('3：57.250'),237.25);
  assert.equal(formatMediaTimeInput(237.25),'3:57.25');
  assert.throws(()=>parseMediaTime('3:99'),/秒必须小于 60/);
  assert.throws(()=>parseMediaTime('-1'),/不能为负数/);
});

test('compiled trim range accepts clock-form inputs and still rejects reversed range',()=>{
  const longMedia={...media,duration:4000};
  const task=compileTask({...defaults,start:'3:57.250',end:'4:00'},longMedia);
  assert.equal(task.start,237.25);
  assert.equal(task.end,240);
  assert.equal(task.expectedDuration,2.75);
  assert.throws(()=>compileTask({...defaults,start:'4:00',end:'3:57.250'},longMedia),/结束时间必须晚于开始时间/);
});

test('manual values survive compilation and are emitted once',()=>{
  const task=build({width:320,height:180,fpsMode:'cfr',fps:24,gop:72,maxrate:6000000,bufsize:12000000,quality:18,preset:'slow'});
  assert.equal(task.outputArgs[task.outputArgs.indexOf('-crf')+1],'18');
  assert.equal(task.outputArgs[task.outputArgs.indexOf('-preset')+1],'slow');
  assert.equal(task.outputArgs[task.outputArgs.indexOf('-r')+1],'24');
  assert.match(task.outputArgs[task.outputArgs.indexOf('-vf')+1],/scale=320:180/);
  assert.equal(task.outputArgs.filter(x=>x==='-crf').length,1);
});

test('schema v4 selects one or more concrete video streams',()=>{
  const one=build({videoStreams:'1'});
  assert.equal(one.version,4);
  assert.deepEqual(one.videoStreams,[1]);
  assert.equal(one.expectedVideoTracks,1);
  assert.ok(one.outputArgs.includes('0:v:1'));

  const both=build({videoStreams:'0,1'});
  assert.deepEqual(both.videoStreams,[0,1]);
  assert.equal(both.expectedVideoTracks,2);
  assert.ok(both.outputArgs.includes('0:v:0'));
  assert.ok(both.outputArgs.includes('0:v:1'));

  const all=build({videoStreams:'all'});
  assert.deepEqual(all.videoStreams,[0,1]);
  assert.throws(()=>build({videoStreams:'2'}),/视频流索引不存在/);
  assert.throws(()=>build({videoStreams:'0,a'}),/视频流选择格式无效/);
});

test('independent video/audio time policies compile to separate source views',()=>{
  const videoOnly=build({start:1,end:3,videoRange:'trim',audioRange:'full',videoStreams:'1'});
  assert.equal(videoOnly.usesTrimInput,true);
  assert.ok(videoOnly.outputArgs.includes('1:v:1'));
  assert.ok(videoOnly.outputArgs.includes('0:a?'));
  assert.deepEqual(taskSourceArgs(videoOnly,'source.mkv'),['-i','source.mkv','-ss','1','-t','2','-i','source.mkv']);
  assert.equal(videoOnly.expectedVideoDuration,2);
  assert.equal(videoOnly.expectedAudioDuration,6);
  assert.equal(videoOnly.expectedDuration,6);

  const audioOnly=build({start:1,end:3,videoRange:'full',audioRange:'trim'});
  assert.ok(audioOnly.outputArgs.includes('0:v:0'));
  assert.ok(audioOnly.outputArgs.includes('1:a?'));
  assert.equal(audioOnly.expectedVideoDuration,6);
  assert.equal(audioOnly.expectedAudioDuration,2);

  const full=build({start:1,end:3,videoRange:'full',audioRange:'full'});
  assert.equal(full.usesTrimInput,false);
  assert.deepEqual(taskSourceArgs(full,'source.mkv'),['-i','source.mkv']);
});

test('video Stream Copy can be combined with independent audio transcode and remux',()=>{
  const t=build({operation:'copy',audio:'aac',audioBitrate:96000,outputContainer:'mkv',start:1,end:3});
  assert.equal(t.twoPass,false);
  assert.equal(t.outputArgs[t.outputArgs.indexOf('-c:v')+1],'copy');
  assert.equal(t.outputArgs[t.outputArgs.indexOf('-c:a')+1],'aac');
  for(const flag of ['-vf','-r','-preset','-crf','-pix_fmt'])assert.ok(!t.outputArgs.includes(flag));
  assert.equal(t.outputContainer,'mkv');
});

test('container resolution is part of the compiled task and uses selected stream identity',()=>{
  const encoded=build({audio:'aac'});
  assert.equal(encoded.version,4);
  assert.equal(encoded.outputContainer,'mp4');
  const copied=build({operation:'copy',outputContainer:'keep'});
  assert.equal(copied.outputContainer,'mp4');
  const mkv=build({audio:'libopus',outputContainer:'auto'});
  assert.equal(mkv.outputContainer,'mkv');
  assert.throws(()=>build({audio:'libopus',outputContainer:'mp4'}),/Opus/);

  const incompatible={...media,videoStreams:[media.videoStreams[0],{...media.videoStreams[1],codec:'vp9'}]};
  assert.throws(()=>compileTask({...defaults,operation:'copy',videoStreams:'1',outputContainer:'mp4'},incompatible),/vp9/i);
  assert.doesNotThrow(()=>compileTask({...defaults,operation:'copy',videoStreams:'0',outputContainer:'mp4'},incompatible));
});

test('track selection and mute change expected output count',()=>{
  assert.equal(build({audio:'none'}).expectedAudioTracks,0);
  assert.equal(build({audioTrack:'1'}).expectedAudioTracks,1);
  assert.throws(()=>build({audioTrack:'2'}));
});

test('copied audio guidance follows the selected audio track',()=>{
  const mixed={...media,audioCodecs:['aac','dts'],audioStreams:[{ordinal:0,codec:'aac'},{ordinal:1,codec:'dts'}]};
  const aac=compileTask({...defaults,audio:'copy',audioTrack:'0'},mixed);
  assert.ok(aac.compatibilityWarnings.some(message=>message.includes('AAC · 1 轨')));
  const dts=compileTask({...defaults,audio:'copy',audioTrack:'1'},mixed);
  assert.ok(dts.compatibilityWarnings.some(message=>message.includes('DTS · 1 轨') && message.includes('转为 AAC')));
  const transcoded=build({audio:'aac'});
  assert.equal(transcoded.compatibilityWarnings.some(message=>message.includes('Stream Copy')),false);
});

test('multi-video limitations reject ambiguous one-value controls',()=>{
  assert.throws(()=>build({videoStreams:'0,1',rateMode:'size',targetSize:50,sizeUnit:'MB'}),/目标体积模式/);
  assert.throws(()=>build({videoStreams:'0,1',twoPass:true,rateMode:'bitrate',bitrate:1000000}),/两遍编码/);
  assert.throws(()=>build({videoStreams:'0,1',frames:30,fpsMode:'cfr',fps:30,audio:'none'}),/总帧数/);
});

test('invalid ranges, malformed filters and incompatible options are rejected',()=>{
  for(const fields of [{end:0},{start:NaN},{start:5,end:4},{width:0,height:180},{crop:'movie=/private/file'},{fps:24,fpsMode:'vfr'},{frames:30},{preset:'p7'}])assert.throws(()=>build(fields));
  const hdrMedia={...media,videoStreams:[media.videoStreams[0],{...media.videoStreams[1],bitDepth:10,unsafeColorPipeline:true}]};
  assert.doesNotThrow(()=>compileTask(defaults,hdrMedia));
  assert.throws(()=>compileTask({...defaults,videoStreams:'1'},hdrMedia),/HDR\/高位深/);
  assert.doesNotThrow(()=>compileTask({...defaults,operation:'copy',videoStreams:'1'},hdrMedia));
});

test('compiled options stay within the native argument schema',()=>{
  const tasks=[
    build(),
    build({operation:'copy',videoStreams:'0,1'}),
    build({operation:'copy',audio:'aac',start:1,end:3,videoRange:'trim',audioRange:'full'}),
    build({operation:'hardsub',videoStreams:'0,1',crop:'640:360:0:0',deinterlace:'bwdif',rotation:'clock',denoise:true,deband:true,sharpen:true}),
    build({encoder:'h264_nvenc',preset:'p5',lookahead:16,spatialAq:true,temporalAq:false,aqStrength:8})
  ];
  for(const task of tasks){
    for(let i=0;i<task.outputArgs.length;i++){
      const flag=task.outputArgs[i];if(flag==='-sn')continue;
      const value=task.outputArgs[++i];
      if(flag==='-vf') for(const filter of value.split(','))assert.ok(schema.filters.some(pattern=>new RegExp('^(?:'+pattern+')$').test(filter)),filter);
      else assert.ok(new RegExp('^(?:'+schema.values[flag]+')$').test(value),flag+' '+value);
    }
  }
});

test('keyframe seek uses the primary selected video and recalculates trimmed durations',async()=>{
  const engine=new EncoderEngine();
  let command='';
  engine.api={ReturnCode:{isSuccess:()=>true},FFprobeKit:{execute:async value=>{command=value;return {getReturnCode:()=>0,getOutput:()=> '0.000\n2.000\n4.000\n'};}}};
  const result=await engine.snapTaskStart(build({operation:'copy',videoStreams:'1',start:3.1,end:5}));
  assert.match(command,/-select_streams v:1/);
  assert.equal(result.requestedStart,3.1);
  assert.equal(result.start,2);
  assert.equal(result.expectedVideoDuration,3);
  assert.equal(result.expectedAudioDuration,3);
  assert.equal(result.expectedDuration,3);
});

test('fractional fps and codec-specific overrides remain exact',()=>{
 const t=build({fpsMode:'cfr',fps:'24000/1001',audio:'none',frames:24,codecParams:'aq-mode=2:rc-lookahead=20'});
 assert.equal(t.outputArgs[t.outputArgs.indexOf('-r')+1],'24000/1001');
 assert.ok(Math.abs(t.expectedDuration-1.001)<1e-9);
 assert.throws(()=>build({fpsMode:'cfr',fps:'24/0'}));
 assert.throws(()=>build({codecParams:'analysis-save=private'}));
});

test('web staging reuses an already mounted source for media-only work',async()=>{
  const engine=new EncoderEngine();
  let mounts=0,fallbackLoads=0;
  engine.ready=true;
  engine.api={mount:async()=>{mounts++;},writeFile:async()=>{},FFmpegKitConfig:{setFontDirectoryList:async()=>{}}};
  engine.getBundledFallbackFont=async()=>{fallbackLoads++;return null;};
  const video={name:'source.mkv',size:432800000,lastModified:1};
  await engine.stageFiles(video,null,[]);
  await engine.stageFiles(video,null,[]);
  assert.equal(mounts,1);
  assert.equal(fallbackLoads,0);
});

test('timeline keyframe scan returns ordered bounded keyframes and reports truncation',async()=>{
  const engine=new EncoderEngine();
  engine.ready=true;
  engine.inputPath='/input/source.mkv';
  engine.mediaInfo={duration:400,audioTracks:1};
  const lines=Array.from({length:301},(_,i)=>String(i)).join('\n')+'\n';
  engine.api={ReturnCode:{isSuccess:()=>true},FFprobeKit:{execute:async()=>({getReturnCode:()=>0,getOutput:async()=>lines})}};
  const result=await engine.listKeyframes({duration:400,maxKeyframes:256});
  assert.equal(result.keyframes.length,256);
  assert.equal(result.keyframes[0],0);
  assert.equal(result.keyframes.at(-1),255);
  assert.equal(result.keyframesTruncated,true);
  assert.equal(result.duration,400);
});

test('timeline frame preview seeks exact requested time and scales bounded output',async()=>{
  const engine=new EncoderEngine();
  engine.ready=true;
  engine.inputPath='/input/source.mkv';
  engine.mediaInfo={videoCodec:'h264'};
  let command='';
  engine.execute=async value=>{command=value;};
  engine.api={readFile:async()=>new Uint8Array([137,80,78,71])};
  const result=await engine.renderTimelineFrame(12.345,{width:640,videoStream:1});
  assert.match(command,/-ss 12\.345/);
  assert.match(command,/-map 0:v:1/);
  assert.match(command,/-frames:v 1/);
  assert.match(command,/scale=640:-2:force_original_aspect_ratio=decrease/);
  assert.equal(result.time,12.345);
  assert.equal(result.width,640);
  assert.match(result.url,/^blob:/);
  URL.revokeObjectURL(result.url);
});
