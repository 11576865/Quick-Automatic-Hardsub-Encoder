import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileTask, taskInputArgs, taskDurationArgs } from './media-task.js';

const enabled = process.env.FFMPEG_INTEGRATION === '1';
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });

function av1SourceEncoder() {
  const encoders = run('ffmpeg', ['-hide_banner', '-encoders']);
  if (/\blibaom-av1\b/.test(encoders)) {
    return ['-c:v', 'libaom-av1', '-cpu-used', '8', '-row-mt', '1', '-crf', '46'];
  }
  if (/\blibsvtav1\b/.test(encoders)) {
    return ['-c:v', 'libsvtav1', '-preset', '13', '-crf', '46'];
  }
  throw new Error('Hosted FFmpeg exposes neither libaom-av1 nor libsvtav1; AV1+ALAC acceptance cannot run.');
}

function streamHashes(file, selector) {
  const info = JSON.parse(run('ffprobe', [
    '-v', 'error',
    '-select_streams', selector,
    '-show_packets',
    '-show_data_hash', 'sha256',
    '-show_entries', 'packet=data_hash',
    '-of', 'json',
    file
  ]));
  return (info.packets || []).map(packet => packet.data_hash).filter(Boolean);
}

test('real AV1+ALAC MKV acceptance matrix covers copy and hardsub AAC paths', { skip: !enabled }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'av1-alac-acceptance-'));
  try {
    const source = join(dir, 'source-av1-alac.mkv');
    run('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=96x54:rate=12',
      '-f', 'lavfi', '-i', 'sine=frequency=523.25:sample_rate=48000',
      '-t', '2',
      '-map', '0:v:0', '-map', '1:a:0',
      ...av1SourceEncoder(),
      '-g', '12',
      '-c:a', 'alac',
      '-shortest',
      source
    ]);

    const sourceInfo = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source]));
    const sourceVideo = sourceInfo.streams.find(stream => stream.codec_type === 'video');
    const sourceAudio = sourceInfo.streams.find(stream => stream.codec_type === 'audio');
    assert.equal(sourceVideo?.codec_name, 'av1');
    assert.equal(sourceAudio?.codec_name, 'alac');
    assert.match(String(sourceInfo.format?.format_name || ''), /matroska/);

    const media = {
      duration: Number(sourceInfo.format.duration || 2),
      fps: 12,
      audioTracks: 1,
      formatName: sourceInfo.format.format_name,
      sourceName: 'source-av1-alac.mkv',
      videoCodec: 'av1',
      audioCodec: 'alac',
      audioCodecs: ['alac'],
      audioBitRate: Number(sourceAudio?.bit_rate || 0)
    };

    const base = {
      operation: 'transcode',
      codec: 'h264',
      encoder: 'libx264',
      preset: 'ultrafast',
      rateMode: 'quality',
      quality: 28,
      start: 0,
      end: 1.5,
      audio: 'copy',
      audioTrack: 'all',
      fpsMode: 'auto',
      pixelFormat: 'yuv420p',
      scaleAlgorithm: 'lanczos',
      rotation: 'none',
      deinterlace: 'none',
      multipass: 'fullres',
      lookahead: '',
      aqStrength: '',
      outputContainer: 'auto'
    };

    const execute = (task, name) => {
      const output = join(dir, name + '.' + task.outputExtension);
      // Match the real Native executors: ASS/font assets are staged into a
      // per-job working directory and the filter graph receives relative
      // names. This avoids inventing a different escaping contract for raw
      // absolute Windows filter paths.
      const args = task.outputArgs.map(arg => arg.replace('__ASS__', 'subtitle.ass').replace('__FONTS__', 'fonts'));
      run('ffmpeg', [
        '-v', 'error', '-y',
        ...taskInputArgs(task),
        '-i', source,
        ...taskDurationArgs(task),
        ...args,
        '-f', task.outputFormat,
        output
      ], { cwd: dir });
      const info = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]));
      return { output, info };
    };

    const assertCopiedPayloadPrefix = output => {
      for (const selector of ['v:0', 'a:0']) {
        const original = streamHashes(source, selector);
        const copied = streamHashes(output, selector);
        assert.ok(copied.length > 0, selector + ' copy produced no packet hashes');
        assert.deepEqual(
          copied,
          original.slice(0, copied.length),
          selector + ' stream payload changed during nominal stream-copy'
        );
      }
    };

    const autoCopyTask = compileTask({ ...base, operation: 'copy', outputContainer: 'auto' }, media);
    assert.equal(autoCopyTask.outputContainer, 'mkv');
    assert.match(autoCopyTask.containerReason, /保持源容器/);
    const autoCopy = execute(autoCopyTask, 'copy-auto');
    assert.equal(autoCopy.info.streams.find(stream => stream.codec_type === 'video')?.codec_name, 'av1');
    assert.equal(autoCopy.info.streams.find(stream => stream.codec_type === 'audio')?.codec_name, 'alac');
    assert.match(String(autoCopy.info.format?.format_name || ''), /matroska/);
    assertCopiedPayloadPrefix(autoCopy.output);

    const explicitMkvTask = compileTask({ ...base, operation: 'copy', outputContainer: 'mkv' }, media);
    assert.equal(explicitMkvTask.outputContainer, 'mkv');
    const explicitMkv = execute(explicitMkvTask, 'copy-explicit-mkv');
    assert.equal(explicitMkv.info.streams.find(stream => stream.codec_type === 'video')?.codec_name, 'av1');
    assert.equal(explicitMkv.info.streams.find(stream => stream.codec_type === 'audio')?.codec_name, 'alac');
    assertCopiedPayloadPrefix(explicitMkv.output);

    const ass = join(dir, 'subtitle.ass');
    mkdirSync(join(dir, 'fonts'), { recursive: true });
    writeFileSync(ass, [
      '[Script Info]',
      'ScriptType: v4.00+',
      'PlayResX: 96',
      'PlayResY: 54',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Default,DejaVu Sans,11,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,2,2,2,1',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,AV1 ALAC ACCEPTANCE',
      ''
    ].join('\n'));

    const hardMkvTask = compileTask({
      ...base,
      operation: 'hardsub',
      audio: 'aac',
      audioBitrate: 96000,
      audioChannels: 2,
      audioSampleRate: 48000,
      outputContainer: 'mkv'
    }, media);
    assert.equal(hardMkvTask.outputContainer, 'mkv');
    const hardMkv = execute(hardMkvTask, 'hardsub-aac-mkv');
    assert.equal(hardMkv.info.streams.find(stream => stream.codec_type === 'video')?.codec_name, 'h264');
    assert.equal(hardMkv.info.streams.find(stream => stream.codec_type === 'audio')?.codec_name, 'aac');
    assert.match(String(hardMkv.info.format?.format_name || ''), /matroska/);

    const autoAacTask = compileTask({
      ...base,
      operation: 'hardsub',
      audio: 'aac',
      audioBitrate: 96000,
      audioChannels: 2,
      audioSampleRate: 48000,
      outputContainer: 'auto'
    }, media);
    assert.equal(autoAacTask.outputContainer, 'mp4');
    const autoAac = execute(autoAacTask, 'hardsub-aac-auto');
    assert.equal(autoAac.info.streams.find(stream => stream.codec_type === 'video')?.codec_name, 'h264');
    assert.equal(autoAac.info.streams.find(stream => stream.codec_type === 'audio')?.codec_name, 'aac');
    assert.match(String(autoAac.info.format?.format_name || ''), /mp4|mov/);

    const frameHash = file => run('ffmpeg', ['-v', 'error', '-ss', '0.75', '-i', file, '-map', '0:v:0', '-frames:v', '1', '-f', 'md5', '-']);
    const plainTask = compileTask({ ...base, operation: 'transcode', audio: 'aac', audioBitrate: 96000, outputContainer: 'mkv' }, media);
    const plain = execute(plainTask, 'plain-aac-mkv');
    assert.notEqual(frameHash(hardMkv.output), frameHash(plain.output), 'hard-sub path did not alter the decoded frame');

    for (const result of [autoCopy, explicitMkv, hardMkv, autoAac]) {
      run('ffmpeg', ['-v', 'error', '-i', result.output, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-']);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
