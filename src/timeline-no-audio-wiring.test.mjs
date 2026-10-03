import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('source timeline remains usable when waveform audio is absent', async () => {
  const [workspace, main] = await Promise.all([
    readFile(new URL('./media-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
  ]);

  assert.match(workspace, /allowNoWaveform:true/);
  assert.match(workspace, /无音频波形 · 时间范围仍可用/);
  assert.match(workspace, /时间范围与画面预览仍可使用/);
  assert.match(workspace, /纯视频转码分支：时间轴用于选择源素材的转码范围与定位源帧；不是转码前后质量对比/);

  assert.match(main, /const allowNoWaveform = !!options\?\.allowNoWaveform/);
  assert.match(main, /const emptyTimeline = \(duration, error = '当前视频没有音频轨'\)/);
  assert.match(main, /if \(allowNoWaveform\) return emptyTimeline\(duration\)/);
  assert.match(main, /if \(allowNoWaveform && !includeKeyframes\) return emptyTimeline\(duration,/);
});
