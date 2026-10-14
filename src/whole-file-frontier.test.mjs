import test from 'node:test';
import assert from 'node:assert/strict';
import {wholeFileLedger,projectWholeFileFrontier} from './whole-file-frontier.js';
import {compileTask} from './media-task.js';
const task={expectedVideoDuration:8,sourceDuration:8,trimDuration:8,audio:'copy',expectedAudioTracks:1,audioTrack:'all',audioRange:'full',keepAttachments:true,attachmentSelection:[0],sizeReserve:4};
const evidence={version:1,scope:'full-source',audioPacketBytes:[100],attachmentBytes:[160]};
const base={ok:true,minimumEvidenceTargetBytes:1000,maximumEvidenceTargetBytes:3000,evidencePoints:[{targetBytes:2000,quality:.9,lowerQuality:.89,upperQuality:.91}],knee:null,
 evaluateTargetBytes(bytes){return {status:bytes<1000?'below-evidence':bytes>3000?'above-evidence':'within-evidence',targetBytes:bytes,videoBitrate:bytes,prediction:{quality:.9,lowerQuality:.89,upperQuality:.91},branchId:'h265',alternatives:[]};},sampleCurve(){return [this.evaluateTargetBytes(1000),this.evaluateTargetBytes(2000),this.evaluateTargetBytes(3000)].map(e=>({...e.prediction,targetBytes:e.targetBytes,videoBitrate:e.videoBitrate}));}};
test('total budget projection retains measured quality and moves fixed payload/reserve into coordinates',()=>{
 const ledger=wholeFileLedger(task,evidence);assert.equal(ledger.fixedPayloadBytes,260);
 const f=projectWholeFileFrontier(base,ledger);assert.equal(f.ok,true);
 const total=f.videoBytesToTarget(2000),e=f.evaluateTargetBytes(total);
 assert.equal(e.status,'within-evidence');assert.equal(e.videoBitrate,2000);
 assert.deepEqual(e.prediction,base.evaluateTargetBytes(2000).prediction);
 assert.equal(e.budget.fixedPayloadBytes,260);assert.equal(e.targetBytes,total);
 assert.ok(f.minimumEvidenceTargetBytes>base.minimumEvidenceTargetBytes);
 assert.equal(f.evaluateTargetBytes(200).status,'infeasible');
 assert.equal(f.evaluateTargetBytes(f.maximumEvidenceTargetBytes+10).status,'above-evidence');
 assert.equal(f.evaluateTargetBytes(f.minimumEvidenceTargetBytes).status,'within-evidence');
 assert.equal(f.evaluateTargetBytes(f.maximumEvidenceTargetBytes).status,'within-evidence');
});
test('unknown copy/FLAC costs cannot be replaced by zero; active source evidence is required',()=>{
 assert.throws(()=>wholeFileLedger(task,null),/成本未知/);
 assert.throws(()=>wholeFileLedger({...task,audioPlan:[{sourceOrdinal:0,action:'flac',range:'full'}]},evidence),/FLAC/);
 assert.throws(()=>wholeFileLedger({...task,sizeReserve:0},evidence),/体积余量/);
});
test('encoded audio is budgeted by its own full duration and trimmed copies remain conservative',()=>{
 const l=wholeFileLedger({...task,hasTrimRange:true,trimDuration:2,audioPlan:[{action:'aac',bitrate:8000,range:'full'},{action:'copy',sourceOrdinal:0,range:'trim'}]},evidence);
 assert.equal(l.encodedAudioBytes,8000);assert.equal(l.copiedTrimReserveBytes,100);
});
test('projected VBR rate is exactly the formal size compiler rate including ceil reserve',()=>{
 const media={duration:8,videoTracks:1,videoCodec:'h264',fps:24,audioTracks:1,audioStreams:[{codec:'flac'}],attachmentTracks:1,budgetEvidence:evidence};
 const raw={operation:'transcode',codec:'h264',encoder:'libx264',preset:'medium',rateMode:'quality',quality:23,audio:'copy',audioTrack:'all',audioRange:'full',videoRange:'full',subtitleRange:'full',keepAttachments:true,attachmentStreams:'all',outputContainer:'mkv',pixelFormat:'yuv420p',fpsMode:'auto',rotation:'none',deinterlace:'none',sizeReserve:4};
 const compiled=compileTask(raw,media);const f=projectWholeFileFrontier(base,wholeFileLedger(compiled,evidence));
 const bytes=2501;const e=f.evaluateTargetBytes(bytes);
 const formal=compileTask({...raw,rateMode:'size',targetSize:bytes/1e6,sizeUnit:'MB',budgetPolicy:'strict-ceiling'},media);
 assert.equal(e.videoBitrate,formal.bitrate);assert.equal(formal.sizeCeilingBytes,bytes);
});

test('full-duration encoded audio remains a fixed plan cost when video is only two seconds',()=>{
 const l=wholeFileLedger({...task,expectedVideoDuration:2,trimDuration:2,audioPlan:[{action:'aac',bitrate:8000,range:'full'}],keepAttachments:false},evidence);
 assert.equal(l.durationSeconds,2);assert.equal(l.encodedAudioBytes,8000);
});

test('projected candidate fits always use the same whole-file budget coordinate as the slider',()=>{
 const withCandidates={
  ...base,
  sampleBranchCurves:()=>[
   {id:'h264',points:[{targetBytes:1200,quality:.82},{targetBytes:2000,quality:.91}]},
   {id:'h265',points:[{targetBytes:1200,quality:.84},{targetBytes:2000,quality:.93}]}
  ]
 };
 const projected=projectWholeFileFrontier(withCandidates,wholeFileLedger(task,evidence));
 assert.equal(projected.ok,true);
 const curves=projected.sampleBranchCurves(2);
 assert.deepEqual(curves.map(c=>c.id),['h264','h265']);
 for(const branch of curves)for(const point of branch.points){
  assert.ok(point.targetBytes>=projected.minimumEvidenceTargetBytes);
  assert.ok(point.targetBytes<=projected.maximumEvidenceTargetBytes);
  assert.notEqual(point.targetBytes,1200);
  assert.notEqual(point.targetBytes,2000);
 }
 const projectedWithoutCandidates=projectWholeFileFrontier(base,wholeFileLedger(task,evidence));
 assert.equal(projectedWithoutCandidates.sampleBranchCurves,undefined);
});
