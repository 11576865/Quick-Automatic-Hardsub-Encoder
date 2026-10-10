// Real, same-reference codec-frontier crossover: synthetic CPU fixture only.
// No claim about real film, GPU, HDR, VFR, or perceptual-optimal codec.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SCENE_PLAN_VERSION} from '../src/scene-risk-selection.js';
import {fitRateDistortionModel} from '../src/rate-distortion-model.js';
import {createMultiBranchFrontier} from '../src/compression-decision.js';
import {planPairedRefinement,appendMatchedSceneObservation} from '../src/calibration-refinement.js';

const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg',ffprobe=process.env.FFPROBE_PATH||'ffprobe';
const dir=mkdtempSync(join(tmpdir(),'qhe-codec-frontier-'));
const duration=4,span=2,targetBytes=80000,crfs=[18,24,30,36];
const fingerprint=SCENE_PLAN_VERSION+':2:0.000';
const scope='fixture:single-ffv1-source:original-size-ssim';
function run(exe,args,timeout=30000,loglevel='error'){
 const p=spawnSync(exe,['-hide_banner','-nostdin','-loglevel',loglevel,...args],{
  cwd:dir,timeout,encoding:'utf8',windowsHide:true,maxBuffer:3*1024*1024});
 assert.equal(p.error,undefined,exe+' start failed: '+p.error?.message);
 assert.equal(p.status,0,exe+' failed: '+p.stderr?.slice(-1000));
 return p;
}
function ff(...args){return run(ffmpeg,['-y',...args]);}
function packetBytes(file){
 const p=spawnSync(ffprobe,['-v','error','-select_streams','v:0',
  '-show_entries','packet=size','-of','csv=p=0',file],{
  cwd:dir,timeout:15000,encoding:'utf8',windowsHide:true});
 assert.equal(p.error,undefined,'ffprobe failed to start: '+p.error?.message);
 assert.equal(p.status,0,'ffprobe failed: '+p.stderr);
 const numbers=p.stdout.trim().split(/\s+/).map(Number);
 assert.ok(numbers.length>=25&&numbers.every(x=>Number.isSafeInteger(x)&&x>0));
 return numbers.reduce((a,b)=>a+b,0);
}
function quality(file,reference){
 const p=run(ffmpeg,['-i',file,'-i',reference,'-lavfi','[0:v][1:v]ssim',
  '-f','null','-'],15000,'info');
 const matches=[...p.stderr.matchAll(/All:([0-9]+(?:\.[0-9]+)?)/g)];
 assert.ok(matches.length,'No FFmpeg SSIM for '+file);
 const x=Number(matches.at(-1)[1]);
 assert.ok(x>0&&x<=1);
 return x;
}
function measure(codec,crf,start,label){
 const reference=label+'-reference.mkv',file=label+'-'+codec+'-'+crf+'.mkv';
 const encoder=codec==='h264'?'libx264':'libx265';
 const args=['-i',reference,'-an','-threads','2','-c:v',encoder,'-preset','medium',
  '-crf',String(crf),'-pix_fmt','yuv420p'];
 if(codec==='h265')args.push('-x265-params','pools=none:frame-threads=2:log-level=error');
 const now=performance.now();
 ff(...args,file);
 const elapsedSeconds=(performance.now()-now)/1000;
 const bytes=packetBytes(file),ssim=quality(file,reference),bitrate=bytes*8/span;
 return {codec,preset:'medium',crf,ssim,averageSsim:ssim,sampleBitrate:bitrate,
  sampleCount:1,sampleFingerprint:fingerprint,videoBytes:bytes,
  sampleMeasurements:[{start,duration:span,ssim,bitrate,elapsedSeconds}]};
}
function envelope(data,incumbentId=null){
 return createMultiBranchFrontier(['h264','h265'].map(id=>({
  id,preset:'medium',model:fitRateDistortionModel(data[id]),measurementScope:scope
 })),{durationSeconds:duration,audioBitrate:0,reservePercent:0,
  containerReservePercent:0,fixedReserveBytes:0,minimumVideoBitrate:1000,
  incumbentId,hysteresisSsim:.003});
}
try{
 // Both trial encoders see identical frame spans from ONE lossless source.
 ff('-f','lavfi','-i','testsrc2=s=320x180:r=15:d=2',
  '-f','lavfi','-i','color=c=gray:s=320x180:r=15:d=2',
  '-filter_complex','[1:v]noise=alls=45:allf=t+u:all_seed=42[n];'+
   '[0:v][n]concat=n=2:v=1:a=0[v]',
  '-map','[v]','-an','-c:v','ffv1','source.mkv');
 for(const [label,start] of [['motion',0],['grain',2]]){
  ff('-ss',String(start),'-t','2','-i','source.mkv',
   '-an','-c:v','ffv1',label+'-reference.mkv');
 }
 const firstPoints={},addedPoints={};
 for(const codec of ['h264','h265']){
  firstPoints[codec]=crfs.map(crf=>measure(codec,crf,0,'motion'));
 }
 const firstFrontier=envelope(firstPoints);
 assert.equal(firstFrontier.ok,true,'Initial common size domain: '+firstFrontier.reason);
 const first=firstFrontier.evaluateTargetBytes(targetBytes);
 assert.equal(first.status,'within-evidence');
 assert.equal(first.branchId,'h264','Baseline real measured frontier favors H.264');
 const spentSeconds=Object.values(firstPoints).flat().reduce((s,p)=>
  s+p.sampleMeasurements[0].elapsedSeconds,0);
 const plan=planPairedRefinement({frontier:firstFrontier,targetBytes,
  samplePlan:{fingerprint,starts:[0],candidates:[{start:0,score:.2},{start:2,score:.95}]},
  spentSeconds,budgetSeconds:120,
  branches:['h264','h265'].map(codec=>({id:codec,codec,preset:'medium',
   sourceScope:scope,testedPoints:firstPoints[codec],sampleFingerprint:fingerprint}))});
 assert.equal(plan.refine,true,'Actual runtime policy did not schedule refinement: '+plan.reason);
 assert.deepEqual(plan.starts,[2]);
 assert.equal(plan.branches.flatMap(x=>x.points).length,8,
  'Every observed CRF of both codecs must be sampled on the same extra scene');
 const elapsedStart=performance.now(),refined={};
 for(const codec of ['h264','h265']){
  const evidence=crfs.map(crf=>measure(codec,crf,2,'grain'));
  const byCrf=new Map(evidence.map(x=>[x.crf,x]));
  refined[codec]=firstPoints[codec].map(old=>appendMatchedSceneObservation(old,
   byCrf.get(old.crf),{start:2,originalFingerprint:fingerprint,
    nextFingerprint:plan.fingerprint}));
  assert.ok(refined[codec].every(p=>p?.sampleMeasurements.length===2&&
   p.sampleFingerprint===plan.fingerprint&&p.sampleMeasurements[0].start===0&&
   p.sampleMeasurements[1].start===2),
   'Partial or incompatible measured scene populations');
 }
 const extraWallSeconds=(performance.now()-elapsedStart)/1000;
 const updated=envelope(refined,first.branchId);
 assert.equal(updated.ok,true,'Updated common size domain: '+updated.reason);
 const after=updated.evaluateTargetBytes(targetBytes);
 assert.equal(after.status,'within-evidence');
 assert.equal(after.branchId,'h265','Matched grain must reverse the measured codec preference');
 const winner=after.alternatives.find(x=>x.id===after.branchId);
 const previous=after.alternatives.find(x=>x.id===first.branchId);
 const gain=winner.lowerQuality-previous.lowerQuality;
 assert.ok(gain>.01,'Realized conservative quality difference too small: '+gain);
 const addedEncodeSeconds=Object.values(refined).flat().reduce((s,p)=>
  s+p.sampleMeasurements[1].elapsedSeconds,0);
 assert.ok(addedEncodeSeconds>0&&extraWallSeconds>=addedEncodeSeconds);
 console.log(JSON.stringify({result:'PASS',fixture:'synthetic-software-codec-crossover',
  version:SCENE_PLAN_VERSION,targetBytes,initialCodec:first.branchId,
  refinedCodec:after.branchId,initial:first.alternatives,refined:after.alternatives,
  observedSsimGainAtSameBudget:gain,initialEncodeSeconds:spentSeconds,
  addedEncodeSeconds,additionalWallSeconds:extraWallSeconds,
  pairedCrfMeasurements:plan.branches.flatMap(x=>x.points).length},null,2));
}finally{rmSync(dir,{recursive:true,force:true});}
