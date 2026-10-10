// Real guided-budget handoff evidence: short CRF samples versus full VBR output.
// Synthetic software-only integration, NOT production Windows bridge/GPU acceptance.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fitRateDistortionModel,createSizeQualityFrontier} from '../src/rate-distortion-model.js';

const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';
const ffprobe=process.env.FFPROBE_PATH||'ffprobe';
const dir=mkdtempSync(join(tmpdir(),'qhe-full-vbr-budget-'));
const seconds=6,targetRate=2000000,targetVideoBytes=targetRate*seconds/8;
const sampleSeconds=2,starts=[0,3],crfs=[18,22,26,30];
function run(exe,args,level='error',limit=30000){
 const p=spawnSync(exe,args,{cwd:dir,windowsHide:true,timeout:limit,
   encoding:'utf8',maxBuffer:3*1024*1024});
 assert.equal(p.error,undefined,exe+' start error: '+p.error?.message);
 assert.equal(p.status,0,exe+' failed: '+p.stderr?.slice(-1100));
 return p;
}
function ff(args,level='error',limit=30000){
 return run(ffmpeg,['-hide_banner','-nostdin','-loglevel',level,'-y',...args],level,limit);
}
function dimensions(file){
 const p=run(ffprobe,['-v','error','-select_streams','v:0',
  '-show_entries','stream=width,height','-of','csv=p=0:s=x',file]);
 const m=p.stdout.trim().match(/^(\d+)x(\d+)$/);
 assert.ok(m,'Video dimension probe failed: '+p.stdout);
 return {width:Number(m[1]),height:Number(m[2])};
}
function bytes(file){
 const p=run(ffprobe,['-v','error','-select_streams','v:0',
 '-show_entries','packet=size','-of','csv=p=0',file]);
 const packets=p.stdout.trim().split(/\s+/).map(Number);
 assert.ok(packets.length>=15&&packets.every(x=>Number.isSafeInteger(x)&&x>0),
 'Incomplete video packet bytes in '+file);
 return packets.reduce((a,b)=>a+b,0);
}
function ssim(output,reference){
 const p=run(ffmpeg,['-hide_banner','-nostdin','-loglevel','info',
  '-i',output,'-i',reference,'-lavfi','[0:v][1:v]ssim',
  '-f','null','-'],'info',30000);
 const ms=[...p.stderr.matchAll(/All:([0-9]+(?:\.[0-9]+)?)/g)];
 assert.ok(ms.length,'Missing measured full/reference SSIM for '+output);
 const quality=Number(ms.at(-1)[1]);
 assert.ok(quality>0&&quality<=1);
 return quality;
}
function duration(file){
 const p=run(ffprobe,['-v','error','-show_entries','format=duration',
  '-of','default=noprint_wrappers=1:nokey=1',file]);
 const n=Number(p.stdout.trim());
 assert.ok(Number.isFinite(n)&&Math.abs(n-seconds)<0.12);
 return n;
}
function cqPoint(crf){
 const measurements=[];
 for(const start of starts){
   const source='reference-rendered.mkv',out='cq-'+crf+'-'+start+'.mkv';
   const startAt=performance.now();
   ff(['-ss',String(start),'-t',String(sampleSeconds),'-i',source,
     '-an','-c:v','libx264','-preset','medium','-crf',String(crf),
     '-pix_fmt','yuv420p',out]);
   const elapsed=(performance.now()-startAt)/1000;
   const reference='scene-'+start+'.mkv';
   const rate=bytes(out)*8/sampleSeconds;
   measurements.push({start,duration:sampleSeconds,ssim:ssim(out,reference),
     bitrate:rate,elapsedSeconds:elapsed});
 }
 const rate=measurements.reduce((sum,m)=>sum+m.bitrate,0)/measurements.length;
 const average=measurements.reduce((sum,m)=>sum+m.ssim,0)/measurements.length;
 return {codec:'h264',crf,preset:'medium',sampleBitrate:rate,
   ssim:Math.min(...measurements.map(m=>m.ssim)),
   averageSsim:average,sampleCount:measurements.length,sampleMeasurements:measurements};
}
try{
  // One actual subtitle-bearing source. Reference is FFV1 after subtitle
  // rendering; full output encodes original source with the SAME ASS filter.
  const ass=['[Script Info]','ScriptType: v4.00+','PlayResX: 640','PlayResY: 360',
    '[V4+ Styles]','Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    'Style: Default,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,20,1',
    '[Events]','Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
    'Dialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,Moving scene benchmark',
    'Dialogue: 0,0:00:03.00,0:00:06.00,Default,,0,0,0,,Temporal noise benchmark'].join('\n')+'\n';
  writeFileSync(join(dir,'subtitle.ass'),ass,'utf8');
  ff(['-f','lavfi','-i','testsrc2=s=640x360:r=12:d=3',
    '-f','lavfi','-i','color=c=gray:s=640x360:r=12:d=3',
    '-filter_complex','[1:v]noise=alls=12:allf=t+u:all_seed=42[grain];'+
      '[0:v][grain]concat=n=2:v=1:a=0[v]',
    '-map','[v]','-an','-c:v','ffv1','source.mkv']);
  ff(['-i','source.mkv','-an','-vf','ass=subtitle.ass',
    '-c:v','ffv1','-pix_fmt','yuv420p','reference-rendered.mkv']);
  for(const start of starts){
    ff(['-ss',String(start),'-t',String(sampleSeconds),
      '-i','reference-rendered.mkv','-an','-c:v','ffv1',
      'scene-'+start+'.mkv']);
  }
  const points=crfs.map(cqPoint);
  const model=fitRateDistortionModel(points);
  assert.equal(model.ok,true,'CQ short-sample model: '+model.reason);
  const frontier=createSizeQualityFrontier(model,{
    durationSeconds:seconds,audioBitrate:0,reservePercent:0,
    containerReservePercent:0,fixedReserveBytes:0,minimumVideoBitrate:1000
  });
  assert.equal(frontier.ok,true,'Measured-only CQ budget mapping failed: '+frontier.reason);
  const estimation=frontier.evaluateTargetBytes(targetVideoBytes);
  assert.equal(estimation.status,'within-evidence',
    'The formal VBR target must be within measured CQ sample bitrate range');
  const input=['-i','source.mkv','-vf','ass=subtitle.ass',
    '-an','-c:v','libx264','-preset','medium','-pix_fmt','yuv420p',
    '-b:v',String(targetRate)];
  const t1=performance.now();
  ff([...input,'formal-single-pass.mkv']);
  const oneWall=(performance.now()-t1)/1000;
  const p1=performance.now();
  ff([...input,'-pass','1','-passlogfile','guided-pass',
    '-f','null','-']);
  ff([...input,'-pass','2','-passlogfile','guided-pass',
    'formal-two-pass.mkv']);
  const twoWall=(performance.now()-p1)/1000;
  const first={bytes:statSync(join(dir,'formal-single-pass.mkv')).size,
    packetBytes:bytes('formal-single-pass.mkv'),
    ssim:ssim('formal-single-pass.mkv','reference-rendered.mkv'),
    seconds:oneWall};
  const second={bytes:statSync(join(dir,'formal-two-pass.mkv')).size,
    packetBytes:bytes('formal-two-pass.mkv'),
    ssim:ssim('formal-two-pass.mkv','reference-rendered.mkv'),
    seconds:twoWall};
  for(const file of ['formal-single-pass.mkv','formal-two-pass.mkv']){
    assert.deepEqual(dimensions(file),{width:640,height:360});
    duration(file);
  }
  const relativeError=result=>(result.bytes-targetVideoBytes)/targetVideoBytes;
  const firstError=relativeError(first),secondError=relativeError(second);
  assert.ok(first.ssim>=.95&&second.ssim>=.95,
    'Both formal options must retain practical SSIM on this bounded fixture');
  assert.ok(firstError>.25,
    'Synthetic high-grain single-pass budget violation failed to reproduce: '+firstError);
  assert.ok(Math.abs(secondError)<Math.abs(firstError),
    'Two pass should materially reduce size error on this fixture');
  // The second method performs two complete passes, but OS scheduling and
  // first-pass speed can make a *single* small wall-time comparison noisy.
  // Record both elapsed times; do not bake a flaky monotonic-time assertion
  // into a real-FFmpeg CI acceptance gate.
  assert.ok(first.seconds>0&&second.seconds>0,
    'Both encode methods must publish positive observed wall time');
  console.log(JSON.stringify({result:'PASS',
    scope:'same-ASS-rendered-reference-and-source',
    plannedVideoBytes:targetVideoBytes,
    cqPredictedSsim:estimation.prediction,
    first:{...first,relativeSizeError:firstError},
    twoPass:{...second,relativeSizeError:secondError},
    extraWallSeconds:second.seconds-first.seconds,
    caution:'CQ-derived SSIM is not verified VBR quality; neither one-pass nor two-pass guarantees byte ceiling.'},null,2));
}finally{
  rmSync(dir,{recursive:true,force:true});
}
