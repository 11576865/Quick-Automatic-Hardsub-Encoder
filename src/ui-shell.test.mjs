import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('web shell keeps platform guidance but uses compact native workbench layout', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./style.css', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /id="windowsNativeCard"/);
  assert.match(main, /windows\\start_windows\.bat/);
  assert.match(main, /WINDOWS NATIVE · RECOMMENDED/);
  assert.match(main, /id="nativeStatusBar"/);
  assert.match(main, /renderNativeStatusBar/);
  assert.match(main, /nativeGpuLabel/);
  assert.match(main, /id="videoNativePickerBtn"/);
  assert.match(main, /id="assNativePickerBtn"/);
  assert.match(main, /id="fontsNativePickerBtn"/);
  assert.match(main, /requestWindowsNativePicker/);
  assert.match(main, /nativePlatformName\(\) \+ ' 自检：'/);
  assert.match(main, /class="workspace-layout"/);
  assert.match(main, /class="platform-rail"/);

  assert.match(css, /\.workspace-layout\s*\{\s*display:\s*block/);
  assert.match(css, /\.windows-native-connected \.platform-rail\s*\{\s*display:\s*none/);
  assert.match(css, /\.native-status-bar\s*\{/);
  assert.match(css, /Relaxed desktop workbench v4/);
  assert.match(css, /\.windows-native-connected \.input-card > \.grid\.two\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.native-picker-button\s*\{/);

  assert.match(main, /selectedTests:\s*\{\}/);
  assert.match(main, /function restoreSelectedTestForCurrentPlan\(\)/);
  assert.match(main, /function selectedTestCacheKey\(codec, plan\)/);
  const selectStart = main.indexOf('function selectCodec(codec)');
  const selectEnd = main.indexOf('function qualityCrfRange', selectStart);
  assert.ok(selectStart > 0 && selectEnd > selectStart);
  const selectBlock = main.slice(selectStart, selectEnd);
  assert.doesNotMatch(selectBlock, /state\.selectedTest\s*=\s*null/);
  assert.doesNotMatch(selectBlock, /revokeObjectURL/);
  assert.match(main, /id="nextP" type="button"/);
  assert.match(main, />下一条<\/button>/);
});
