import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('focused workbench preserves native bindings and progressive disclosure', async () => {
  const [main,workspace,css]=await Promise.all([
    readFile(new URL('./main.js',import.meta.url),'utf8'),
    readFile(new URL('./media-workspace.js',import.meta.url),'utf8'),
    readFile(new URL('./focused-workbench.css',import.meta.url),'utf8')
  ]);
  assert.match(main,/import '.\/focused-workbench\.css'/);
  for(const id of ['inputCard','video','ass','fonts','analyze','preflightCard',
    'previewBtn','previewSampleRail','hardsubStrategySwitcher','planCard',
    'quickPresetRange','qualityTargetRange','sizeFrontierPanel',
    'encodeCard','encodeBtn','cancelEncodeBtn','progressBar',
    'taskOverviewRail','overviewTaskState','nativeStatusBar',
    'windowsNativeCard','androidAppCard']){
    assert.match(main,new RegExp('id="'+id+'"'),'missing UI binding '+id);
  }
  assert.match(workspace,/<details class="media-workflow-notes"><summary>处理方式说明<\/summary>/);
  assert.match(workspace,/<div class="media-mode-explainer media-mode-explainer-copy"/);
  assert.match(workspace,/<div class="task-grid media-output-core-grid">/);
  assert.match(workspace,/<details class="media-output-audio-details media-advanced-panel"><summary>音频详细设置<\/summary>/);
  assert.match(workspace,/select\('audio','音频策略'/);
  assert.match(workspace,/select\('outputContainer','成品容器'/);
  assert.match(css,/body\.ui-desktop \.workspace-layout\s*\{\s*display:grid/);
  assert.match(main,/class="support-rail"/);
  assert.match(css,/grid-template-areas:"main support"/);
  assert.match(css,/body\.ui-desktop \.support-rail\s*\{\s*grid-area:support/);
  assert.ok(main.indexOf('id="planCard"')<main.indexOf('id="sharedMediaOutputMount"'));
  assert.ok(main.indexOf('id="sharedMediaOutputMount"')<main.indexOf('id="encodeCard"'));
  assert.match(css,/body\.ui-desktop \.production-region\s*\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/body\.ui-phone \.hardsub-strategy-switcher/);
  assert.match(css,/body\.ui-phone \.plan-mode-tabs\s*\{\s*display:grid;\s*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(css,/body\.ui-tablet \.workspace-layout\s*\{display:block/);
  assert.match(css,/@media \(min-width:920px\)[\s\S]*?body\.ui-tablet \.task-overview-rail\s*\{[\s\S]*?display:block/);
  assert.match(css,/body\.windows-native-connected\.ui-desktop \.platform-rail\s*\{display:none !important/);
  assert.doesNotMatch(main,/两种方式共享同一份素材、预检、真实 libass 预览与输出验证/);
  assert.doesNotMatch(workspace,/<p class="note media-decision-hint">先决定编码格式/);
});
