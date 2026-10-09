import { fitRateDistortionModel, createSizeQualityFrontier } from './rate-distortion-model.js';
import { buildSizeFrontierPlot } from './size-frontier-ui.js';

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// Separate positions across the selected clip: these are time-spaced probes,
// not a claim that the content is statistically representative.
export const CALIBRATION_PROFILES = Object.freeze({
  quick: Object.freeze({ count: 3, seconds: 2, label: '快速 · 3 处 × 2 秒' }),
  balanced: Object.freeze({ count: 5, seconds: 4, label: '均衡 · 5 处 × 4 秒' }),
  thorough: Object.freeze({ count: 7, seconds: 6, label: '深入 · 7 处 × 6 秒' })
});

export function calibrationSampleStarts(start, end, seconds = 2, requestedCount = 3) {
  const a = finite(start), b = finite(end), duration = finite(seconds);
  if (a === null || b === null || duration === null || a < 0 || b - a < duration || duration <= 0) return [];
  const requested = Number.isSafeInteger(Number(requestedCount)) ? Number(requestedCount) : 3;
  if (requested < 1 || requested > 15) return [];
  // Non-overlapping windows. For short clips, reduce the count rather than
  // repeatedly testing the same frames and inflating our evidence count.
  const count = Math.min(requested, Math.floor((b - a + 1e-8) / duration));
  return Array.from({ length: count }, (_, i) => a + ((i + 0.5) * (b - a) / count) - duration / 2);
}

export function summarizeCalibrationEvidence(points) {
  if (!Array.isArray(points) || !points.length) return null;
  const latest = points.at(-1);
  const samples = Array.isArray(latest.sampleMeasurements) ? latest.sampleMeasurements : [];
  const rates = samples.map(s => Number(s.bitrate)).filter(v => Number.isFinite(v) && v > 0);
  const qualities = samples.map(s => Number(s.ssim)).filter(v => Number.isFinite(v) && v >= 0 && v <= 1);
  if (!rates.length || rates.length !== samples.length || qualities.length !== samples.length) return null;
  const rateMin = Math.min(...rates), rateMax = Math.max(...rates);
  const worstSsim = Math.min(...qualities), bestSsim = Math.max(...qualities);
  return {
    sampleCount: samples.length,
    minBitrate: rateMin, maxBitrate: rateMax,
    bitrateSpread: rateMax / rateMin,
    worstSsim, bestSsim,
    ssimSpread: bestSsim - worstSsim,
    widelyDivergent: rateMax / rateMin >= 2 || bestSsim - worstSsim > 0.02
  };
}

// Search order is preserved separately from the quality-sorted rate/distortion
// evidence. Endpoints establish the sampled range; midpoint trials converge on
// the last setting meeting the minimum (worst-segment) SSIM threshold.
export async function exploreQuality({
  minQuality, maxQuality, targetSsim, evaluate, onPoint = () => {}, maxEvaluations = 7
}) {
  const lo = Math.ceil(Number(minQuality)), hi = Math.floor(Number(maxQuality));
  const target = Number(targetSsim);
  if (!(lo >= 0 && hi > lo && hi <= 63 && target > 0 && target < 1)) throw Error('无效的质量搜索范围或目标 SSIM');
  if (typeof evaluate !== 'function') throw Error('缺少真实测试片段评估函数');
  const points = [], cache = new Map();
  const test = async (q, lower, upper) => {
    if (cache.has(q)) return cache.get(q);
    const raw = await evaluate(q);
    const bitrate = Number(raw?.sampleBitrate), ssim = Number(raw?.ssim);
    const average = Number(raw?.averageSsim ?? ssim);
    if (!(bitrate > 0) || !(ssim >= 0 && ssim <= 1) || !(average >= 0 && average <= 1))
      throw Error('测试片段缺少有效码率或 SSIM，无法绘制实测曲线');
    const point = {
      ...raw, qualitySetting: q, sampleBitrate: bitrate,
      ssim, averageSsim: average, iteration: points.length + 1,
      searchLower: lower, searchUpper: upper,
      meetsTarget: ssim >= target
    };
    cache.set(q, point);
    points.push(point);
    onPoint(point, [...points]);
    return point;
  };
  await test(lo, lo, hi);
  if (points.length < maxEvaluations) await test(hi, lo, hi);
  let lower = lo, upper = hi;
  while (points.length < maxEvaluations && lower <= upper) {
    const mid = Math.floor((lower + upper) / 2);
    if (cache.has(mid)) {
      const existing = cache.get(mid);
      if (existing.meetsTarget) lower = mid + 1;
      else upper = mid - 1;
      continue;
    }
    const point = await test(mid, lower, upper);
    if (point.meetsTarget) lower = mid + 1;
    else upper = mid - 1;
  }
  const passing = points.filter(p => p.meetsTarget);
  const best = passing.length ? passing.reduce((a, b) => a.qualitySetting > b.qualitySetting ? a : b) : null;
  return {
    points, best, meetsTarget: !!best,
    model: fitRateDistortionModel(points),
    evaluatedCount: points.length,
    targetSsim: target,
    searchExhausted: lower > upper
  };
}

export function createMeasuredSizeFrontier(points, {
  durationSeconds, audioBitrate = 0, reservePercent = 4
} = {}) {
  const model = fitRateDistortionModel(points);
  if (!model.ok) return { ok:false, reason:model.reason, model };
  const frontier = createSizeQualityFrontier(model, { durationSeconds, audioBitrate, reservePercent });
  if (!frontier.ok) return { ...frontier, model };
  return { ...frontier, model, plot: buildSizeFrontierPlot(frontier) };
}

export function buildExplorationPlot(points, targetSsim, {
  width = 720, height = 220, padding = 32
} = {}) {
  if (!Array.isArray(points) || !points.length) return { ok: false, reason: 'no-measurements' };
  const valid = points.filter(p => Number.isFinite(Number(p.ssim)) && Number.isFinite(Number(p.qualitySetting)));
  if (!valid.length) return { ok: false, reason: 'invalid-measurements' };
  const quality = valid.map(p => Number(p.ssim));
  const target = Number(targetSsim);
  const min = clamp(Math.min(...quality, target) - 0.005, 0, 1);
  const max = clamp(Math.max(...quality, target) + 0.005, 0, 1);
  const span = Math.max(0.000001, max - min);
  const innerWidth = width - padding * 2, innerHeight = height - padding * 2;
  const measured = valid.map((p, i) => ({
    ...p,
    x: padding + (valid.length === 1 ? innerWidth / 2 : i * innerWidth / (valid.length - 1)),
    y: padding + innerHeight * (1 - (Number(p.ssim) - min) / span)
  }));
  const targetY = padding + innerHeight * (1 - (target - min) / span);
  const line = measured.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' ');
  return { ok: true, width, height, measured, line, targetY, min, max };
}
