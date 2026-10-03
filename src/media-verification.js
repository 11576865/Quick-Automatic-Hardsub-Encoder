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


const trimNumeric = value => {
  const text = Number(value || 0).toFixed(6);
  return text.replace(/(?:\.0+|(?<=\.[0-9]*?)0+)$/, '').replace(/\.$/, '') || '0';
};

export function hardsubReferenceFilter(task, sourceTime, assPath = '__ASS__', fontsDir = '__FONTS__', displayWidth = 0) {
  if (task?.operation !== 'hardsub') throw new Error('硬字幕参考帧要求 hardsub 任务');
  const args = Array.isArray(task?.outputArgs) ? task.outputArgs : [];
  const vfIndex = args.indexOf('-vf');
  if (vfIndex < 0 || !args[vfIndex + 1]) throw new Error('硬字幕任务缺少视频滤镜链');

  const absolute = trimNumeric(Math.max(0, Number(sourceTime) || 0));
  const rawParts = String(args[vfIndex + 1]).split(',');
  const output = [];
  let foundAss = false;

  for (const raw of rawParts) {
    const part = raw.trim();
    if (/^setpts=PTS[+-]\d+(?:\.\d+)?\/TB$/.test(part)) continue;
    if (part === 'ass=__ASS__:fontsdir=__FONTS__') {
      foundAss = true;
      output.push(
        `setpts=PTS-STARTPTS+${absolute}/TB`,
        `ass=${assPath}:fontsdir=${fontsDir}`,
        'setpts=PTS-STARTPTS'
      );
      continue;
    }
    output.push(part);
  }

  if (!foundAss) throw new Error('硬字幕任务滤镜链缺少权威 ASS 渲染步骤');
  const width = Math.max(0, Math.floor(Number(displayWidth) || 0));
  if (width > 0) output.push(`scale=${width}:-2:force_original_aspect_ratio=decrease`);
  return output.join(',');
}
