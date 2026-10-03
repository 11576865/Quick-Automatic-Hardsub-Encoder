import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('timeline source-frame preview is wired across Web, Windows Native and Android Native', async () => {
  const [workspace, main, engine, client, windows, android] = await Promise.all([
    readFile(new URL('./media-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./engine.js', import.meta.url), 'utf8'),
    readFile(new URL('./windows-native-client.js', import.meta.url), 'utf8'),
    readFile(new URL('../windows/native-bridge.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../android-native/app/src/main/java/io/github/quickhardsub/NativeBridge.kt', import.meta.url), 'utf8'),
  ]);

  assert.match(workspace, /id="taskFramePreviewPanel"/);
  assert.match(workspace, /id="taskBoundaryFrameInspector"/);
  assert.match(workspace, /scheduleCursorFramePreview/);
  assert.match(workspace, /scheduleBoundaryFramePreview/);
  assert.match(workspace, /autoScrollTimeline/);

  assert.match(main, /nativeFrameWaiters: new Map\(\)/);
  assert.match(main, /function requestNativeFrame\(/);
  assert.match(main, /frame: async options =>/);
  assert.match(main, /state\.engine\.renderTimelineFrame/);

  assert.match(engine, /async renderTimelineFrame\(timeSeconds, options = \{\}\)/);
  assert.match(engine, /-frames:v 1/);
  assert.match(engine, /force_original_aspect_ratio=decrease/);

  assert.match(client, /renderNativeFrame\(requestId, timeSeconds, width\)/);
  assert.match(client, /'\/api\/frame'/);
  assert.match(windows, /function Invoke-Frame\(\$Body\)/);
  assert.match(windows, /\$path -eq '\/api\/frame'/);

  assert.match(android, /fun renderNativeFrame\(requestId: String, timeSeconds: Double, width: Int\)/);
  assert.match(android, /"__onNativeFrame"/);
  assert.match(android, /native-timeline-frame/);
});
