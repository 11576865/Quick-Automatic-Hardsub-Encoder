import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationSampleStarts, exploreQuality, createMeasuredSizeFrontier, buildExplorationPlot, CALIBRATION_PROFILES, summarizeCalibrationEvidence } from './transcode-curves.js';

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

test('quality presets span long videos without overlapping windows', () => {
  const {count,seconds}=CALIBRATION_PROFILES.thorough;
  const starts=calibrationSampleStarts(0,25200,seconds,count);
  assert.equal(starts.length,7);
  assert.ok(starts[0]>=0 && starts.at(-1)+seconds<=25200);
  assert.ok(starts.every((v,i)=>i===0||v-starts[i-1]>=seconds));
  assert.equal(calibrationSampleStarts(0,10,4,7).length,2);
  assert.deepEqual(calibrationSampleStarts(100,102,2,7),[100]);
  assert.deepEqual(calibrationSampleStarts(0,1.5,2,7),[]);
});

test('calibration summary exposes sample spread without pretending to be a confidence interval', () => {
  const summary=summarizeCalibrationEvidence([{sampleMeasurements:[
    {start:0,bitrate:8_000_000,ssim:.95},
    {start:100,bitrate:25_000_000,ssim:.99},
    {start:200,bitrate:14_000_000,ssim:.975}
  ]}]);
  assert.equal(summary.sampleCount,3);
  assert.equal(summary.widelyDivergent,true);
  assert.equal(summary.minBitrate,8_000_000);
  assert.equal(summary.maxBitrate,25_000_000);
  assert.equal(summarizeCalibrationEvidence([{sampleMeasurements:[{bitrate:0,ssim:.9}]}]),null);
});

test('visual exploration plot retains measured min/max per-point whiskers',()=>{
 const p=buildExplorationPlot([
  {qualitySetting:20,ssim:.945,sampleMeasurements:[{ssim:.945},{ssim:.963}]},
  {qualitySetting:25,ssim:.975,sampleMeasurements:[{ssim:.975},{ssim:.99}]}
 ],.98);
 assert.equal(p.ok,true);
 assert.equal(p.paddingX,66);
 assert.equal(p.paddingY,34);
 assert.ok(p.measured[0].highY < p.measured[0].lowY);
 assert.ok(p.measured[1].highY < p.measured[1].lowY);
 assert.ok(p.targetY >= p.paddingY && p.targetY <= p.height-p.paddingY);
});
