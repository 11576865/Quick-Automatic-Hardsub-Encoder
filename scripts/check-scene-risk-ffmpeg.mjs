// Real FFmpeg decoded-scene evidence -> the production scene-selection policy.
// Synthetic fixtures only; this is not GPU, HDR/VFR, or long-form acceptance.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SCENE_PLAN_VERSION,normalizedSceneRisk,sceneProbeStarts,selectPairedSceneWindows}
  from '../src/scene-risk-selection.js';

const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';
const dir=mkdtempSync(join(tmpdir(),'qhe-scene-risk-'));
function run(args){
  const p=spawnSync(ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-y',...args],{
    cwd:dir,timeout:25000,encoding:'utf8',windowsHide:true,maxBuffer:3*1024*1024
  });
  assert.equal(p.error,undefined,'FFmpeg could not start: '+p.error?.message);
  assert.equal(p.status,0,'FFmpeg failed ('+p.status+'): '+p.stderr);
}
function metadata(source){
  // Identical metadata field names and strictly numeric grammar to
  // Windows Native Invoke-SceneRiskProbe: don't coerce missing values to 0.
  const fields=new Map(['YAVG','YDIF','YLOW','YHIGH','score'].map(k=>[k,[]]));
  for(const line of source.split(/\r?\n/)){
    const m=/^lavfi\.(?:signalstats|scd)\.(YAVG|YDIF|YLOW|YHIGH|score)=([0-9]+(?:\.[0-9]+)?)$/.exec(line);
    if(m){const n=Number(m[2]);if(Number.isFinite(n))fields.get(m[1]).push(n);}
  }
  const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  const luma=fields.get('YAVG'),dif=fields.get('YDIF');
  const low=fields.get('YLOW'),high=fields.get('YHIGH');
  assert.ok(luma.length>=3,'No decoded luma frames');
  assert.equal(luma.length,dif.length,'Missing YDIF frames');
  assert.equal(low.length,high.length,'Incomplete contrast evidence');
  const cuts=fields.get('score');
  return {meanLuma:avg(luma),meanYdif:avg(dif),
    meanContrast:avg(high.map((x,i)=>x-low[i])),
    peakScene:cuts.length?Math.max(...cuts):0};
}
const cases=[
  {id:'static',input:'color=c=black:s=320x180:r=15:d=2',filter:null},
  {id:'motion',input:'testsrc2=s=320x180:r=15:d=2',filter:null},
  {id:'noise',input:'color=c=gray:s=320x180:r=15:d=2',filter:'noise=alls=90:allf=t+u'},
  {id:'dark-motion',input:'testsrc2=s=320x180:r=15:d=2',
    filter:'eq=brightness=-0.35:contrast=0.7'}
];
try{
  const signals={};
  for(const item of cases){
    const options=['-f','lavfi','-i',item.input];
    if(item.filter)options.push('-vf',item.filter);
    run([...options,'-an','-c:v','ffv1',item.id+'.mkv']);
    run(['-i',item.id+'.mkv','-an','-sn','-vf',
      "fps=2,scale=w='max(2,trunc(iw*min(1,320/max(iw,ih))/2)*2)':h='max(2,trunc(ih*min(1,320/max(iw,ih))/2)*2)':flags=bilinear,format=yuv420p,signalstats,scdet=threshold=10,metadata=print:file="+item.id+'.stats',
      '-f','null','-']);
    signals[item.id]=metadata(readFileSync(join(dir,item.id+'.stats'),'utf8'));
    const score=normalizedSceneRisk(signals[item.id]);
    assert.ok(Number.isFinite(score)&&score>=0&&score<=1,
      'Production risk policy rejected decoded '+item.id+' metadata');
  }
  assert.equal(signals.static.meanYdif,0,'Static fixture must show zero frame change');
  assert.ok(signals.motion.meanYdif>1,'Moving content must have measured frame changes');
  assert.ok(signals.noise.meanYdif>1,'Temporal noise must have measured frame changes');
  assert.ok(signals['dark-motion'].meanLuma<signals.motion.meanLuma*.7,
    'Dark moving scene must be measurably darker than standard motion');
  assert.ok(normalizedSceneRisk(signals.motion)>normalizedSceneRisk(signals.static),
    'With these fixtures moving content must outrank static black');

  const starts=sceneProbeStarts(120,2);
  assert.equal(starts.length,6);
  const probes=starts.map((start,i)=>({start,...(
    i===1?signals.motion:i===4?signals['dark-motion']:signals.static)}));
  const args={durationSeconds:120,windowSeconds:2,probes,
    subtitleEvents:[{kind:'Dialogue',startSeconds:starts[3],
      endSeconds:starts[3]+1.8}]};
  const planned=selectPairedSceneWindows(args);
  assert.equal(planned.ok,true);
  assert.equal(planned.riskAware,true);
  assert.deepEqual(planned.starts,[starts[1],starts[3],starts[4]],
    'Decoded risk and subtitle overlap should displace static scene windows');
  assert.ok(planned.fingerprint.startsWith(SCENE_PLAN_VERSION+':2:'),
    'Selection must preserve scene-plan provenance');
  const fallback=selectPairedSceneWindows({...args,probes:[]});
  assert.equal(fallback.riskAware,false,'Absent measurements must not be called measured risk');
  assert.notDeepEqual(fallback.starts,planned.starts,
    'Actual decoded FFmpeg measurements must influence sampling positions');

  console.log(JSON.stringify({result:'PASS',signals,chosen:planned.starts,
    fallback:fallback.starts,fingerprint:planned.fingerprint},null,2));
}finally{
  rmSync(dir,{recursive:true,force:true});
}
