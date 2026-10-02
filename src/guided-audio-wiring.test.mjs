import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('guided hard-sub audio policy is wired through every execution backend', async () => {
  const [main, engine, workspace, windows, android] = await Promise.all([
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./engine.js', import.meta.url), 'utf8'),
    readFile(new URL('./media-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../windows/native-bridge.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../android-native/app/src/main/java/io/github/quickhardsub/EncodeService.kt', import.meta.url), 'utf8'),
  ]);

  assert.match(workspace, /select\('audio','音频策略'/);
  assert.match(main, /function guidedHardsubAudioSettings\(\)/);
  assert.match(main, /\.\.\.audioSettings/);
  assert.match(main, /audio:\s*audioSettings\.audio/);
  assert.match(engine, /guidedAudioArgs\.push\('-map','0:a\?','-c:a',guidedAudio\)/);
  assert.match(windows, /\$audioMode=if\(\[string\]\$request\.audio\)/);
  assert.match(windows, /\$audioArgs\+=' -b:a '/);
  assert.match(android, /val audioMode = if \(task == null\) request\.optString\("audio", "copy"\)/);
  assert.match(android, /args\.addAll\(listOf\("-c:a", audioMode\)\)/);
});
