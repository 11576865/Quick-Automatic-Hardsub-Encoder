import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSizeQualityFrontier,
  fitRateDistortionModel,
  targetBytesForVideoBitrate,
  videoBitrateForTargetBytes
} from './rate-distortion-model.js';

test('rate-distortion fit enforces monotonic quality without extrapolating', () => {
  const model = fitRateDistortionModel([
    { sampleBitrate: 100000, averageSsim: 0.90, ssim: 0.88, sampleCount: 2 },
    { sampleBitrate: 200000, averageSsim: 0.88, ssim: 0.86, sampleCount: 2 },
    { sampleBitrate: 400000, averageSsim: 0.95, ssim: 0.93, sampleCount: 2 }
  ]);

  assert.equal(model.ok, true);
  assert.equal(model.points.length, 3);
  assert.equal(model.points[0].quality, model.points[1].quality);
  assert.ok(model.points[2].quality >= model.points[1].quality);
  assert.equal(model.predictAtBitrate(90000), null);
  assert.equal(model.predictAtBitrate(500000), null);
});

test('log-domain interpolation makes geometric bitrate midpoint a quality midpoint', () => {
  const model = fitRateDistortionModel([
    { sampleBitrate: 100000, averageSsim: 0.80, ssim: 0.78 },
    { sampleBitrate: 400000, averageSsim: 0.96, ssim: 0.94 }
  ]);

  const predicted = model.predictAtBitrate(200000);
  assert.equal(model.ok, true);
  assert.ok(predicted);
  assert.ok(Math.abs(predicted.quality - 0.88) < 1e-12);
  assert.ok(Math.abs(predicted.lowerQuality - 0.86) < 1e-12);
});

test('evidence band preserves per-sample spread', () => {
  const model = fitRateDistortionModel([
    {
      sampleBitrate: 200000,
      averageSsim: 0.90,
      ssim: 0.86,
      sampleMeasurements: [
        { ssim: 0.86 },
        { ssim: 0.94 }
      ]
    },
    {
      sampleBitrate: 400000,
      averageSsim: 0.96,
      ssim: 0.94,
      sampleMeasurements: [
        { ssim: 0.94 },
        { ssim: 0.98 }
      ]
    }
  ]);

  assert.equal(model.ok, true);
  assert.equal(model.points[0].lowerQuality, 0.86);
  assert.equal(model.points[0].upperQuality, 0.94);
  assert.equal(model.points[1].lowerQuality, 0.94);
  assert.equal(model.points[1].upperQuality, 0.98);
});

test('knee estimate identifies a diminishing-return interior point', () => {
  const model = fitRateDistortionModel([
    { sampleBitrate: 100000, averageSsim: 0.50, ssim: 0.48 },
    { sampleBitrate: 200000, averageSsim: 0.72, ssim: 0.69 },
    { sampleBitrate: 400000, averageSsim: 0.84, ssim: 0.82 },
    { sampleBitrate: 800000, averageSsim: 0.90, ssim: 0.88 },
    { sampleBitrate: 1600000, averageSsim: 0.93, ssim: 0.91 }
  ]);

  const knee = model.estimateKnee();
  assert.ok(knee);
  assert.ok(knee.bitrate >= 200000 && knee.bitrate <= 800000);
  assert.ok(knee.strength > 0);
});

test('size-budget transform is invertible inside floating-point tolerance', () => {
  const budget = {
    durationSeconds: 7200,
    audioBitrate: 64000,
    reservePercent: 4
  };
  const bytes = targetBytesForVideoBitrate(500000, budget);
  const bitrate = videoBitrateForTargetBytes(bytes, budget);

  assert.ok(bytes > 0);
  assert.ok(Math.abs(bitrate - 500000) < 1e-8);
});

test('size frontier distinguishes impossible, unmeasured and measured target regions', () => {
  const model = fitRateDistortionModel([
    { sampleBitrate: 100000, averageSsim: 0.80, ssim: 0.77 },
    { sampleBitrate: 400000, averageSsim: 0.95, ssim: 0.93 }
  ]);
  const frontier = createSizeQualityFrontier(model, {
    durationSeconds: 3600,
    audioBitrate: 64000,
    reservePercent: 4,
    minimumVideoBitrate: 1000
  });

  assert.equal(frontier.ok, true);
  assert.ok(frontier.minimumFeasibleTargetBytes < frontier.minimumEvidenceTargetBytes);
  assert.ok(frontier.minimumEvidenceTargetBytes < frontier.maximumEvidenceTargetBytes);

  const impossible = frontier.evaluateTargetBytes(frontier.minimumFeasibleTargetBytes * 0.9);
  const below = frontier.evaluateTargetBytes(
    (frontier.minimumFeasibleTargetBytes + frontier.minimumEvidenceTargetBytes) / 2
  );
  const within = frontier.evaluateTargetBytes(
    (frontier.minimumEvidenceTargetBytes + frontier.maximumEvidenceTargetBytes) / 2
  );
  const above = frontier.evaluateTargetBytes(frontier.maximumEvidenceTargetBytes * 1.5);

  assert.equal(impossible.status, 'impossible');
  assert.equal(below.status, 'below-evidence');
  assert.equal(within.status, 'within-evidence');
  assert.ok(within.prediction?.quality > 0);
  assert.equal(above.status, 'above-evidence');
});

test('curve sampling is monotonic in bitrate, size and fitted quality', () => {
  const model = fitRateDistortionModel([
    { sampleBitrate: 120000, averageSsim: 0.75, ssim: 0.71 },
    { sampleBitrate: 250000, averageSsim: 0.86, ssim: 0.82 },
    { sampleBitrate: 500000, averageSsim: 0.92, ssim: 0.89 },
    { sampleBitrate: 1000000, averageSsim: 0.96, ssim: 0.94 }
  ]);
  const frontier = createSizeQualityFrontier(model, {
    durationSeconds: 5400,
    audioBitrate: 48000,
    reservePercent: 4
  });
  const curve = frontier.sampleCurve(32);

  assert.equal(curve.length, 32);
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].bitrate >= curve[i - 1].bitrate);
    assert.ok(curve[i].targetBytes >= curve[i - 1].targetBytes);
    assert.ok(curve[i].quality >= curve[i - 1].quality);
  }
});

test('insufficient evidence does not fabricate a model', () => {
  const model = fitRateDistortionModel([
    { sampleBitrate: 100000, averageSsim: 0.80, ssim: 0.79 }
  ]);

  assert.equal(model.ok, false);
  assert.equal(model.reason, 'insufficient-evidence');
});
