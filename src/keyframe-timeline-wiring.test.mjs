import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('keyframe-aware trim timeline is wired across Web, Windows Native and Android Native', async () => {
  const [workspace, main, engine, windows, android] = await Promise.all([
    readFile(new URL('./media-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./engine.js', import.meta.url), 'utf8'),
    readFile(new URL('../windows/native-bridge.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../android-native/app/src/main/java/io/github/quickhardsub/NativeBridge.kt', import.meta.url), 'utf8'),
  ]);

  assert.match(workspace, /includeKeyframes:copy/);
  assert.match(workspace, /id="taskWaveformActualStart"/);
  assert.match(workspace, /将 IN 对齐关键帧/);
  assert.match(workspace, /实际无损起点/);

  assert.match(main, /includeKeyframes,s*maxKeyframes/);
  assert.match(engine, /async listKeyframes\(options = \{\}\)/);
  assert.match(engine, /-skip_frame nokey/);
  assert.match(engine, /keyframesTruncated/);

  assert.match(windows, /\$includeKeyframes = \[bool\]\$Body\.includeKeyframes/);
  assert.match(windows, /-skip_frame nokey -show_frames/);
  assert.match(windows, /keyframes=@\(\$keyframes\)/);

  assert.match(android, /val includeKeyframes = options\.optBoolean\("includeKeyframes", false\)/);
  assert.match(android, /"-skip_frame", "nokey"/);
  assert.match(android, /\.put\("keyframes", keyframes\)/);
});
