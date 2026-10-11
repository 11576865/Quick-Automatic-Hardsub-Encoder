// Real, source-matched FFmpeg CRF/SSIM regression for temporal-grain risk.
// Synthetic software-only evidence, NOT GPU, HDR, VFR or real-film acceptance.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizedSceneRisk,sceneProbeStarts,selectPairedSceneWindows,SCENE_PLAN_VERSION}
  from '../src/scene-risk-selection.js';

const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';
const ffprobe=process.env.FFPROBE_PATH||'ffprobe';
const work=mkdtempSync(join(tmpdir(),'qhe-codec-scene-'));
function exec(exe,args,{loglevel='error'}={}){
  const p=spawnSync(exe,['-hide_banner','-nostdin','-loglevel',loglevel,...args],{
    cwd:work,timeout:35000,encoding:'utf8',windowsHide:true,maxBuffer:3*1024*1024
  });
  assert.equal(p.error,undefined,exe+' start failure: '+p.error?.message);
  assert.equal(p.status,0,exe+' returned '+p.status+': '+p.stderr?.slice(-900));
  return p;
}
function ff(...args){return exec(ffmpeg,['-y',...args]);}
function risk(reference,name,filter){
  const output=name+'.stats';
  ff('-i',reference,'-vf',filter+',format=yuv420p,signalstats,scdet=threshold=10,metadata=print:file='+output,'-f','null','-');
  const fields=new Map(['YAVG','YDIF','YLOW','YHIGH','score'].map(k=>[k,[]]));
  for(const line of readFileSync(join(work,output),'utf8').split(/\r?\n/)){
    const match=/^lavfi\.(?:signalstats|scd)\.(YAVG|YDIF|YLOW|YHIGH|score)=([0-9]+(?:\.[0-9]+)?)$/.exec(line);
    if(match)fields.get(match[1]).push(Number(match[2]));
  }
  const mean=v=>v.reduce((a,b)=>a+b,0)/v.length;
  const luma=fields.get('YAVG'),dif=fields.get('YDIF'),lo=fields.get('YLOW'),hi=fields.get('YHIGH');
  assert.ok(luma.length>=3 && dif.length===luma.length);
  assert.equal(lo.length,hi.length);
  return {meanLuma:mean(luma),meanYdif:mean(dif),meanContrast:mean(hi.map((x,i)=>x-lo[i])),
    peakScene:fields.get('score').length?Math.max(...fields.get('score')):0};
}
function bitrateBytes(file){
  const p=spawnSync(ffprobe,['-v','error','-select_streams','v:0','-show_entries','packet=size',
    '-of','csv=p=0',file],{cwd:work,timeout:15000,encoding:'utf8',windowsHide:true});
  assert.equal(p.status,0,'FFprobe packet-size inspection failed: '+p.stderr);
  const sizes=p.stdout.trim().split(/\s+/).map(Number);
  assert.ok(sizes.length>=25 && sizes.every(x=>Number.isSafeInteger(x)&&x>0));
  return sizes.reduce((a,b)=>a+b,0);
}
function measuredQuality(encoded,reference){
  const p=exec(ffmpeg,['-i',encoded,'-i',reference,'-lavfi','[0:v][1:v]ssim','-f','null','-'],{loglevel:'info'});
  const found=p.stderr.match(/All:([0-9]+(?:\.[0-9]+)?)/g);
  assert.ok(found?.length,'No real SSIM measurement emitted by FFmpeg');
  const score=Number(found.at(-1).slice(4));
  assert.ok(score>0 && score<=1);
  return score;
}
try{
  // ONE four-second lossless source: motion (0–2s), grain (2–4s).
  // Both measured CRFs use identical time windows and matching references.
  ff('-f','lavfi','-i','testsrc2=s=320x180:r=15:d=2',
    '-f','lavfi','-i','color=c=gray:s=320x180:r=15:d=2',
    '-filter_complex','[1:v]noise=alls=90:allf=t+u:all_seed=42[grain];[0:v][grain]concat=n=2:v=1:a=0[v]',
    '-map','[v]','-an','-c:v','ffv1','source.mkv');
  const evidence={};
  for(const [name,start] of [['motion',0],['grain',2]]){
    const reference=name+'-reference.mkv';
    ff('-ss',String(start),'-t','2','-i','source.mkv','-an','-c:v','ffv1',reference);
    const oldRisk=risk(reference,name+'-legacy','fps=2,scale=160:90:flags=bilinear');
    const newRisk=risk(reference,name+'-detail',"fps=2,scale=w='max(2,trunc(iw*min(1,320/max(iw,ih))/2)*2)':h='max(2,trunc(ih*min(1,320/max(iw,ih))/2)*2)':flags=bilinear");
    const points=[];
    for(const crf of [22,28]){
      const out=name+'-'+crf+'.mkv';
      ff('-i',reference,'-an','-c:v','libx264','-preset','medium','-crf',String(crf),'-pix_fmt','yuv420p',out);
      points.push({crf,ssim:measuredQuality(out,reference),videoBytes:bitrateBytes(out)});
    }
    evidence[name]={oldRisk,newRisk,points};
  }
  const motion=evidence.motion,grain=evidence.grain;
  const m=Object.fromEntries(motion.points.map(p=>[p.crf,p]));
  const g=Object.fromEntries(grain.points.map(p=>[p.crf,p]));
  const target=.970;
  assert.ok(m[28].ssim>target && g[28].ssim<target && g[22].ssim>target,
    'Measured motion and grain windows must reverse CRF quality-gate decision');
  assert.ok(g[28].videoBytes>m[28].videoBytes*5,
    'Dynamic grain must carry significantly more real video packet bytes');
  assert.ok(grain.newRisk.meanYdif>grain.oldRisk.meanYdif*2,
    '320px texture-aware preflight must recover blurred temporal noise');
  assert.ok(grain.newRisk.meanYdif>motion.newRisk.meanYdif*2,
    'Grain must be measurably distinct from ordinary motion at new detail');
  assert.ok(normalizedSceneRisk(grain.newRisk)>normalizedSceneRisk(motion.newRisk),
    'New risk signal must prefer this measured high-frequency grain');
  const starts=sceneProbeStarts(120,2);
  assert.equal(starts.length,6);
  const probes=starts.map((start,i)=>({start,...(i===1?grain.newRisk:motion.newRisk)}));
  const plan=selectPairedSceneWindows({durationSeconds:120,windowSeconds:2,probes});
  assert.equal(plan.riskAware,true);
  assert.ok(plan.starts.includes(starts[1]),'Planner must choose measured grain-risk window');
  const initial=motion.points.filter(p=>p.ssim>=target).sort((a,b)=>b.crf-a.crf)[0];
  const refined=[22,28].filter(crf=>Math.min(m[crf].ssim,g[crf].ssim)>=target).sort((a,b)=>b-a)[0];
  assert.equal(initial.crf,28);
  assert.equal(refined,22);
  console.log(JSON.stringify({result:'PASS',metricVersion:SCENE_PLAN_VERSION,
    target,selectedBefore:initial.crf,selectedAfter:refined,
    motion,grain,selectedWindows:plan.starts},null,2));
}finally{rmSync(work,{recursive:true,force:true});}
