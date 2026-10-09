function finite(value, fallback = null) {
  // Missing, blank and boolean values are not valid numerical observations.
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && !value.trim()) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function qualityFromPoint(point) {
  const average = finite(point?.quality ?? point?.averageSsim);
  const conservative = finite(point?.lowerQuality ?? point?.ssim ?? average);
  const samples = Array.isArray(point?.sampleMeasurements) ? point.sampleMeasurements : [];
  const sampleQualities = samples
    .map(sample => finite(sample?.ssim))
    .filter(Number.isFinite);
  const upper = finite(
    point?.upperQuality,
    sampleQualities.length ? Math.max(...sampleQualities) : average
  );

  if (!Number.isFinite(average) && !Number.isFinite(conservative)) return null;
  const center = clamp01(Number.isFinite(average) ? average : conservative);
  const low = clamp01(Number.isFinite(conservative) ? conservative : center);
  const high = clamp01(Number.isFinite(upper) ? upper : center);
  return {
    center,
    low: Math.min(low, center),
    high: Math.max(high, center)
  };
}

function pointWeight(point) {
  const weight = finite(point?.sampleCount, 1);
  return weight > 0 ? weight : 1;
}

function weightedMean(items, key) {
  let numerator = 0;
  let denominator = 0;
  for (const item of items) {
    const value = finite(item[key]);
    const weight = pointWeight(item);
    if (!Number.isFinite(value)) continue;
    numerator += value * weight;
    denominator += weight;
  }
  return denominator > 0 ? numerator / denominator : null;
}

function collapseDuplicateRates(points) {
  const groups = new Map();
  for (const point of points) {
    const bitrate = finite(point?.sampleBitrate ?? point?.bitrate);
    const quality = qualityFromPoint(point);
    if (!(bitrate > 0) || !quality) continue;

    const key = Math.round(bitrate);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      ...point,
      bitrate,
      center: quality.center,
      low: quality.low,
      high: quality.high
    });
  }

  return [...groups.values()]
    .map(group => {
      const bitrate = weightedMean(group, 'bitrate');
      const center = weightedMean(group, 'center');
      const lowValues = group.map(item => item.low).filter(Number.isFinite);
      const highValues = group.map(item => item.high).filter(Number.isFinite);
      return {
        bitrate,
        logBitrate: Math.log(bitrate),
        quality: center,
        lowerQuality: lowValues.length ? Math.min(...lowValues) : center,
        upperQuality: highValues.length ? Math.max(...highValues) : center,
        sampleCount: group.reduce((sum, item) => sum + pointWeight(item), 0),
        evidenceCount: group.length,
        sourcePoints: group
      };
    })
    .filter(point => point.bitrate > 0 && Number.isFinite(point.quality))
    .sort((a, b) => a.bitrate - b.bitrate);
}

function isotonicNonDecreasing(values, weights) {
  const blocks = [];
  for (let i = 0; i < values.length; i++) {
    const value = finite(values[i]);
    if (!Number.isFinite(value)) throw new Error('Isotonic input contains a non-finite value.');
    const weight = Math.max(1e-9, finite(weights?.[i], 1));
    blocks.push({ start: i, end: i, weight, mean: value });

    while (blocks.length >= 2) {
      const right = blocks[blocks.length - 1];
      const left = blocks[blocks.length - 2];
      if (left.mean <= right.mean) break;
      const mergedWeight = left.weight + right.weight;
      blocks.splice(blocks.length - 2, 2, {
        start: left.start,
        end: right.end,
        weight: mergedWeight,
        mean: (left.mean * left.weight + right.mean * right.weight) / mergedWeight
      });
    }
  }

  const result = new Array(values.length);
  for (const block of blocks) {
    for (let i = block.start; i <= block.end; i++) result[i] = block.mean;
  }
  return result;
}

function interpolateLogDomain(points, bitrate, key) {
  if (!(bitrate > 0) || points.length === 0) return null;
  if (bitrate < points[0].bitrate || bitrate > points.at(-1).bitrate) return null;
  if (points.length === 1) return points[0][key];

  const x = Math.log(bitrate);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (bitrate < a.bitrate || bitrate > b.bitrate) continue;
    if (b.logBitrate === a.logBitrate) return a[key];
    const t = (x - a.logBitrate) / (b.logBitrate - a.logBitrate);
    return a[key] + (b[key] - a[key]) * t;
  }
  return points.at(-1)[key];
}

function logSpaced(min, max, count) {
  if (!(min > 0) || !(max >= min)) return [];
  if (count <= 1 || min === max) return [min];
  const lo = Math.log(min);
  const hi = Math.log(max);
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return min;
    if (index === count - 1) return max;
    return Math.exp(lo + (hi - lo) * index / (count - 1));
  });
}

export function fitRateDistortionModel(rawPoints, options = {}) {
  const collapsed = collapseDuplicateRates(Array.isArray(rawPoints) ? rawPoints : []);
  if (collapsed.length < 2) {
    return {
      ok: false,
      reason: 'insufficient-evidence',
      points: collapsed,
      minimumPoints: 2
    };
  }

  const weights = collapsed.map(point => Math.max(1, point.sampleCount));
  const centerFit = isotonicNonDecreasing(collapsed.map(point => point.quality), weights);
  const lowerFit = isotonicNonDecreasing(collapsed.map(point => point.lowerQuality), weights);
  const upperFit = isotonicNonDecreasing(collapsed.map(point => point.upperQuality), weights);

  const points = collapsed.map((point, index) => {
    const quality = clamp01(centerFit[index]);
    return {
      ...point,
      observedQuality: point.quality,
      observedLowerQuality: point.lowerQuality,
      observedUpperQuality: point.upperQuality,
      quality,
      lowerQuality: Math.min(quality, clamp01(lowerFit[index])),
      upperQuality: Math.max(quality, clamp01(upperFit[index]))
    };
  });

  const minBitrate = points[0].bitrate;
  const maxBitrate = points.at(-1).bitrate;
  const metric = options.metric || 'ssim';

  const predictAtBitrate = bitrate => {
    const rate = finite(bitrate);
    if (!(rate > 0) || rate < minBitrate || rate > maxBitrate) return null;
    const quality = interpolateLogDomain(points, rate, 'quality');
    const lowerQuality = interpolateLogDomain(points, rate, 'lowerQuality');
    const upperQuality = interpolateLogDomain(points, rate, 'upperQuality');
    return {
      metric,
      bitrate: rate,
      quality,
      lowerQuality: Math.min(quality, lowerQuality),
      upperQuality: Math.max(quality, upperQuality),
      withinEvidence: true
    };
  };

  const sampleCurve = (count = 64) =>
    logSpaced(minBitrate, maxBitrate, Math.max(2, Math.round(count)))
      .map(predictAtBitrate)
      .filter(Boolean);

  const estimateKnee = () => {
    if (points.length < 3) return null;
    const qMin = points[0].quality;
    const qMax = points.at(-1).quality;
    const qSpan = qMax - qMin;
    const xMin = Math.log(minBitrate);
    const xMax = Math.log(maxBitrate);
    const xSpan = xMax - xMin;
    if (!(qSpan > 1e-6) || !(xSpan > 0)) return null;

    let best = null;
    for (const point of points.slice(1, -1)) {
      const xNorm = (point.logBitrate - xMin) / xSpan;
      const qNorm = (point.quality - qMin) / qSpan;
      const strength = qNorm - xNorm;
      if (!best || strength > best.strength) {
        best = {
          bitrate: point.bitrate,
          quality: point.quality,
          lowerQuality: point.lowerQuality,
          upperQuality: point.upperQuality,
          strength
        };
      }
    }
    return best && best.strength > 0 ? best : null;
  };

  const marginalQualityPerDoubling = bitrate => {
    const rate = finite(bitrate);
    if (!(rate > 0) || rate < minBitrate || rate > maxBitrate) return null;
    const half = Math.max(minBitrate, rate / Math.sqrt(2));
    const twice = Math.min(maxBitrate, rate * Math.sqrt(2));
    if (twice <= half) return 0;
    const left = predictAtBitrate(half);
    const right = predictAtBitrate(twice);
    if (!left || !right) return null;
    const octaves = Math.log2(twice / half);
    return octaves > 0 ? (right.quality - left.quality) / octaves : 0;
  };

  return {
    ok: true,
    metric,
    points,
    minBitrate,
    maxBitrate,
    predictAtBitrate,
    sampleCurve,
    estimateKnee,
    marginalQualityPerDoubling
  };
}

function normalizeBudgetOptions({
  durationSeconds,
  audioBitrate = 0,
  reservePercent = 4,
  containerReservePercent = 0,
  fixedReserveBytes = 0
} = {}) {
  const duration = finite(durationSeconds);
  const audio = finite(audioBitrate, 0);
  const reserve = finite(reservePercent, 4);
  const containerReserve = finite(containerReservePercent, 0);
  const fixedReserve = finite(fixedReserveBytes, 0);
  if (
    !(duration > 0) ||
    !(audio >= 0) ||
    !(reserve >= 0 && reserve < 100) ||
    !(containerReserve >= 0 && containerReserve < 100) ||
    !(fixedReserve >= 0)
  ) return null;
  return {
    duration,
    audio,
    reserveFraction: reserve / 100,
    containerReserveFraction: containerReserve / 100,
    fixedReserve
  };
}

export function targetBytesForVideoBitrate(videoBitrate, options = {}) {
  const video = finite(videoBitrate);
  const budget = normalizeBudgetOptions(options);
  if (!(video >= 0) || !budget) return null;

  const payloadBytes = (video + budget.audio) * budget.duration / 8;
  const percentPayloadFraction = 1 - budget.containerReserveFraction;
  if (!(percentPayloadFraction > 0)) return null;

  const safeBudgetIfPercentReserve = payloadBytes / percentPayloadFraction;
  const percentReserveBytes = safeBudgetIfPercentReserve * budget.containerReserveFraction;
  const safeBudgetBytes = percentReserveBytes >= budget.fixedReserve
    ? safeBudgetIfPercentReserve
    : payloadBytes + budget.fixedReserve;
  return safeBudgetBytes / (1 - budget.reserveFraction);
}

export function videoBitrateForTargetBytes(targetBytes, options = {}) {
  const bytes = finite(targetBytes);
  const budget = normalizeBudgetOptions(options);
  if (!(bytes > 0) || !budget) return null;

  const safeBudgetBytes = bytes * (1 - budget.reserveFraction);
  const containerReserveBytes = Math.max(
    budget.fixedReserve,
    safeBudgetBytes * budget.containerReserveFraction
  );
  const payloadBytes = safeBudgetBytes - containerReserveBytes;
  if (!(payloadBytes >= 0)) return -budget.audio;
  return payloadBytes * 8 / budget.duration - budget.audio;
}

export function createSizeQualityFrontier(model, {
  durationSeconds,
  audioBitrate = 0,
  reservePercent = 4,
  containerReservePercent = 0,
  fixedReserveBytes = 0,
  minimumVideoBitrate = 1000
} = {}) {
  if (!model?.ok) {
    return { ok: false, reason: 'invalid-rate-distortion-model' };
  }

  const duration = finite(durationSeconds);
  const audio = finite(audioBitrate, 0);
  const reserve = finite(reservePercent, 4);
  const containerReserve = finite(containerReservePercent, 0);
  const fixedReserve = finite(fixedReserveBytes, 0);
  const minimumVideo = Math.max(0, finite(minimumVideoBitrate, 1000));
  const budget = {
    durationSeconds: duration,
    audioBitrate: audio,
    reservePercent: reserve,
    containerReservePercent: containerReserve,
    fixedReserveBytes: fixedReserve
  };
  if (!normalizeBudgetOptions(budget)) {
    return { ok: false, reason: 'invalid-size-budget' };
  }
  if (model.maxBitrate < minimumVideo) {
    return { ok: false, reason: 'evidence-below-minimum-video-bitrate' };
  }
  const minimumEvidenceBitrate = Math.max(model.minBitrate, minimumVideo);
  const minimumFeasibleTargetBytes = targetBytesForVideoBitrate(minimumVideo, budget);
  const minimumEvidenceTargetBytes = targetBytesForVideoBitrate(minimumEvidenceBitrate, budget);
  const maximumEvidenceTargetBytes = targetBytesForVideoBitrate(model.maxBitrate, budget);

  const evaluateTargetBytes = targetBytes => {
    const bytes = finite(targetBytes);
    const videoBitrate = videoBitrateForTargetBytes(bytes, budget);
    if (!(bytes > 0) || !Number.isFinite(videoBitrate)) {
      return { status: 'invalid', targetBytes: bytes, videoBitrate: null, prediction: null };
    }
    if (videoBitrate < minimumVideo) {
      return { status: 'impossible', targetBytes: bytes, videoBitrate, prediction: null };
    }
    if (videoBitrate < model.minBitrate) {
      return { status: 'below-evidence', targetBytes: bytes, videoBitrate, prediction: null };
    }
    if (videoBitrate > model.maxBitrate) {
      return { status: 'above-evidence', targetBytes: bytes, videoBitrate, prediction: null };
    }
    return {
      status: 'within-evidence',
      targetBytes: bytes,
      videoBitrate,
      prediction: model.predictAtBitrate(videoBitrate)
    };
  };

  const sampleCurve = (count = 64) =>
    logSpaced(
      minimumEvidenceBitrate,
      model.maxBitrate,
      Math.max(2, Math.round(count))
    )
      .map(model.predictAtBitrate)
      .filter(Boolean)
      .map(point => ({
        ...point,
        targetBytes: targetBytesForVideoBitrate(point.bitrate, budget)
      }));

  const rawKnee = model.estimateKnee();
  const knee = rawKnee && rawKnee.bitrate >= minimumEvidenceBitrate
    ? rawKnee
    : null;
  const kneeTargetBytes = knee
    ? targetBytesForVideoBitrate(knee.bitrate, budget)
    : null;

  return {
    ok: true,
    durationSeconds: duration,
    audioBitrate: audio,
    reservePercent: reserve,
    containerReservePercent: containerReserve,
    fixedReserveBytes: fixedReserve,
    minimumVideoBitrate: minimumVideo,
    minimumEvidenceBitrate,
    minimumFeasibleTargetBytes,
    minimumEvidenceTargetBytes,
    maximumEvidenceTargetBytes,
    knee: knee ? { ...knee, targetBytes: kneeTargetBytes } : null,
    evidencePoints: model.points
      .filter(point => point.bitrate >= minimumEvidenceBitrate)
      .map(point => ({
        ...point,
        fittedQuality: point.quality,
        quality: point.observedQuality ?? point.quality,
        lowerQuality: point.observedLowerQuality ?? point.lowerQuality,
        upperQuality: point.observedUpperQuality ?? point.upperQuality,
        targetBytes: targetBytesForVideoBitrate(point.bitrate, budget)
      })),
    evaluateTargetBytes,
    sampleCurve
  };
}
