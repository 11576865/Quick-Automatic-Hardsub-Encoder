import { CURVE_CHART_LAYOUT } from './curve-chart-svg.js';

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function targetBytesAtEvidenceFraction(frontier, fraction) {
  const min = finite(frontier?.minimumEvidenceTargetBytes);
  const max = finite(frontier?.maximumEvidenceTargetBytes);
  const t = clamp(finite(fraction, 0), 0, 1);
  if (!(min > 0) || !(max >= min)) return null;
  if (min === max) return min;
  const lo = Math.log(min);
  const hi = Math.log(max);
  return Math.exp(lo + (hi - lo) * t);
}

export function evidenceFractionForTargetBytes(frontier, targetBytes) {
  const min = finite(frontier?.minimumEvidenceTargetBytes);
  const max = finite(frontier?.maximumEvidenceTargetBytes);
  const bytes = finite(targetBytes);
  if (!(min > 0) || !(max >= min) || !(bytes > 0)) return null;
  if (bytes < min || bytes > max) return null;
  if (min === max) return 0;
  return (Math.log(bytes) - Math.log(min)) / (Math.log(max) - Math.log(min));
}

function pathFor(points, key) {
  return points
    .map((point, index) => (index ? 'L' : 'M') + point.x.toFixed(2) + ' ' + point[key].toFixed(2))
    .join(' ');
}

export function buildSizeFrontierPlot(frontier, {
  width = CURVE_CHART_LAYOUT.width,
  height = CURVE_CHART_LAYOUT.height,
  paddingX = CURVE_CHART_LAYOUT.paddingX,
  paddingY = CURVE_CHART_LAYOUT.paddingY,
  sampleCount = 72,
  selectedTargetBytes = null
} = {}) {
  if (!frontier?.ok) return { ok: false, reason: 'invalid-frontier' };
  const curve = frontier.sampleCurve(sampleCount);
  if (!curve.length) return { ok: false, reason: 'empty-frontier' };

  const minBytes = finite(frontier.minimumEvidenceTargetBytes);
  const maxBytes = finite(frontier.maximumEvidenceTargetBytes);
  if (!(minBytes > 0) || !(maxBytes > minBytes)) {
    return { ok: false, reason: 'invalid-evidence-domain' };
  }

  const qualityValues = [...curve, ...(frontier.evidencePoints || [])].flatMap(point => [
    finite(point.lowerQuality, point.quality),
    finite(point.quality),
    finite(point.upperQuality, point.quality)
  ]).filter(Number.isFinite);
  const rawMinQuality = Math.min(...qualityValues);
  const rawMaxQuality = Math.max(...qualityValues);
  const rawSpan = Math.max(0.002, rawMaxQuality - rawMinQuality);
  const qualityMin = clamp(rawMinQuality - rawSpan * 0.14, 0, 1);
  const qualityMax = clamp(rawMaxQuality + rawSpan * 0.14, 0, 1);
  const qualitySpan = Math.max(1e-9, qualityMax - qualityMin);
  const innerWidth = Math.max(1, width - paddingX * 2);
  const innerHeight = Math.max(1, height - paddingY * 2);

  const xForBytes = bytes => {
    const fraction = evidenceFractionForTargetBytes(frontier, bytes);
    if (fraction === null) return null;
    return paddingX + fraction * innerWidth;
  };
  const yForQuality = quality =>
    paddingY + (1 - (clamp(quality, qualityMin, qualityMax) - qualityMin) / qualitySpan) * innerHeight;

  const points = curve.map(point => ({
    ...point,
    x: xForBytes(point.targetBytes),
    y: yForQuality(point.quality),
    lowerY: yForQuality(point.lowerQuality),
    upperY: yForQuality(point.upperQuality)
  }));

  const upper = points.map(point => point.x.toFixed(2) + ' ' + point.upperY.toFixed(2));
  const lower = [...points].reverse().map(point => point.x.toFixed(2) + ' ' + point.lowerY.toFixed(2));
  const bandPath = upper.length
    ? 'M' + upper[0] + upper.slice(1).map(value => ' L' + value).join('') +
      lower.map(value => ' L' + value).join('') + ' Z'
    : '';

  const evidencePoints = (frontier.evidencePoints || [])
    .map(point => ({
      ...point,
      x: xForBytes(point.targetBytes),
      y: yForQuality(point.quality),
      lowerY: yForQuality(point.lowerQuality),
      upperY: yForQuality(point.upperQuality)
    }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));

  const knee = frontier.knee && xForBytes(frontier.knee.targetBytes) !== null
    ? {
        ...frontier.knee,
        x: xForBytes(frontier.knee.targetBytes),
        y: yForQuality(frontier.knee.quality)
      }
    : null;

  const selectedEvaluation = frontier.evaluateTargetBytes(selectedTargetBytes);
  const selected = selectedEvaluation?.status === 'within-evidence'
    ? {
        targetBytes: selectedEvaluation.targetBytes,
        videoBitrate: selectedEvaluation.videoBitrate,
        ...selectedEvaluation.prediction,
        x: xForBytes(selectedEvaluation.targetBytes),
        y: yForQuality(selectedEvaluation.prediction.quality)
      }
    : null;

  return {
    ok: true,
    width,
    height,
    paddingX,
    paddingY,
    qualityMin,
    qualityMax,
    minBytes,
    maxBytes,
    curvePath: pathFor(points, 'y'),
    bandPath,
    points,
    evidencePoints,
    knee,
    selected,
    selectedStatus: selectedEvaluation?.status || 'invalid'
  };
}
