import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('post-operation output verification is wired across Web, Windows Native and Android Native', async () => {
  const [workspace, main, engine, client, windows, android, androidArgs] = await Promise.all([
    readFile(new URL('./media-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./engine.js', import.meta.url), 'utf8'),
    readFile(new URL('./windows-native-client.js', import.meta.url), 'utf8'),
    readFile(new URL('../windows/native-bridge.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../android-native/app/src/main/java/io/github/quickhardsub/NativeBridge.kt', import.meta.url), 'utf8'),
    readFile(new URL('../android-native/app/src/main/java/io/github/quickhardsub/MediaTaskArguments.kt', import.meta.url), 'utf8'),
  ]);

  assert.match(workspace, /id="taskOutputVerification"/);
  assert.match(workspace, /id="taskVerifyFrames"/);
  assert.match(workspace, /源帧 ↔ 转码成品/);
  assert.match(workspace, /权威字幕参考 ↔ 硬压成品/);
  assert.match(workspace, /\['transcode','hardsub'\]\.includes/);
  assert.match(workspace, /verificationSourceTime/);
  assert.match(workspace, /hooks\.verifyFramePair/);
  assert.match(workspace, /openOutputVerificationFullscreen/);

  assert.match(main, /nativeOutputFrameWaiters: new Map\(\)/);
  assert.match(main, /nativeReferenceFrameWaiters: new Map\(\)/);
  assert.match(main, /function requestNativeOutputFrame\(/);
  assert.match(main, /function requestNativeReferenceFrame\(/);
  assert.match(main, /verifyFramePair: async options =>/);
  assert.match(main, /renderVerifiedOutputFrame/);
  assert.match(main, /renderHardsubReferenceFrame/);

  assert.match(engine, /async renderVerifiedOutputFrame\(blob, timeSeconds, options = \{\}\)/);
  assert.match(engine, /async renderHardsubReferenceFrame\(timeSeconds, task, options = \{\}\)/);
  assert.match(engine, /this\.lastVerifiedOutput = \{ blob, path, extension \}/);

  assert.match(client, /renderNativeOutputFrame\(requestId, jobId, timeSeconds, width\)/);
  assert.match(client, /renderNativeReferenceFrame\(requestId, jobId, timeSeconds, width\)/);
  assert.match(client, /\/api\/jobs\/.*\/frame/);
  assert.match(windows, /function Invoke-OutputFrame\(\[string\]\$JobId,\$Body\)/);
  assert.match(windows, /Invoke-OutputFrame \$Matches\[1\]/);
  assert.match(windows, /function Invoke-HardsubReferenceFrame\(\[string\]\$JobId,\$Body\)/);
  assert.match(windows, /Invoke-HardsubReferenceFrame \$Matches\[1\]/);
  assert.match(windows, /Source=\$video/);
  assert.match(android, /fun renderNativeOutputFrame\(requestId: String, jobId: String, timeSeconds: Double, width: Int\)/);
  assert.match(android, /"__onNativeOutputFrame"/);
  assert.match(android, /fun renderNativeReferenceFrame\(requestId: String, jobId: String, timeSeconds: Double, width: Int\)/);
  assert.match(android, /"__onNativeReferenceFrame"/);
  assert.match(androidArgs, /fun hardsubReferenceFilter\(/);
});
