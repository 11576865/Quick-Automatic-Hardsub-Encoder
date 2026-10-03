import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCompressionEvidence,
  normalizeCompressionEvidenceList,
  qualityEvidenceRecord,
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

test('quality evidence is source-scoped and can be recovered as ordered curve points', () => {
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
  const points = sourceQualityEvidence(normalized, sourceIdentity, 'av1');
  assert.equal(points.length, 2);
  assert.deepEqual(points.map(x => x.sampleBitrate), [500000, 900000]);
  assert.ok(points.every(x => x.evidenceScope === 'source'));
});
