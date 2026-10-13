import test from 'node:test';
import assert from 'node:assert/strict';
import {commitVerifiedManualCandidate} from './manual-transcode-adoption.js';
import {compileTask} from './media-task.js';
const candidate={id:'h265-x265',codec:'h265',encoder:'libx265',preset:'medium'};
function fixture(){
  const values={codec:'h264',encoder:'libx264',preset:'slow',
    multipass:'disabled',rateMode:'quality',bitrate:'1500000',
    twoPass:false,operation:'transcode',audio:'copy'};
  const el={};
  for(const [name,value] of Object.entries(values)) el[name]={
    value:String(value),checked:value===true
  };
  const read=()=>Object.fromEntries(Object.entries(el).map(([name,x])=>[
    name,name==='twoPass'?x.checked:x.value
  ]));
  const old=read(),events=[];
  const run=({override={},compile=(actual)=>({
    operation:'transcode',codec:actual.codec,encoder:actual.encoder,
    preset:actual.preset,rateMode:actual.rateMode,bitrate:Number(actual.bitrate)
  })}={})=>commitVerifiedManualCandidate({
    candidate,bitrate:850000,expectedSettings:old,
    expectedSourceIdentity:'source-v1',read,
    sourceIdentity:()=> 'source-v1',get:k=>el[k],
    updateEncoder:()=>{el.encoder.value='libx264';},
    updatePreset:()=>{el.preset.value='fast';},
    updateRate:()=>{events.push('rate');},
    compile,media:{duration:60},...override
  });
  return {el,old,read,events,run};
}
test('atomic form commit builds one complete bitrate-mode HEVC plan',()=>{
  const x=fixture(),result=x.run();
  assert.equal(result.ok,true);
  assert.equal(result.task.encoder,'libx265');
  assert.equal(result.task.rateMode,'bitrate');
  assert.equal(x.read().codec,'h265');
  assert.equal(x.read().preset,'medium');
  assert.equal(x.read().bitrate,'850000');
  assert.equal(x.read().twoPass,false);
});
test('failed final compiler restores all old fields; no task is adopted',()=>{
  const x=fixture();
  const result=x.run({compile:()=>{throw Error('invalid mux');}});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'adoption-rejected');
  assert.deepEqual(x.read(),x.old);
});
test('source/settings drift is rejected before touching form',()=>{
  const x=fixture();
  const s=x.run({override:{sourceIdentity:()=> 'other'}});
  assert.equal(s.reason,'stale-adoption-settings');
  assert.equal(x.events.length,0);
  assert.deepEqual(x.read(),x.old);
  const t=x.run({override:{expectedSettings:{...x.old,codec:'h265'}}});
  assert.equal(t.reason,'stale-adoption-settings');
  assert.deepEqual(x.read(),x.old);
});
test('unknown/contradictory encoders and invalid rate cannot be committed',()=>{
  const x=fixture();
  for(const p of [{candidate:{...candidate,encoder:'hevc_nvenc'}},
    {candidate:{...candidate,codec:'av1'}},{bitrate:0},
    {bitrate:'850000'}]){
    const y=x.run({override:p});assert.equal(y.ok,false);
    assert.deepEqual(x.read(),x.old);
  }
});
test('invalid chosen encoder options trigger rollback instead of partial switch',()=>{
  const x=fixture();
  const y=x.run({override:{updateEncoder:()=>{
    if(x.el.codec.value==='h265')throw Error('selected encoder is unavailable');
    x.el.encoder.value='libx264';
  }}});
  assert.equal(y.ok,false);
  assert.deepEqual(x.read(),x.old);
});

test('the committed formal v4 transcode command really contains HEVC and target video bitrate',()=>{
  const media={
    duration:6,sourceName:'synthetic.mkv',formatName:'matroska,webm',
    fps:30,videoTracks:1,videoCodec:'h264',
    videoStreams:[{ordinal:0,codec:'h264',width:320,height:180,
      fps:30,pixelFormat:'yuv420p',bitDepth:8,unsafeColorPipeline:false}],
    audioTracks:0,audioStreams:[]
  };
  const base={
    operation:'transcode',codec:'h264',encoder:'libx264',preset:'slow',
    rateMode:'quality',quality:'23',multipass:'disabled',
    bitrate:'1000000',twoPass:false,
    start:'0',end:'',videoStreams:'0',videoRange:'trim',
    audio:'none',audioTrack:'all',audioRange:'trim',subtitleRange:'trim',
    fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'lanczos',
    rotation:'none',deinterlace:'none',outputContainer:'mkv'
  };
  const owned=['codec','encoder','preset','multipass','rateMode','bitrate','twoPass'];
  const controls=Object.fromEntries(owned.map(name=>[name,{
    value:String(base[name]),checked:base[name]===true
  }]));
  const read=()=>({...base,...Object.fromEntries(owned.map(name=>[
    name,name==='twoPass'?controls[name].checked:controls[name].value
  ]))});
  const result=commitVerifiedManualCandidate({
    candidate,bitrate:850000,
    expectedSettings:read(),expectedSourceIdentity:'real-media-key',
    read,sourceIdentity:()=> 'real-media-key',get:k=>controls[k],
    updateEncoder:()=>{controls.encoder.value='libx264';},
    updatePreset:()=>{controls.preset.value='medium';},
    updateRate:()=>{},compile:compileTask,media
  });
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.task.operation,'transcode');
  assert.equal(result.task.encoder,'libx265');
  assert.equal(result.task.codec,'h265');
  assert.equal(result.task.rateMode,'bitrate');
  assert.equal(result.task.bitrate,850000);
  assert.deepEqual(result.task.outputArgs.slice(
    result.task.outputArgs.indexOf('-c:v'),result.task.outputArgs.indexOf('-c:v')+2
  ),['-c:v','libx265']);
});
test('adoption writes and rolls back verified resolution and bicubic scaling atomically',()=>{
 const x=fixture();for(const k of ['width','height','scaleAlgorithm'])x.el[k]={value:k==='scaleAlgorithm'?'lanczos':'',checked:false};
 const old=x.read(),c={...candidate,outputWidth:160,outputHeight:90,scaleAlgorithm:'bicubic'};
 const result=x.run({override:{candidate:c,expectedSettings:old},compile:a=>compileTask({...a,start:0,end:'',audio:'none',fpsMode:'auto',rotation:'none',deinterlace:'none',pixelFormat:'yuv420p'},{duration:6,fps:24,videoTracks:1,audioTracks:0})});
 assert.equal(result.ok,true);assert.equal(x.read().width,'160');assert.equal(x.read().height,'90');assert.equal(x.read().scaleAlgorithm,'bicubic');
 const y=fixture();for(const k of ['width','height','scaleAlgorithm'])y.el[k]={value:k==='scaleAlgorithm'?'lanczos':'',checked:false};
 const previous=y.read();
 assert.equal(y.run({override:{candidate:c,expectedSettings:previous},compile:()=>{throw Error('reject');}}).ok,false);
 assert.deepEqual(y.read(),previous);
});
