import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationSampleStarts, exploreQuality, createMeasuredSizeFrontier, buildExplorationPlot } from './transcode-curves.js';

test('probe starts spread across a long range and respect trim boundaries', () => {
  const starts = calibrationSampleStarts(3600, 7*3600, 2);
  assert.equal(starts.length, 3);
  assert.ok(starts[0] >= 3600);
  assert.ok(starts[2] + 2 <= 7*3600);
  assert.deepEqual(calibrationSampleStarts(8, 10, 2), [8]);
  assert.deepEqual(calibrationSampleStarts(0, 1, 2), []);
});

test('search records actual evaluation order and converges on conservative target', async () => {
  const seen = [];
  const output = await exploreQuality({
    minQuality: 20, maxQuality: 40, targetSsim: .98, maxEvaluations: 7,
    evaluate: async q => ({
      ssim: 1-q*.0007,
      averageSsim: 1-q*.00065,
      sampleBitrate: 35_000_000 - q * 500_000,
      sampleMeasurements: [{ssim:1-q*.0007}]
    }),
    onPoint: p => seen.push(p.qualitySetting)
  });
  assert.deepEqual(seen.slice(0,2), [20,40]);
  assert.ok(output.points.every((p,i)=>p.iteration===i+1));
  assert.ok(output.best.meetsTarget);
  assert.equal(output.best.qualitySetting, 28);
  assert.equal(output.model.ok, true);
  assert.equal(buildExplorationPlot(output.points, .98).ok, true);
});

test('curve rejects invented measurements and refuses extrapolation', async () => {
  await assert.rejects(exploreQuality({
    minQuality:18,maxQuality:40,targetSsim:.98,
    evaluate:async()=>({ssim:.99,sampleBitrate:0})
  }),/有效码率/);
  const frontier = createMeasuredSizeFrontier([
    {sampleBitrate:10_000_000,ssim:.94,averageSsim:.95},
    {sampleBitrate:20_000_000,ssim:.98,averageSsim:.985},
    {sampleBitrate:30_000_000,ssim:.99,averageSsim:.992}
  ], {durationSeconds:25200,audioBitrate:192000,reservePercent:4});
  assert.equal(frontier.ok,true);
  assert.equal(frontier.evaluateTargetBytes(frontier.maximumEvidenceTargetBytes*1.5).status,'above-evidence');
  assert.equal(frontier.evaluateTargetBytes(frontier.minimumEvidenceTargetBytes*.3).status,'below-evidence');
});
