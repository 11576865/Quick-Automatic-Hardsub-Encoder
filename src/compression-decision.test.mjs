import test from 'node:test';
import assert from 'node:assert/strict';
import {fitRateDistortionModel} from './rate-distortion-model.js';
import {calibrationTimeBudget,calibrationCost,calibrationShouldContinue,createMultiBranchFrontier} from './compression-decision.js';
import {buildSizeFrontierPlot} from './size-frontier-ui.js';

const samples=(elapsed)=>({sampleMeasurements:[{elapsedSeconds:elapsed}]});
test('short-video time budgets never silently turn into unlimited probes',()=>{
  assert.equal(calibrationTimeBudget(120),12);
  assert.equal(calibrationTimeBudget(7200),120);
  assert.equal(calibrationTimeBudget(1),8);
  assert.equal(calibrationTimeBudget(0),null);
  assert.deepEqual(calibrationShouldContinue({points:[],budgetSeconds:8}).continue,true);
  assert.equal(calibrationShouldContinue({points:[samples(6)],budgetSeconds:10}).reason,'time-budget');
  assert.equal(calibrationShouldContinue({points:[samples(1),samples(2)],budgetSeconds:8}).continue,true);
  assert.equal(calibrationShouldContinue({points:[{sampleMeasurements:[{elapsedSeconds:false}]}],budgetSeconds:8}).reason,'unknown-cost');
  assert.equal(calibrationCost(samples(2.5)),2.5);
});
const model=(a,b)=>fitRateDistortionModel([
  {sampleBitrate:1e6,ssim:a,averageSsim:a},
  {sampleBitrate:2e6,ssim:b,averageSsim:b}
]);
const opts={durationSeconds:120,audioBitrate:64000,reservePercent:4,measurementScope:'source-render-A'};
function envelope(branches,incumbentId=null,hysteresisSsim=.003) {
 return createMultiBranchFrontier(branches,{...opts,incumbentId,hysteresisSsim});
}
const branch=(id,a,b,scope='source-render-A')=>({id,model:model(a,b),preset:'medium',measurementScope:scope});
test('upper envelope compares conservative qualities at the same measured file budget',()=>{
 const e=envelope([branch('h264',.90,.94),branch('h265',.94,.97)]);
 assert.equal(e.ok,true);
 const middle=Math.sqrt(e.minimumEvidenceTargetBytes*e.maximumEvidenceTargetBytes);
 const decision=e.evaluateTargetBytes(middle);
 assert.equal(decision.status,'within-evidence');
 assert.equal(decision.branchId,'h265');
 assert.ok(decision.alternatives.length===2);
 assert.equal(e.evaluateTargetBytes(e.minimumEvidenceTargetBytes*.9).status,'below-evidence');
 assert.equal(e.evaluateTargetBytes(e.maximumEvidenceTargetBytes*1.1).status,'above-evidence');
 const plotted=buildSizeFrontierPlot(e,{selectedTargetBytes:middle});
 assert.equal(plotted.ok,true);
 assert.equal(plotted.selected.branchId,'h265');
 assert.ok(plotted.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});
test('hysteresis retains incumbent until conservative SSIM improvement clears threshold',()=>{
 const a=branch('h264',.951,.96);
 const b=branch('h265',.952,.962);
 const sticky=envelope([a,b],'h264',.003);
 assert.equal(sticky.ok,true);
 assert.equal(sticky.evaluateTargetBytes(sticky.minimumEvidenceTargetBytes).branchId,'h264');
 const swapped=envelope([a,b],'h264',.0001);
 assert.equal(swapped.evaluateTargetBytes(swapped.maximumEvidenceTargetBytes).branchId,'h265');
});
test('incompatible evidence scopes and disjoint sampled size intervals fail closed',()=>{
 const a=branch('a',.9,.95),b=branch('b',.9,.95,'different');
 assert.equal(envelope([a,b]).reason,'incompatible-evidence-scope');
 assert.equal(envelope([a]).reason,'insufficient-branches');
 const x=branch('wide',.9,.95),y=branch('narrow',.96,.97);
 y.model=fitRateDistortionModel([
  {sampleBitrate:4e6,ssim:.96},{sampleBitrate:8e6,ssim:.97}
 ]);
 assert.equal(envelope([x,y]).reason,'no-common-evidence-domain');
});
