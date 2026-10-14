import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCompletedMuxBytes as summarize} from './completed-mux-byte-ledger.js';
import {outputReport} from './media-planning.js';
const task=()=>({
 outputPlan:{video:[{sourceOrdinal:0}],audio:[{sourceOrdinal:0},{sourceOrdinal:1}],
  subtitles:[{sourceOrdinal:0}],attachments:[{sourceOrdinal:0}]},
 sizePlan:{targetBytes:1000000},expectedVideoTracks:1
});
const result=()=>({verified:true,jobId:'native-output-id',outputBytes:900000,
 outputPacketEvidence:{
  version:1,scope:'completed-artifact',
  artifactJobId:'native-output-id',artifactBytes:900000,
  artifactWriteTicks:'638960827860000000',
  videoPacketBytes:[530000],audioPacketBytes:[200000,90000],
  subtitlePacketBytes:[3000]
 }});
const check=(options={})=>summarize({task:task(),result:result(),...options});
test('completed mixed mux decomposes all three codec packet classes but does not mislabel remainder',()=>{
 const r=check();
 assert.equal(r.status,'completed-mux-byte-ledger');
 assert.equal(r.videoPacketBytes,530000);
 assert.equal(r.audioPacketBytes,290000);
 assert.equal(r.subtitlePacketBytes,3000);
 assert.equal(r.measuredCodecPacketBytes,823000);
 assert.equal(r.otherAndMuxBytes,77000);
 assert.equal(r.observedHeadroomBytes,100000);
 assert.deepEqual(r.sourceTrackCounts,{video:1,audio:2,subtitle:1});
 assert.equal(r.canPredictFutureBytes,false);
 assert.equal(r.canAuthorizeStrictBudget,false);
 assert.match(r.semantics,/attachments/);
});
test('full report attaches the same non-predictive ledger to audited successful outputs',()=>{
 const t=task(),r=result();t.expectedDuration=3;t.encoder='libx264';t.budgetPolicy='best-effort';
 const report=outputReport(t,r,2);
 assert.equal(report.completedMuxByteLedger.status,'completed-mux-byte-ledger');
 assert.equal(report.completedMuxByteLedger.otherAndMuxBytes,77000);
 assert.equal(report.withinBudget,true);
});
test('oversized completed film is observed and reports negative actual headroom; no future right',()=>{
 const t=task(),r=result();t.sizePlan.targetBytes=800000;
 const a=check({task:t,result:r});
 assert.equal(a.withinObservedBudget,false);
 assert.equal(a.observedHeadroomBytes,-100000);
 assert.equal(a.canAuthorizeStrictBudget,false);
});
test('missing video packet list, mismatched actual stream map or missing receipt refuses attribution',()=>{
 for(const mutate of [
  r=>{delete r.outputPacketEvidence.videoPacketBytes},
  r=>{r.outputPacketEvidence.videoPacketBytes=[]},
  r=>{r.outputPacketEvidence.audioPacketBytes=[200000]},
  r=>{r.outputPacketEvidence.subtitlePacketBytes=[]},
  r=>{r.outputPacketEvidence=null},
  r=>{r.verified=false}
 ]){
  const r=result();mutate(r);
  assert.equal(check({result:r}).status,'unavailable');
 }
});
test('output job ID, current staged file byte count and lossless NTFS ticks are required',()=>{
 for(const mutate of [
  r=>{r.jobId='different'},
  r=>{r.outputPacketEvidence.artifactJobId='different'},
  r=>{r.outputPacketEvidence.artifactBytes=900001},
  r=>{r.outputPacketEvidence.artifactWriteTicks=638960827860000000},
  r=>{r.outputPacketEvidence.artifactWriteTicks='not-a-timestamp'}
 ]){
  const r=result();mutate(r);
  assert.equal(check({result:r}).verifiedCurrentArtifact,false);
 }
});
test('codec packet sum cannot exceed the true completed container file length',()=>{
 const r=result();r.outputPacketEvidence.videoPacketBytes=[900000];
 assert.equal(check({result:r}).reason,'codec-payload-exceeds-container-or-overflows');
});
test('packet sizes must be nonnegative safe integers and component total must not overflow',()=>{
 for(const invalid of [-1,null,'1000',1.5,Number.MAX_SAFE_INTEGER+1]){
  const r=result();r.outputPacketEvidence.videoPacketBytes=[invalid];
  assert.equal(check({result:r}).status,'unavailable');
 }
 const r=result();r.outputPacketEvidence.audioPacketBytes=[Number.MAX_SAFE_INTEGER,1];
 assert.equal(check({result:r}).status,'unavailable');
});
test('zero stream classes permitted only if task and actual output agree',()=>{
 const t=task(),r=result();t.outputPlan.audio=[];t.outputPlan.subtitles=[];
 r.outputPacketEvidence.audioPacketBytes=[];r.outputPacketEvidence.subtitlePacketBytes=[];
 const s=check({task:t,result:r});
 assert.equal(s.status,'completed-mux-byte-ledger');
 assert.equal(s.otherAndMuxBytes,370000);
});
test('Native packet scans for short/long paths and output-report UI must be connected',async()=>{
 const {readFile}=await import('node:fs/promises');
 const [native,worker,ui]=await Promise.all([
  readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8'),
  readFile(new URL('../windows/trim-packet-audit.ps1',import.meta.url),'utf8'),
  readFile(new URL('./media-workspace.js',import.meta.url),'utf8')
 ]);
 assert.match(native,/videoPacketBytes=@\(\$receipt\.videoPacketBytes\)/);
 assert.match(native,/\$video=Measure-AuxiliaryPackets \$Job\.Output 'v'/);
 assert.match(worker,/\$video=Get-PacketTotals 'v'/);
 assert.match(ui,/completedMuxByteLedger/);
});
