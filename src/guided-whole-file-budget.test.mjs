import test from 'node:test';
import assert from 'node:assert/strict';
import {guidedWholeFileProjection,assessGuidedWholeFileBudget} from './guided-whole-file-budget.js';
import {compileTask} from './media-task.js';
const duration=8;
const video={ok:true,kind:'multi-branch',
  minimumEvidenceTargetBytes:300000,maximumEvidenceTargetBytes:900000,
  evidencePoints:[],knee:null,
  evaluateTargetBytes(bytes){return {status:bytes<300000?'below-evidence':bytes>900000?'above-evidence':'within-evidence',
    videoBitrate:Math.floor(bytes*8/duration),prediction:{quality:.96},branchId:'h264'};}
};
const media={duration,fps:24,videoTracks:1,audioTracks:1};
const audio={audio:'copy'};
const evidence={version:1,scope:'full-source',audioPacketBytes:[100000]};
const raw={operation:'hardsub',codec:'h264',encoder:'libx264',preset:'medium',
  start:0,end:'',videoRange:'full',audio:'copy',audioRange:'full',subtitleRange:'full',
  fpsMode:'auto',pixelFormat:'yuv420p',rotation:'none',deinterlace:'none',
  rateMode:'size',targetSize:1,sizeUnit:'MB',sizeReserve:4,outputContainer:'mkv'};
test('guided whole-file target matches formal task bitrate with measured copied audio',()=>{
  const f=guidedWholeFileProjection(video,{media,audio,evidence});
  assert.equal(f.ok,true,JSON.stringify(f));
  assert.equal(f.kind,'multi-branch');
  assert.equal(f.guidedCostBasis,'measured-source-packets');
  const task=compileTask(raw,{...media,budgetEvidence:evidence});
  assert.equal(f.evaluateTargetBytes(1000000).videoBitrate,task.bitrate);
  assert.equal(f.evaluateTargetBytes(1000000).budget.fixedPayloadBytes,100000);
});
test('unknown or incomplete copy cost cannot be represented as measured budget',()=>{
  assert.deepEqual(guidedWholeFileProjection(video,{media,audio}),{ok:false,reason:'copy-cost-not-measured'});
  const x=guidedWholeFileProjection(video,{media,audio,evidence:{version:1,scope:'full-source',audioPacketBytes:[]}});
  assert.equal(x.ok,false);
  assert.match(x.detail,/测量/);
});
test('planned AAC uses the same full-file coordinate without packet evidence',()=>{
  const f=guidedWholeFileProjection(video,{media,audio:{audio:'aac',audioBitrate:96000}});
  assert.equal(f.ok,true,JSON.stringify(f));
  const task=compileTask({...raw,audio:'aac',audioBitrate:96000},media);
  assert.equal(f.evaluateTargetBytes(1000000).videoBitrate,task.bitrate);
  assert.equal(f.evaluateTargetBytes(1000000).budget.encodedAudioBytes,96000*duration/8);
});

test('guided size admission exactly matches formal compiled video rate for measured copy, AAC, Opus and mute',()=>{
  const sources=[
    {audio:{audio:'copy'},evidence},
    {audio:{audio:'aac',audioBitrate:96000}},
    {audio:{audio:'libopus',audioBitrate:64000}},
    {audio:{audio:'none'}}
  ];
  for(const {audio:a,evidence:packets} of sources){
    const result=assessGuidedWholeFileBudget({targetBytes:1000000,media,audio:a,evidence:packets});
    assert.equal(result.status,'feasible',JSON.stringify(result));
    const task=compileTask({...raw,...a},{...media,budgetEvidence:packets});
    assert.equal(result.availableVideoBitrate,task.bitrate,a.audio);
    assert.equal(result.encodedAudioBytes,task.sizePlan.encodedAudioBytes,a.audio);
    assert.equal(result.fixedPayloadBytes,task.sizePlan.fixedPayloadBytes,a.audio);
    assert.equal(result.containerReserveBytes,task.sizePlan.containerReserveBytes,a.audio);
    assert.equal(result.shortfallBytes,0,a.audio);
  }
});
test('guided size assessment is fail-closed on unmeasured or incomplete copy costs',()=>{
  assert.equal(assessGuidedWholeFileBudget({targetBytes:1000000,media,audio}).reason,'copy-cost-not-measured');
  const stale=assessGuidedWholeFileBudget({targetBytes:1000000,media,audio,evidence:{version:1,scope:'full-source',audioPacketBytes:[]}});
  assert.equal(stale.status,'unknown');
  assert.equal(stale.reason,'whole-file-cost-unavailable');
  assert.equal(assessGuidedWholeFileBudget({targetBytes:0,media,audio:{audio:'none'}}).status,'invalid');
});
test('guided capacity minimum is the exact first byte that supports the formal minimum video rate',()=>{
  const input={media:{...media,duration:3600},audio:{audio:'aac',audioBitrate:192000},minimumVideoBitrate:150001};
  const small=assessGuidedWholeFileBudget({...input,targetBytes:4000000});
  assert.equal(small.status,'infeasible');
  const minimum=small.minimumTargetBytes;
  const below=assessGuidedWholeFileBudget({...input,targetBytes:minimum-1});
  const at=assessGuidedWholeFileBudget({...input,targetBytes:minimum});
  assert.equal(below.status,'infeasible');
  assert.equal(at.status,'feasible');
  assert.equal(below.shortfallBytes,1);
  assert.ok(at.availableVideoBitrate>=input.minimumVideoBitrate);
});
test('a copied-audio packet ledger counts each selected track without inventing duration scaling',()=>{
  const evidence2={version:1,scope:'full-source',audioPacketBytes:[100000,200000]};
  const media2={...media,audioTracks:2};
  const a=assessGuidedWholeFileBudget({targetBytes:1000000,media:media2,audio,evidence:evidence2});
  const task=compileTask(raw,{...media2,budgetEvidence:evidence2});
  assert.equal(a.status,'feasible');
  assert.equal(a.fixedPayloadBytes,300000);
  assert.equal(a.availableVideoBitrate,task.bitrate);
});
