import { targetBytesForVideoBitrate } from './rate-distortion-model.js';

// Capacity feasibility under the *guided planner's* audio/reserve assumptions.
// This is not a promise of perceptual quality or an exact encoder output size.
export function assessGuidedBudget({
  targetBytes, durationSeconds, audioBitrate = 0,
  reservePercent = 4, containerReservePercent = 1,
  fixedReserveBytes = 256 * 1024, minimumVideoBitrate = 150001
} = {}) {
  const valid = [durationSeconds, audioBitrate, reservePercent, containerReservePercent,
    fixedReserveBytes, minimumVideoBitrate].every(value => typeof value === 'number' && Number.isFinite(value)) &&
    Number.isSafeInteger(targetBytes) && targetBytes > 0 && durationSeconds > 0 &&
    audioBitrate >= 0 && reservePercent >= 0 && reservePercent < 100 &&
    containerReservePercent >= 0 && containerReservePercent < 100 &&
    fixedReserveBytes >= 0 && Number.isSafeInteger(minimumVideoBitrate) && minimumVideoBitrate > 0;
  if (!valid) return { status: 'invalid' };
  const availableRate = bytes => {
    const safeBytes = Math.floor(bytes * (1 - reservePercent / 100));
    const containerBytes = Math.max(fixedReserveBytes, Math.floor(safeBytes * containerReservePercent / 100));
    return Math.floor((safeBytes - containerBytes) * 8 / durationSeconds - audioBitrate);
  };
  const estimatedMinimum = targetBytesForVideoBitrate(minimumVideoBitrate, {
    durationSeconds, audioBitrate, reservePercent,
    containerReservePercent, fixedReserveBytes
  });
  if (!Number.isFinite(estimatedMinimum) || estimatedMinimum > Number.MAX_SAFE_INTEGER / 2) {
    return { status: 'invalid' };
  }
  // Invert the actual floor-based planner, not just the continuous formula:
  // even a one-byte shortfall must never be labelled mathematically feasible.
  let low = 0;
  let high = Math.max(1, Math.ceil(estimatedMinimum));
  while (availableRate(high) < minimumVideoBitrate) {
    high = Math.ceil(high * 1.5) + 1;
    if (!Number.isSafeInteger(high)) return { status: 'invalid' };
  }
  while (high - low > 1) {
    const mid = low + Math.floor((high - low) / 2);
    if (availableRate(mid) >= minimumVideoBitrate) high = mid;
    else low = mid;
  }
  const availableVideoBitrate = availableRate(targetBytes);
  return {
    status: availableVideoBitrate >= minimumVideoBitrate ? 'feasible' : 'infeasible',
    targetBytes, minimumTargetBytes: high,
    shortfallBytes: Math.max(0, high - targetBytes),
    availableVideoBitrate, minimumVideoBitrate,
    audioPayloadBytes: Math.ceil(audioBitrate * durationSeconds / 8),
    fixedReserveBytes
  };
}

// One user-visible execution policy. A size target is not automatically a hard byte ceiling.
export const GUIDED_SIZE_POLICIES=Object.freeze(['best-effort','two-pass','strict-ceiling']);
export function resolveGuidedSizePolicy({mode,codec,backend,policy='best-effort',ceilingBytes=0}={}){
  if(mode!=='budget-rate')return {ok:policy==='best-effort',reason:policy==='best-effort'?null:'not-a-budget-job',policy:'best-effort',twoPass:false,strict:false};
  if(!GUIDED_SIZE_POLICIES.includes(policy))return {ok:false,reason:'unknown-policy'};
  const software=policy!=='best-effort';
  if(software&&(codec!=='h264'||backend!=='windows-native'))
    return {ok:false,reason:'software-h264-windows-only',policy};
  if(policy==='strict-ceiling'&&!(Number.isSafeInteger(ceilingBytes)&&ceilingBytes>0))
    return {ok:false,reason:'missing-byte-ceiling',policy};
  return {ok:true,policy,twoPass:software,strict:policy==='strict-ceiling',
    softwareEncoder:software?'libx264':null};
}
