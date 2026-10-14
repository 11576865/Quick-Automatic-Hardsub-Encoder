import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCompletedCutTimeline} from './cut-timeline-evidence.js';
const task={operation:'copy',hasTrimRange:true,start:3.5,end:5.5};
const completed={jobId:'abc',outputBytes:251257,actualStart:2};
const receipt=()=>({
 ok:true,version:1,scope:'completed-artifact-first-boundary',jobId:'abc',
 artifactBytes:251257,artifactWriteTicks:'123456',executionSeekIn:2,
 actualFirstPresentation:0.04,firstVideoPacketPts:0.08,firstVideoPacketDts:0,
 audioTimeMapping:[{outputOrdinal:0,outputFirstPts:-0.021,outputFirstDts:-0.021}]
});
test('B09 observes output-clock first frame but never promotes it to source alignment proof',()=>{
 const r=normalizeCompletedCutTimeline(task,completed,receipt());
 assert.equal(r.requestedIn,3.5);assert.equal(r.executionSeekIn,2);
 assert.equal(r.actualFirstPresentation,.04);
 assert.equal(r.firstVideoPacketPts,.08);assert.equal(r.firstVideoPacketDts,0);
 assert.equal(r.audioTimeMapping[0].outputFirstPts,-.021);
 assert.equal(r.audioTimeMapping[0].sourceMappingVerified,false);
 assert.equal(r.copiedPacketRange,null);
 assert.match(r.verificationStatus,/unverified/);
});
test('foreign job, changed output length, seek identity and missing real frame fail closed',()=>{
 assert.throws(()=>normalizeCompletedCutTimeline(task,completed,{...receipt(),jobId:'foreign'}),/bound/);
 assert.throws(()=>normalizeCompletedCutTimeline(task,completed,{...receipt(),artifactBytes:21}),/identity/);
 assert.throws(()=>normalizeCompletedCutTimeline(task,completed,{...receipt(),executionSeekIn:1}),/seek/);
 assert.throws(()=>normalizeCompletedCutTimeline(task,completed,{...receipt(),actualFirstPresentation:null}),/valid decoded/);
});
test('null audio time cannot fabricate an observed timestamp or source mapping',()=>{
 assert.throws(()=>normalizeCompletedCutTimeline(task,completed,{
  ...receipt(),audioTimeMapping:[{outputOrdinal:0,outputFirstPts:null,outputFirstDts:0}]
 }),/Incomplete/);
 assert.throws(()=>normalizeCompletedCutTimeline({operation:'transcode',hasTrimRange:true},completed,receipt()),/Stream Copy/);
});
