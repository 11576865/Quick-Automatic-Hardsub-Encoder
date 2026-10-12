import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTask } from './media-task.js';
import { validateEncoderSupport } from './media-capabilities.js';
import schema from './task-argument-schema.json' with {type:'json'};
import * as planning from './media-planning.js';

const media={duration:5,fps:24,videoTracks:1,audioTracks:0,unsafeColorPipeline:false};
const raw={operation:'transcode',codec:'h266',encoder:'libvvenc',preset:'medium',
  rateMode:'quality',quality:32,start:0,end:'',audio:'none',audioTrack:'all',
  fpsMode:'auto',pixelFormat:'yuv420p10le',deinterlace:'none',rotation:'none',
  scaleAlgorithm:'lanczos',outputContainer:'mkv'};
const build=changes=>compileTask({...raw,...changes},media);

test('VVC quality task emits QP rather than CRF, resolves MKV and keeps audio/drop semantics',()=>{
  const t=build({quality:63});
  assert.equal(t.encoder,'libvvenc');
  assert.equal(t.outputArgs[t.outputArgs.indexOf('-qp')+1],'63');
  assert.equal(t.outputArgs.includes('-crf'),false);
  assert.equal(t.outputArgs.includes('-cq'),false);
  assert.equal(t.expectedBitDepth,10);
  assert.equal(t.outputContainer,'mkv');
  assert.match(t.compatibilityWarnings.join(' '),/H\.266/);
});

test('VVC bitrate emits explicit bitrate without CQ quality controls',()=>{
  const t=build({rateMode:'bitrate',bitrate:600000,outputContainer:'auto'});
  assert.equal(t.outputArgs[t.outputArgs.indexOf('-b:v')+1],'600000');
  assert.equal(t.outputArgs.includes('-qp'),false);
  assert.equal(t.outputContainer,'mkv');
  const ass=build({operation:'hardsub',quality:0});
  assert.match(ass.outputArgs[ass.outputArgs.indexOf('-vf')+1],/ass=__ASS__/);
});

test('VVC refuses unsupported preset, fractional QP, pixel formats, HDR and advanced flags',()=>{
  for(const preset of ['faster','fast','medium','slow','slower'])assert.doesNotThrow(()=>build({preset}));
  for(const bad of [{preset:'ultrafast'},{quality:32.5},{quality:64},{pixelFormat:'yuv420p'},
    {codecParams:'aq-mode=2'},{tune:'film'},{profile:'main'},{bf:4},{refs:3},{gop:48},
    {bufsize:1000000},{maxrate:1000000},{fpsMode:'vfr'},{twoPass:true},
    {outputContainer:'mp4'},{videoStreams:'all',frames:1}])assert.throws(()=>build(bad));
  assert.throws(()=>compileTask(raw,{...media,unsafeColorPipeline:true}),/HDR/);
});

test('VVC structured schema admits compiler flags and rejects arbitrary parameters',()=>{
  const args=build({quality:32}).outputArgs;
  for(let i=0;i<args.length;i++){
    const flag=args[i];if(flag==='-sn')continue;
    const value=args[++i];if(flag==='-vf')continue;
    assert.ok(schema.values[flag],flag);
    assert.match(value,new RegExp('^(?:'+schema.values[flag]+')$'),flag);
  }
});

test('VVC capability gate requires the encoder QP flag even if generic flags exist',()=>{
  const t=build();
  assert.throws(()=>validateEncoderSupport(t,{options:['-preset'],pixelFormats:['yuv420p10le']},['-fps_mode']),/-qp/);
  assert.doesNotThrow(()=>validateEncoderSupport(t,{options:['-preset','-qp'],pixelFormats:['yuv420p10le']},['-fps_mode']));
});
test('VVC short trials preserve requested QP endpoints and distinguish QP from CRF',()=>{
  assert.equal(typeof planning.sampleQualityTrial,'function');
  for(const quality of [0,32,63]){
    const task=build({quality});
    const trials=[-1,0,1].map(step=>planning.sampleQualityTrial(task,step));
    assert.equal(trials[1].quality,quality);
    assert.ok(trials.every(t=>t.quality>=0&&t.quality<=63));
    assert.ok(trials.every(t=>t.label==='QP'));
  }
  assert.equal(planning.sampleQualityTrial({codec:'av1',encoder:'av1_nvenc',quality:51},1).quality,51);
  assert.equal(planning.sampleQualityTrial({codec:'h264',encoder:'libx264',quality:23},1).quality,25);
});
