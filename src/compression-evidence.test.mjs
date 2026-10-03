import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCompressionEvidence,
  normalizeCompressionEvidenceList,
  qualityEvidenceRecord,
  reusableSourceQualityByCrf,
  runtimeEvidenceKey,
  sourceEvidenceKey,
  sourceQualityEvidence
} from './compression-evidence.js';

const media = {
  sourceName: 'movie.mkv',
  size: 123456789,
  duration: 120.125,
  width: 1920,
  height: 1080,
  fps: 23.976,
  videoCodec: 'h264',
  pixelFormat: 'yuv420p',
  videoBitRate: 4500000
};

test('source evidence key is deterministic and changes with source identity', () => {
  const a = sourceEvidenceKey(media, 'movie.mkv', media.size);
  const b = sourceEvidenceKey({ ...media }, 'movie.mkv', media.size);
  const c = sourceEvidenceKey({ ...media, duration: 121.125 }, 'movie.mkv', media.size);

  assert.match(a, /^src-[0-9a-f]{8}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('legacy benchmark records normalize as full-encode evidence', () => {
  const normalized = normalizeCompressionEvidence({
    codec: 'av1',
    preset: '6',
    averageSpeed: 1.5,
    outputBytes: 1000
  });

  assert.equal(normalized.evidenceKind, 'full-encode');
  assert.equal(normalized.evidenceScope, 'device');
  assert.equal(normalized.codec, 'av1');
  assert.equal(normalized.averageSpeed, 1.5);
});

test('unkeyed quality samples are persisted as observation-only evidence', () => {
  const sourceIdentity = sourceEvidenceKey(media, 'movie.mkv', media.size);
  const records = [
    qualityEvidenceRecord({
      media,
      sourceName: 'movie.mkv',
      sourceSize: media.size,
      backend: 'windows-native',
      codec: 'av1',
      preset: '6',
      crf: 34,
      targetSsim: 0.98,
      ssim: 0.975,
      averageSsim: 0.979,
      sampleBitrate: 500000,
      encodeSpeed: 0.8,
      sampleCount: 2
    }),
    qualityEvidenceRecord({
      media,
      sourceName: 'movie.mkv',
      sourceSize: media.size,
      backend: 'windows-native',
      codec: 'av1',
      preset: '6',
      crf: 30,
      targetSsim: 0.98,
      ssim: 0.988,
      averageSsim: 0.99,
      sampleBitrate: 900000,
      encodeSpeed: 0.75,
      sampleCount: 2
    }),
    qualityEvidenceRecord({
      media: { ...media, duration: 999 },
      sourceName: 'other.mkv',
      sourceSize: 111,
      backend: 'windows-native',
      codec: 'av1',
      preset: '6',
      crf: 30,
      ssim: 0.99,
      averageSsim: 0.99,
      sampleBitrate: 700000,
      encodeSpeed: 0.75,
      sampleCount: 2
    })
  ];

  const normalized = normalizeCompressionEvidenceList(records);
  assert.ok(normalized.every(x => x.evidenceScope === 'observation'));
  const points = sourceQualityEvidence(normalized, sourceIdentity, 'av1');
  assert.equal(points.length, 0);
});


test('latest reusable CRF evidence wins for the same source and preset', () => {
  const sourceIdentity = sourceEvidenceKey(media, 'movie.mkv', media.size);
  const base = qualityEvidenceRecord({
    media,
    sourceName: 'movie.mkv',
    sourceSize: media.size,
    backend: 'android-native',
    codec: 'av1',
    preset: '6',
    crf: 30,
    ssim: 0.98,
    averageSsim: 0.981,
    sampleBitrate: 800000,
    encodeSpeed: 0.8,
    sampleCount: 2
  });
  const older = { ...base, evidenceScope: 'source', recordedAt: 100 };
  const newer = { ...base, evidenceScope: 'source', recordedAt: 200, ssim: 0.99, sampleBitrate: 900000 };
  const otherPreset = { ...base, evidenceScope: 'source', recordedAt: 300, preset: '8', ssim: 0.995 };

  const reusable = reusableSourceQualityByCrf(
    [older, newer, otherPreset],
    sourceIdentity,
    'av1',
    '6'
  );

  assert.equal(reusable.length, 1);
  assert.equal(reusable[0].ssim, 0.99);
  assert.equal(reusable[0].sampleBitrate, 900000);
});


test('runtime evidence key changes when encoder runtime changes', () => {
  const a = runtimeEvidenceKey({
    backend: 'windows-native',
    ffmpegVersion: '8.0',
    bridgeVersion: 5,
    platform: 'windows',
    cpu: 'CPU',
    gpus: ['GPU']
  });
  const b = runtimeEvidenceKey({
    backend: 'windows-native',
    ffmpegVersion: '8.1',
    bridgeVersion: 5,
    platform: 'windows',
    cpu: 'CPU',
    gpus: ['GPU']
  });
  assert.match(a, /^runtime-[0-9a-f]{8}$/);
  assert.notEqual(a, b);
});

test('reusable quality evidence can be restricted to the current runtime', () => {
  const sourceIdentity = sourceEvidenceKey(media, 'movie.mkv', media.size);
  const runtimeA = runtimeEvidenceKey({ backend: 'windows-native', ffmpegVersion: '8.0', bridgeVersion: 5 });
  const runtimeB = runtimeEvidenceKey({ backend: 'windows-native', ffmpegVersion: '8.1', bridgeVersion: 5 });
  const base = qualityEvidenceRecord({
    media,
    sourceName: 'movie.mkv',
    sourceSize: media.size,
    backend: 'windows-native',
    runtimeIdentity: runtimeA,
    codec: 'av1',
    preset: '6',
    crf: 30,
    ssim: 0.98,
    averageSsim: 0.981,
    sampleBitrate: 800000,
    encodeSpeed: 0.8,
    sampleCount: 2
  });
  const current = { ...base, evidenceScope: 'source', recordedAt: 100 };
  const staleRuntime = { ...base, evidenceScope: 'source', recordedAt: 200, runtimeIdentity: runtimeB, ssim: 0.99 };

  const reusable = reusableSourceQualityByCrf(
    [current, staleRuntime],
    sourceIdentity,
    'av1',
    '6',
    runtimeA
  );

  assert.equal(reusable.length, 1);
  assert.equal(reusable[0].runtimeIdentity, runtimeA);
  assert.equal(reusable[0].ssim, 0.98);
});
