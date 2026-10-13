import test from 'node:test';
import assert from 'node:assert/strict';
import {guidedWholeFileProjection} from './guided-whole-file-budget.js';
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
