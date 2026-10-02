import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('three media operations use dedicated workspace presentation', async () => {
  const [workspace, css] = await Promise.all([
    readFile(new URL('./media-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('./media-workspace-ui.css', import.meta.url), 'utf8'),
  ]);

  assert.match(workspace, /data-media-mode="hardsub"/);
  assert.match(workspace, /data-media-mode="transcode"/);
  assert.match(workspace, /data-media-mode="copy"/);
  assert.equal((workspace.match(/data-media-mode="/g) || []).length, 3);

  assert.match(workspace, /编码参数/);
  assert.match(workspace, /纯视频转码工作区/);
  assert.match(workspace, /无损快速剪切工作区/);
  assert.match(workspace, /document\.body\.dataset\.mediaOperation = mode/);
  assert.match(workspace, /taskRun'\)\.textContent = hardsub \? '使用当前参数开始硬压' : transcode \? '开始视频转码' : '开始无损剪切'/);

  assert.match(workspace, /class="media-mode-explainer media-mode-explainer-hardsub"/);
  assert.match(workspace, /class="media-mode-explainer media-mode-explainer-transcode"/);
  assert.match(workspace, /class="media-mode-explainer media-mode-explainer-copy"/);
  assert.match(workspace, /data-hardsub-strategy/);
  assert.match(workspace, /hardsub-control-strategy-v1/);
  assert.match(workspace, /syncHardsubStrategyChrome/);
  assert.match(workspace, /section\.dataset\.mobileStageSection = hardsub \? 'produce' : 'prepare'/);
  assert.match(workspace, /hooks\.onModeChange\?\.\(mode\)/);
  assert.match(workspace, /hardsub-strategy-suppressed/);
  assert.match(workspace, /HARDSUB · PARAMETERS/);
  assert.match(workspace, /使用当前参数开始硬压/);

  assert.match(workspace, /qualityRange\.type = 'range'/);
  assert.match(workspace, /className = 'media-inline-range'/);
  assert.match(workspace, /qualityRange\.addEventListener\('input'/);

  assert.match(css, /\.media-mode-switcher\s*\{/);
  assert.match(css, /button\[aria-pressed="true"\]/);
  assert.match(css, /body\[data-media-operation="transcode"\] \.production-region/);
  assert.match(css, /body\[data-media-operation="copy"\] \.media-encoding-panel/);
  assert.match(css, /body\[data-media-operation="copy"\] \.media-sample-panel/);
  assert.match(css, /\.media-inline-range::-webkit-slider-runnable-track/);
  assert.match(css, /\.media-action-dock\s*\{/);
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
});
