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

test('calibration workflow retains source identity and stops incomplete trials safely',async()=>{
  const [panel,workspace,main,bridge]=await Promise.all([
    readFile(new URL('./transcode-calibration-panel.js',import.meta.url),'utf8'),
    readFile(new URL('./media-workspace.js',import.meta.url),'utf8'),
    readFile(new URL('./main.js',import.meta.url),'utf8'),
    readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8')
  ]);
  for(const id of ['taskCurveProfile','taskStopCurve','taskExploreTarget','taskAdoptCurveRate'])
    assert.match(panel,new RegExp('id="'+id+'"'));
  assert.match(panel,/CALIBRATION_PROFILES\[profileControl\.value\]/);
  assert.match(panel,/calibrationSampleStarts\(from,to,profile\.seconds,profile\.count\)/);
  assert.match(panel,/if\(cancelRequested\)throw Error\('用户已停止校准'\)/);
  assert.match(panel,/clearEvidence\(\);[\s\S]*?label\(\(cancelRequested/);
  assert.match(panel,/const evidenceIsCurrent/);
  assert.match(panel,/evidenceIsCurrent\(\)/);
  assert.match(panel,/expectedAudioDuration/);
  assert.match(workspace,/transcodeCurves\.invalidate\(\)/);
  assert.match(main,/sampleExact: true/);
  assert.match(main,/multipass, sampleExact: true/);
  assert.match(bridge,/if \(\[bool\]\$Options\.sampleExact\)/);
  assert.match(bridge,/no implicit hq tune/);
  assert.equal((bridge.match(/function Invoke-Sample/g)||[]).length,1);
  assert.match(bridge,/Requested NVENC fullres multipass is unavailable/);
});

test('exact video-only calibration reads source directly for SSIM instead of writing full-resolution FFV1 files',async()=>{
  const script=await readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8');
  assert.match(script,/function Get-SsimAgainstSource/);
  assert.match(script,/format=yuv420p,setpts=PTS-STARTPTS/);
  assert.match(script,/if\(-not \[bool\]\$o\.sampleExact\)/);
  assert.match(script,/Get-SsimAgainstSource \$candidate \$video \$startText \$durationText/);
  assert.match(script,/Get-Ssim \$candidate \$reference \$work/);
});
