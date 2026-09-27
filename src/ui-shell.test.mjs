import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('web shell exposes Windows Native guidance and wide desktop rail', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./style.css', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /id="windowsNativeCard"/);
  assert.match(main, /windows\\start_windows\.bat/);
  assert.match(main, /WINDOWS NATIVE · RECOMMENDED/);
  assert.match(main, /h264_nvenc|NVENC/);
  assert.match(main, /libx264|x264/);
  assert.match(main, /Gyan\.FFmpeg/);
  assert.match(main, /class="workspace-layout"/);
  assert.match(main, /class="platform-rail"/);

  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) 340px/);
  assert.match(css, /@media \(max-width: 1180px\)/);
  assert.match(css, /\.platform-rail\s*\{/);
});
