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
  assert.match(main, /nativePlatformName\(\) \+ ' 自检：'/);
  assert.match(main, /class="workspace-layout"/);
  assert.match(main, /class="platform-rail"/);

  assert.match(css, /\.workspace-layout\s*\{\s*display:\s*block/);
  assert.match(css, /\.windows-native-connected \.platform-rail\s*\{\s*display:\s*none/);
  assert.match(css, /\.native-status-bar\s*\{/);
  assert.match(css, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
});
