import { parseMediaTime } from './media-time.js';
// Size budgets are estimates, never a reason to truncate or delete a valid movie.
export const SIZE_UNITS = { MB: 1000000, GB: 1000000000, MiB: 1048576, GiB: 1073741824 };
export function sizeBudget(raw, duration, audioTracks) {
  const amount = Number(raw.targetSize), reserve = Number(raw.sizeReserve ?? 4);
  const bytes = amount * SIZE_UNITS[raw.sizeUnit || 'MB'];
  if (!(duration > 0) || !Number.isFinite(bytes) || bytes <= 0 || bytes > 1e13) throw Error('目标体积或时长无效');
  if (!Number.isFinite(reserve) || reserve < 1 || reserve > 30) throw Error('体积余量须为 1–30%');
  if (raw.audio === 'copy' && audioTracks > 0) throw Error('目标体积模式请指定 AAC / Opus 码率或关闭音频；复制音频大小无法可靠预估');
  if (raw.keepAttachments) throw Error('目标体积模式请关闭附件保留；附件大小尚未计入预算');
  const audioRate = raw.audio === 'none' ? 0 : Number(raw.audioBitrate || 128000) * audioTracks;
  if (!Number.isFinite(audioRate) || audioRate < 0) throw Error('音频码率无效');
  const payloadBytes = bytes * (1 - reserve / 100);
  const videoRate = Math.floor(payloadBytes * 8 / duration - audioRate);
  if (videoRate < 1000) throw Error('音频和体积余量已用尽预算，请增大目标体积或降低音频码率');
  return { targetBytes: Math.round(bytes), reservePercent: reserve, audioRate, videoRate, estimatedBytes: (videoRate + audioRate) * duration / 8 };
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
  const withinBudget = task.sizePlan && Number.isFinite(bytes) ? bytes <= task.sizePlan.targetBytes : null;
  const audioRate = task.estimatedAudioRate || 0;
  const suggestedVideoRate = withinBudget === false
    ? Math.max(1000, Math.floor((Number(task.bitrate) + audioRate) * task.sizePlan.targetBytes / bytes * .97 - audioRate)) : null;
  return {version:1, operation:task.operation, encoder:task.encoder || 'copy', parameters:task,
    outputBytes:Number.isFinite(bytes) ? bytes : null, outputDuration:duration, elapsedSeconds,
    actualStart:result.actualStart ?? task.start, targetBytes:task.sizePlan?.targetBytes ?? null,
    withinBudget, suggestedVideoRate, verified:result.verified ?? null,
    note:'体积预算与片段外推均不保证整片大小或主观画质；超出预算不会删除完整成品。'};
}
export function sampleProjection(bytes, sampleDuration, fullDuration) {
  if (!(bytes > 0 && sampleDuration > 0 && fullDuration > 0)) return null;
  return bytes / sampleDuration * fullDuration;
}
