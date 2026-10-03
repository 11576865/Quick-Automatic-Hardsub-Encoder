export const COMPRESSION_EVIDENCE_VERSION = 1;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function stableFNV1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function runtimeEvidenceKey(backend = {}) {
  const identity = [
    cleanText(backend.backend || 'web').toLowerCase(),
    cleanText(backend.ffmpegVersion || backend.ffmpegKitVersion),
    cleanText(backend.appVersionCode || backend.bridgeVersion),
    cleanText(backend.abi || backend.platform),
    cleanText(backend.cpu),
    Array.isArray(backend.gpus) ? backend.gpus.map(cleanText).join(',') : ''
  ].join('|');
  return 'runtime-' + stableFNV1a(identity);
}

export function sourceEvidenceKey(media = {}, sourceName = '', sourceSize = 0) {
  const identity = [
    cleanText(sourceName || media.sourceName).toLowerCase(),
    Math.round(finite(sourceSize || media.size)),
    Math.round(finite(media.duration) * 1000),
    Math.round(finite(media.width)),
    Math.round(finite(media.height)),
    Math.round(finite(media.fps) * 1000),
    cleanText(media.videoCodec).toLowerCase(),
    cleanText(media.pixelFormat).toLowerCase()
  ].join('|');
  return 'src-' + stableFNV1a(identity);
}

export function normalizeCompressionEvidence(record) {
  if (!record || typeof record !== 'object') return null;
  const evidenceKind = cleanText(record.evidenceKind || record.kind || 'full-encode');
  return {
    ...record,
    evidenceVersion: finite(record.evidenceVersion, COMPRESSION_EVIDENCE_VERSION),
    evidenceKind,
    evidenceScope: cleanText(record.evidenceScope || (record.sourceIdentity ? 'source' : 'device')),
    recordedAt: finite(record.recordedAt),
    sourceIdentity: cleanText(record.sourceIdentity),
    runtimeIdentity: cleanText(record.runtimeIdentity),
    codec: cleanText(record.codec),
    preset: cleanText(record.preset),
    width: finite(record.width),
    height: finite(record.height),
    fps: finite(record.fps),
    averageSpeed: finite(record.averageSpeed || record.encodeSpeed),
    outputBytes: finite(record.outputBytes),
    outputVideoBitrate: finite(record.outputVideoBitrate),
    sampleBitrate: finite(record.sampleBitrate || record.calibrationSampleBitrate),
    ssim: optionalFinite(record.ssim),
    averageSsim: optionalFinite(record.averageSsim)
  };
}

export function normalizeCompressionEvidenceList(records) {
  return (Array.isArray(records) ? records : [])
    .map(normalizeCompressionEvidence)
    .filter(Boolean);
}

export function qualityEvidenceRecord({
  media,
  sourceName,
  sourceSize,
  backend,
  runtimeIdentity,
  codec,
  preset,
  crf,
  targetSsim,
  ssim,
  averageSsim,
  sampleBitrate,
  encodeSpeed,
  sampleCount,
  sampleMeasurements,
  testedCrfs
}) {
  return {
    evidenceVersion: COMPRESSION_EVIDENCE_VERSION,
    evidenceKind: 'quality-sample',
    evidenceScope: 'observation',
    sourceIdentity: sourceEvidenceKey(media, sourceName, sourceSize),
    backend: cleanText(backend),
    runtimeIdentity: cleanText(runtimeIdentity),
    codec: cleanText(codec),
    preset: cleanText(preset),
    crf: finite(crf),
    targetSsim: optionalFinite(targetSsim),
    ssim: optionalFinite(ssim),
    averageSsim: optionalFinite(averageSsim),
    sampleBitrate: finite(sampleBitrate),
    averageSpeed: finite(encodeSpeed),
    sampleCount: Math.max(0, Math.round(finite(sampleCount))),
    sampleMeasurements: (Array.isArray(sampleMeasurements) ? sampleMeasurements : [])
      .map(sample => ({
        start: finite(sample?.start),
        duration: finite(sample?.duration),
        ssim: optionalFinite(sample?.ssim),
        bitrate: finite(sample?.bitrate),
        elapsedSeconds: finite(sample?.elapsedSeconds)
      }))
      .filter(sample => sample.duration > 0 && Number.isFinite(sample.ssim)),
    testedCrfs: Array.isArray(testedCrfs) ? testedCrfs.map(Number).filter(Number.isFinite) : [],
    width: finite(media?.width),
    height: finite(media?.height),
    fps: finite(media?.fps),
    sourceCodec: cleanText(media?.videoCodec),
    sourcePixelFormat: cleanText(media?.pixelFormat),
    sourceVideoBitrate: finite(media?.videoBitRate),
    duration: finite(media?.duration)
  };
}

export function sourceQualityEvidence(records, sourceIdentity, codec = '', preset = '', runtimeIdentity = '') {
  const normalized = normalizeCompressionEvidenceList(records);
  return normalized
    .filter(record =>
      record.evidenceKind === 'quality-sample' &&
      record.evidenceScope === 'source' &&
      record.sourceIdentity === sourceIdentity &&
      (!codec || record.codec === codec) &&
      (!preset || record.preset === preset) &&
      (!runtimeIdentity || record.runtimeIdentity === runtimeIdentity) &&
      record.sampleBitrate > 0 &&
      Number.isFinite(record.ssim)
    )
    .sort((a, b) => a.sampleBitrate - b.sampleBitrate || a.recordedAt - b.recordedAt);
}


export function reusableSourceQualityByCrf(records, sourceIdentity, codec, preset = '', runtimeIdentity = '') {
  const latest = new Map();
  for (const record of sourceQualityEvidence(records, sourceIdentity, codec, preset, runtimeIdentity)) {
    const crf = Number(record.crf);
    if (!Number.isFinite(crf)) continue;
    const previous = latest.get(crf);
    if (!previous || Number(record.recordedAt || 0) >= Number(previous.recordedAt || 0)) {
      latest.set(crf, record);
    }
  }
  return [...latest.values()].sort((a, b) => Number(a.crf) - Number(b.crf));
}
