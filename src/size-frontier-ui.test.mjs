import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSizeFrontierPlot,
  evidenceFractionForTargetBytes,
  targetBytesAtEvidenceFraction
} from './size-frontier-ui.js';
import { createSizeQualityFrontier, fitRateDistortionModel } from './rate-distortion-model.js';

test('observation markers retain raw quality when isotonic fitting changes it', () => {
  const model = fitRateDistortionModel([
    {sampleBitrate:1e6,averageSsim:.99,ssim:.98,sampleMeasurements:[{ssim:.98},{ssim:1}]},
    {sampleBitrate:2e6,averageSsim:.89,ssim:.88,sampleMeasurements:[{ssim:.88},{ssim:.90}]}
  ]);
  const frontier = createSizeQualityFrontier(model,{durationSeconds:60});
  const plot = buildSizeFrontierPlot(frontier);
  assert.equal(model.points[0].quality,model.points[1].quality);
  assert.deepEqual(plot.evidencePoints.map(p=>p.quality),[.99,.89]);
  assert.ok(plot.qualityMin<=.88 && plot.qualityMax>=1,
    'Raw scene spread must remain visible even outside the fitted envelope');
  assert.ok(plot.evidencePoints[0].upperY<=plot.evidencePoints[0].y);
  assert.ok(plot.evidencePoints[0].lowerY>=plot.evidencePoints[0].y);
});

function frontierFixture() {
  const model = fitRateDistortionModel([
    {
      sampleBitrate: 150000,
      averageSsim: 0.82,
      ssim: 0.79,
      sampleMeasurements: [{ ssim: 0.79 }, { ssim: 0.85 }]
    },
    {
      sampleBitrate: 350000,
      averageSsim: 0.91,
      ssim: 0.88,
      sampleMeasurements: [{ ssim: 0.88 }, { ssim: 0.94 }]
    },
    {
      sampleBitrate: 800000,
      averageSsim: 0.96,
      ssim: 0.94,
      sampleMeasurements: [{ ssim: 0.94 }, { ssim: 0.98 }]
    }
  ]);
  return createSizeQualityFrontier(model, {
    durationSeconds: 3600,
    audioBitrate: 128000,
    reservePercent: 4,
    containerReservePercent: 1,
    fixedReserveBytes: 256 * 1024,
    minimumVideoBitrate: 150000
  });
}

test('evidence fraction maps logarithmically and round-trips target bytes', () => {
  const frontier = frontierFixture();
  const middle = targetBytesAtEvidenceFraction(frontier, 0.5);
  const expected = Math.sqrt(
    frontier.minimumEvidenceTargetBytes *
    frontier.maximumEvidenceTargetBytes
  );

  assert.ok(Math.abs(middle - expected) / expected < 1e-12);
  assert.ok(Math.abs(evidenceFractionForTargetBytes(frontier, middle) - 0.5) < 1e-12);
  assert.equal(evidenceFractionForTargetBytes(frontier, frontier.minimumEvidenceTargetBytes * 0.9), null);
});

test('plot model exposes continuous path, evidence band and measured points', () => {
  const frontier = frontierFixture();
  const selected = targetBytesAtEvidenceFraction(frontier, 0.5);
  const plot = buildSizeFrontierPlot(frontier, { selectedTargetBytes: selected });

  assert.equal(plot.ok, true);
  assert.match(plot.curvePath, /^M/);
  assert.match(plot.bandPath, /^M/);
  assert.match(plot.bandPath, /Z$/);
  assert.equal(plot.evidencePoints.length, 3);
  assert.ok(plot.selected);
  assert.ok(plot.selected.x > plot.paddingX);
  assert.ok(plot.selected.x < plot.width - plot.paddingX);
  assert.ok(plot.selected.y > 0 && plot.selected.y < plot.height);
});

test('plot keeps unsupported manual targets outside the draggable evidence curve', () => {
  const frontier = frontierFixture();
  const plot = buildSizeFrontierPlot(frontier, {
    selectedTargetBytes: frontier.maximumEvidenceTargetBytes * 1.5
  });

  assert.equal(plot.ok, true);
  assert.equal(plot.selected, null);
  assert.equal(plot.selectedStatus, 'above-evidence');
});

test('knee marker, when available, lies inside the plot', () => {
  const frontier = frontierFixture();
  const plot = buildSizeFrontierPlot(frontier);

  assert.equal(plot.ok, true);
  if (plot.knee) {
    assert.ok(plot.knee.x >= plot.paddingX);
    assert.ok(plot.knee.x <= plot.width - plot.paddingX);
    assert.ok(plot.knee.y >= plot.paddingY);
    assert.ok(plot.knee.y <= plot.height - plot.paddingY);
  }
});
