import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('manual transcode mounts measured exploration and efficiency curves',async()=>{
  const [panel, workspace, main, bridge] = await Promise.all([
    readFile(new URL('./transcode-calibration-panel.js',import.meta.url),'utf8'),
    readFile(new URL('./media-workspace.js',import.meta.url),'utf8'),
    readFile(new URL('./main.js',import.meta.url),'utf8'),
    readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8')
  ]);
  assert.match(panel,/id="taskExplorationChart"/);
  assert.match(panel,/id="taskEfficiencyChart"/);
  assert.match(panel,/exploreQuality\(/);
  assert.match(panel,/createMeasuredSizeFrontier/);
  assert.match(panel,/hooks\.applyBitrate/);
  assert.match(panel,/hooks\.applyQuality/);
  assert.match(panel,/raw\.operation!=='transcode'/);
  assert.match(panel,/calibrationSampleStarts/);
  assert.match(workspace,/mountTranscodeCurves/);
  assert.match(main,/calibrationSample:\s*async/);
  assert.match(main,/actual\.encoder !== encoder/);
  assert.match(bridge,/Sample encoder does not match the selected codec/);
  assert.match(bridge,/Selected sample encoder is not runtime-available/);
});
