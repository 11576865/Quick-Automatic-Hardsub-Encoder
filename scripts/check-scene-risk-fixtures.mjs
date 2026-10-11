// Reproducible decoded-content fixture; not a GPU or full-video quality test.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sceneProbeStarts, selectPairedSceneWindows } from '../src/scene-risk-selection.js';

const temp = mkdtempSync(join(tmpdir(), 'qhe-scene-risk-'));
function ffmpeg(args, cwd = temp) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], {
    cwd, encoding: 'utf8', timeout: 20000, windowsHide: true
  });
  if (run.error || run.status !== 0)
    throw new Error('FFmpeg risk fixture failed: ' +
      (run.error?.message || run.stderr || run.status));
}
function extractSignals(raw, start) {
  const data = new Map(['YAVG', 'YDIF', 'YLOW', 'YHIGH', 'score'].map(key => [key, []]));
  for (const line of raw.split(/\r?\n/)) {
    const match = /^lavfi\.(?:signalstats|scd)\.(YAVG|YDIF|YLOW|YHIGH|score)=([0-9]+(?:\.[0-9]+)?)$/.exec(line.trim());
    if (match && Number.isFinite(Number(match[2])))
      data.get(match[1]).push(Number(match[2]));
  }
  const mean = key => {
    const values = data.get(key);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  assert.ok(data.get('YAVG').length >= 2, 'Missing decoded luma measurements');
  assert.ok(data.get('YDIF').length >= 2, 'Missing decoded temporal measurements');
  const lo = mean('YLOW'), hi = mean('YHIGH');
  return {start, meanLuma: mean('YAVG'), meanYdif: mean('YDIF'),
    meanContrast: lo !== null && hi !== null ? hi - lo : null,
    peakScene: data.get('score').length ? Math.max(...data.get('score')) : 0};
}

try {
  const video = join(temp, 'scene-regimes.mkv');
  // Deterministic, ordered regimes: dark/static, motion, temporal grain/noise.
  ffmpeg(['-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=15:d=4',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=4',
    '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=15:d=4,noise=alls=38:allf=t',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]',
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', video]);
  const seconds = 2, durationSeconds = 12;
  const starts = sceneProbeStarts(durationSeconds, seconds);
  assert.equal(starts.length, 6);
  const probes = starts.map((start, i) => {
    const work = join(temp, 'probe-' + i);
    mkdirSync(work);
    ffmpeg(['-ss', String(start), '-t', String(seconds), '-i', video,
      '-an', '-sn', '-vf',
      'fps=2,scale=160:90:flags=bilinear,format=yuv420p,signalstats,scdet=threshold=10,metadata=print:file=risk.stats',
      '-f', 'null', '-'], work);
    return extractSignals(readFileSync(join(work, 'risk.stats'), 'utf8'), start);
  });
  // A probe starting at 2.5s crosses the 4s cut, so only the earliest probe
  // represents the wholly static regime. This explicitly avoids test leakage.
  const still = probes.filter(p => p.start < 1.5);
  const moving = probes.filter(p => p.start > 4.1 && p.start < 6.5);
  const noisy = probes.filter(p => p.start > 8);
  assert.ok(still.length && moving.length && noisy.length);
  assert.ok(still.every(p => p.meanYdif < 0.5), 'Static input gained fake motion');
  assert.ok(moving.some(p => p.meanYdif > 3), 'Moving input lost temporal change');
  assert.ok(noisy.some(p => p.meanYdif > 2), 'Temporal noise was not observed');
  assert.ok(still.every(p => p.meanLuma + 25 < moving[0].meanLuma),
    'Dark and bright regimes should be separated by observed luma');
  const options = {durationSeconds, windowSeconds:seconds, probes};
  const chosen = selectPairedSceneWindows(options);
  assert.equal(chosen.ok, true);
  assert.equal(chosen.riskAware, true);
  assert.equal(chosen.starts.length, 3);
  assert.ok(chosen.starts.some(start => start >= 4 && start < 8));
  assert.deepEqual(chosen, selectPairedSceneWindows(options), 'Selection must be reproducible');
  assert.equal(selectPairedSceneWindows({durationSeconds, windowSeconds:seconds}).riskAware,
    false, 'Missing probe evidence must not be promoted to measured risk');
  console.log('Real FFmpeg scene risk fixture: dark/static, motion and temporal-noise passed.');
} finally {
  rmSync(temp, {recursive:true, force:true});
}
