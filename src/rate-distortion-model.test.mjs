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


test('planner reserve transform matches the guided size-budget accounting', () => {
  const budget = {
    durationSeconds: 3600,
    audioBitrate: 128000,
    reservePercent: 4,
    containerReservePercent: 1,
    fixedReserveBytes: 256 * 1024
  };

  const impossibleTarget = 20 * 1024 * 1024;
  const impossibleVideoBitrate = videoBitrateForTargetBytes(impossibleTarget, budget);
  assert.ok(impossibleVideoBitrate < 0);
  assert.ok(impossibleTarget < targetBytesForVideoBitrate(0, budget));

  for (const targetBytes of [80 * 1024 * 1024, 800 * 1024 * 1024]) {
    const videoBitrate = videoBitrateForTargetBytes(targetBytes, budget);
    const roundTrip = targetBytesForVideoBitrate(videoBitrate, budget);
    assert.ok(videoBitrate >= 0);
    assert.ok(Math.abs(roundTrip - targetBytes) < 1e-6);
  }
});

test('size frontier exposes measured evidence points in target-byte coordinates', () => {
  const model = fitRateDistortionModel([
    { sampleBitrate: 150000, averageSsim: 0.82, ssim: 0.79 },
    { sampleBitrate: 600000, averageSsim: 0.95, ssim: 0.92 }
  ]);
  const frontier = createSizeQualityFrontier(model, {
    durationSeconds: 1800,
    audioBitrate: 64000,
    reservePercent: 4,
    containerReservePercent: 1,
    fixedReserveBytes: 256 * 1024,
    minimumVideoBitrate: 150000
  });

  assert.equal(frontier.ok, true);
  assert.equal(frontier.evidencePoints.length, 2);
  assert.ok(frontier.evidencePoints[0].targetBytes < frontier.evidencePoints[1].targetBytes);
  assert.ok(frontier.evidencePoints.every(point => point.targetBytes > 0));
});


test('minimum executable bitrate clips the plotted evidence domain', () => {
  const model = fitRateDistortionModel([
    { sampleBitrate: 80000, averageSsim: 0.70, ssim: 0.66 },
    { sampleBitrate: 200000, averageSsim: 0.84, ssim: 0.81 },
    { sampleBitrate: 500000, averageSsim: 0.94, ssim: 0.92 }
  ]);
  const frontier = createSizeQualityFrontier(model, {
    durationSeconds: 1800,
    audioBitrate: 64000,
    reservePercent: 4,
    containerReservePercent: 1,
    fixedReserveBytes: 256 * 1024,
    minimumVideoBitrate: 150000
  });

  assert.equal(frontier.ok, true);
  assert.equal(frontier.minimumEvidenceBitrate, 150000);
  assert.ok(frontier.minimumEvidenceTargetBytes >= frontier.minimumFeasibleTargetBytes);
  const sampled = frontier.sampleCurve(64);
  assert.ok(Math.abs(sampled[0].bitrate - 150000) < 1e-8);
  assert.ok(sampled.every(point => point.bitrate >= 150000));
  assert.ok(frontier.evidencePoints.every(point => point.bitrate >= 150000));
});

test('null quality fields do not silently become zero-quality evidence', () => {
  const model = fitRateDistortionModel([
    { sampleBitrate: 100000, averageSsim: null, ssim: null },
    { sampleBitrate: 200000, averageSsim: 0.9, ssim: 0.88 }
  ]);

  assert.equal(model.ok, false);
  assert.equal(model.points.length, 1);
});
