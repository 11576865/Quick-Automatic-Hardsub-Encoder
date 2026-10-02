import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTask } from './media-task.js';
import { EncoderEngine } from './engine.js';
import schema from './task-argument-schema.json' with {type:'json'};
const media={duration:6,fps:30,audioTracks:2,formatName:'mov,mp4,m4a,3gp,3g2,mj2',sourceName:'source.mp4',videoCodec:'h264',audioCodec:'aac',audioCodecs:['aac','aac']};
export const defaults={operation:'transcode',codec:'h264',encoder:'libx264',preset:'medium',rateMode:'quality',quality:23,start:0,end:'',audio:'copy',audioTrack:'all',fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'lanczos',rotation:'none',deinterlace:'none',multipass:'fullres',lookahead:'',aqStrength:'',outputContainer:'auto'};
const build=(changes={})=>compileTask({...defaults,...changes},media);
test('manual values survive compilation and are emitted once',()=>{
  const task=build({width:320,height:180,fpsMode:'cfr',fps:24,gop:72,maxrate:6000000,bufsize:12000000,quality:18,preset:'slow'});
  assert.equal(task.outputArgs[task.outputArgs.indexOf('-crf')+1],'18');
  assert.equal(task.outputArgs[task.outputArgs.indexOf('-preset')+1],'slow');
  assert.equal(task.outputArgs[task.outputArgs.indexOf('-r')+1],'24');
  assert.match(task.outputArgs[task.outputArgs.indexOf('-vf')+1],/scale=320:180/);
  assert.equal(task.outputArgs.filter(x=>x==='-crf').length,1);
});
test('copy task has no filters, encoding preset, pixel conversion or audio transcode',()=>{
  const t=build({operation:'copy',rateMode:'size',twoPass:true,width:320,fps:24,pixelFormat:'yuv420p10le',start:1.2,end:3.7});
  assert.equal(t.expectedDuration,2.5);assert.equal(t.twoPass,false);
  for(const flag of ['-vf','-r','-preset','-crf','-pix_fmt'])assert.ok(!t.outputArgs.includes(flag));
  assert.equal(t.outputArgs[t.outputArgs.indexOf('-c:v')+1],'copy');
  assert.throws(()=>build({operation:'copy',audio:'aac'}));
});
test('container resolution is part of the compiled task',()=>{
  const encoded=build({audio:'aac'});
  assert.equal(encoded.version,3);
  assert.equal(encoded.outputContainer,'mp4');
  assert.equal(encoded.outputFormat,'mp4');
  assert.equal(encoded.outputExtension,'mp4');
  assert.equal(encoded.outputMime,'video/mp4');
  const copied=build({operation:'copy',outputContainer:'keep'});
  assert.equal(copied.outputContainer,'mp4');
  const mkv=build({audio:'libopus',outputContainer:'auto'});
  assert.equal(mkv.outputContainer,'mkv');
  assert.throws(()=>build({audio:'libopus',outputContainer:'mp4'}),/Opus/);
});
test('track selection and mute change expected output count',()=>{
  assert.equal(build({audio:'none'}).expectedAudioTracks,0);
  assert.equal(build({audioTrack:'1'}).expectedAudioTracks,1);
  assert.throws(()=>build({audioTrack:'2'}));
});
test('invalid ranges, malformed filters and incompatible options are rejected',()=>{
  for(const fields of [{end:0},{start:NaN},{start:5,end:4},{width:0,height:180},{crop:'movie=/private/file'},{fps:24,fpsMode:'vfr'},{frames:30},{videoStream:1},{preset:'p7'}])assert.throws(()=>build(fields));
  assert.throws(()=>compileTask(defaults,{...media,unsafeColorPipeline:true}));
  assert.doesNotThrow(()=>compileTask({...defaults,operation:'copy'},{...media,unsafeColorPipeline:true}));
});
test('compiled options stay within the native argument schema',()=>{
  const tasks=[build(),build({operation:'copy'}),build({operation:'hardsub',crop:'640:360:0:0',deinterlace:'bwdif',rotation:'clock',denoise:true,deband:true,sharpen:true}),build({encoder:'h264_nvenc',preset:'p5',lookahead:16,spatialAq:true,temporalAq:false,aqStrength:8})];
  for(const task of tasks){
    for(let i=0;i<task.outputArgs.length;i++){
      const flag=task.outputArgs[i];if(flag==='-sn')continue;
      const value=task.outputArgs[++i];
      if(flag==='-vf') for(const filter of value.split(','))assert.ok(schema.filters.some(pattern=>new RegExp('^(?:'+pattern+')$').test(filter)),filter);
      else assert.ok(new RegExp('^(?:'+schema.values[flag]+')$').test(value),flag+' '+value);
    }
  }
});
test('keyframe seek snaps backwards and recalculates expected duration',async()=>{
  const engine=new EncoderEngine();
  engine.api={ReturnCode:{isSuccess:()=>true},FFprobeKit:{execute:async()=>({getReturnCode:()=>0,getOutput:()=> '0.000\n2.000\n4.000\n'})}};
  const result=await engine.snapTaskStart(build({operation:'copy',start:3.1,end:5}));
  assert.equal(result.requestedStart,3.1);assert.equal(result.start,2);assert.equal(result.expectedDuration,3);
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
  engine.api={
    mount:async()=>{mounts++;},
    writeFile:async()=>{},
    FFmpegKitConfig:{setFontDirectoryList:async()=>{}}
  };
  engine.getBundledFallbackFont=async()=>{fallbackLoads++;return null;};
  const video={name:'source.mkv',size:432800000,lastModified:1};
  await engine.stageFiles(video,null,[]);
  await engine.stageFiles(video,null,[]);
  assert.equal(mounts,1);
  assert.equal(fallbackLoads,0);
});
