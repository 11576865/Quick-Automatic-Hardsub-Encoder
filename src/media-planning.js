import { parseMediaTime } from './media-time.js';
import { auditTrimCopyPayload } from './trim-copy-audit.js';
// Size budgets are estimates, never a reason to truncate or delete a valid movie.
export const SIZE_UNITS = { MB: 1000000, GB: 1000000000, MiB: 1048576, GiB: 1073741824 };
export function sampleQualityTrial(task,adjustment) {
  const vvc=task.encoder==='libvvenc';
  const min=vvc?0:1;
  const max=vvc || task.codec==='av1'&&!task.encoder.endsWith('_nvenc')?63:51;
  return {quality:Math.max(min,Math.min(max,Number(task.quality)+adjustment*2)),label:vvc?'QP':'CRF / CQ'};
}
export function sizeBudget(raw, duration, audioTracks) {
  const amount = Number(raw.targetSize), reserve = Number(raw.sizeReserve ?? 4);
  const bytes = amount * SIZE_UNITS[raw.sizeUnit || 'MB'];
  if (!(duration > 0) || !Number.isFinite(bytes) || bytes <= 0 || bytes > 1e13) throw Error('目标体积或时长无效');
  if (!Number.isFinite(reserve) || reserve < 1 || reserve > 30) throw Error('体积余量须为 1–30%');
  const evidence = raw.budgetEvidence;
  let copiedTrimReserveBytes = 0;
  const measured = (key, ordinals, trimmed=false) => {
    if (!ordinals.length) return 0;
    if (evidence?.version !== 1 || evidence.scope !== 'full-source')
      throw Error('体积预算中的复制流/附件成本未知：请测量当前完整源文件');
    const values = evidence[key];
    const total = ordinals.reduce((sum, ordinal) => {
      const value = values?.[ordinal];
      if (!Number.isSafeInteger(value) || value < 0) throw Error('复制流/附件测量不完整，请重新测量或改用有损音频');
      return sum + value;
    }, 0);
    // Keep the whole measured payload for a trimmed copy. Never scale by duration:
    // packet boundaries and overlapping subtitle events need not scale linearly.
    if (trimmed) copiedTrimReserveBytes += total;
    return total;
  };
  let fixedPayloadBytes = 0, encodedAudioBytes = 0;
  const sourceDuration = Number(raw.sourceDuration || duration), trimDuration = Number(raw.trimDuration || duration);
  if (raw.audioPlan) {
    for (const track of raw.audioPlan) {
      if (track.action === 'drop') continue;
      if (track.action === 'flac') throw Error('FLAC 重编码体积成本未知；请使用质量/码率模式、复制已测流或 AAC / Opus');
      if (track.action === 'copy') fixedPayloadBytes += measured('audioPacketBytes', [track.sourceOrdinal], raw.hasTrimRange && track.range !== 'full');
      else encodedAudioBytes += Number(track.bitrate) * (track.range === 'full' ? sourceDuration : trimDuration) / 8;
    }
  } else if (raw.audio === 'copy' && audioTracks > 0) {
    const ordinals = raw.audioTrack && raw.audioTrack !== 'all' ? [Number(raw.audioTrack)] : Array.from({length:audioTracks},(_,i)=>i);
    fixedPayloadBytes += measured('audioPacketBytes', ordinals, raw.hasTrimRange && raw.audioRange !== 'full');
  } else if (raw.audio !== 'none') {
    encodedAudioBytes = Number(raw.audioBitrate || 128000) * audioTracks * (raw.audioRange === 'full' ? sourceDuration : trimDuration) / 8;
  }
  if (raw.keepSubtitles) {
    const ordinals = raw.subtitleSelection || (Array.isArray(evidence?.subtitlePacketBytes) ? evidence.subtitlePacketBytes.map((_,i)=>i) : null);
    if (!ordinals) throw Error('内封字幕成本未知，请测量当前素材');
    fixedPayloadBytes += measured('subtitlePacketBytes', ordinals, raw.hasTrimRange && raw.subtitleRange !== 'full');
  }
  if (raw.keepAttachments) {
    const ordinals = raw.attachmentSelection || (Array.isArray(evidence?.attachmentBytes) ? evidence.attachmentBytes.map((_,i)=>i) : null);
    if (!ordinals) throw Error('附件成本未知，请测量当前素材');
    fixedPayloadBytes += measured('attachmentBytes', ordinals);
  }
  if (!Number.isSafeInteger(fixedPayloadBytes) || !Number.isFinite(encodedAudioBytes) || encodedAudioBytes < 0) throw Error('音频或固定负载成本无效');
  const audioRate = encodedAudioBytes * 8 / duration;
  const containerReserveBytes = Math.ceil(bytes * reserve / 100);
  const videoRate = Math.floor((bytes - containerReserveBytes - fixedPayloadBytes - encodedAudioBytes) * 8 / duration);
  if (videoRate < 1000) throw Error('音频、固定流与封装余量已用尽预算，请增大目标体积或调整输出计划');
  return { targetBytes: Math.round(bytes), reservePercent: reserve, containerReserveBytes, fixedPayloadBytes, encodedAudioBytes, copiedTrimReserveBytes,
    audioRate, videoRate, estimatedBytes: videoRate * duration / 8 + encodedAudioBytes + fixedPayloadBytes };

}
export function formatSize(bytes) {
  return Number.isFinite(bytes) ? `${(bytes / 1e6).toFixed(2)} MB / ${(bytes / 1048576).toFixed(2)} MiB` : '尚无可靠估计';
}
export function sampleSettings(raw, media) {
  if (raw.operation === 'copy') throw Error('无损剪切无需比较编码质量');
  const start = parseMediaTime(raw.sampleStart, { empty: 0, max: media.duration, label: '试压起点' });
  const length = Number(raw.sampleLength || 15);
  const rangeStart = parseMediaTime(raw.start, { empty: 0, max: media.duration, label: '开始时间' });
  const rangeEnd = parseMediaTime(raw.end, { empty: media.duration, max: media.duration, label: '结束时间' });
  if (!Number.isFinite(start) || !Number.isFinite(length) || length < 2 || length > 60 || start < rangeStart || start >= rangeEnd) throw Error('试压起点须在所选范围内，长度须为 2–60 秒');
  const end = Math.min(rangeEnd, start + length);
  if (end - start < 2) throw Error('试压片段不足 2 秒');
  return {start, end, length: end - start};
}
export function outputReport(task, result, elapsedSeconds) {
  const bytes = Number(result.outputBytes ?? result.byteLength ?? result.blob?.size);
  const duration = Number(result.outputDuration || task.expectedDuration);
  const limit = task.sizeCeilingBytes || task.sizePlan?.targetBytes;
  const validBytes = Number.isSafeInteger(bytes) && bytes > 0;
  const withinBudget = limit && validBytes ? bytes <= limit : null;
  const strict = task.budgetPolicy === 'strict-ceiling';
  const deliveryAllowed = !strict || withinBudget === true;
  const audioRate = task.estimatedAudioRate || 0;
  const suggestedVideoRate = withinBudget === false
    ? Math.max(1000, Math.floor((Number(task.bitrate) + audioRate) * (limit - (task.sizePlan?.fixedPayloadBytes || 0)) / Math.max(1,bytes - (task.sizePlan?.fixedPayloadBytes || 0)) * .97 - audioRate)) : null;
  const trimCopyAudit=result.verified===true && validBytes
    ? auditTrimCopyPayload(task,result.outputPacketEvidence) : null;
  return {version:1, operation:task.operation, encoder:task.encoder || 'copy', parameters:task,
    trimCopyAudit,
    trimCopyAuditState:trimCopyAudit?'ready':(result.outputPacketAuditState??null),
    outputBytes:Number.isFinite(bytes) ? bytes : null, outputDuration:duration, elapsedSeconds,
    actualStart:result.actualStart ?? task.start, targetBytes:limit ?? null,
    withinBudget, deliveryAllowed, recoveryOptions:deliveryAllowed?[]:['increase-budget','reduce-video-rate','change-stream-plan'], suggestedVideoRate, verified:result.verified ?? null,
    note:'体积预算与片段外推均不保证整片大小或主观画质；超出预算不会删除完整成品。'};
}
export function sampleProjection(bytes, sampleDuration, fullDuration) {
  if (!(bytes > 0 && sampleDuration > 0 && fullDuration > 0)) return null;
  return bytes / sampleDuration * fullDuration;
}
