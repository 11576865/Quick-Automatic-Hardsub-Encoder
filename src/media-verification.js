export function verificationDuration(task, completed) {
  const output = Number(completed?.outputDuration);
  if (Number.isFinite(output) && output > 0) return output;
  const expected = Number(task?.expectedDuration);
  return Number.isFinite(expected) && expected > 0 ? expected : 0;
}

export function verificationSourceTime(task, completed, outputTime) {
  const start = Number(completed?.actualStart ?? task?.start ?? 0);
  const duration = verificationDuration(task, completed);
  const t = Math.max(0, Math.min(duration || Infinity, Number(outputTime) || 0));
  return Math.max(0, start + t);
}

export function verificationHasSpatialTransforms(task) {
  return !!(
    task?.crop ||
    task?.width ||
    task?.height ||
    (task?.rotation && task.rotation !== 'none') ||
    task?.squarePixels ||
    task?.deinterlace && task.deinterlace !== 'none' ||
    task?.denoise ||
    task?.deband ||
    task?.sharpen
  );
}
