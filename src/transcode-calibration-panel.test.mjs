import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('manual transcode renders one measured size-quality curve with optional CQ observations',async()=>{
  const [panel, workspace, main, bridge] = await Promise.all([
    readFile(new URL('./transcode-calibration-panel.js',import.meta.url),'utf8'),
    readFile(new URL('./media-workspace.js',import.meta.url),'utf8'),
    readFile(new URL('./main.js',import.meta.url),'utf8'),
    readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8')
  ]);
  assert.match(panel,/id="taskEfficiencyChart"/);
  assert.doesNotMatch(panel,/id="taskExplorationChart"/);
  assert.match(panel,/<details class="media-curve-observations">/);
  assert.match(panel,/id="taskMeasuredQualityPoints"/);
  assert.equal((panel.match(/<svg id="task[^"]+Chart"/g)||[]).length,1);
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
  assert.match(panel,/if\(cancelRequested \|\| disposed\)throw Error\('用户已停止校准'\)/);
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

test('the single manual curve retains measured evidence and pointer geometry',async()=>{
  const [panel,main,svg,style,mediaCss]=await Promise.all([
    readFile(new URL('./transcode-calibration-panel.js',import.meta.url),'utf8'),
    readFile(new URL('./main.js',import.meta.url),'utf8'),
    readFile(new URL('./curve-chart-svg.js',import.meta.url),'utf8'),
    readFile(new URL('./style.css',import.meta.url),'utf8'),
    readFile(new URL('./media-workspace-ui.css',import.meta.url),'utf8')
  ]);
  for(const source of [panel,main]) {
    assert.match(source,/renderRateDistortionSvg\(/);
    assert.doesNotMatch(source,/renderExplorationSvg\(/);
    assert.match(source,/plotFractionAtX\(/);
    assert.match(source,/plotXFromClientX\(/);
  }
  assert.doesNotMatch(panel,/\(x-34\)\/652/);
  assert.doesNotMatch(main,/\(svgX - 34\) \/ \(720 - 68\)/);
  assert.match(panel,/class="media-curve-legend"/);
  assert.match(svg,/curve-sample-whisker/);
  assert.match(style,/\.curve-axis/);
  assert.match(mediaCss,/\.media-curve-legend/);
});

test('small-screen curves maintain readable numeric tick width and local scrolling',async()=>{
 const [panel,css,globalCss]=await Promise.all([
  readFile(new URL('./transcode-calibration-panel.js',import.meta.url),'utf8'),
  readFile(new URL('./media-workspace-ui.css',import.meta.url),'utf8'),
  readFile(new URL('./style.css',import.meta.url),'utf8')
 ]);
 assert.equal((panel.match(/class="media-curve-viewport"/g)||[]).length,1);
 assert.match(css,/\.media-curve-viewport svg\s*\{min-width:560px/);
 assert.match(globalCss,/\.size-frontier-chart \{min-width:560px\}/);
});

test('manual calibration enforces an observed-cost soft budget without claiming a hard timeout',async()=>{
 const source=await readFile(new URL('./transcode-calibration-panel.js',import.meta.url),'utf8');
 assert.match(source,/calibrationTimeBudget\(fullDuration\)/);
 assert.match(source,/budgetSeconds,/);
 assert.match(source,/result\.stopReason/);
 assert.match(source,/单个不可中断的原生样本仍可能超时/);
});

test('formal VBR bitrate adoption requires native sample confirmation, never CQ interpolation alone',async()=>{
 const [panel,main,bridge]=await Promise.all([
  readFile(new URL('./transcode-calibration-panel.js',import.meta.url),'utf8'),
  readFile(new URL('./main.js',import.meta.url),'utf8'),
  readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8')
 ]);
 assert.match(panel,/id="taskVerifyCurveRate"/);
 assert.match(panel,/verifiedSelection\.bitrate/);
 assert.match(panel,/mode:'bitrate',bitrate/);
 assert.match(main,/targetVideoBitrate: mode==='bitrate' \? bitrate : 0/);
 assert.match(bridge,/if \(\$targetRate -gt 0\) \{ return "-c:v/);
});

test('native exact CQ/VBR probes include an FFmpeg process timeout',async()=>{
 const [panel,main,bridge]=await Promise.all([
  readFile(new URL('./transcode-calibration-panel.js',import.meta.url),'utf8'),
  readFile(new URL('./main.js',import.meta.url),'utf8'),
  readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8')
 ]);
 assert.match(panel,/elapsedEncodeSeconds/);
 assert.match(panel,/timeoutSeconds:Math\.max/);
 assert.match(main,/timeoutSeconds/);
 assert.match(bridge,/if \(\$TimeoutSeconds -gt 0\)/);
 assert.match(bridge,/\$p\.Kill\(\)/);
 assert.match(bridge,/FFmpeg sample encode timeout after/);
});
