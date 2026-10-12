// Strictly verify REAL Native Bridge CQ responses gathered by a companion
// PowerShell harness. This is a CI acceptance of the measured two-codec path,
// not a promise that either codec wins on arbitrary user videos.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  admitManualNativeCqSample,
  createManualTranscodeComparison
} from '../src/manual-transcode-comparison.js';
import {buildSizeFrontierPlot} from '../src/size-frontier-ui.js';
import {createManualTranscodeSession} from '../src/manual-transcode-session.js';

const file=process.argv[2];
if(!file) throw Error('Expected paired Native receipt file');
const fixture=JSON.parse(readFileSync(file,'utf8'));
assert.equal(fixture.kind,'qhe-manual-windows-native-paired-v1');
assert.equal(fixture.sourceGeometry.width,320);
assert.equal(fixture.sourceGeometry.height,180);
assert.deepEqual(fixture.qualities,[18,28,40]);
assert.equal(fixture.branches.length,2);
assert.equal(fixture.windows.length,2);
assert.equal(fixture.samples.length,12);
assert.deepEqual(fixture.branches.map(x=>x.encoder),['libx264','libx265']);

const first=fixture.samples[0]?.result?.nativeEvidence;
assert.equal(first.method,'windows-native-exact-cq-v1');
assert.equal(first.identityKind,'file-stat-snapshot-not-content-hash');
assert.match(first.sourceToken,/^stat-sha256:[a-f0-9]{64}$/);
assert.match(first.runtimeToken,/^stat-sha256:[a-f0-9]{64}$/);

const protocol={
  method:'windows-native-exact-cq-v1',
  referenceMetric:first.referenceMetric,
  sourceToken:first.sourceToken,
  runtimeToken:first.runtimeToken,
  referenceToken:first.referenceToken,
  filterToken:first.filterToken,
  samplePlanVersion:'windows-native-paired-real-v1',
  mediaDuration:fixture.mediaDuration,
  rangeStart:fixture.rangeStart,
  rangeEnd:fixture.rangeEnd,
  videoStream:0,
  referenceWidth:fixture.sourceGeometry.width,
  referenceHeight:fixture.sourceGeometry.height,
  windows:fixture.windows
};
const session=createManualTranscodeSession({
  protocol,
  candidates:fixture.branches.map(branch=>({
    id:branch.id,codec:branch.codec,encoder:branch.encoder,
    preset:branch.preset,outputWidth:320,outputHeight:180,pixelFormat:'yuv420p'
  })),
  maxTotalSamples:24,maxEncodeSeconds:300
});
assert.equal(session.ok,true);
const trials=[];
let minObserved=Infinity,maxObserved=-Infinity;
for(const branch of fixture.branches){
  const candidate={
    id:branch.id,codec:branch.codec,encoder:branch.encoder,
    preset:branch.preset,outputWidth:320,outputHeight:180,pixelFormat:'yuv420p'
  };
  const points=[];
  for(const quality of fixture.qualities){
    const measurements=[];
    for(const window of fixture.windows){
      const hits=fixture.samples.filter(x=>
        x.id===branch.id&&x.quality===quality&&
        x.window.start===window.start&&x.window.duration===window.duration
      );
      assert.equal(hits.length,1,'Every codec/CQ/window must be uniquely measured');
      const r=admitManualNativeCqSample({
        sample:hits[0].result,protocol,candidate,window,qualitySetting:quality
      });
      assert.equal(r.ok,true,
        'Native receipt must match common source, runtime and reference: '+JSON.stringify(r));
      const registered=session.addSample({
        candidate,qualitySetting:quality,window,sample:hits[0].result
      });
      assert.equal(registered.ok,true,
        'Real Native evidence registry must accept paired window: '+JSON.stringify(registered));
      const m=r.measurement;
      assert.ok(m.ssim>0&&m.ssim<=1);
      assert.ok(m.bitrate>0);
      minObserved=Math.min(minObserved,m.ssim);
      maxObserved=Math.max(maxObserved,m.ssim);
      measurements.push(m);
    }
    const qualities=measurements.map(m=>m.ssim);
    const rates=measurements.map(m=>m.bitrate);
    const mean=arr=>arr.reduce((sum,x)=>sum+x,0)/arr.length;
    points.push({
      qualitySetting:quality,
      sampleBitrate:mean(rates),
      ssim:Math.min(...qualities),
      averageSsim:mean(qualities),
      sampleCount:measurements.length,
      sampleMeasurements:measurements
    });
  }
  assert.ok(new Set(points.map(x=>Math.round(x.sampleBitrate))).size>=2,
    branch.id+' did not produce different video rates between CQ settings');
  trials.push({protocol,candidate,points});
}
const actualBudget={durationSeconds:fixture.rangeEnd-fixture.rangeStart,
  audioBitrate:0,audioEvidence:'no-audio',reservePercent:0};
const result=session.compare(actualBudget);
const legacyProjection=createManualTranscodeComparison({trials,budget:actualBudget});
assert.equal(legacyProjection.ok,true,'Prior evidence projection must remain valid');
assert.deepEqual(session.snapshot().candidates.map(c=>c.completeSettings),[3,3]);
assert.equal(session.snapshot().stats.receivedSamples,12);
assert.deepEqual(result.branchIds,legacyProjection.branchIds);
assert.equal(result.ok,true,
  'Real codecs must intersect in measured byte domain; '+JSON.stringify(result));
assert.equal(result.frontier.kind,'multi-branch');
assert.equal(result.frontier.branchIds.length,2);
const f=result.frontier;
const midpoint=Math.sqrt(f.minimumEvidenceTargetBytes*f.maximumEvidenceTargetBytes);
const chosen=f.evaluateTargetBytes(midpoint);
assert.equal(chosen.status,'within-evidence');
assert.equal(chosen.alternatives.length,2);
assert.ok(chosen.alternatives.every(x=>Number.isFinite(x.quality)));
const plot=buildSizeFrontierPlot(f,{selectedTargetBytes:midpoint});
assert.equal(plot.ok,true);
assert.ok(/^M/.test(plot.curvePath),'One fitted upper envelope is required');
assert.ok(f.sampleCurve(16).length>=2);
assert.equal(f.evaluateTargetBytes(f.minimumEvidenceTargetBytes*.5).status,'below-evidence');
assert.equal(f.evaluateTargetBytes(f.maximumEvidenceTargetBytes*1.5).status,'above-evidence');

console.log(JSON.stringify({
  result:'PASS',test:'real Windows Native x264/x265 same-source paired CQ',
  samples:fixture.samples.length,
  encoders:fixture.branches.map(x=>x.encoder),
  windows:fixture.windows,qualitySettings:fixture.qualities,
  observedSsimRange:[+minObserved.toFixed(5),+maxObserved.toFixed(5)],
  sharedEvidenceBytes:[Math.floor(f.minimumEvidenceTargetBytes),
    Math.ceil(f.maximumEvidenceTargetBytes)],
  incumbentOrPreferred:chosen.branchId,
  evidenceKind:'real synthetic FFV1 fixture, Windows hosted runner; not user hardware',
  note:'No actual Manual UI handoff or final VBR output validation was performed.'
},null,2));
