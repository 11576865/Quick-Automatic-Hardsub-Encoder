import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('web shell keeps platform guidance but uses compact native workbench layout', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./style.css', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /id="windowsNativeCard"/);
  assert.match(main, /WINDOWS NATIVE/);
  assert.match(main, /id="nativeStatusBar"/);
  assert.match(main, /id="runtimeModeBanner"/);
  assert.match(main, /id="runtimeModeBadge"/);
  assert.match(main, /id="heroRuntimeTitle"/);
  assert.match(main, /function renderRuntimeIdentity\(\)/);
  assert.match(main, /WINDOWS NATIVE WORKBENCH/);
  assert.match(main, /WEB \/ WASM/);
  assert.match(main, /刷新页面会继续连接本次 Bridge 会话/);
  assert.match(main, /renderNativeStatusBar/);
  assert.match(main, /nativeGpuLabel/);
  assert.match(main, /id="videoNativePickerBtn"/);
  assert.match(main, /id="assNativePickerBtn"/);
  assert.match(main, /id="fontsNativePickerBtn"/);
  assert.match(main, /id="videoWebPicker" class="file-picker-trigger"/);
  assert.match(main, /id="assWebPicker" class="file-picker-trigger"/);
  assert.match(main, /id="fontsWebPicker" class="file-picker-trigger"/);
  assert.match(main, /requestWindowsNativePicker/);
  assert.match(main, /nativePlatformName\(\) \+ ' 自检：'/);
  assert.match(main, /class="workspace-layout"/);
  assert.match(main, /class="platform-rail"/);
  assert.match(main, /class="adaptive-region setup-region"/);
  assert.match(main, /class="adaptive-region production-region"/);
  assert.match(main, /class="production-controls"/);
  assert.match(main, /function resolveWindowSizeClass\(width = window\.innerWidth\)/);
  assert.doesNotMatch(main, /data-theme-choice=/);
  assert.doesNotMatch(main, /THEME_KEY/);
  assert.doesNotMatch(main, /prefers-color-scheme/);
  assert.match(main, /WEB MEDIA WORKBENCH/);
  assert.match(main, /<h1 id="runtimeWorkbenchTitle">浏览器媒体处理工作台<\/h1>/);
  assert.match(main, /class="app-header-main"/);
  assert.match(main, /largeMax:\s*1599/);
  assert.match(main, /return 'extra-large'/);

  assert.match(css, /\.workspace-layout\s*\{\s*display:\s*block/);
  assert.match(css, /\.windows-native-connected \.platform-rail\s*\{\s*display:\s*none/);
  assert.match(css, /\.native-status-bar\s*\{/);
  assert.match(css, /\.runtime-mode-banner\s*\{/);
  assert.match(css, /data-runtime-backend="windows-native"/);
  assert.match(css, /data-runtime-backend="android-native"/);
  assert.match(css, /data-window-size="medium"\] \.input-card > \.grid\.two\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.native-picker-button\s*\{/);
  assert.match(css, /\.file-input-control\s*\{/);
  assert.match(css, /\.file-picker-trigger,/);
  assert.match(css, /\.status-list\s*\{[\s\S]*?repeat\(auto-fit, minmax\(205px, 1fr\)\)/);
  assert.match(css, /\.preview-wrap\s*\{[\s\S]*?max-width:\s*760px/);
  assert.match(main, /<details class="card log-card">/);
  assert.doesNotMatch(main, /id="previewLightbox" class="preview-lightbox"/);
  assert.match(main, /id="mobileStageNav" class="mobile-stage-nav"/);
  assert.match(main, /data-mobile-stage-target="prepare"/);
  assert.match(main, /data-mobile-stage-target="produce"/);
  assert.equal((main.match(/data-mobile-stage-target="/g) || []).length, 2);
  assert.match(main, /function devicePrefersMobileShell\(\)/);
  assert.match(main, /function resolvePresentationShell\(width = window\.innerWidth\)/);
  assert.match(main, /classList\.remove\('ui-mobile', 'ui-phone', 'ui-tablet', 'ui-desktop'\)/);
  assert.match(main, /document\.body\.classList\.add\('ui-tablet'\)/);
  assert.match(main, /document\.body\.classList\.add\('ui-desktop'\)/);
  assert.match(main, /function setMobileStage\(stage/);
  assert.match(css, /body\.ui-desktop \.production-region/);
  assert.match(css, /body\.ui-mobile \.mobile-stage-nav/);
  assert.match(css, /body\.ui-mobile \[data-mobile-stage-section\]/);
  assert.match(css, /body\.ui-mobile\[data-mobile-stage="prepare"\]/);
  assert.match(css, /body\.ui-mobile\[data-mobile-stage="produce"\]/);
  assert.match(main, /detectBasicCapabilities/);
  assert.match(main, /data-workflow-step="assets"/);
  assert.match(main, /data-workflow-step="preflight"/);
  assert.match(main, /data-workflow-step="preview"/);
  assert.match(main, /data-workflow-step="plan"/);
  assert.match(main, /data-workflow-step="encode"/);
  assert.equal((main.match(/data-workflow-step="/g) || []).length, 5);
  assert.match(main, /id="hardsubStrategySwitcher"/);
  assert.match(main, /data-hardsub-strategy="guided"/);
  assert.match(main, /data-hardsub-strategy="manual"/);
  assert.match(main, /function ensureWebEngineReady\(\)/);
  assert.match(main, /function ensureNativeSelfTestStarted\(\)/);
  assert.match(main, /首张真实预览已成功解码输入视频/);
  assert.match(main, /id="continueToProduceBtn"/);
  assert.match(main, /mobile-stage-copy/);
  assert.match(main, /预览与压制/);
  assert.match(css, /Mobile task shell v2/);
  assert.match(css, /body\.ui-mobile \.mobile-preflight-action/);
  assert.match(css, /body\.ui-mobile \.mobile-stage-nav \{/);
  assert.match(main, /class="mobile-runtime-help"/);
  assert.match(main, /class="mobile-runtime-option android"/);
  assert.match(main, /class="mobile-runtime-option windows"/);
  assert.match(css, /--mobile-sky: #55b9ff/);
  assert.match(css, /--mobile-grass: #72d66c/);
  assert.match(main, /class="platform-guide"/);
  assert.match(main, /windows\/start_windows\.bat/);
  assert.match(main, /下载最新版 APK/);
  assert.match(css, /Native setup guides/);
  assert.match(css, /body\.ui-mobile \.mobile-runtime-help/);
  assert.doesNotMatch(main, /执行输入解码 smoke test/);
  assert.doesNotMatch(main, /id="previewZoom"/);
  assert.match(main, /class="preview-image"/);
  assert.match(main, /data-codec="' \+ codec \+ '" role="button"/);
  assert.match(css, /\.codec-card\[data-codec\]\s*\{[\s\S]*?cursor:\s*pointer/);
  assert.match(css, /\.preview-lightbox\s*\{/);
  assert.match(css, /body\.ui-mobile \.preflight-card \.status-item\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(8\.5rem, auto\)/);
  assert.doesNotMatch(main, /data-range-step="quick"/);
  assert.doesNotMatch(main, /data-range-reset="quick"/);

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
  assert.match(main, /const targetFrames = testCodec === 'av1' \? 120 : 72/);
  assert.match(main, /const maxSampleSeconds = testCodec === 'av1' \? 4\.0 : 2\.4/);
  assert.match(main, />下一条<\/button>/);

  assert.match(main, /data-plan-mode="quick"/);
  assert.match(main, /data-plan-mode="quality"/);
  assert.match(main, /data-plan-mode="size"/);
  assert.match(main, /id="quickPresetRange" class="plan-slider plan-interaction" type="range"/);
  assert.match(main, /id="qualityTargetRange" class="plan-slider plan-interaction" type="range"/);
  assert.match(main, /id="sizeBudgetRange" class="plan-slider plan-interaction" type="range"/);
  assert.match(main, /id="qualityAutoCodec"/);
  assert.match(main, /id="sizeBudgetMultiplier" type="hidden"/);
  assert.match(main, /function commitQualityTarget\(\)/);
  assert.match(main, /function commitSizeBudget\(\)/);
  assert.match(main, /parseLibassFontDiagnostics/);
  assert.match(main, /renderRuntimeFontDiagnostics/);
  assert.match(main, /previewFontDiagnostics/);
  assert.match(main, /findGlyphRiskPreviewTimes/);
  assert.match(main, /buildPreviewPlan/);
  assert.match(main, /mergePreviewTimes/);
  assert.match(main, /previewRiskTimes/);
  assert.match(main, /goal !== 'sizeBudget'/);
  assert.doesNotMatch(main, /<option value="quality">质量优先/);
  assert.doesNotMatch(main, /体积预算：1\.6×/);
  assert.match(main, /诊断：固定参数编码器基准测试/);
  assert.match(css, /\.plan-mode-tabs\s*\{/);
  assert.match(css, /\.plan-slider::-webkit-slider-runnable-track/);
  assert.match(css, /--slider-progress/);
  assert.match(css, /\.runtime-font-diagnostics\s*\{/);
  assert.match(css, /\.runtime-font-row\s*\{/);
  assert.match(css, /Current dark workbench/);
  assert.match(css, /Current adaptive window layout/);
  assert.match(css, /@layer foundation, current;/);
  assert.match(css, /@layer foundation\s*\{/);
  assert.match(css, /@layer current\s*\{/);
  assert.doesNotMatch(css, /Adaptive window-size workbench v5/);
  assert.doesNotMatch(css, /Semantic contrast \+ adaptive theme v2/);
  assert.doesNotMatch(css, /Compact workbench layout v3/);
  assert.doesNotMatch(css, /Relaxed desktop workbench v4/);
  assert.doesNotMatch(css, /Modern dark workbench v6/);
  assert.doesNotMatch(css, /Adaptive workbench v7/);
  assert.match(css, /data-window-size="expanded"\] \.production-region\s*\{[\s\S]*?display:\s*grid/);
  assert.match(css, /data-window-size="large"\] \.production-region,[\s\S]*?display:\s*grid/);
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
  assert.match(css, /data-window-size="compact"\] \.setup-region/);
  assert.match(css, /data-window-size="medium"\] \.production-region/);
  assert.doesNotMatch(css, /System may still resolve\s+to light/);
});


test('phone tablet and desktop use coordinated responsive shells', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./style.css', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /function resolvePresentationShell\(width = window\.innerWidth\)/);
  assert.match(main, /if \(width <= 640\) return 'phone'/);
  assert.match(main, /if \(width <= 1180 \|\| window\.matchMedia\('\(pointer: coarse\)'\)\.matches\) return 'tablet'/);
  assert.match(main, /return 'desktop'/);
  assert.match(main, /document\.documentElement\.dataset\.uiShell = shell/);
  assert.match(main, /id="taskOverviewRail"/);
  assert.match(main, /function syncTaskOverview\(\)/);
  assert.match(css, /Runtime-first responsive workbench v4/);
  assert.match(css, /body\.ui-desktop \.workspace-layout\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /body\.ui-tablet \.workspace-layout/);
  assert.match(css, /body\.ui-phone\[data-mobile-stage="prepare"\] \[data-mobile-stage-section="prepare"\]/);
  assert.match(css, /body\.ui-phone\[data-mobile-stage="produce"\] \[data-mobile-stage-section="produce"\]/);
});


test('design-faithful preview sample rail and visual hierarchy are present', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./style.css', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /id="previewSampleRail" class="preview-sample-rail"/);
  assert.match(main, /function renderPreviewSampleRail\(activeIndex = 0\)/);
  assert.match(main, /data-preview-index=/);
  assert.match(main, /class="preview-generate-action action-solid action-cyan"/);
  assert.match(main, /class="primary action-solid action-green"/);
  assert.match(css, /Runtime-first responsive workbench v4/);
  assert.match(css, /\.preview-workspace\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,1fr\) 190px/);
  assert.match(css, /\.preview-sample-card\.is-current/);
  assert.match(css, /\.action-green\s*\{/);
  assert.match(css, /\.hardsub-strategy-switcher\s*\{/);
  assert.match(css, /\.hardsub-strategy-suppressed\s*\{/);
});


test('runtime-first three-endpoint layout keeps Android and Windows entry visible', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./style.css', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /class="platform-rail-heading"/);
  assert.match(main, /<h2>选择运行方式<\/h2>/);
  assert.match(main, /id="windowsNativeCard"/);
  assert.match(main, /id="androidAppCard"/);
  assert.match(main, /第一次使用？3 步启动/);
  assert.match(main, /第一次使用？3 步安装/);
  assert.match(main, /<span class="step-no">01<\/span><div><h2>准备素材/);
  assert.match(main, /<span class="step-no">02<\/span>[\s\S]*?<span class="preflight-heading">媒体与字幕预检/);
  assert.match(main, /<span class="step-no">03<\/span>[\s\S]*?<h2>真实字幕预览/);
  assert.match(main, /<h2>选择控制方式<\/h2>/);
  assert.match(main, /<span class="step-no">04<\/span><div><h2>输出策略/);
  assert.match(main, /<span class="step-no">05<\/span><div><h2>执行与验证/);

  assert.match(css, /Runtime-first responsive workbench v4/);
  assert.match(css, /body\.ui-desktop \.workspace-layout\s*\{[\s\S]*?"runtime runtime"[\s\S]*?"main overview"/);
  assert.match(css, /body\.ui-tablet \.platform-rail\s*\{[\s\S]*?display:\s*grid !important/);
  assert.match(css, /body\.ui-phone \.platform-rail\s*\{[\s\S]*?display:\s*grid !important/);
  assert.match(css, /body\.ui-phone \.workspace-layout\s*\{[\s\S]*?"runtime"[\s\S]*?"main"/);
  assert.match(css, /body\.ui-phone \.workflow-strip,[\s\S]*?body\.ui-phone \.mobile-stage-nav\s*\{[\s\S]*?display:\s*none !important/);
});


test('compact density v5 reduces dead space without shrinking primary actions', async () => {
  const css = await readFile(new URL('./style.css', import.meta.url), 'utf8');

  assert.match(css, /Compact density v5/);
  assert.match(css, /body\.ui-desktop \.input-card \.file-row,[\s\S]*?min-height:\s*66px/);
  assert.match(css, /body\.ui-tablet \.preflight-card \.status-item[\s\S]*?min-height:\s*34px/);
  assert.match(css, /body\.ui-phone \.workspace-layout,[\s\S]*?gap:\s*6px !important/);
  assert.match(css, /body\.ui-phone \.platform-card,[\s\S]*?padding:\s*9px/);
  assert.match(css, /body\.ui-phone \.plan-mode-tab\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /body\.ui-phone \.file-picker-trigger,[\s\S]*?min-height:\s*42px/);
});


test('phone browser exposes dedicated Android and Windows tutorials', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./style.css', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /<strong>运行方式与教程<\/strong>/);
  assert.match(main, /<strong>Android 教程<\/strong>/);
  assert.match(main, /<strong>Windows 教程<\/strong>/);
  assert.match(main, /下载 Android APK/);
  assert.match(main, /下载 Windows 包/);
  assert.match(main, /详细说明/);

  assert.match(css, /Phone tutorial visibility fix/);
  assert.match(css, /body\.ui-phone \.mobile-runtime-help\s*\{[\s\S]*?display:\s*block !important/);
  assert.match(css, /body\.ui-phone \.platform-rail\s*\{[\s\S]*?display:\s*none !important/);
  assert.match(css, /body\.ui-phone \.mobile-runtime-help-grid\s*\{[\s\S]*?repeat\(2,minmax\(0,1fr\)\)/);
});


test('phone stage visibility respects active stage and hardsub strategy suppression', async () => {
  const css = await readFile(new URL('./style.css', import.meta.url), 'utf8');
  assert.doesNotMatch(
    css,
    /body\.ui-phone \[data-mobile-stage-section\]:not\(\.hidden\)\s*\{/
  );
  assert.match(
    css,
    /body\.ui-phone\[data-mobile-stage="prepare"\] \[data-mobile-stage-section="prepare"\][\s\S]*?:not\(\.hardsub-strategy-suppressed\)[\s\S]*?body\.ui-phone\[data-mobile-stage="produce"\] \[data-mobile-stage-section="produce"\]/
  );
});


test('source video metadata is independent from subtitle preflight', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./style.css', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /id="sourceVideoSummary"/);
  assert.match(main, /function renderSourceVideoSummary/);
  assert.match(main, /async function analyzeVideoOnly/);
  assert.match(main, /async function analyzeCurrentInputs/);
  assert.match(main, /button\.textContent = fullHardsub \? '分析视频与字幕' : '读取视频参数'/);
  assert.match(main, /if \(!state\.video\) \{ button\.disabled = true; return; \}/);
  assert.doesNotMatch(main, /const hasFiles = !!\(state\.video && state\.ass\)/);
  assert.match(main, /state\.sourceMedia = mediaFromNativeProbe\(p\);[\s\S]*?renderSourceVideoSummary\(\)/);
  assert.match(main, /invalidateAnalysis\(\{ clearVideoMetadata: true \}\)/);
  assert.match(css, /\.source-video-summary\s*\{/);
  assert.match(css, /\.source-video-summary-heading\s*\{/);
});

test('input identity is locked across native async work', async () => {
  const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');

  assert.match(main, /function cancelPendingNativeInputWork\(reason = '输入已变化'\)/);
  assert.match(main, /state\.nativePreviewWaiters,[\s\S]*?state\.nativeFrameWaiters,[\s\S]*?state\.nativeWaveformWaiters,[\s\S]*?state\.nativeSampleWaiters/);
  assert.match(main, /cancelPendingNativeInputWork\('输入已变化，旧 Native 请求已取消'\)/);
  assert.match(main, /video:\s*\{ inputId: 'video', buttonId: 'videoNativePickerBtn'/);
  assert.match(main, /ass:\s*\{ inputId: 'ass', buttonId: 'assNativePickerBtn'/);
  assert.match(main, /fonts:\s*\{ inputId: 'fonts', buttonId: 'fontsNativePickerBtn'/);
  assert.match(main, /function syncTaskInputMutationLocks\(\)/);
  assert.match(main, /button\.disabled = !!busy \|\| state\.operationBusy \|\| !!state\.nativeJobId/);
  assert.match(main, /if \(state\.operationBusy \|\| state\.nativeJobId \|\| state\.nativeImportJobId\) \{[\s\S]*?任务运行期间不能更换输入素材/);
  assert.match(main, /const hasExistingSelection = role === 'video'/);
  assert.match(main, /if \(!hasExistingSelection && config\?\.metaId/);
  assert.match(main, /正在请求取消 ' \+ nativePlatformName\(\) \+ ' 压制/);
  assert.doesNotMatch(main, /正在请求取消 Android 原生压制/);
  assert.match(main, /\.font-binding-select, \.plan-interaction, \.remove-saved-font/);
  assert.match(main, /#taskOutputPolicy \[name\]/);
  assert.match(main, /\$\('clearSavedFontsBtn'\)\.disabled = locked \|\| !state\.savedFonts\.length/);
  assert.match(main, /await deleteSavedFont\(file\);[\s\S]*?invalidateAnalysis\(\);[\s\S]*?需要重新分析与预览/);
  assert.match(main, /await clearSavedFonts\(\);[\s\S]*?invalidateAnalysis\(\);[\s\S]*?需要重新分析与预览/);
  assert.match(main, /let statusReadFailures = 0/);
  assert.match(main, /statusReadFailures >= 5/);
  assert.match(main, /当前任务 ID 已保留/);
  assert.match(main, /state\.nativeJobId = jobId;[\s\S]*?syncTaskInputMutationLocks\(\)/);
});



test('compression evidence store is wired across Android and Windows', async () => {
  const [main, windowsClient, windowsBridge, windowsHistory, androidBridge, androidStore, encodeService] = await Promise.all([
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./windows-native-client.js', import.meta.url), 'utf8'),
    readFile(new URL('../windows/native-bridge.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../windows/compression-history.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../android-native/app/src/main/java/io/github/quickhardsub/NativeBridge.kt', import.meta.url), 'utf8'),
    readFile(new URL('../android-native/app/src/main/java/io/github/quickhardsub/NativeBenchmarkStore.kt', import.meta.url), 'utf8'),
    readFile(new URL('../android-native/app/src/main/java/io/github/quickhardsub/EncodeService.kt', import.meta.url), 'utf8')
  ]);

  assert.match(main, /qualityEvidenceRecord/);
  const evidenceModel = await readFile(new URL('./compression-evidence.js', import.meta.url), 'utf8');
  assert.match(evidenceModel, /evidenceScope: 'observation'/);
  assert.match(evidenceModel, /record\.evidenceScope === 'source'/);
  assert.match(main, /record\?\.evidenceKind !== 'full-encode'/);
  assert.match(main, /persistCompressionEvidence/);
  assert.match(main, /currentSourceEvidenceKey/);
  assert.match(main, /sourceIdentity:\s*currentSourceEvidenceKey\(\)/);
  assert.match(main, /evaluateQualityCandidate\(codec, crf, preset, targetSsim = null, outputSize = null, samplePlan = null\)/);
  assert.match(main, /sampleMeasurements: results\.map/);
  assert.doesNotMatch(main, /reusableSourceQualityByCrf/);

  assert.match(windowsClient, /recordCompressionEvidence\(recordJson\)/);
  assert.match(windowsClient, /\/api\/history/);
  assert.match(windowsBridge, /compression-history\.ps1/);
  assert.match(windowsBridge, /Ensure-CompletedJobHistory/);
  assert.match(windowsBridge, /EncodeSeconds=0\.0;TimedProcessKey=''/);
  assert.equal((windowsBridge.match(/EncodeSeconds=0\.0;TimedProcessKey=''/g) || []).length, 2);
  assert.match(windowsBridge, /\$j\.EncodeSeconds \+= \[Math\]::Max\(\.001,\(\$p\.ExitTime-\$p\.StartTime\)\.TotalSeconds\)/);
  assert.match(windowsBridge, /\$elapsed=\[Math\]::Max\(\.001,\[double\]\$Job\.EncodeSeconds\)/);
  assert.doesNotMatch(windowsBridge, /\(\(Get-Date\)-\$Job\.StartedAt\)\.TotalSeconds/);
  assert.match(windowsBridge, /Add-ClientCompressionEvidence \$body\.record/);
  assert.match(windowsHistory, /CompressionHistoryMaxRecords = 500/);
  assert.match(windowsHistory, /LocalApplicationData/);
  assert.match(windowsHistory, /quality-sample/);
  assert.match(windowsHistory, /sampleMeasurements'[\s\S]*?'testedCrfs/);
  assert.match(windowsHistory, /quality-sample'\)\{'observation'\}else\{'source'\}/);

  assert.match(androidBridge, /fun recordCompressionEvidence\(recordJson: String\)/);
  assert.match(androidBridge, /"sampleMeasurements"/);
  assert.match(androidBridge, /kind == "quality-sample"\) record\.put\("evidenceScope", "observation"\)/);
  assert.match(androidStore, /MAX_RECORDS = 500/);
  assert.match(androidStore, /fun appendEvidence/);
  assert.match(encodeService, /"evidenceKind", "full-encode"/);
  assert.match(encodeService, /"sourceIdentity", request\.optString\("sourceIdentity", ""\)/);
});


test('rate-distortion model is fed by in-session calibration evidence', async () => {
  const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
  const model = await readFile(new URL('./rate-distortion-model.js', import.meta.url), 'utf8');

  assert.match(main, /fitRateDistortionModel/);
  assert.match(main, /rateDistortionModels:\s*\{\}/);
  assert.match(main, /testedPoints:\s*\[\.\.\.tested\.values\(\)\]/);
  assert.match(main, /state\.rateDistortionModels\[codec\] = rdModel\.ok \? rdModel : null/);
  assert.match(main, /R-D 模型/);

  assert.match(model, /function isotonicNonDecreasing/);
  assert.match(model, /predictAtBitrate/);
  assert.match(model, /estimateKnee/);
  assert.match(model, /createSizeQualityFrontier/);
  assert.match(model, /status: 'impossible'/);
  assert.match(model, /status: 'below-evidence'/);
  assert.match(model, /status: 'above-evidence'/);
});


test('target-size mode exposes a draggable measured frontier', async () => {
  const [main, css, frontierUi] = await Promise.all([
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./style.css', import.meta.url), 'utf8'),
    readFile(new URL('./size-frontier-ui.js', import.meta.url), 'utf8')
  ]);

  assert.match(main, /id="sizeFrontierPanel"/);
  assert.match(main, /id="sizeFrontierChart"[^>]*role="slider"/);
  assert.match(main, /id="calibrateSizeFrontierBtn"/);
  assert.match(main, /function renderSizeFrontier\(\)/);
  assert.match(main, /function sizeFrontierTargetFromPointer\(event\)/);
  assert.match(main, /function commitSizeFrontierKeyboard\(event\)/);
  assert.match(main, /sizeFrontierChart'\)\.addEventListener\('pointerdown'/);
  assert.match(main, /sizeFrontierChart'\)\.addEventListener\('pointermove'/);
  assert.match(main, /sizeFrontierChart'\)\.addEventListener\('keydown', commitSizeFrontierKeyboard\)/);
  assert.match(main, /state\.sizeBudgetTargetBytes = Math\.round\(clamped\)/);
  assert.match(main, /budgetSource: directBudgetBytes > 0 \? 'frontier' : 'multiplier'/);
  assert.match(main, /directBudgetBytes > 0\s*\? ceilingVideoBitrate/);
  assert.match(main, /state\.rateDistortionModels = \{\}/);
  assert.match(main, /state\.sizeBudgetTargetBytes = null/);

  assert.match(css, /Measured target-size frontier/);
  assert.match(css, /\.size-frontier-chart\s*\{[\s\S]*?touch-action:\s*none/);
  assert.match(css, /\.size-frontier-band\s*\{/);
  assert.match(css, /\.size-frontier-thumb\s*\{/);

  assert.match(frontierUi, /targetBytesAtEvidenceFraction/);
  assert.match(frontierUi, /evidenceFractionForTargetBytes/);
  assert.match(frontierUi, /buildSizeFrontierPlot/);
  assert.match(frontierUi, /bandPath/);
});

test('Bink 2 input adapter distinguishes probe, decode, and external import state', async () => {
  const [main, client, css, bink, bridge] = await Promise.all([
    readFile(new URL('./main.js', import.meta.url), 'utf8'),
    readFile(new URL('./windows-native-client.js', import.meta.url), 'utf8'),
    readFile(new URL('./style.css', import.meta.url), 'utf8'),
    readFile(new URL('../windows/bink-import.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../windows/native-bridge.ps1', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /id="sourceAdapterPanel"/);
  assert.match(main, /id="sourceAdapterImportBtn"/);
  assert.match(main, /id="sourceAdapterCancelBtn"/);
  assert.match(main, /function renderSourceAdapterState/);
  assert.match(main, /async function startBink2Import/);
  assert.match(main, /async function monitorBink2Import/);
  assert.match(main, /async function recoverBink2ImportJob/);
  assert.match(main, /async function recoverWindowsNativeVideoSelection/);
  assert.match(main, /sourceAdapterRequired/);
  assert.match(main, /sourceAdapterApplied/);
  assert.match(main, /inputDecodeSmoke === false && !state\.nativeInputProbe\.inputDecodeDeferred/);
  assert.match(main, /Bink 2 已经过外部解码导入/);
  assert.match(main, /nativeImportJobId/);
  assert.match(main, /nativeBink2ImportJobId/);
  assert.match(main, /不显示未经证实的 ETA/);
  assert.match(main, /任务 ID 已保留/);

  assert.match(client, /async startBink2Import\(\)/);
  assert.match(client, /async getBink2ImportStatus\(jobId\)/);
  assert.match(client, /cancelBink2Import\(jobId\)/);
  assert.match(client, /async readSelectedVideoInfo\(\)/);

  assert.match(css, /\.source-adapter-panel\s*\{/);
  assert.match(css, /\.source-adapter-heading\s*\{/);

  assert.match(bink, /function Test-Bink2File/);
  assert.match(bink, /StartsWith\('KB2'/);
  assert.match(bink, /function Find-RadVideoConverter/);
  assert.match(bink, /RADVIDEO64/);
  assert.match(bink, /RADVIDEO_HOME/);
  assert.match(bink, /return 'binkconv ' \+ \$input \+ ' ' \+ \$output/);
  assert.match(bink, /externalDependency = \$true/);
  assert.match(bink, /bundled = \$false/);

  assert.match(bridge, /\/api\/import\/bink2/);
  assert.match(bridge, /\/api\/import-jobs\//);
  assert.match(bridge, /sourceAdapterRequired/);
  assert.match(bridge, /sourceAdapterApplied/);
  assert.match(bridge, /Bink 2 must be imported through RAD Video Tools/);
  assert.match(bridge, /Stream Copy is unavailable for a Bink 2 source/);
  assert.match(bridge, /FFmpeg cannot decode the video stream/);
});

test('hard-sub quality plan reports measured search progress without a second chart', async () => {
  const [main, curves] = await Promise.all([
    readFile(new URL('./main.js', import.meta.url),'utf8'),
    readFile(new URL('./transcode-curves.js', import.meta.url),'utf8')
  ]);
  assert.doesNotMatch(main,/id="qualityExplorationChart"/);
  assert.match(main,/id="qualityExplorationReadout"/);
  assert.doesNotMatch(main,/renderExplorationSvg\(/);
  assert.match(main,/qualityExplorationPoints:\s*\{\}/);
  assert.match(main,/function renderQualityExploration\(\)/);
  assert.match(main,/state\.qualityExplorationPoints\[codec\]\.push\(/);
  assert.match(main,/renderQualityExploration\(\);/);
  assert.match(curves,/function buildExplorationPlot\(/);
});

test('guided size budget compares compatible measured codec curves with explicit handoff',async()=>{
 const main=await readFile(new URL('./main.js',import.meta.url),'utf8');
 assert.match(main,/id="compareSizeFrontierBtn"/);
 assert.match(main,/id="adoptSizeFrontierBranchBtn"/);
 assert.match(main,/createMultiBranchFrontier\(/);
 assert.match(main,/state\.sizeEnvelopeEnabled=compareForSize/);
 assert.match(main,/selectCodec\(recommendation\.branchId\)/);
 assert.match(main,/calibrationShouldContinue\(/);
});

test('final verified output reports predicted vs actual size without claiming perceptual quality validation',async()=>{
 const source=await readFile(new URL('./main.js',import.meta.url),'utf8');
 assert.match(source,/nativeJobProjection/);
 assert.match(source,/plannedBytes:Number\(plan\.plannedBytes/);
 assert.match(source,/const sizeError=projection\?\.plannedBytes/);
 assert.match(source,/体积误差/);
 assert.match(source,/已超出目标体积上限/);
 assert.match(source,/sizeComparison:projection/);
});

test('guided multi-resolution calibration keeps output scale, SSIM reference and execution branch aligned',async()=>{
 const [main,bridge]=await Promise.all([
  readFile(new URL('./main.js',import.meta.url),'utf8'),
  readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8')
 ]);
 assert.match(main,/id="compareResolutionFrontierBtn"/);
 assert.match(main,/runResolutionCalibration\(/);
 assert.match(main,/COMMON_REFERENCE_METRIC/);
 assert.match(main,/resolutionRateDistortionModels/);
 assert.match(main,/referenceWidth:outputSize\?\.width/);
 assert.match(main,/outputWidth:plan\.outputWidth\|\|0/);
 assert.match(main,/state\.guidedOutputSize=resolution\.outputWidth>0/);
 assert.match(bridge,/scale='\+\$ReferenceWidth\+':'\+\$ReferenceHeight/);
 assert.match(bridge,/Guided output resolution differs from adopted calibration branch/);
 assert.match(bridge,/scale='\+\$outW\+':'\+\$outH\+':flags=bicubic/);
});

test('guided calibration shares scene-risk preflight positions across competing branches',async()=>{
 const [main,bridge]=await Promise.all([
  readFile(new URL('./main.js',import.meta.url),'utf8'),
  readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8')
 ]);
 assert.match(main,/preparePairedQualitySamplePlan/);
 assert.match(main,/const samplePlan=await preparePairedQualitySamplePlan\(\)/);
 assert.match(main,/calibrateCodecQuality\(codec,target,eachBudget,size,samplePlan\)/);
 assert.match(main,/calibrateCodecQuality\(codec, target, budgetPerCodec,null,samplePlan\)/);
 assert.match(main,/samplePlan\?\.starts \|\| qualitySampleStarts\(duration\)/);
 assert.match(main,/sampleFingerprint:samplePlan\?\.fingerprint/);
 assert.match(main,/if\(!outputSize\?\.width && !samplePlan\)/);
 assert.match(bridge,/function Invoke-SceneRiskProbe/);
 assert.match(bridge,/if\(\[bool\]\$o\.sceneRiskOnly\)/);
 assert.match(bridge,/signalstats,scdet=threshold=10/);
});

test('budgeted paired refinement is attached after codec and resolution comparisons',async()=>{
 const main=await readFile(new URL('./main.js',import.meta.url),'utf8');
 assert.match(main,/runBudgetedPairedRefinement\(\{mode:'resolution',samplePlan,budget/);
 assert.match(main,/runBudgetedPairedRefinement\(\{mode:'codec',samplePlan,budget/);
 assert.match(main,/appendMatchedSceneObservation/);
 assert.match(main,/if\(proposals\.length!==branches\.length/);
 assert.match(main,/originalFingerprint:plan\.previousFingerprint/);
 assert.match(main,/if\(!check\.ok \|\| check\.evaluateTargetBytes\(targetBytes\)\.status/);
 assert.match(main,/配对追加测量未发布/);
 assert.match(main,/sourceScope:sourceEvidenceKey\(state\.media/);
});

test('guided sample ingress refuses missing or falsified elapsed timing evidence',async()=>{
 const main=await readFile(new URL('./main.js',import.meta.url),'utf8');
 assert.match(main,/const elapsed=parseMeasuredNumber\(sample\?\.elapsedSeconds\)/);
 assert.match(main,/!\(elapsed>0\)/);
 assert.match(main,/elapsedSeconds: elapsed/);
});

test('guided size target distinguishes CQ samples from formal VBR and actual file bytes',async()=>{
 const main=await readFile(new URL('./main.js',import.meta.url),'utf8');
 assert.match(main,/CQ 短样预测 SSIM/);
 assert.match(main,/正式目标码率使用单遍 VBR/);
 assert.match(main,/CQ 短样曲线/);
 assert.match(main,/CQ 短样质量曲线不能代表正式 VBR 的整片 SSIM/);
 assert.match(main,/可能明显超出预算/);
 assert.match(main,/actualBytes>projection\.budgetBytes/);
});

test('guided size budget explicitly records execution policy and byte ceiling',async()=>{
 const main=await readFile(new URL('./main.js',import.meta.url),'utf8');
 assert.match(main,/id="guidedSizeBudgetPolicy"/);
 assert.match(main,/value="best-effort"/);
 assert.match(main,/value="two-pass"/);
 assert.match(main,/value="strict-ceiling"/);
 assert.match(main,/resolveGuidedSizePolicy/);
 assert.match(main,/sizeBudgetPolicy:executionPolicy\.policy/);
 assert.match(main,/sizeBudgetPolicy:plan\.sizeBudgetPolicy\|\|'best-effort'/);
 assert.match(main,/sizeCeilingBytes:plan\.mode==='budget-rate'\?plan\.sizeCeiling:0/);
 assert.match(main,/totalPasses>1/);
 assert.match(main,/成品超出预算会失败且不可导出/);
});
