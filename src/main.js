import { validateEncoderSupport } from './media-capabilities.js';
import { mountMediaWorkspace } from './media-workspace.js';
import { outputFileName, resolveOutputContainer } from './media-container.js';
import './style.css';
import { parseAss, rewriteAssFonts, shiftAssForPreview, findGlyphRiskPreviewTimes, mergePreviewTimes } from './ass.js';
import { inspectFontFile, matchRequestedFonts, analyzeFontUsageCoverage } from './fonts.js';
import { listSavedFonts, saveFonts as persistFonts, deleteSavedFont, clearSavedFonts, requestPersistentFontStorage, getFontStorageEstimate } from './font-store.js';
import { detectBasicCapabilities, detectCapabilities } from './capabilities.js';
import { EncoderEngine } from './engine.js';
import { decodeAssFile } from './ass-decoding.js';
import { detectWindowsNativeBridge } from './windows-native-client.js';
import { parseLibassFontDiagnostics, codePointDisplay } from './font-diagnostics.js';
import { normalizeCompressionEvidence, normalizeCompressionEvidenceList, qualityEvidenceRecord, runtimeEvidenceKey, sourceEvidenceKey } from './compression-evidence.js';
import { createSizeQualityFrontier, fitRateDistortionModel } from './rate-distortion-model.js';
import { buildSizeFrontierPlot, evidenceFractionForTargetBytes, targetBytesAtEvidenceFraction } from './size-frontier-ui.js';
import { renderRateDistortionSvg, plotFractionAtX, plotXFromClientX } from './curve-chart-svg.js';
import { createMultiBranchFrontier, calibrationTimeBudget, calibrationShouldContinue } from './compression-decision.js';
import { parseMeasuredQuality, parseMeasuredNumber } from './transcode-curves.js';

const MAX_BYTES = 1024 ** 3;
const APP_UPDATE_URL = './app-update.json';
const APP_PACKAGE = 'io.github.quickhardsub';
const APP_DOWNLOAD_FALLBACK = 'https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/releases/download/dev-builds/quick-automatic-hardsub-encoder-debug.apk';
const WINDOWS_SOURCE_ZIP = 'https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/archive/refs/heads/main.zip';
const WINDOWS_DOC_URL = 'https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/tree/main/windows';

const state = {
  video: null,
  ass: null,
  fonts: [],
  savedFonts: [],
  effectiveFonts: [],
  assInfo: null,
  assEncoding: 'unknown',
  assText: '',
  activeAssText: '',
  fontBindings: {},
  autoFontFallbacks: {},
  fontFaces: [],
  fallbackFontFaces: [],
  fontMatches: [],
  glyphCoverage: [],
  media: null,
  sourceMedia: null,
  engine: null,
  webEngineInitPromise: null,
  capabilities: null,
  nativeBackend: null,
  nativeSelfTest: null,
  nativeSelfTestStarted: false,
  nativeInputProbe: null,
  nativePreviewWaiters: new Map(),
  nativeFrameWaiters: new Map(),
  nativeOutputFrameWaiters: new Map(),
  nativeReferenceFrameWaiters: new Map(),
  nativeWaveformWaiters: new Map(),
  nativeSampleWaiters: new Map(),
  nativeJobId: null,
  nativeImportJobId: null,
  nativeCompletedJob: null,
  localBenchmarkHistory: [],
  appRelease: null,
  appUpdateCheck: null,
  softwareEncoders: { h264: null, h265: null, av1: null },
  softwareDecoders: { av1Dav1d: null },
  inputDecodeOk: false,
  previewUrls: [],
  previewBaseUrls: [],
  previewFontEvents: [],
  previewFontDiagnostics: [],
  previewVisualChange: [],
  previewTimes: [],
  previewRiskTimes: [],
  benchmarks: {},
  qualityCalibration: {},
  rateDistortionModels: {},
  sizeEnvelopeEnabled: false,
  qualityExplorationPoints: {},
  sizeBudgetTargetBytes: null,
  sizeFrontierPointerId: null,
  qualityCalibrationTarget: null,
  qualityCalibrationBusy: false,
  selectedCodec: null,
  selectedTest: null,
  selectedTests: {},
  latestNativeSampleId: null,
  acceptedWarnings: false,
  operationBusy: false,
  analyzedVideo: null,
  analyzedAss: null,
  analyzedFontKey: ''
};

const app = document.querySelector('#app');
app.innerHTML = `
<div class="app-shell">
  <header class="hero app-header">
    <div class="app-header-main">
      <div class="app-brand">
        <div class="app-mark" aria-hidden="true"><span>Q</span></div>
        <div class="app-brand-copy">
          <div id="runtimeKicker" class="hero-kicker">WEB MEDIA WORKBENCH</div>
          <h1 id="runtimeWorkbenchTitle">浏览器媒体处理工作台</h1>
        </div>
      </div>
      <div class="hero-state" aria-label="当前运行后端">
        <span class="hero-state-dot"></span>
        <div><strong id="heroRuntimeTitle">浏览器 / WASM</strong><small id="heroRuntimeDetail">文件留在当前浏览器</small></div>
      </div>
    </div>
    <p id="heroSubtitle" class="hero-subtitle">预检 · 真实预览 · 选方案 · 开始压制</p>
    <nav id="workflowStrip" class="workflow-strip" aria-label="硬字幕压制流程">
      <span data-workflow-step="assets"><b>01</b>素材</span>
      <span data-workflow-step="preflight"><b>02</b>预检</span>
      <span data-workflow-step="preview"><b>03</b>预览</span>
      <span data-workflow-step="plan"><b>04</b>方案</span>
      <span data-workflow-step="encode"><b>05</b>压制</span>
    </nav>
    <div id="nativeStatusBar" class="native-status-bar hidden" aria-live="polite"></div>
  </header>

  <section id="runtimeModeBanner" class="runtime-mode-banner" data-runtime="web" aria-live="polite">
    <span id="runtimeModeBadge" class="runtime-mode-badge">WEB / WASM</span>
    <div class="runtime-mode-copy">
      <strong id="runtimeModeTitle">浏览器后端</strong>
      <span id="runtimeModeDetail">由当前浏览器读取文件并运行 FFmpeg WebAssembly；单个视频建议不超过 1 GB。</span>
    </div>
  </section>

  <nav id="mobileStageNav" class="mobile-stage-nav" aria-label="移动端任务阶段">
    <button type="button" data-mobile-stage-target="prepare" aria-current="step">
      <span class="mobile-stage-index">01</span>
      <span class="mobile-stage-copy"><strong>准备素材</strong><small>视频 · 字幕 · 字体</small></span>
    </button>
    <button type="button" data-mobile-stage-target="produce" disabled>
      <span class="mobile-stage-index">02</span>
      <span class="mobile-stage-copy"><strong>预览与压制</strong><small>画面 · 方案 · 输出</small></span>
    </button>
  </nav>

  <section class="mobile-runtime-help" aria-label="本机运行教程">
    <div class="mobile-runtime-help-title">
      <div><strong>运行方式与教程</strong><span>Android / Windows</span></div>
    </div>
    <div class="mobile-runtime-help-grid">
      <details class="mobile-runtime-option android">
        <summary>
          <span class="runtime-option-icon">A</span>
          <span><strong>Android 教程</strong><small>安装 APK · 后台压制</small></span>
          <span class="runtime-option-arrow">›</span>
        </summary>
        <div class="runtime-option-body">
          <ol>
            <li>下载最新版 APK；若系统拦截，按提示允许当前来源安装。</li>
            <li>安装后打开 App，用系统文件选择器选择视频、ASS 与字体。</li>
            <li>长任务由前台服务持有，可从通知栏查看进度或取消。</li>
          </ol>
          <a class="runtime-help-link runtime-help-android" href="${APP_DOWNLOAD_FALLBACK}">下载 Android APK</a>
        </div>
      </details>
      <details class="mobile-runtime-option windows">
        <summary>
          <span class="runtime-option-icon">W</span>
          <span><strong>Windows 教程</strong><small>FFmpeg · NVENC · 大文件</small></span>
          <span class="runtime-option-arrow">›</span>
        </summary>
        <div class="runtime-option-body">
          <ol>
            <li>下载源码 ZIP 并完整解压。</li>
            <li>确认 FFmpeg 可用；缺少时可用 WinGet 安装 Gyan.FFmpeg。</li>
            <li>双击 <code>windows/start_windows.bat</code>，浏览器会自动连接本机 Bridge。</li>
          </ol>
          <div class="runtime-help-actions">
            <a class="runtime-help-link runtime-help-windows" href="${WINDOWS_SOURCE_ZIP}">下载 Windows 包</a>
            <a class="runtime-help-link" href="${WINDOWS_DOC_URL}" target="_blank" rel="noreferrer">详细说明</a>
          </div>
        </div>
      </details>
    </div>
  </section>

  <div class="workspace-layout">
    <main class="workflow-main">
  <div class="adaptive-region setup-region">
  <section id="inputCard" class="card input-card" data-mobile-stage-section="prepare">
    <div class="card-heading"><span class="step-no">01</span><div><h2>准备素材</h2><p>选择视频；硬字幕模式另需 ASS 和可选字体。</p></div></div>
    <div class="grid two">
      <div class="file-row input-video"><label id="videoLabel">视频（网页≤ 1 GB；Native 后端适合更大文件）</label><input id="video" class="file-input-control" type="file"><label id="videoWebPicker" class="file-picker-trigger" for="video">选择视频</label><button id="videoNativePickerBtn" class="native-picker-button hidden" type="button">选择视频</button><small id="videoMeta">未选择；视频格式交给 FFprobe 判断。</small></div>
      <div class="file-row input-ass"><label>ASS 字幕</label><input id="ass" class="file-input-control" type="file" accept=".ass,text/plain"><label id="assWebPicker" class="file-picker-trigger" for="ass">选择 ASS 字幕</label><button id="assNativePickerBtn" class="native-picker-button hidden" type="button">选择 ASS 字幕</button><small id="assMeta">未选择</small></div>
      <div class="file-row input-font">
        <label id="fontLabel">字体（可选，可多选）</label>
        <input id="fonts" class="file-input-control" type="file" multiple accept=".ttf,.otf,.ttc,.otc">
        <label id="fontsWebPicker" class="file-picker-trigger" for="fonts">选择字体文件</label>
        <button id="fontsNativePickerBtn" class="native-picker-button hidden" type="button">选择字体文件</button>
        <label id="fontPersistCheck" class="font-persist-check"><input id="rememberFonts" type="checkbox" checked> 记住本次选择，加入本机常用字体库</label>
        <small id="fontMeta">未选择；常用字体库会自动参与 ASS 字体匹配。</small>
        <details id="fontLibraryDetails" class="font-library-details">
          <summary id="savedFontsSummary">常用字体库：加载中…</summary>
          <div id="savedFontsList" class="font-library-list"></div>
          <div class="button-row"><button id="clearSavedFontsBtn" type="button">清空常用字体库</button></div>
        </details>
      </div>
      <div class="file-row input-engine"><label id="backendLabel">处理引擎</label>
        <div id="backendSummary" class="note">正在检测当前网页 / 原生运行环境…</div>
      </div>
    </div>
    <div id="sourceVideoSummary" class="status-list source-video-summary hidden" aria-live="polite"></div>
    <div id="sourceAdapterPanel" class="source-adapter-panel hidden" aria-live="polite">
      <div class="source-adapter-heading"><div><span>输入适配</span><strong id="sourceAdapterTitle">Bink 2</strong></div><span id="sourceAdapterBadge">EXTERNAL</span></div>
      <p id="sourceAdapterDetail"></p>
      <div class="button-row source-adapter-actions">
        <button id="sourceAdapterImportBtn" type="button" class="secondary">使用 RAD Video Tools 导入</button>
        <button id="sourceAdapterCancelBtn" type="button" class="secondary hidden">取消导入</button>
        <a id="sourceAdapterInstallLink" class="button-link" href="https://www.radgametools.com/bnkdown.htm" target="_blank" rel="noreferrer">获取 RAD Video Tools</a>
      </div>
      <p id="sourceAdapterStatus" class="note"></p>
    </div>
    <div class="button-row action-row"><button id="analyze" class="primary action-solid action-cyan" disabled>读取视频参数</button></div>
  </section>

  <section id="envCard" class="card env-card" data-mobile-stage-section="prepare">
    <details id="envDetails" class="env-details">
      <summary>
        <span class="env-heading">运行环境 · 诊断</span>
        <span id="envSummary" class="env-summary">检测中…</span>
      </summary>
      <div class="env-body">
        <div id="capabilities" class="status-list"><div class="status-item"><span>状态</span><span>检测中…</span></div></div>
        <p id="engineHint" class="note"></p>
      </div>
    </details>
  </section>
  </div>

  <section id="preflightCard" class="card preflight-card hidden" data-mobile-stage-section="prepare">
    <details id="preflightDetails" class="preflight-details">
      <summary>
        <span class="step-no">02</span>
        <span class="preflight-heading">媒体与字幕预检</span>
        <span id="preflightStatus" class="preflight-status">等待分析</span>
      </summary>
      <div class="preflight-body">
        <div id="subtitleSummary" class="status-list"></div>
        <div id="fontWarnings"></div>
        <div class="mobile-preflight-action">
          <button id="continueToProduceBtn" class="primary" type="button">进入预览与压制</button>
        </div>
      </div>
    </details>
  </section>

  <div class="adaptive-region production-region">
  <section id="subtitleCard" class="card preview-card hidden" data-mobile-stage-section="produce">
    <div class="card-heading preview-card-heading">
      <span class="step-no">03</span>
      <div><h2>真实字幕预览</h2><p>查看实际 libass 渲染结果。</p></div>
      <button id="previewBtn" class="preview-generate-action action-solid action-cyan" disabled>生成预览</button>
    </div>
    <div class="preview-workspace">
      <div class="preview-workspace-main">
        <div id="preview" class="preview-wrap"><div class="preview-placeholder">分析完成后可生成真实预览帧。</div></div>
        <div id="warningAccept" class="hidden preview-warning"><label><input type="checkbox" id="acceptWarnings"> 接受当前字体回退 / 缺失警告并继续</label></div>
      </div>
      <aside id="previewSampleRail" class="preview-sample-rail" aria-label="预览采样点">
        <div class="preview-sample-empty">生成后显示采样点</div>
      </aside>
    </div>
  </section>

  <div class="production-controls">
  <section id="hardsubControlDeck" class="card hardsub-control-deck" data-mobile-stage-section="produce">
    <div class="hardsub-control-head">
      <div>
        <h2>选择控制方式</h2>
        <p>两种方式共享同一份素材、预检、真实 libass 预览与输出验证；同一时刻只保留一个正式执行入口。</p>
      </div>
      <span class="hardsub-control-badge">HARDSUB</span>
    </div>
    <div id="hardsubStrategySwitcher" class="hardsub-strategy-switcher" role="group" aria-label="硬字幕压制控制方式">
      <button type="button" data-hardsub-strategy="guided" aria-pressed="true">
        <span class="hardsub-strategy-kicker">GOAL DRIVEN</span>
        <strong>目标控制</strong>
        <small>快速预设 / 目标质量 / 目标体积。先表达目标，再由系统映射编码参数。</small>
      </button>
      <button type="button" data-hardsub-strategy="manual" aria-pressed="false">
        <span class="hardsub-strategy-kicker">PARAMETER DRIVEN</span>
        <strong>参数控制</strong>
        <small>直接控制 codec、preset、CRF/CQ、帧率、尺寸、滤镜、音轨与封装。</small>
      </button>
    </div>
  </section>
  <div id="sharedMediaOutputMount"></div>
  <div id="hardsubManualMount"></div>
  <section id="planCard" class="card plan-card hidden" data-mobile-stage-section="produce">
    <div class="card-heading"><span class="step-no">04</span><div><h2>输出策略</h2><p>先定义目标，再选择实际可用的编码器与测试路径。</p></div></div>

    <input id="encodeGoal" type="hidden" value="balanced">
    <input id="qualityTarget" type="hidden" value="0.985">
    <input id="sizeBudgetMultiplier" type="hidden" value="1.60">
    <input id="sizeBudgetBytes" type="hidden" value="">

    <div class="plan-mode-tabs" role="tablist" aria-label="压制方式">
      <button type="button" class="plan-mode-tab plan-interaction selected" data-plan-mode="quick" aria-pressed="true">
        <strong>快速预设</strong><small>直接生成参数</small>
      </button>
      <button type="button" class="plan-mode-tab plan-interaction" data-plan-mode="quality" aria-pressed="false">
        <strong>目标质量</strong><small>实测后校准</small>
      </button>
      <button type="button" class="plan-mode-tab plan-interaction" data-plan-mode="size" aria-pressed="false">
        <strong>目标体积</strong><small>按预算反推码率</small>
      </button>
    </div>

    <div class="plan-controls">
      <div class="plan-mode-stack">
        <div id="quickPlanPanel" class="plan-mode-panel" data-plan-panel="quick">
          <div class="plan-slider-head"><div><strong>预设倾向</strong></div><output id="quickPresetValue" class="plan-slider-value">均衡</output></div>
          <input id="quickPresetRange" class="plan-slider plan-interaction" type="range" min="0" max="2" step="1" value="1" aria-label="快速预设倾向">
          <div class="plan-slider-scale"><span>更快</span><span>均衡</span><span>更精细</span></div>
          <div id="quickPresetDetail" class="plan-value-detail plan-slider-feedback"></div>
        </div>

        <div id="qualityPlanPanel" class="plan-mode-panel hidden" data-plan-panel="quality">
          <div class="plan-slider-head"><div><strong>目标 SSIM</strong></div><output id="qualityTargetValue" class="plan-slider-value">0.985</output></div>
          <input id="qualityTargetRange" class="plan-slider plan-interaction" type="range" min="0.980" max="0.990" step="0.001" value="0.985" aria-label="目标 SSIM">
          <div class="plan-slider-scale"><span>较宽松 · 0.980</span><span>默认 · 0.985</span><span>较严格 · 0.990</span></div>
          <div id="qualityTargetDetail" class="plan-value-detail plan-slider-feedback">当前阈值 0.985；改动后需要重新校准。</div>
          <label class="quality-auto-codec"><input id="qualityAutoCodec" class="plan-interaction" type="checkbox" checked> 自动比较可用编码器，在达到同一 SSIM 后优先选择更低样本码率；差异很小时偏向更快者。</label>
          <div id="qualityCalibrationControls" class="quality-calibration">
            <button id="calibrateQualityBtn" type="button">比较可用编码器并校准</button>
            <small>校准会对代表性短片段反复试编码。短样本用于寻找参数边界，不是整片质量保证。</small>
            <div id="qualityCalibrationResult" class="note"></div>
            <p id="qualityExplorationReadout" class="note" role="status">校准前没有实测参数。</p>
          </div>
        </div>

        <div id="sizePlanPanel" class="plan-mode-panel hidden" data-plan-panel="size">
          <div class="plan-slider-head"><div><strong>目标输出上限</strong></div><output id="sizeBudgetValue" class="plan-slider-value">×1.60</output></div>

          <div id="sizeFrontierPanel" class="size-frontier-panel">
            <div class="size-frontier-head">
              <div>
                <strong>实测效率曲线</strong>
                <small id="sizeFrontierSubtitle">先对当前编码器做短片段实测；有足够证据后可直接沿曲线选择体积。</small>
              </div>
              <div class="size-frontier-actions">
                <button id="calibrateSizeFrontierBtn" class="plan-interaction" type="button">生成当前编码器曲线</button>
                <button id="compareSizeFrontierBtn" class="plan-interaction secondary" type="button">比较可用编码器</button>
              </div>
            </div>
            <div id="sizeFrontierEmpty" class="size-frontier-empty note">尚无当前编码器的 R-D 模型。仍可使用下方手动倍率预算。</div>
            <div id="sizeFrontierChartWrap" class="size-frontier-chart-wrap hidden">
              <svg id="sizeFrontierChart" class="size-frontier-chart" viewBox="0 0 720 300" role="slider" tabindex="0" aria-label="沿实测体积质量曲线选择目标体积"></svg>
              <div class="size-frontier-scale">
                <span id="sizeFrontierMin">—</span>
                <span id="sizeFrontierKnee">实测范围</span>
                <span id="sizeFrontierMax">—</span>
              </div>
            </div>
            <div class="media-curve-legend"><span class="legend-observed">原始观测</span><span class="legend-fit">保序拟合</span><span class="legend-band">范围插值</span><span class="legend-whisker">场景范围</span></div>
            <div id="sizeFrontierReadout" class="size-frontier-readout">当前仍按手动倍率规划；拖动曲线后切换为实测预算。</div>
            <button id="adoptSizeFrontierBranchBtn" type="button" class="secondary plan-interaction hidden">采用推荐编码器</button>
          </div>

          <details id="sizeManualBudget" class="size-manual-budget">
            <summary>手动按源文件倍率设置</summary>
            <input id="sizeBudgetRange" class="plan-slider plan-interaction" type="range" min="0.75" max="2.00" step="0.05" value="1.60" aria-label="目标输出体积相对源文件倍率">
            <div class="plan-slider-scale"><span>更紧</span><span>源文件 ×1.0</span><span>更宽松</span></div>
            <div class="size-snap-row" aria-label="体积预算快捷值">
              <button type="button" class="plan-interaction" data-size-multiplier="1.00">×1.00</button>
              <button type="button" class="plan-interaction" data-size-multiplier="1.25">×1.25</button>
              <button type="button" class="plan-interaction" data-size-multiplier="1.60">×1.60</button>
              <button type="button" class="plan-interaction" data-size-multiplier="2.00">×2.00</button>
            </div>
          </details>
          <div id="sizeBudgetDetail" class="plan-value-detail plan-slider-feedback">选择视频后显示对应的实际字节上限。</div>
        </div>
      </div>
    </div>
    <div id="sourceAnchor" class="plan-anchor note">分析后显示源片锚点。</div>
    <div id="codecPlanGrid" class="grid three codec-plan-grid" style="margin-top:14px"></div>
    <div id="chosenSummary" class="note plan-summary">请选择一个编码器。</div>

    <div class="button-row">
      <button id="testSelectedBtn" class="action-solid action-cyan-soft" disabled>生成测试片段</button>
    </div>
    <div id="selectedTestResult" class="hidden"></div>

    <details class="advanced-box">
      <summary>诊断：固定参数编码器基准测试</summary>
      <p class="note">固定一组参考 CRF/preset，观察当前设备上的编码速度、SSIM 与样本码率。它不参与自动选参，也不是等质量比较；等质量选择请使用上方“目标质量”的自动编码器模式。</p>
      <div class="button-row"><button id="benchmarkBtn" disabled>比较 H.264 / H.265 / AV1</button></div>
      <div id="codecGrid" class="grid three" style="margin-top:14px"></div>
    </details>
  </section>

  <section id="encodeCard" class="card encode-card hidden" data-mobile-stage-section="produce">
    <div class="card-heading"><span class="step-no">05</span><div><h2>执行与验证</h2><p>由实际编码器完成整片任务；结束后验证容器、视频流与输出结果。</p></div></div>
    <div id="liveEta" class="note">开始压制后根据 FFmpeg 实际进度动态计算速度与剩余时间。</div>
    <div class="button-row">
      <button id="encodeBtn" class="primary action-solid action-green" disabled>开始硬字幕压制</button>
      <button id="cancelEncodeBtn" class="hidden" type="button">取消压制</button>
    </div>
    <div class="progress"><div id="progressBar"></div></div>
  </section>

  </div>
  </div>

  <details class="card log-card">
    <summary class="log-summary"><span class="step-no">LOG</span><strong>技术日志</strong><span>仅在排错时展开</span></summary>
    <div id="log" class="log">Quick-Automatic-Hardsub-Encoder v0.2.0\n</div>
  </details>
    </main>
    <aside id="taskOverviewRail" class="task-overview-rail" aria-label="任务概览">
      <section class="card task-overview-card">
        <div class="task-overview-head">
          <div><h2>任务概览</h2><p>当前文件、预检、预览与压制方案。</p></div>
          <span id="overviewReadyBadge" class="task-overview-badge">待准备</span>
        </div>
        <div class="task-overview-group">
          <h3>媒体与字幕</h3>
          <dl>
            <div><dt>视频</dt><dd id="overviewVideo">未选择</dd></div>
            <div><dt>媒体</dt><dd id="overviewMedia">等待分析</dd></div>
            <div><dt>字幕</dt><dd id="overviewAss">未选择</dd></div>
            <div><dt>字体</dt><dd id="overviewFonts">未选择</dd></div>
          </dl>
        </div>
        <div class="task-overview-group">
          <h3>制作状态</h3>
          <dl>
            <div><dt>预检</dt><dd id="overviewPreflight">等待分析</dd></div>
            <div><dt>预览</dt><dd id="overviewPreview">未生成</dd></div>
            <div><dt>方案</dt><dd id="overviewPlan">未选择</dd></div>
          </dl>
        </div>
        <div class="task-overview-group task-overview-final">
          <h3>任务状态</h3>
          <p id="overviewTaskState">选择视频、ASS 并完成分析后即可继续。</p>
        </div>
      </section>
    </aside>
    <aside class="platform-rail" aria-label="运行方式">
      <div class="platform-rail-heading">
        <div>
          <h2>选择运行方式</h2>
          <p>网页可直接使用；长任务可切到 Android App 或 Windows 本地。</p>
        </div>
      </div>
      <section id="windowsNativeCard" class="card platform-card windows-card">
        <div class="platform-card-head">
          <div><div class="platform-eyebrow">WINDOWS NATIVE</div><h2>Windows 本机运行</h2><p class="note">长视频、系统 FFmpeg 与 NVIDIA NVENC。</p></div>
          <span class="platform-badge">推荐</span>
        </div>
        <div class="button-row platform-actions">
          <a class="button-link platform-primary-link" href="${WINDOWS_SOURCE_ZIP}">下载 Windows 源码包</a>
          <a class="button-link" href="${WINDOWS_DOC_URL}" target="_blank" rel="noreferrer">运行说明</a>
        </div>
        <details class="platform-guide">
          <summary>第一次使用？3 步启动</summary>
          <ol>
            <li>下载 ZIP 后完整解压，不要直接在压缩包内运行。</li>
            <li>确认 FFmpeg 可用；没有时在 PowerShell 运行 <code>winget install --id Gyan.FFmpeg -e --source winget</code>。</li>
            <li>双击 <code>windows/start_windows.bat</code>。它会启动 localhost Bridge 并自动打开当前界面。</li>
          </ol>
          <p>若启动失败，再使用 <code>windows/start_windows_debug.bat</code> 查看控制台错误。</p>
        </details>
      </section>

      <section id="androidAppCard" class="card app-card">
        <div class="app-card-head">
          <div><h2 id="appCardTitle">Android 应用</h2><p id="appReleaseSummary" class="note">正在读取最新版信息…</p></div>
          <span id="appModeBadge" class="app-mode-badge">网页</span>
        </div>
        <div class="button-row platform-actions">
          <button id="openAndroidAppBtn" class="primary" type="button">打开 Android App</button>
          <a id="downloadAndroidAppBtn" class="button-link" href="${APP_DOWNLOAD_FALLBACK}">下载最新版 APK</a>
          <button id="checkAppUpdateBtn" class="hidden" type="button">检查更新</button>
        </div>
        <div id="appUpdateNotice" class="note app-update-notice">Android 浏览器可直接拉起已安装的 App；未安装时回退到 APK 下载。</div>
        <details class="platform-guide">
          <summary>第一次使用？3 步安装</summary>
          <ol>
            <li>下载最新版 APK；若 Android 阻止安装，按系统提示允许当前浏览器或文件管理器安装此来源的应用。</li>
            <li>安装后打开“硬字幕压制”，通过系统文件选择器选择视频；硬字幕模式另需 ASS 和可选字体。</li>
            <li>开始正式压制后可离开当前页面；前台服务会持有任务，并在通知栏显示进度与取消入口。</li>
          </ol>
          <p>更新使用同一包名 <code>io.github.quickhardsub</code>；正常更新不需要先卸载旧版。</p>
        </details>
      </section>
    </aside>
  </div>
</div>`;

const $ = id => document.getElementById(id);

const WINDOW_SIZE_CLASS = Object.freeze({
  compactMax: 599,
  mediumMax: 839,
  expandedMax: 1199,
  largeMax: 1599
});

function resolveWindowSizeClass(width = window.innerWidth) {
  if (width <= WINDOW_SIZE_CLASS.compactMax) return 'compact';
  if (width <= WINDOW_SIZE_CLASS.mediumMax) return 'medium';
  if (width <= WINDOW_SIZE_CLASS.expandedMax) return 'expanded';
  if (width <= WINDOW_SIZE_CLASS.largeMax) return 'large';
  return 'extra-large';
}

function applyWindowSizeClass() {
  document.documentElement.dataset.windowSize = resolveWindowSizeClass();
}

const MOBILE_STAGE_ORDER = ['prepare', 'produce'];

function resolvePresentationShell(width = window.innerWidth) {
  if (width <= 640) return 'phone';
  if (width <= 1180 || window.matchMedia('(pointer: coarse)').matches) return 'tablet';
  return 'desktop';
}

function devicePrefersMobileShell() {
  return resolvePresentationShell() === 'phone';
}

function applyPresentationShell() {
  const shell = resolvePresentationShell();
  document.body.classList.remove('ui-mobile', 'ui-phone', 'ui-tablet', 'ui-desktop');
  if (shell === 'phone') {
    document.body.classList.add('ui-mobile', 'ui-phone');
    if (!document.body.dataset.mobileStage) document.body.dataset.mobileStage = 'prepare';
  } else if (shell === 'tablet') {
    document.body.classList.add('ui-tablet');
  } else {
    document.body.classList.add('ui-desktop');
  }
  document.documentElement.dataset.uiShell = shell;
  syncMobileStageNav();
}

function mobileStageAvailable(stage) {
  if (stage === 'prepare') return true;
  if (stage === 'produce') {
    return !$('subtitleCard')?.classList.contains('hidden') &&
      !$('planCard')?.classList.contains('hidden') &&
      !$('encodeCard')?.classList.contains('hidden');
  }
  return false;
}

function runtimeWorkbenchTitle(stage = document.body.dataset.mobileStage || 'prepare') {
  if (state.nativeBackend?.backend === 'windows-native') {
    return document.body.classList.contains('ui-phone')
      ? (stage === 'produce' ? 'Windows · 预览与处理' : 'Windows Native')
      : 'Windows Native 媒体工作台';
  }
  if (state.nativeBackend?.backend === 'android-native') {
    return document.body.classList.contains('ui-phone')
      ? (stage === 'produce' ? 'Android · 预览与处理' : 'Android Native')
      : 'Android Native 媒体工作台';
  }
  return document.body.classList.contains('ui-phone')
    ? (stage === 'produce' ? '预览与处理' : '浏览器处理')
    : '浏览器媒体处理工作台';
}

function syncMobileStageNav() {
  const nav = $('mobileStageNav');
  if (!nav) return;
  const current = document.body.dataset.mobileStage || 'prepare';
  const mobileTitle = $('runtimeWorkbenchTitle');
  if (mobileTitle) mobileTitle.textContent = runtimeWorkbenchTitle(current);
  for (const button of nav.querySelectorAll('[data-mobile-stage-target]')) {
    const stage = button.dataset.mobileStageTarget;
    button.disabled = !mobileStageAvailable(stage);
    if (stage === current) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
}

function setMobileStage(stage, { scroll = true } = {}) {
  if (!MOBILE_STAGE_ORDER.includes(stage) || !mobileStageAvailable(stage)) return;
  document.body.dataset.mobileStage = stage;
  syncMobileStageNav();
  if (stage === 'produce') ensureNativeSelfTestStarted();
  if (document.body.classList.contains('ui-mobile') && scroll) {
    const target = stage === 'prepare' ? $('inputCard') : $('subtitleCard');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

$('mobileStageNav')?.addEventListener('click', event => {
  const button = event.target.closest('[data-mobile-stage-target]');
  if (!button || button.disabled) return;
  setMobileStage(button.dataset.mobileStageTarget);
});

$('continueToProduceBtn')?.addEventListener('click', () => {
  setMobileStage('produce');
});

applyWindowSizeClass();
applyPresentationShell();
window.addEventListener('resize', () => {
  applyWindowSizeClass();
  applyPresentationShell();
}, { passive: true });

function overviewText(value, fallback = '—') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function syncTaskOverview() {
  const rail = $('taskOverviewRail');
  if (!rail) return;

  $('overviewVideo').textContent = state.video?.name || '未选择';
  $('overviewAss').textContent = state.ass?.name || '未选择';
  $('overviewFonts').textContent = state.fonts?.length
    ? state.fonts.length + ' 个文件'
    : (state.savedFonts?.length ? '常用库 ' + state.savedFonts.length + ' 个文件' : '未选择');

  $('overviewMedia').textContent = state.media
    ? overviewText(
        (state.media.videoCodec || 'unknown').toUpperCase() + ' · ' +
        state.media.width + '×' + state.media.height + ' · ' +
        Number(state.media.fps || 0).toFixed(2) + ' fps'
      )
    : '等待分析';

  $('overviewPreflight').textContent = overviewText($('preflightStatus')?.textContent, '等待分析');
  $('overviewPreview').textContent = state.previewUrls?.filter(Boolean).length
    ? state.previewUrls.filter(Boolean).length + ' 张真实预览'
    : '未生成';

  const manualHardsub = document.body.dataset.mediaOperation === 'hardsub' &&
    document.body.dataset.hardsubStrategy === 'manual';
  const chosen = overviewText($('chosenSummary')?.textContent, '未选择');
  $('overviewPlan').textContent = manualHardsub
    ? '参数控制 · 显式控制编码、画面、音轨与封装'
    : (chosen.length > 58 ? chosen.slice(0, 58) + '…' : chosen);

  const guidedReady = !!$('encodeBtn') && !$('encodeBtn').disabled && !$('encodeCard')?.classList.contains('hidden') &&
    !$('encodeCard')?.classList.contains('hardsub-strategy-suppressed');
  const manualGateReady = manualHardsub && workflowReadiness().ready;
  const ready = guidedReady || manualGateReady;
  $('overviewReadyBadge').textContent = manualGateReady ? '可检查参数' : guidedReady ? '已就绪' : (state.media ? '处理中' : '待准备');
  $('overviewReadyBadge').classList.toggle('is-ready', ready);
  $('overviewTaskState').textContent = manualGateReady
    ? '字幕分析与真实预览门槛已满足；检查当前参数后即可执行。'
    : guidedReady
      ? '当前素材与方案已满足正式压制条件。'
      : state.media
        ? '继续生成真实字幕预览并确认当前方案。'
        : '选择视频、ASS 并完成分析后即可继续。';
}

const overviewObserver = new MutationObserver(syncTaskOverview);
for (const id of ['videoMeta','assMeta','preflightStatus','chosenSummary','preview','encodeCard','encodeBtn']) {
  const node = $(id);
  if (node) overviewObserver.observe(node, { childList: true, subtree: true, characterData: true, attributes: true });
}
for (const id of ['video','ass','fonts','encodeGoal','qualityTarget','sizeBudgetMultiplier']) {
  $(id)?.addEventListener('change', () => queueMicrotask(syncTaskOverview));
}
syncTaskOverview();

const log = msg => { $('log').textContent += `${msg}\n`; $('log').scrollTop = $('log').scrollHeight; };
state.engine = new EncoderEngine(log);

function currentFontKey() {
  return state.fonts.map(file => `${file.name}:${file.size}:${file.lastModified}`).join('|');
}

function notifyMediaInfoChanged() {
  document.dispatchEvent(new Event('quick-hardsub-media-info-changed'));
}

function cancelPendingNativeInputWork(reason = '输入已变化') {
  const error = new Error(reason);
  for (const map of [
    state.nativePreviewWaiters,
    state.nativeFrameWaiters,
    state.nativeWaveformWaiters,
    state.nativeSampleWaiters
  ]) {
    for (const waiter of map.values()) {
      clearTimeout(waiter.timer);
      try { waiter.reject(error); } catch {}
    }
    map.clear();
  }
}

function invalidateAnalysis({ clearVideoMetadata = false } = {}) {
  cancelPendingNativeInputWork('输入已变化，旧 Native 请求已取消');
  if (clearVideoMetadata) {
    state.sourceMedia = null;
    const sourceSummary = $('sourceVideoSummary');
    if (sourceSummary) {
      sourceSummary.classList.add('hidden');
      sourceSummary.innerHTML = '';
    }
  }
  state.analyzedVideo = null;
  state.analyzedAss = null;
  state.analyzedFontKey = '';
  state.inputDecodeOk = false;
  state.media = null;
  state.assInfo = null;
  state.assText = '';
  state.activeAssText = '';
  state.fontMatches = [];
  state.fontFaces = [];
  state.fallbackFontFaces = [];
  state.glyphCoverage = [];
  state.selectedCodec = null;
  state.acceptedWarnings = false;
  $('acceptWarnings').checked = false;
  for (const url of [...state.previewUrls, ...state.previewBaseUrls]) {
    if (url) URL.revokeObjectURL(url);
  }
  clearSelectedTestCache();
  state.previewUrls = [];
  state.previewBaseUrls = [];
  state.previewFontEvents = [];
  state.previewFontDiagnostics = [];
  state.previewVisualChange = [];
  state.previewTimes = [];
  state.previewRiskTimes = [];
  state.benchmarks = {};
  invalidateQualityCalibration();
  $('preview').innerHTML = '<div class="preview-placeholder">输入已变化，请重新分析并生成预览。</div>';
  $('previewBtn').disabled = true;
  for (const id of ['preflightCard', 'subtitleCard', 'planCard', 'encodeCard']) $(id).classList.add('hidden');
  setMobileStage('prepare', { scroll: false });
  syncMobileStageNav();
  refreshBenchmarkEnabled();
}

function clearSelectedTestCache() {
  const sampleUrls = new Set();
  for (const result of Object.values(state.selectedTests || {})) {
    if (result?.sampleUrl) sampleUrls.add(result.sampleUrl);
  }
  if (state.selectedTest?.sampleUrl) sampleUrls.add(state.selectedTest.sampleUrl);
  for (const url of sampleUrls) URL.revokeObjectURL(url);

  state.selectedTests = {};
  state.selectedTest = null;
  state.latestNativeSampleId = null;

  const resultBox = $('selectedTestResult');
  if (resultBox) {
    resultBox.classList.add('hidden');
    resultBox.innerHTML = '';
  }
}

async function runWebTask(task) {
  if (state.operationBusy) return;
  state.operationBusy = true;
  syncTaskInputMutationLocks();
  refreshAnalyze();
  refreshBenchmarkEnabled();
  $('previewBtn').disabled = true;
  $('calibrateQualityBtn').disabled = true;
  try {
    await task();
  } catch (error) {
    log('任务失败：' + (error?.message || error));
    alert('任务失败：' + (error?.message || error));
  } finally {
    state.operationBusy = false;
    syncTaskInputMutationLocks();
    refreshAnalyze();
    refreshBenchmarkEnabled();
    $('previewBtn').disabled =
      !state.assInfo?.previewTimes?.length ||
      !(state.engine.ready || state.nativeBackend?.available);
    updateQualityCalibrationControls();
  }
}

const WINDOWS_NATIVE_PICKERS = {
  video: { inputId: 'video', buttonId: 'videoNativePickerBtn', metaId: 'videoMeta', label: '视频' },
  ass: { inputId: 'ass', buttonId: 'assNativePickerBtn', metaId: 'assMeta', label: 'ASS 字幕' },
  fonts: { inputId: 'fonts', buttonId: 'fontsNativePickerBtn', metaId: 'fontMeta', label: '字体' }
};

function setWindowsNativePickerBusy(role, busy) {
  const config = WINDOWS_NATIVE_PICKERS[role];
  const button = config ? $(config.buttonId) : null;
  if (!button) return;
  button.disabled = !!busy || state.operationBusy || !!state.nativeJobId || !!state.nativeImportJobId;
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
  button.textContent = busy ? '正在打开系统选择器…' : (role === 'video' ? '选择视频' : role === 'ass' ? '选择 ASS 字幕' : '选择字体文件');
}

function syncTaskInputMutationLocks() {
  const locked = state.operationBusy || !!state.nativeJobId || !!state.nativeImportJobId;
  for (const id of ['video', 'ass', 'fonts', 'encodeGoal', 'qualityTarget', 'sizeBudgetMultiplier']) {
    if ($(id)) $(id).disabled = locked;
  }
  document.querySelectorAll('.font-binding-select, .plan-interaction, .remove-saved-font, #taskOutputPolicy [name]').forEach(control => {
    control.disabled = locked;
  });
  if ($('clearSavedFontsBtn')) $('clearSavedFontsBtn').disabled = locked || !state.savedFonts.length;
  if ($('sourceAdapterImportBtn')) {
    const required = !!state.nativeInputProbe?.sourceAdapterRequired;
    const available = !!state.nativeInputProbe?.sourceAdapterAvailable || !!state.nativeBackend?.bink2ImportAvailable;
    $('sourceAdapterImportBtn').disabled = locked || !required || !available;
  }
  for (const role of Object.keys(WINDOWS_NATIVE_PICKERS)) {
    const button = $(WINDOWS_NATIVE_PICKERS[role].buttonId);
    setWindowsNativePickerBusy(role, button?.getAttribute('aria-busy') === 'true');
  }
}

function requestWindowsNativePicker(role) {
  const config = WINDOWS_NATIVE_PICKERS[role];
  const bridge = globalThis.NativeHardsub;
  if (!config || !bridge?.__windowsNative || !bridge?.preparePickerRole) return false;
  if (state.operationBusy || state.nativeJobId || state.nativeImportJobId) {
    log('Windows Native：任务运行期间不能更换输入素材；请先等待完成或取消当前任务。');
    return false;
  }
  try {
    setWindowsNativePickerBusy(role, true);
    bridge.preparePickerRole(role);
    log('Windows Native：正在打开系统' + config.label + '文件选择器…');
    return true;
  } catch (error) {
    setWindowsNativePickerBusy(role, false);
    log('Windows Native 文件选择器启动失败：' + (error?.message || error));
    return false;
  }
}

for (const [inputId, role] of [['video', 'video'], ['ass', 'ass'], ['fonts', 'fonts']]) {
  $(inputId).addEventListener('click', event => {
    try {
      if (globalThis.NativeHardsub?.__windowsNative) {
        event.preventDefault();
        requestWindowsNativePicker(role);
        return;
      }
      globalThis.NativeHardsub?.preparePickerRole?.(role);
    } catch {}
  });
}

for (const [role, config] of Object.entries(WINDOWS_NATIVE_PICKERS)) {
  $(config.buttonId)?.addEventListener('click', () => requestWindowsNativePicker(role));
}

$('video').addEventListener('change', e => {
  state.video = e.target.files?.[0] || null;
  state.nativeInputProbe = null;
  invalidateAnalysis({ clearVideoMetadata: true });
  renderSourceAdapterState(null);
  notifyMediaInfoChanged();
  $('videoMeta').textContent = state.video ? `${state.video.name} · ${formatBytes(state.video.size)}` : '未选择';
  if ($('videoWebPicker')) $('videoWebPicker').textContent = state.video ? '更换视频' : '选择视频';
  const browserTooLarge = !state.nativeBackend?.available && state.video?.size > MAX_BYTES;
  $('videoMeta').className = browserTooLarge ? 'bad' : '';

  if (state.video && globalThis.NativeHardsub?.probeSelectedVideo) {
    try {
      globalThis.NativeHardsub.probeSelectedVideo();
      log(state.nativeBackend?.backend === 'windows-native'
        ? 'Windows Native：正在使用系统 FFprobe 探测所选视频…'
        : 'Android Native：正在直接探测所选 content:// 视频和 SAF 可寻址性…');
    } catch (error) {
      log(nativePlatformName() + ' 输入探测启动失败：' + error.message);
    }
  }

  if (state.video && !state.nativeBackend?.available) {
    void ensureWebEngineReady().catch(() => {});
  }

  refreshAnalyze();
});
$('ass').addEventListener('change', e => {
  state.ass = e.target.files?.[0] || null;
  invalidateAnalysis();
  $('assMeta').textContent = state.ass ? state.ass.name : '未选择';
  if ($('assWebPicker')) $('assWebPicker').textContent = state.ass ? '更换字幕' : '选择 ASS 字幕';
  $('assMeta').className = '';
  if (state.ass) log('字幕文件已接收：' + state.ass.name + ' · ' + formatBytes(state.ass.size));
  refreshAnalyze();
});
$('fonts').addEventListener('change', async e => {
  state.fonts = [...(e.target.files || [])];
  invalidateAnalysis();
  updateFontMeta();
  if ($('fontsWebPicker')) $('fontsWebPicker').textContent = state.fonts.length ? '更换字体' : '选择字体文件';

  if (!state.nativeBackend?.available && $('rememberFonts').checked && state.fonts.length) {
    const valid = [];
    for (const file of state.fonts) {
      try {
        await inspectFontFile(file);
        valid.push(file);
      } catch (error) {
        log(`未保存到常用字体库：${file.name} · ${error.message}`);
      }
    }

    if (valid.length) {
      try {
        const persistence = await requestPersistentFontStorage();
        await persistFonts(valid);
        state.savedFonts = await listSavedFonts();
        renderSavedFontLibrary();
        updateFontMeta();

        const estimate = await getFontStorageEstimate();
        const persistenceText = persistence.persisted
          ? '浏览器已将站点存储标记为持久化'
          : persistence.supported
            ? '浏览器未授予持久化存储，低存储空间时仍可能被清理'
            : '当前浏览器不支持持久化存储请求';

        const quotaText = estimate?.quota
          ? ` · 站点存储约 ${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}`
          : '';

        log(`已将 ${valid.length} 个字体保存到本机常用字体库；${persistenceText}${quotaText}。`);
      } catch (error) {
        log(`保存常用字体失败：${error.message}`);
      }
    }
  }
});
$('acceptWarnings').addEventListener('change', e => {
  state.acceptedWarnings = e.target.checked;
  refreshBenchmarkEnabled();
});

$('analyze').addEventListener('click', () => runWebTask(analyzeCurrentInputs));
$('sourceAdapterImportBtn')?.addEventListener('click', () => {
  void startBink2Import().catch(error => {
    log('Bink 2 导入启动失败：' + error.message);
    $('sourceAdapterStatus').textContent = '无法开始导入：' + error.message;
  });
});
$('sourceAdapterCancelBtn')?.addEventListener('click', () => {
  const jobId = state.nativeImportJobId;
  if (!jobId) return;
  try {
    globalThis.NativeHardsub?.cancelBink2Import?.(jobId);
    $('sourceAdapterStatus').textContent = '正在请求取消 Bink 2 导入…';
  } catch (error) {
    log('取消 Bink 2 导入失败：' + error.message);
  }
});
$('previewBtn').addEventListener('click', () => runWebTask(renderPreviews));
const QUICK_PRESET_GOALS = ['speed', 'balanced', 'quality'];
const QUICK_PRESET_LABELS = ['更快', '均衡', '更精细'];

function planModeFromGoal(goal) {
  if (QUICK_PRESET_GOALS.includes(goal)) return 'quick';
  if (goal === 'targetQuality' || goal === 'efficiency') return 'quality';
  return 'size';
}

function setSliderProgress(input) {
  if (!input) return;
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value || min);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--slider-progress', Math.max(0, Math.min(100, pct)).toFixed(2) + '%');
}

function updateQuickPresetPreview() {
  const range = $('quickPresetRange');
  if (!range) return;
  const index = Math.max(0, Math.min(2, Math.round(Number(range.value) || 0)));
  const goal = QUICK_PRESET_GOALS[index];
  $('quickPresetValue').textContent = QUICK_PRESET_LABELS[index];
  const codec = state.selectedCodec || chooseDefaultCodec(goal);
  if (codec) {
    const p = profileFor(codec, goal);
    $('quickPresetDetail').textContent =
      codec.toUpperCase() + ' · CRF ' + p.crf + ' · ' + p.preset;
  } else {
    $('quickPresetDetail').textContent = '';
  }
  setSliderProgress(range);
}

function updateQualityTargetPreview() {
  const range = $('qualityTargetRange');
  if (!range) return;
  const preview = Number(range.value || 0.985);
  const committed = Number($('qualityTarget')?.value || 0.985);
  $('qualityTargetValue').textContent = preview.toFixed(3);
  $('qualityTargetDetail').textContent =
    Math.abs(preview - committed) > 0.0001
      ? '预览阈值 ' + preview.toFixed(3) + '；松手后提交并要求重新校准。'
      : '当前阈值 ' + committed.toFixed(3) +
        (state.qualityCalibrationTarget === committed ? '；已有校准结果可复用。' : '；需要实测校准。');
  setSliderProgress(range);
}

function estimatedSizeBudgetAudioBitrate() {
  const media = state.media;
  if (!media?.duration || !state.video) return 0;
  const audioSettings = guidedHardsubAudioSettings();
  const tracks = Math.max(0, Number(media.audioTracks || 0));
  if (audioSettings.audio === 'none') return 0;
  if (audioSettings.audio === 'aac' || audioSettings.audio === 'libopus') {
    return Math.max(0, Number(audioSettings.audioBitrate || 128000)) * tracks;
  }

  const totalAverage = Number(state.video.size || 0) * 8 / media.duration;
  const sourceVideoBitrate = getSourceVideoBitrate();
  let audioBitRate = Number(media.audioBitRate || 0);
  if (!audioBitRate && totalAverage > sourceVideoBitrate) {
    audioBitRate = Math.max(0, totalAverage - sourceVideoBitrate);
  }
  if (!audioBitRate && tracks > 0) audioBitRate = 256000 * tracks;
  return Math.max(0, audioBitRate);
}

function currentSizeFrontier(codec = null) {
  if (!state.media?.duration) return null;
  const budget={
    durationSeconds:Number(state.media.duration),audioBitrate:estimatedSizeBudgetAudioBitrate(),
    reservePercent:4,containerReservePercent:1,fixedReserveBytes:256*1024,minimumVideoBitrate:150000
  };
  if(codec===null && state.sizeEnvelopeEnabled) {
    const scope=sourceEvidenceKey(state.media,state.video?.name,Number(state.video?.size||0))+
      ':'+currentRuntimeEvidenceKey();
    const branches=['h264','h265','av1']
      .filter(id=>state.softwareEncoders[id]!==false && state.rateDistortionModels[id]?.ok)
      .map(id=>({id,model:state.rateDistortionModels[id],
        preset:state.qualityCalibration[id]?.preset||profileFor(id,'balanced').preset,
        measurementScope:scope}));
    if(branches.length>=2) {
      const envelope=createMultiBranchFrontier(branches,{
        ...budget,incumbentId:state.selectedCodec,hysteresisSsim:.003
      });
      if(envelope.ok)return envelope;
    }
  }
  const selected=codec||state.selectedCodec||chooseDefaultCodec('sizeBudget');
  const model=selected?state.rateDistortionModels?.[selected]:null;
  if(!model?.ok)return null;
  const frontier=createSizeQualityFrontier(model,budget);
  return frontier?.ok?frontier:null;
}

function currentSizeBudgetBytes() {
  const direct = Number(state.sizeBudgetTargetBytes || 0);
  if (direct > 0) return Math.round(direct);
  if (!state.video?.size) return 0;
  const multiplier = Math.max(0.75, Math.min(2, Number($('sizeBudgetMultiplier')?.value || 1.6)));
  return Math.floor(Number(state.video.size) * multiplier);
}

function setSizeFrontierTargetBytes(targetBytes, { commit = false } = {}) {
  const frontier = currentSizeFrontier();
  const bytes = Number(targetBytes);
  if (!frontier || !(bytes > 0)) return false;
  const clamped = Math.max(
    frontier.minimumEvidenceTargetBytes,
    Math.min(frontier.maximumEvidenceTargetBytes, bytes)
  );
  state.sizeBudgetTargetBytes = Math.round(clamped);
  if ($('sizeBudgetBytes')) $('sizeBudgetBytes').value = String(state.sizeBudgetTargetBytes);
  if (state.video?.size) {
    $('sizeBudgetMultiplier').value = (state.sizeBudgetTargetBytes / state.video.size).toFixed(6);
  }
  updateSizeBudgetPreview();
  if (commit) {
    renderPlanOptions();
    refreshBenchmarkEnabled();
  }
  return true;
}

function renderSizeFrontier() {
  const panel = $('sizeFrontierPanel');
  const svg = $('sizeFrontierChart');
  const wrap = $('sizeFrontierChartWrap');
  const empty = $('sizeFrontierEmpty');
  const readout = $('sizeFrontierReadout');
  const button = $('calibrateSizeFrontierBtn');
  const compare=$('compareSizeFrontierBtn'), branchAction=$('adoptSizeFrontierBranchBtn');
  if (!panel || !svg || !wrap || !empty || !readout || !button) return;

  const goal = $('encodeGoal')?.value || 'balanced';
  const codec = state.selectedCodec || chooseDefaultCodec(goal);
  const model = codec ? state.rateDistortionModels?.[codec] : null;
  const multiReady=state.sizeEnvelopeEnabled &&
    Object.values(state.rateDistortionModels).filter(m=>m?.ok).length>=2;
  const nativeOnly = !state.nativeBackend?.available;
  const inputNotReady = !state.inputDecodeOk || !state.assInfo;
  const ssimUnavailable = state.nativeBackend?.available && state.nativeSelfTest?.ssimSmoke !== true;
  button.disabled =
    goal !== 'sizeBudget' ||
    state.operationBusy ||
    state.qualityCalibrationBusy ||
    !!state.nativeJobId ||
    nativeOnly ||
    inputNotReady ||
    ssimUnavailable ||
    !codec;
  button.textContent = state.qualityCalibrationBusy
    ? '正在实测曲线…'
    : model?.ok
      ? '刷新当前编码器曲线'
      : '生成当前编码器曲线';
  if(compare)compare.disabled=button.disabled;
  if(branchAction){branchAction.classList.add('hidden');branchAction.disabled=true;}

  const label = codec ? codec.toUpperCase() : '当前编码器';
  if (!model?.ok && !multiReady) {
    wrap.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.textContent = nativeOnly
      ? '实测效率曲线需要 Native 后端；当前仍可按源文件倍率设置体积预算。'
      : ssimUnavailable
        ? '当前 Native 核心没有通过 SSIM 能力检查；暂时无法生成效率曲线。'
        : inputNotReady
          ? '完成字幕预检与真实输入准备后，可生成 ' + label + ' 的实测效率曲线。'
          : '尚无 ' + label + ' 的 R-D 模型。点击“生成当前编码器曲线”进行短片段实测。';
    $('sizeFrontierSubtitle').textContent =
      '曲线只使用当前会话实测点；没有证据的区间不会伪造质量预测。';
    readout.textContent = state.sizeBudgetTargetBytes
      ? '当前直接体积预算仍保留，但没有当前编码器的质量曲线可解释它。'
      : '当前仍按手动倍率规划；生成曲线后可直接沿曲线选择体积。';
    svg.innerHTML = '';
    return;
  }

  const frontier = currentSizeFrontier();
  if (!frontier) {
    wrap.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.textContent = '当前 R-D 模型无法映射到体积预算。';
    svg.innerHTML = '';
    return;
  }

  const directBytes = Number(state.sizeBudgetTargetBytes || 0);
  const plot = buildSizeFrontierPlot(frontier, {
    width: 720,
    height: 300,
    selectedTargetBytes: directBytes > 0 ? directBytes : null
  });
  if (!plot.ok) {
    wrap.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.textContent = '当前实测点不足以形成可交互曲线。';
    svg.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  wrap.classList.remove('hidden');
  $('sizeFrontierSubtitle').textContent = frontier.kind==='multi-branch'
    ? frontier.branchIds.map(id=>id.toUpperCase()).join(' / ')+
      ' · 仅在相同参考画面与共同实测预算区间内形成上包络，不作外推。'
    : label + ' · ' + model.points.length + ' 个实测码率点 · 阴影表示当前样本离散范围，不是统计置信区间。';
  $('sizeFrontierMin').textContent = formatBytes(frontier.minimumEvidenceTargetBytes);
  $('sizeFrontierMax').textContent = formatBytes(frontier.maximumEvidenceTargetBytes);
  $('sizeFrontierKnee').textContent = frontier.knee
    ? '效率拐点约 ' + formatBytes(frontier.knee.targetBytes)
    : '当前实测范围';

  svg.innerHTML = renderRateDistortionSvg(plot);

  const ariaBytes = directBytes > 0
    ? Math.max(frontier.minimumEvidenceTargetBytes, Math.min(frontier.maximumEvidenceTargetBytes, directBytes))
    : (frontier.knee?.targetBytes || frontier.minimumEvidenceTargetBytes);
  svg.setAttribute('aria-valuemin', String(Math.round(frontier.minimumEvidenceTargetBytes)));
  svg.setAttribute('aria-valuemax', String(Math.round(frontier.maximumEvidenceTargetBytes)));
  svg.setAttribute('aria-valuenow', String(Math.round(ariaBytes)));
  svg.setAttribute('aria-valuetext', formatBytes(ariaBytes));

  if (directBytes > 0 && plot.selected) {
    const marginal = frontier.kind==='multi-branch' ? null :
      model.marginalQualityPerDoubling(plot.selected.videoBitrate);
    readout.innerHTML =
      '<strong>' + escapeHtml(formatBytes(plot.selected.targetBytes)) + '</strong>' +
      ' · 视频 ' + escapeHtml(formatBitrate(plot.selected.videoBitrate)) +
      ' · 预计 SSIM ' + Number(plot.selected.quality).toFixed(5) +
      ' <span class="size-frontier-band-copy">样本范围 ' +
      Number(plot.selected.lowerQuality).toFixed(5) + '–' +
      Number(plot.selected.upperQuality).toFixed(5) + '</span>' +
      (Number.isFinite(marginal)
        ? ' · 每翻倍视频码率约 +' + Number(marginal).toFixed(4) + ' SSIM'
        : '')+
      (frontier.kind==='multi-branch'
        ? ' · 建议 '+escapeHtml(String(plot.selected.branchId||'').toUpperCase())+
          (plot.selected.branchId!==state.selectedCodec?'（未采用，执行方案不变）':'（已选择）')
        : '');
    if(branchAction && frontier.kind==='multi-branch' && plot.selected.branchId &&
      plot.selected.branchId!==state.selectedCodec){
      branchAction.dataset.codec=plot.selected.branchId;
      branchAction.disabled=state.qualityCalibrationBusy||state.operationBusy;
      branchAction.classList.remove('hidden');
      branchAction.textContent='采用推荐编码器 '+plot.selected.branchId.toUpperCase();
    }
  } else if (directBytes > 0) {
    const evaluation = frontier.evaluateTargetBytes(directBytes);
    const statusText = evaluation.status === 'below-evidence'
      ? '当前直接预算低于实测曲线范围，质量未知。'
      : evaluation.status === 'above-evidence'
        ? '当前直接预算高于实测曲线范围，继续增加体积的质量收益尚无实测证据。'
        : '当前直接预算不在可解释的实测范围。';
    readout.textContent = statusText + ' 拖动曲线会把目标切回有证据的区间。';
  } else {
    readout.textContent =
      '当前仍按手动倍率规划。直接按住并拖动曲线，即可切换为 ' +
      label + ' 的实测体积预算。';
  }
}

function sizeFrontierTargetFromPointer(event) {
  const svg = $('sizeFrontierChart');
  const frontier = currentSizeFrontier();
  if (!svg || !frontier) return null;
  const rect = svg.getBoundingClientRect();
  if (!(rect.width > 0)) return null;
  const plot = buildSizeFrontierPlot(frontier);
  if (!plot.ok) return null;
  const svgX = plotXFromClientX(event.clientX, rect, plot.width);
  const fraction = plotFractionAtX(plot, svgX);
  return fraction === null ? null : targetBytesAtEvidenceFraction(frontier, fraction);
}

function commitSizeFrontierKeyboard(event) {
  const frontier = currentSizeFrontier();
  if (!frontier) return;
  let fraction = evidenceFractionForTargetBytes(frontier, Number(state.sizeBudgetTargetBytes || 0));
  if (fraction === null) {
    fraction = frontier.knee
      ? evidenceFractionForTargetBytes(frontier, frontier.knee.targetBytes)
      : 0.5;
  }
  let next = fraction ?? 0.5;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 0.02;
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 0.02;
  else if (event.key === 'PageDown') next -= 0.10;
  else if (event.key === 'PageUp') next += 0.10;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = 1;
  else return;
  event.preventDefault();
  setSizeFrontierTargetBytes(targetBytesAtEvidenceFraction(frontier, next), { commit: true });
}

function updateSizeBudgetPreview() {
  const range = $('sizeBudgetRange');
  if (!range) return;
  const multiplier = Number(range.value || 1.6);
  const directBytes = Number(state.sizeBudgetTargetBytes || 0);
  if (directBytes > 0 && state.video?.size) {
    const directMultiplier = directBytes / state.video.size;
    $('sizeBudgetValue').textContent =
      formatBytes(directBytes) + ' · ×' + directMultiplier.toFixed(2);
    $('sizeBudgetDetail').textContent =
      '当前由实测曲线直接控制目标上限 ' + formatBytes(directBytes) +
      '；切换下方手动倍率会退出曲线预算。';
  } else {
    $('sizeBudgetValue').textContent = '×' + multiplier.toFixed(2);
    $('sizeBudgetDetail').textContent = state.video
      ? '手动上限 ' + formatBytes(Math.floor(state.video.size * multiplier)) +
        ' · 源文件 ' + formatBytes(state.video.size) + ' · 松手后提交。'
      : '相对源文件 ×' + multiplier.toFixed(2) + '；选择视频后显示实际字节上限。';
  }
  document.querySelectorAll('[data-size-multiplier]').forEach(button => {
    button.classList.toggle(
      'selected',
      directBytes <= 0 && Math.abs(Number(button.dataset.sizeMultiplier) - multiplier) < 0.001
    );
  });
  setSliderProgress(range);
  renderSizeFrontier();
}

function syncPlanModeUI() {
  const goal = $('encodeGoal')?.value || 'balanced';
  const mode = planModeFromGoal(goal);
  document.querySelectorAll('.plan-mode-tab').forEach(button => {
    const selected = button.dataset.planMode === mode;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  document.querySelectorAll('[data-plan-panel]').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.planPanel !== mode);
  });

  if (mode === 'quick') {
    const index = QUICK_PRESET_GOALS.indexOf(goal);
    if (index >= 0) $('quickPresetRange').value = String(index);
  } else if (mode === 'quality') {
    $('qualityAutoCodec').checked = goal === 'efficiency';
  }

  updateQuickPresetPreview();
  updateQualityTargetPreview();
  updateSizeBudgetPreview();
}

function commitEncodeGoal(goal) {
  if (!$('encodeGoal')) return;
  if ($('encodeGoal').value === goal) {
    syncPlanModeUI();
    renderPlanOptions();
    refreshBenchmarkEnabled();
    return;
  }
  $('encodeGoal').value = goal;
  $('encodeGoal').dispatchEvent(new Event('change'));
}

function commitQuickPreset() {
  const index = Math.max(0, Math.min(2, Math.round(Number($('quickPresetRange').value) || 0)));
  commitEncodeGoal(QUICK_PRESET_GOALS[index]);
}

function commitQualityTarget() {
  const value = Math.max(0.980, Math.min(0.990, Number($('qualityTargetRange').value || 0.985)));
  $('qualityTargetRange').value = value.toFixed(3);
  if (Math.abs(Number($('qualityTarget').value) - value) < 0.0001) {
    updateQualityTargetPreview();
    return;
  }
  $('qualityTarget').value = value.toFixed(3);
  $('qualityTarget').dispatchEvent(new Event('change'));
}

function commitSizeBudget() {
  const value = Math.max(0.75, Math.min(2.0, Number($('sizeBudgetRange').value || 1.6)));
  state.sizeBudgetTargetBytes = null;
  if ($('sizeBudgetBytes')) $('sizeBudgetBytes').value = '';
  $('sizeBudgetRange').value = value.toFixed(2);
  $('sizeBudgetMultiplier').value = value.toFixed(2);
  updateSizeBudgetPreview();
  renderPlanOptions();
  refreshBenchmarkEnabled();
}

$('encodeGoal').addEventListener('change', () => {
  const goal = $('encodeGoal').value;
  if (
    goal === 'efficiency' &&
    state.qualityCalibrationTarget === Number($('qualityTarget')?.value || 0.985)
  ) {
    const pick = chooseEfficiencyCalibration(Object.values(state.qualityCalibration));
    if (pick) state.selectedCodec = pick.codec;
  }
  syncPlanModeUI();
  updateQualityCalibrationControls();
  renderPlanOptions();
  refreshBenchmarkEnabled();
});

$('qualityTarget').addEventListener('change', () => {
  state.qualityCalibration = {};
  state.qualityExplorationPoints = {};
  state.qualityCalibrationTarget = null;
  $('qualityCalibrationResult').textContent = '';
  updateQualityTargetPreview();
  renderPlanOptions();
  refreshBenchmarkEnabled();
});

document.querySelectorAll('.plan-mode-tab').forEach(button => {
  button.addEventListener('click', () => {
    const mode = button.dataset.planMode;
    if (mode === 'quick') {
      commitQuickPreset();
    } else if (mode === 'quality') {
      commitEncodeGoal($('qualityAutoCodec').checked ? 'efficiency' : 'targetQuality');
    } else {
      commitEncodeGoal('sizeBudget');
    }
  });
});

$('quickPresetRange').addEventListener('input', updateQuickPresetPreview);
$('quickPresetRange').addEventListener('change', commitQuickPreset);
$('qualityTargetRange').addEventListener('input', updateQualityTargetPreview);
$('qualityTargetRange').addEventListener('change', commitQualityTarget);
$('sizeBudgetRange').addEventListener('input', updateSizeBudgetPreview);
$('sizeBudgetRange').addEventListener('change', commitSizeBudget);

$('sizeFrontierChart').addEventListener('pointerdown', event => {
  const targetBytes = sizeFrontierTargetFromPointer(event);
  if (!(targetBytes > 0)) return;
  event.preventDefault();
  state.sizeFrontierPointerId = event.pointerId;
  $('sizeFrontierChart').setPointerCapture?.(event.pointerId);
  setSizeFrontierTargetBytes(targetBytes);
});

$('sizeFrontierChart').addEventListener('pointermove', event => {
  if (state.sizeFrontierPointerId !== event.pointerId) return;
  const targetBytes = sizeFrontierTargetFromPointer(event);
  if (!(targetBytes > 0)) return;
  event.preventDefault();
  setSizeFrontierTargetBytes(targetBytes);
});

const finishSizeFrontierPointer = event => {
  if (state.sizeFrontierPointerId !== event.pointerId) return;
  const targetBytes = sizeFrontierTargetFromPointer(event);
  state.sizeFrontierPointerId = null;
  try { $('sizeFrontierChart').releasePointerCapture?.(event.pointerId); } catch {}
  if (targetBytes > 0) setSizeFrontierTargetBytes(targetBytes, { commit: true });
};

$('sizeFrontierChart').addEventListener('pointerup', finishSizeFrontierPointer);
$('sizeFrontierChart').addEventListener('pointercancel', finishSizeFrontierPointer);
$('sizeFrontierChart').addEventListener('keydown', commitSizeFrontierKeyboard);

$('qualityAutoCodec').addEventListener('change', () => {
  commitEncodeGoal($('qualityAutoCodec').checked ? 'efficiency' : 'targetQuality');
});

document.querySelectorAll('[data-range-step]').forEach(button => {
  button.addEventListener('click', () => {
    const kind = button.dataset.rangeStep;
    const delta = Number(button.dataset.delta || 0);
    const range = kind === 'quick'
      ? $('quickPresetRange')
      : kind === 'quality'
        ? $('qualityTargetRange')
        : $('sizeBudgetRange');
    const min = Number(range.min);
    const max = Number(range.max);
    const value = Math.max(min, Math.min(max, Number(range.value) + delta));
    range.value = kind === 'quality' ? value.toFixed(3) : kind === 'size' ? value.toFixed(2) : String(Math.round(value));
    if (kind === 'quick') commitQuickPreset();
    else if (kind === 'quality') commitQualityTarget();
    else commitSizeBudget();
  });
});

document.querySelectorAll('[data-range-reset]').forEach(button => {
  button.addEventListener('click', () => {
    const kind = button.dataset.rangeReset;
    if (kind === 'quick') {
      $('quickPresetRange').value = '1';
      commitQuickPreset();
    } else if (kind === 'quality') {
      $('qualityTargetRange').value = '0.985';
      commitQualityTarget();
    } else {
      $('sizeBudgetRange').value = '1.60';
      commitSizeBudget();
    }
  });
});

document.querySelectorAll('[data-size-multiplier]').forEach(button => {
  button.addEventListener('click', () => {
    $('sizeBudgetRange').value = Number(button.dataset.sizeMultiplier).toFixed(2);
    commitSizeBudget();
  });
});
document.addEventListener('change', event => {
  if (['outputContainer','audio','audioBitrate','audioChannels','audioSampleRate'].includes(event.target?.name)) {
    queueMicrotask(() => {
      refreshGuidedContainerDecision();
      if (($('encodeGoal')?.value || '') === 'sizeBudget') renderPlanOptions();
    });
  }
});
$('calibrateQualityBtn').addEventListener('click', () => runWebTask(runQualityCalibration));
$('calibrateSizeFrontierBtn').addEventListener('click', () => runWebTask(runQualityCalibration));
$('compareSizeFrontierBtn').addEventListener('click', () => runWebTask(()=>runQualityCalibration({compareForSize:true})));
$('adoptSizeFrontierBranchBtn').addEventListener('click',()=>{
  const frontier=currentSizeFrontier();
  const recommendation=frontier?.evaluateTargetBytes(Number(state.sizeBudgetTargetBytes||0));
  if(state.operationBusy||state.qualityCalibrationBusy||frontier?.kind!=='multi-branch'||
    recommendation?.status!=='within-evidence'||!recommendation.branchId||
    recommendation.branchId===state.selectedCodec)return;
  selectCodec(recommendation.branchId);
});
$('benchmarkBtn').addEventListener('click', () => runWebTask(runBenchmarks));
$('testSelectedBtn').addEventListener('click', () => runWebTask(runSelectedTest));
$('encodeBtn').addEventListener('click', () => runWebTask(runEncode));
$('cancelEncodeBtn').addEventListener('click', () => {
  if (!state.nativeJobId) return;
  try {
    globalThis.NativeHardsub?.cancelNativeEncode?.(state.nativeJobId);
    $('cancelEncodeBtn').disabled = true;
    $('liveEta').textContent = '正在请求取消 ' + nativePlatformName() + ' 压制…';
  } catch (error) {
    log('取消 Native 压制失败：' + error.message);
  }
});
$('openAndroidAppBtn').addEventListener('click', () => {
  const fallback = safeHttpsUrl(state.appRelease?.apkUrl, APP_DOWNLOAD_FALLBACK);
  const intentUrl =
    'intent://open#Intent;scheme=quickhardsub;package=' + APP_PACKAGE +
    ';S.browser_fallback_url=' + encodeURIComponent(fallback) + ';end';
  window.location.href = intentUrl;
});

$('downloadAndroidAppBtn').addEventListener('click', event => {
  const bridge = globalThis.NativeHardsub;
  const url = safeHttpsUrl(
    state.appUpdateCheck?.apkUrl || state.appRelease?.apkUrl,
    APP_DOWNLOAD_FALLBACK
  );
  if (bridge?.openExternalUrl) {
    event.preventDefault();
    bridge.openExternalUrl(url);
  }
});

$('checkAppUpdateBtn').addEventListener('click', () => {
  const bridge = globalThis.NativeHardsub;
  if (bridge?.checkForUpdate) {
    $('appUpdateNotice').textContent = '正在检查更新…';
    bridge.checkForUpdate();
  }
});

$('clearSavedFontsBtn').addEventListener('click', async () => {
  if (!state.savedFonts.length) return;
  if (!confirm('清空本机常用字体库？这不会删除设备上的原字体文件。')) return;
  try {
    await clearSavedFonts();
    state.savedFonts = [];
    invalidateAnalysis();
    renderSavedFontLibrary();
    updateFontMeta();
    log('本机常用字体库已清空；字体来源已变化，需要重新分析与预览。');
  } catch (error) {
    log(`清空常用字体库失败：${error.message}`);
  }
});

syncPlanModeUI();
bootstrap();

function ensureNativeSelfTestStarted() {
  if (!state.nativeBackend?.available || state.nativeSelfTest || state.nativeSelfTestStarted) return;
  const bridge = globalThis.NativeHardsub;
  if (!bridge?.runSelfTest) return;
  state.nativeSelfTestStarted = true;
  log(nativePlatformName() + '：开始按需验证编码器 / libass；预览仍可先进行。');
  try {
    bridge.runSelfTest();
  } catch (error) {
    state.nativeSelfTestStarted = false;
    log(nativePlatformName() + ' 自检启动失败：' + error.message);
  }
}

async function ensureWebEngineReady() {
  if (state.engine.ready) return true;
  if (state.webEngineInitPromise) return state.webEngineInitPromise;

  state.webEngineInitPromise = (async () => {
    $('engineHint').innerHTML = '<span class="note">正在按需加载 Web 压制核心…</span>';
    const detailedCapabilitiesPromise = detectCapabilities()
      .then(capabilities => {
        state.capabilities = capabilities;
        renderCapabilities();
        updateEnvironmentSummary(state.engine.ready);
      })
      .catch(error => log('浏览器详细能力检测失败：' + error.message));

    const engineStatus = await state.engine.init();
    if (!engineStatus.ready) {
      $('engineHint').innerHTML =
        '<span class="warn">FFmpegKitNext Web 核心不可用。</span> 字幕文本仍可解析，但真实预览与压制不可用。';
      updateEnvironmentSummary(false);
      return false;
    }

    try {
      [state.softwareEncoders, state.softwareDecoders] = await Promise.all([
        state.engine.detectSoftwareEncoders(),
        state.engine.detectSoftwareDecoders()
      ]);
      log(`WASM 软件编码器：x264=${state.softwareEncoders.h264} x265=${state.softwareEncoders.h265} SVT-AV1=${state.softwareEncoders.av1}`);
      log(`WASM 软件解码器：dav1d=${state.softwareDecoders.av1Dav1d}`);
    } catch (error) {
      log('WASM 编解码器清单读取失败：' + error.message);
    }

    renderCapabilities();
    updateEnvironmentSummary(true);
    $('engineHint').innerHTML =
      '<span class="ok">Web 压制核心已就绪。</span> 详细能力在需要时检测，不阻塞页面打开。';
    void detailedCapabilitiesPromise;
    return true;
  })().catch(error => {
    state.webEngineInitPromise = null;
    log('Web 压制核心初始化失败：' + error.message);
    throw error;
  });

  return state.webEngineInitPromise;
}

async function bootstrap() {
  await detectWindowsNativeBridge();
  detectNativeBackend();
  const nativeMode = !!state.nativeBackend?.available;

  if (!nativeMode) {
    await loadAppReleaseInfo();

    try {
      state.savedFonts = await listSavedFonts();
      renderSavedFontLibrary();
      updateFontMeta();
      if (state.savedFonts.length) log(`已加载本机常用字体库：${state.savedFonts.length} 个文件。`);
    } catch (error) {
      log(`读取常用字体库失败：${error.message}`);
      renderSavedFontLibrary();
    }
  } else {
    state.savedFonts = [];
    renderSavedFontLibrary();
    updateFontMeta();
  }

  state.capabilities = detectBasicCapabilities();
  renderCapabilities();

  if (nativeMode) {
    // APK uses the ARM64 backend directly. Do not initialize the browser WASM
    // engine just to discover capabilities the app does not use.
    $('engineHint').innerHTML = state.nativeBackend?.backend === 'windows-native'
      ? '<span class="ok">Windows Native 模式。</span> 当前网页只是控制台；预览、测试片段和整片压制都由后台系统 FFmpeg / libass / NVENC 执行。'
      : '<span class="ok">Android Native 模式。</span> 正式预览、测试片段和整片压制都直接调用设备内的 FFmpegKitNext / libass；网页后备环境只保留在高级诊断中。';
    updateEnvironmentSummary(false);
    refreshAnalyze();
    await recoverWindowsNativeVideoSelection();
    await recoverBink2ImportJob();
    await recoverNativeJob();
    if (state.video && !state.nativeInputProbe && !state.nativeImportJobId) {
      try { globalThis.NativeHardsub?.probeSelectedVideo?.(); } catch {}
    }
    return;
  }

  $('engineHint').innerHTML =
    '<span class="note">Web 压制核心按需加载。</span> 先选择视频与 ASS；大型 WASM 与详细编解码能力不会阻塞页面打开。';
  updateEnvironmentSummary(false);
  refreshAnalyze();
}

function detectNativeBackend() {
  const bridge = globalThis.NativeHardsub;
  if (!bridge?.getBackendInfo) {
    state.nativeBackend = null;
    state.nativeSelfTest = null;
    applyPlatformPresentation();
    renderBackendSummary();
    return;
  }

  try {
    state.nativeBackend = JSON.parse(bridge.getBackendInfo());
    loadLocalBenchmarkHistory();
    applyPlatformPresentation();
    renderBackendSummary();
    renderAppReleaseCard();
    if (state.nativeBackend?.backend === 'windows-native') {
      const gpu = nativeGpuLabel();
      const available = Array.isArray(state.nativeBackend.encoders)
        ? state.nativeBackend.encoders.filter(x => x?.Available || x?.available).map(x => x.Encoder || x.encoder || x.Key || x.key)
        : [];
      log(
        '检测到 Windows Native Bridge：CPU=' + (state.nativeBackend.cpu || 'unknown') +
        ' · GPU=' + gpu +
        ' · FFmpeg=' + (state.nativeBackend.ffmpegVersion || 'unknown') +
        ' · source=' + (state.nativeBackend.ffmpegSource || 'unknown') +
        ' · encoders=' + (available.join('/') || 'none')
      );
      for (const warning of (Array.isArray(state.nativeBackend.ffmpegWarnings) ? state.nativeBackend.ffmpegWarnings : [])) {
        log('FFmpeg 警告：' + warning);
      }
    } else {
      log(
        `检测到 Android 原生壳：ABI=${state.nativeBackend.abi || 'unknown'} · FFmpegKitNext=${state.nativeBackend.ffmpegKitVersion || 'unknown'}` +
        ` · Native staging 可分配 ${formatBytes(Number(state.nativeBackend.stagingAllocatableBytes || 0))}` +
        ` · 热状态 ${formatThermalStatus(state.nativeBackend.thermalStatus)}` +
        (state.nativeBackend.powerSaveMode ? ' · 省电模式已开启' : '')
      );
    }

    globalThis.__onNativePickerResult = payload => {
      let data;
      try {
        data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        data = { role: '', count: 0, error: '原生文件选择结果解析失败' };
      }

      const role = data?.role || '';
      const names = Array.isArray(data?.names) ? data.names : [];
      if (role) setWindowsNativePickerBusy(role, false);

      if (data?.error) {
        const config = WINDOWS_NATIVE_PICKERS[role];
        const message = nativePlatformName() + ' 文件选择失败：' + data.error;
        log(message);
        const hasExistingSelection = role === 'video'
          ? !!state.video
          : role === 'ass'
            ? !!state.ass
            : role === 'fonts'
              ? state.fonts.length > 0
              : false;
        if (!hasExistingSelection && config?.metaId && $(config.metaId)) {
          $(config.metaId).textContent = '选择失败：' + data.error;
          $(config.metaId).className = 'warn';
        }
      }

      if (state.nativeBackend?.backend === 'windows-native' && Number(data?.count || 0) > 0) {
        const files = Array.isArray(data?.files) ? data.files : [];
        const fromBase64 = item => {
          const binary = atob(item.base64 || '');
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return new File([bytes], item.name || 'file.bin');
        };

        if (role === 'video') {
          const item = files[0];
          if (item) {
            state.video = { name: item.name, size: Number(item.size || 0), windowsNative: true };
            state.nativeInputProbe = null;
            invalidateAnalysis({ clearVideoMetadata: true });
            $('videoMeta').textContent = item.name + ' · ' + formatBytes(Number(item.size || 0)) + ' · Windows Native';
            $('videoMeta').className = '';
            globalThis.NativeHardsub?.probeSelectedVideo?.();
          }
        } else if (role === 'ass') {
          const item = files[0];
          if (item?.base64) {
            state.ass = fromBase64(item);
            invalidateAnalysis();
            $('assMeta').textContent = state.ass.name + ' · Windows Native';
            $('assMeta').className = '';
          }
        } else if (role === 'fonts') {
          state.fonts = files.filter(item => item?.base64).map(fromBase64);
          invalidateAnalysis();
          updateFontMeta();
        }
        refreshAnalyze();
      }

      if (Number(data?.count || 0) > 0) {
        log(
          nativePlatformName() + ' 文件选择器返回：' +
          (role || 'unknown') + ' · ' +
          (names.join(' / ') || (data.count + ' 个文件'))
        );
      }

      if (role === 'ass' && Number(data?.count || 0) > 0) {
        // Give Chromium one event-loop turn to publish input.files/change.
        // If that path fails on a provider/WebView combination, read the same
        // persisted content:// URI through the Native bridge instead.
        setTimeout(() => {
          if (state.ass) return;
          const bridge = globalThis.NativeHardsub;
          if (!bridge?.readSelectedAssFile) return;
          try {
            const fallback = JSON.parse(bridge.readSelectedAssFile());
            if (!fallback?.ok || !fallback.base64) {
              throw new Error(fallback?.error || 'Native ASS fallback 读取失败');
            }

            const binary = atob(fallback.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }

            state.ass = {
              name: fallback.name || 'subtitles.ass',
              size: Number(fallback.size || bytes.byteLength),
              arrayBuffer: async () =>
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
            };
            invalidateAnalysis();
            $('assMeta').textContent =
              state.ass.name + ' · Android Native URI 读取';
            log('WebView 未回填字幕 File，已通过 Android Native URI 自动恢复所选 ASS。');
            refreshAnalyze();
          } catch (error) {
            $('assMeta').textContent = '字幕已由系统选择，但读取失败';
            $('assMeta').className = 'bad';
            log('Android Native ASS 选择恢复失败：' + error.message);
          }
        }, 150);
      }
    };

    globalThis.__onNativeInputProbe = payload => {
      try {
        state.nativeInputProbe = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        state.nativeInputProbe = { ok: false, error: '原生输入探测结果解析失败' };
      }

      const p = state.nativeInputProbe || {};
      renderSourceAdapterState(p);
      if (p.ok) {
        state.sourceMedia = mediaFromNativeProbe(p);
        renderSourceVideoSummary();
        notifyMediaInfoChanged();
        log(
          (state.nativeBackend?.backend === 'windows-native' ? 'Windows Native 输入探测：' : 'Android SAF 输入探测：') +
          (p.seekable ? '可 seek' : '不可 seek，将需要本地 staging') +
          ' · ' + (p.videoCodec || 'unknown') +
          ' ' + (p.width || 0) + 'x' + (p.height || 0) +
          ' · ' + Number(p.duration || 0).toFixed(3) + ' s'
        );
      } else {
        notifyMediaInfoChanged();
        log(nativePlatformName() + ' 输入探测失败：' + (p.error || '未知错误'));
      }
      renderBackendSummary();
      refreshAnalyze();
    };

    globalThis.__onNativeSelfTest = payload => {
      try {
        state.nativeSelfTest = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        state.nativeSelfTest = { error: '原生自检结果解析失败' };
      }
      renderBackendSummary();
      renderNativeStatusBar();
      updateEnvironmentSummary();
      const t = state.nativeSelfTest || {};
      state.softwareEncoders = {
        h264: !!t.x264EncodeSmoke,
        h265: !!t.x265EncodeSmoke,
        av1: !!t.svtAv1EncodeSmoke
      };
      state.softwareDecoders.av1Dav1d = !!t.dav1d;
      if (state.capabilities) renderCapabilities();
      if (state.media) renderPlanOptions();
      refreshAnalyze();
      log(
        nativePlatformName() + ' 自检：' +
        `x264=${!!t.x264EncodeSmoke} ` +
        `x265=${!!t.x265EncodeSmoke} ` +
        `SVT-AV1=${!!t.svtAv1EncodeSmoke} ` +
        `dav1d=${!!t.dav1d} ` +
        `libass视觉=${!!t.libassVisualSmoke} ` +
        `内置回退字体=${!!t.bundledFallbackReady}`
      );
    };

    globalThis.__onNativePreview = payload => {
      let data;
      try {
        data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        data = { ok: false, error: 'Native 预览结果解析失败' };
      }
      const waiter = state.nativePreviewWaiters.get(data.requestId);
      if (!waiter) return;
      state.nativePreviewWaiters.delete(data.requestId);
      clearTimeout(waiter.timer);
      if (data.ok) waiter.resolve(data);
      else waiter.reject(new Error(data.error || 'Native 预览失败'));
    };

    globalThis.__onNativeFrame = payload => {
      let data;
      try {
        data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        data = { ok: false, error: 'Native 时间轴画面结果解析失败' };
      }
      const waiter = state.nativeFrameWaiters.get(data.requestId);
      if (!waiter) return;
      state.nativeFrameWaiters.delete(data.requestId);
      clearTimeout(waiter.timer);
      if (data.ok) waiter.resolve(data);
      else waiter.reject(new Error(data.error || 'Native 时间轴画面预览失败'));
    };

    globalThis.__onNativeOutputFrame = payload => {
      let data;
      try {
        data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        data = { ok: false, error: 'Native 成品验证帧结果解析失败' };
      }
      const waiter = state.nativeOutputFrameWaiters.get(data.requestId);
      if (!waiter) return;
      state.nativeOutputFrameWaiters.delete(data.requestId);
      clearTimeout(waiter.timer);
      if (data.ok) waiter.resolve(data);
      else waiter.reject(new Error(data.error || 'Native 成品验证帧生成失败'));
    };

    globalThis.__onNativeReferenceFrame = payload => {
      let data;
      try {
        data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        data = { ok: false, error: 'Native 硬字幕参考帧结果解析失败' };
      }
      const waiter = state.nativeReferenceFrameWaiters.get(data.requestId);
      if (!waiter) return;
      state.nativeReferenceFrameWaiters.delete(data.requestId);
      clearTimeout(waiter.timer);
      if (data.ok) waiter.resolve(data);
      else waiter.reject(new Error(data.error || 'Native 硬字幕参考帧生成失败'));
    };

    globalThis.__onNativeWaveform = payload => {
      let data;
      try {
        data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        data = { ok: false, error: 'Native 波形结果解析失败' };
      }
      const waiter = state.nativeWaveformWaiters.get(data.requestId);
      if (!waiter) return;
      state.nativeWaveformWaiters.delete(data.requestId);
      clearTimeout(waiter.timer);
      if (data.ok) waiter.resolve(data);
      else waiter.reject(new Error(data.error || 'Native 音频波形生成失败'));
    };

    globalThis.__onNativeSample = payload => {
      let data;
      try {
        data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        data = { ok: false, error: 'Native 测试片段结果解析失败' };
      }
      const waiter = state.nativeSampleWaiters.get(data.requestId);
      if (!waiter) return;
      state.nativeSampleWaiters.delete(data.requestId);
      clearTimeout(waiter.timer);
      if (data.ok) waiter.resolve(data);
      else waiter.reject(new Error(data.error || 'Native 测试片段生成失败'));
    };

    globalThis.__onNativeSampleExportResult = payload => {
      let data;
      try {
        data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        data = { ok: false, error: 'Native 测试片段保存结果解析失败' };
      }
      if (data.ok) {
        log('Native 测试片段已保存：' + formatBytes(Number(data.bytes || 0)));
      } else {
        log('Native 测试片段保存失败：' + (data.error || '未知错误'));
        alert('测试片段保存失败：' + (data.error || '未知错误'));
      }
    };

    globalThis.__onNativeExportResult = payload => {
      let data;
      try {
        data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        data = { ok: false, error: 'Native 导出结果解析失败' };
      }
      try {
        window.dispatchEvent(new CustomEvent('quick-hardsub-native-export-result', { detail: data }));
      } catch {}
      const guidedExport = !!state.nativeCompletedJob &&
        (!data.jobId || data.jobId === state.nativeCompletedJob.jobId);
      if (!guidedExport) return;
      if (data.ok) {
        $('liveEta').textContent = '成品已保存 · ' + formatBytes(Number(data.bytes || 0)) +
          (data.sha256 ? ' · SHA-256 ' + data.sha256.slice(0, 12) + '…' : '');
        log(nativePlatformName() + ' 成品已导出到用户选择的位置。');
        // Exporting succeeded, so this finished job must no longer intercept
        // later presses as another export request.
        state.nativeCompletedJob = null;
        state.nativeJobId = null;
        localStorage.removeItem('nativeEncodeJobId');
        $('encodeBtn').textContent = '开始硬字幕压制';
        refreshBenchmarkEnabled();
      } else {
        $('liveEta').textContent = '保存失败：' + (data.error || '未知错误');
        log(nativePlatformName() + ' 成品导出失败：' + (data.error || '未知错误'));
      }
    };

    globalThis.__onNativeUpdateCheck = payload => {
      try {
        state.appUpdateCheck = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        state.appUpdateCheck = { ok: false, error: '更新检查结果解析失败' };
      }
      renderAppReleaseCard();
    };

    if (bridge.checkForUpdate) {
      bridge.checkForUpdate();
    }

    if (bridge.runSelfTest && state.nativeBackend?.backend === 'windows-native') {
      state.nativeSelfTestStarted = true;
      bridge.runSelfTest();
    }
  } catch (error) {
    state.nativeBackend = { available: false, error: error.message };
    renderBackendSummary();
    log(`Native 后端检测失败：${error.message}`);
  }
}

function loadLocalBenchmarkHistory() {
  const bridge = globalThis.NativeHardsub;
  if (!bridge?.getLocalBenchmarkHistory) {
    state.localBenchmarkHistory = [];
    return [];
  }
  try {
    const snapshot = JSON.parse(bridge.getLocalBenchmarkHistory());
    state.localBenchmarkHistory = normalizeCompressionEvidenceList(snapshot?.records);
    if (state.localBenchmarkHistory.length) {
      const qualitySamples = state.localBenchmarkHistory.filter(x => x.evidenceKind === 'quality-sample').length;
      const fullEncodes = state.localBenchmarkHistory.filter(x => x.evidenceKind === 'full-encode').length;
      log(
        '已加载本机压制证据：' + state.localBenchmarkHistory.length + ' 条' +
        ' · 正式压制 ' + fullEncodes +
        ' · 质量样本 ' + qualitySamples + '。'
      );
    }
  } catch (error) {
    state.localBenchmarkHistory = [];
    log('读取本机压制历史失败：' + error.message);
  }
  return state.localBenchmarkHistory;
}

async function persistCompressionEvidence(record) {
  const normalized = normalizeCompressionEvidence(record);
  if (!normalized) return false;
  const bridge = globalThis.NativeHardsub;
  if (!bridge?.recordCompressionEvidence) return false;
  try {
    const payload = await Promise.resolve(
      bridge.recordCompressionEvidence(JSON.stringify(normalized))
    );
    const result = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (result?.ok === false) throw new Error(result.error || '证据写入失败');
    state.localBenchmarkHistory.push({
      ...normalized,
      recordedAt: Number(result?.recordedAt || Date.now())
    });
    if (state.localBenchmarkHistory.length > 500) {
      state.localBenchmarkHistory.splice(0, state.localBenchmarkHistory.length - 500);
    }
    return true;
  } catch (error) {
    log('记录压制证据失败，不影响当前任务：' + error.message);
    return false;
  }
}

function currentSourceEvidenceKey() {
  return sourceEvidenceKey(
    state.media || {},
    state.video?.name || state.media?.sourceName || '',
    Number(state.video?.size || state.media?.size || 0)
  );
}

function currentRuntimeEvidenceKey() {
  return runtimeEvidenceKey(state.nativeBackend || { backend: 'web' });
}

function medianNumber(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function predictLocalEncode(codec, preset) {
  const m = state.media;
  if (!m || !codec || !preset) return null;

  const width = Number(m.width || 0);
  const height = Number(m.height || 0);
  const fps = Number(m.fps || 0);

  const candidates = state.localBenchmarkHistory.filter(record => {
    if (record?.evidenceKind !== 'full-encode') return false;
    if (record?.codec !== codec || String(record?.preset) !== String(preset)) return false;
    if (!(Number(record?.averageSpeed) > 0)) return false;
    if (Number(record?.width || 0) !== width || Number(record?.height || 0) !== height) return false;
    const rfps = Number(record?.fps || 0);
    return fps > 0 && rfps > 0 && Math.abs(rfps - fps) <= Math.max(0.5, fps * 0.02);
  });

  if (!candidates.length) return null;

  // Keep recent behavior dominant: thermal state, app/core revisions and battery
  // conditions can shift sustained mobile encoding performance over time.
  const recent = candidates.slice(-12);
  const speed = medianNumber(recent.map(x => Number(x.averageSpeed)));
  if (!(speed > 0)) return null;

  const duration = Number(m.duration || 0);
  return {
    samples: recent.length,
    speed,
    etaSeconds: duration > 0 ? duration / speed : 0,
    minSpeed: Math.min(...recent.map(x => Number(x.averageSpeed))),
    maxSpeed: Math.max(...recent.map(x => Number(x.averageSpeed)))
  };
}

function localPredictionForPlan(plan) {
  if (!plan?.codec || !plan?.preset) return null;
  return predictLocalEncode(plan.codec, plan.preset);
}

function safeHttpsUrl(value, fallback = '') {
  try {
    const url = new URL(value || fallback, location.href);
    return url.protocol === 'https:' ? url.href : fallback;
  } catch {
    return fallback;
  }
}

function validateAppReleaseManifest(manifest) {
  if (!manifest || manifest.packageName !== APP_PACKAGE) {
    throw new Error('更新清单包名不匹配');
  }
  const versionCode = Number(manifest.versionCode);
  if (!Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error('更新清单 versionCode 无效');
  }
  const apkUrl = safeHttpsUrl(manifest.apkUrl);
  if (!apkUrl) throw new Error('更新清单 APK 地址不是有效 HTTPS URL');

  const parsedApkUrl = new URL(apkUrl);
  if (
    parsedApkUrl.hostname !== '11576865.github.io' ||
    !parsedApkUrl.pathname.startsWith('/Quick-Automatic-Hardsub-Encoder/downloads/') ||
    !parsedApkUrl.pathname.toLowerCase().endsWith('.apk')
  ) {
    throw new Error('更新清单 APK 地址不在受信任下载路径');
  }

  const sha256 = String(manifest.sha256 || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error('更新清单缺少有效 APK SHA-256');
  }
  const signerSha256 = String(manifest.signerSha256 || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(signerSha256)) {
    throw new Error('更新清单缺少有效签名摘要');
  }
  return { ...manifest, versionCode, apkUrl, sha256, signerSha256 };
}

async function loadAppReleaseInfo() {
  try {
    const response = await fetch(APP_UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    state.appRelease = validateAppReleaseManifest(await response.json());
  } catch (error) {
    state.appRelease = null;
    log('Android 版本信息读取失败：' + error.message);
  }
  renderAppReleaseCard();
}

function nativePlatformName() {
  if (state.nativeBackend?.backend === 'windows-native') return 'Windows Native';
  if (state.nativeBackend?.backend === 'android-native') return 'Android Native';
  return 'Native';
}

function nativeGpuLabel() {
  if (state.nativeBackend?.backend !== 'windows-native') return '';
  const rawGpus = state.nativeBackend.gpus;
  const gpus = Array.isArray(rawGpus)
    ? rawGpus.filter(Boolean)
    : (typeof rawGpus === 'string' && rawGpus.trim() ? [rawGpus.trim()] : []);
  if (gpus.length) return gpus.join(' / ');
  const nvencAvailable = Array.isArray(state.nativeBackend.encoders) &&
    state.nativeBackend.encoders.some(e => (e.Hardware ?? e.hardware) && (e.Available ?? e.available));
  return nvencAvailable ? 'NVIDIA GPU · NVENC 可用' : '未检测到 NVIDIA GPU';
}

function renderRuntimeIdentity() {
  const backend = state.nativeBackend?.backend || 'web';
  const windowsNative = backend === 'windows-native' && state.nativeBackend?.available;
  const androidNative = backend === 'android-native' && state.nativeBackend?.available;
  const badge = $('runtimeModeBadge');
  const title = $('runtimeModeTitle');
  const detail = $('runtimeModeDetail');
  const banner = $('runtimeModeBanner');
  const kicker = $('runtimeKicker');
  const heroTitle = $('heroRuntimeTitle');
  const heroDetail = $('heroRuntimeDetail');

  document.body.dataset.runtimeBackend = windowsNative ? 'windows-native' : androidNative ? 'android-native' : 'web';
  if (banner) banner.dataset.runtime = document.body.dataset.runtimeBackend;

  if (windowsNative) {
    if (badge) badge.textContent = 'WINDOWS NATIVE';
    if (title) title.textContent = 'Windows 本机后端已连接';
    if (detail) detail.textContent = '系统 FFmpeg / FFprobe 直接读取本机文件；可使用 CPU 与通过运行探测的 NVIDIA NVENC。刷新页面会继续连接本次 Bridge 会话。';
    if (kicker) kicker.textContent = 'WINDOWS NATIVE WORKBENCH';
    if (heroTitle) heroTitle.textContent = 'Windows Native';
    if (heroDetail) heroDetail.textContent = 'localhost Bridge 已连接';
  } else if (androidNative) {
    if (badge) badge.textContent = 'ANDROID NATIVE';
    if (title) title.textContent = 'Android 原生后端';
    if (detail) detail.textContent = '通过 SAF 与 FFmpegKitNext 在设备本地处理；正式任务由原生服务持有。';
    if (kicker) kicker.textContent = 'ANDROID NATIVE WORKBENCH';
    if (heroTitle) heroTitle.textContent = 'Android Native';
    if (heroDetail) heroDetail.textContent = '原生 FFmpegKitNext';
  } else {
    if (badge) badge.textContent = 'WEB / WASM';
    if (title) title.textContent = '浏览器后端';
    if (detail) detail.textContent = '由当前浏览器读取文件并运行 FFmpeg WebAssembly；单个视频建议不超过 1 GB。';
    if (kicker) kicker.textContent = 'WEB MEDIA WORKBENCH';
    if (heroTitle) heroTitle.textContent = '浏览器 / WASM';
    if (heroDetail) heroDetail.textContent = '文件留在当前浏览器';
  }

  const workbenchTitle = $('runtimeWorkbenchTitle');
  if (workbenchTitle) workbenchTitle.textContent = runtimeWorkbenchTitle();
}

function renderNativeStatusBar() {
  const bar = $('nativeStatusBar');
  if (!bar) return;
  if (!state.nativeBackend?.available) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }

  if (state.nativeBackend.backend === 'windows-native') {
    const encoders = Array.isArray(state.nativeBackend.encoders) ? state.nativeBackend.encoders : [];
    const nvencCount = encoders.filter(e => (e.Hardware ?? e.hardware) && (e.Available ?? e.available)).length;
    bar.innerHTML =
      '<span class="native-status-kind">WINDOWS NATIVE</span>' +
      '<strong>已连接</strong>' +
      '<span>' + escapeHtml(state.nativeBackend.cpu || 'CPU unknown') + '</span>' +
      '<span>' + escapeHtml(nativeGpuLabel()) + '</span>' +
      '<span>NVENC ' + nvencCount + '</span>' +
      '<button type="button" id="nativeDiagnosticsBtn">运行环境</button>';
  } else {
    bar.innerHTML =
      '<span class="native-status-kind">ANDROID NATIVE</span>' +
      '<strong>已连接</strong>' +
      '<span>ARM64 · ' + escapeHtml(state.nativeBackend.ffmpegKitVersion || 'FFmpegKitNext') + '</span>' +
      '<button type="button" id="nativeDiagnosticsBtn">运行环境</button>';
  }

  bar.classList.remove('hidden');
  const diagnosticsBtn = $('nativeDiagnosticsBtn');
  if (diagnosticsBtn) {
    diagnosticsBtn.onclick = () => {
      $('envDetails').open = true;
      $('envDetails').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }
}

function applyPlatformPresentation() {
  const nativeMode = !!state.nativeBackend?.available;
  const windowsNative = state.nativeBackend?.backend === 'windows-native';
  const androidNative = state.nativeBackend?.backend === 'android-native';
  document.body.classList.toggle('native-app', nativeMode);
  document.body.classList.toggle('windows-native-connected', windowsNative);
  document.body.classList.toggle('android-native-connected', androidNative);
  renderRuntimeIdentity();

  const hero = $('heroSubtitle');
  const appTitle = $('appCardTitle');
  const videoLabel = $('videoLabel');
  const backendLabel = $('backendLabel');
  const fontLabel = $('fontLabel');
  const fontPersist = $('fontPersistCheck');
  const fontLibrary = $('fontLibraryDetails');

  for (const [role, config] of Object.entries(WINDOWS_NATIVE_PICKERS)) {
    $(config.inputId)?.classList.toggle('hidden', windowsNative);
    $(config.buttonId)?.classList.toggle('hidden', !windowsNative);
    $({ video: 'videoWebPicker', ass: 'assWebPicker', fonts: 'fontsWebPicker' }[role])?.classList.toggle('hidden', windowsNative);
    if (!windowsNative) setWindowsNativePickerBusy(role, false);
  }

  if (nativeMode) {
    if (hero) {
      hero.textContent = windowsNative
        ? '在现代 Web UI 中直接调用 Windows 系统 FFmpeg、CPU 与 NVIDIA NVENC 完成字幕预检、测试与硬字幕压制。'
        : '在设备本地使用 Android 原生 FFmpeg 完成 ASS 字幕预检、字体检查、真实预览、编码测试与 H.264 / H.265 / AV1 硬字幕压制。';
    }
    if (appTitle) appTitle.textContent = windowsNative ? 'Windows Native' : '应用与更新';
    if (videoLabel) videoLabel.textContent = windowsNative ? '视频（Windows 原生文件选择器）' : '视频（通过 Android 系统文件选择器读取）';
    if (backendLabel) backendLabel.textContent = windowsNative ? 'Windows Native 处理引擎' : 'Android 原生处理引擎';
    if (fontLabel) fontLabel.textContent = '字体（可选，可多选；仅用于本次 Native 任务）';
    fontPersist?.classList.add('hidden');
    fontLibrary?.classList.add('hidden');
    $('envDetails').open = false;
  } else {
    if (hero) {
      hero.textContent =
        '一种在浏览器本地运行，自动完成 ASS 字幕预检、字体检查、编码比较与 H.264 / H.265 / AV1 硬字幕压制的快捷工具。';
    }
    if (appTitle) appTitle.textContent = 'Android 应用';
    if (videoLabel) videoLabel.textContent = '视频（网页≤ 1 GB）';
    if (backendLabel) backendLabel.textContent = '处理引擎';
    if (fontLabel) fontLabel.textContent = '字体（可选，可多选）';
    fontPersist?.classList.remove('hidden');
    fontLibrary?.classList.remove('hidden');
  }
  applyPresentationShell();
  renderNativeStatusBar();
}

function renderAppReleaseCard() {
  const summary = $('appReleaseSummary');
  const notice = $('appUpdateNotice');
  const badge = $('appModeBadge');
  const openBtn = $('openAndroidAppBtn');
  const downloadBtn = $('downloadAndroidAppBtn');
  const checkBtn = $('checkAppUpdateBtn');
  if (!summary || !notice || !badge || !openBtn || !downloadBtn || !checkBtn) return;

  if (state.nativeBackend?.backend === 'windows-native') {
    $('androidAppCard')?.classList.add('hidden');
    return;
  }
  $('androidAppCard')?.classList.remove('hidden');

  const release = state.appRelease;
  const remoteUrl = safeHttpsUrl(
    state.appUpdateCheck?.apkUrl || release?.apkUrl,
    APP_DOWNLOAD_FALLBACK
  );
  downloadBtn.href = remoteUrl;

  const inApp = state.nativeBackend?.backend === 'android-native';
  const isAndroid = /Android/i.test(navigator.userAgent);

  if (inApp) {
    badge.textContent = 'Native';
    badge.className = 'app-mode-badge ok';
    openBtn.classList.add('hidden');
    checkBtn.classList.remove('hidden');
    downloadBtn.classList.add('hidden');

    const currentName = state.nativeBackend?.appVersionName || state.appUpdateCheck?.installedVersionName || '未知';
    const currentCode = state.nativeBackend?.appVersionCode ?? state.appUpdateCheck?.installedVersionCode;
    summary.textContent = '当前版本 ' + currentName + (currentCode != null ? ' · build ' + currentCode : '');

    const update = state.appUpdateCheck;
    if (!update) {
      notice.textContent = '启动后自动检查更新；也可以手动检查。';
      return;
    }
    if (!update.ok) {
      notice.textContent = '更新检查失败：' + (update.error || '未知错误');
      return;
    }
    if (update.updateAvailable) {
      const latest = update.latestVersionName || ('build ' + update.latestVersionCode);
      downloadBtn.classList.remove('hidden');
      downloadBtn.textContent = '下载更新';
      notice.innerHTML =
        '<span class="warn">发现新版本 ' + escapeHtml(latest) + '。</span> ' +
        '下载后由 Android 系统安装器确认覆盖更新。';
      return;
    }
    notice.innerHTML = '<span class="ok">当前已是最新版。</span>';
    return;
  }

  badge.textContent = '网页';
  badge.className = 'app-mode-badge';
  checkBtn.classList.add('hidden');
  openBtn.classList.remove('hidden');
  downloadBtn.classList.remove('hidden');
  downloadBtn.textContent = '下载最新版 APK';

  if (release?.versionName) {
    summary.textContent =
      '最新版 ' + release.versionName +
      (release.publishedAt ? ' · ' + release.publishedAt.slice(0, 10) : '');
    if (release.sha256) downloadBtn.title = 'SHA-256: ' + release.sha256;
  } else {
    summary.textContent = '最新版信息暂时不可用；仍可尝试下载当前发布 APK。';
  }

  if (isAndroid) {
    openBtn.disabled = false;
    openBtn.textContent = '打开 Android App';
    notice.textContent = '已安装时直接拉起 App；未安装时回退到最新版 APK 下载。';
  } else {
    openBtn.disabled = true;
    openBtn.textContent = '请在 Android 设备打开';
    notice.textContent = 'APK 仍可下载；“打开 App”按钮仅在 Android 浏览器中启用。';
  }
}

function renderBackendSummary() {
  const el = $('backendSummary');
  if (!el) return;

  if (!state.nativeBackend?.available) {
    el.innerHTML = '浏览器模式 · FFmpeg WASM；Android APK 可使用 ARM64 原生后端。';
    return;
  }

  const t = state.nativeSelfTest;
  const p = state.nativeInputProbe;

  if (state.nativeBackend?.backend === 'windows-native') {
    const gpu = nativeGpuLabel();
    const available = Array.isArray(state.nativeBackend.encoders)
      ? state.nativeBackend.encoders.filter(x => x?.Available || x?.available).map(x => x.Encoder || x.encoder || x.Key || x.key)
      : [];
    const inputText = p
      ? p.ok
        ? '当前视频：' + escapeHtml(p.videoCodec || 'unknown') + ' ' + Number(p.width || 0) + '×' + Number(p.height || 0)
        : '当前视频探测失败：' + escapeHtml(p.error || '未知错误')
      : '选择视频后由系统 FFprobe 直接探测';
    el.innerHTML =
      '<span class="ok">Windows Native 已连接。</span> ' + inputText +
      '<small class="native-runtime">' +
      escapeHtml(state.nativeBackend.cpu || 'unknown CPU') + ' · ' +
      escapeHtml(gpu) + ' · ' +
      escapeHtml(available.join(' / ') || '未发现可用编码器') +
      '</small>';
    return;
  }

  const runtime =
    'ARM64 · FFmpegKitNext ' + escapeHtml(state.nativeBackend.ffmpegKitVersion || 'unknown') +
    ' · 可用私有空间约 ' + formatBytes(Number(state.nativeBackend.stagingAllocatableBytes || 0)) +
    ' · 热状态 ' + escapeHtml(formatThermalStatus(state.nativeBackend.thermalStatus));

  if (!t) {
    el.innerHTML = '<span class="ok">Android Native 已加载。</span> 正在执行原生核心自检。<small class="native-runtime">' + runtime + '</small>';
    return;
  }

  const required = [
    t.x264EncodeSmoke,
    t.x265EncodeSmoke,
    t.svtAv1EncodeSmoke,
    t.dav1d,
    t.libassVisualSmoke,
    t.bundledFallbackReady,
    t.ffprobeSmoke
  ];
  const ok = required.every(Boolean);

  const inputText = p
    ? p.ok
      ? '当前视频：' + escapeHtml(p.videoCodec || 'unknown') + ' ' +
        Number(p.width || 0) + '×' + Number(p.height || 0) +
        ' · ' + (p.seekable ? 'SAF 直接读取' : '需要 staging')
      : '当前视频探测失败：' + escapeHtml(p.error || '未知错误')
    : '选择视频后会进行 SAF 与解码探测';

  el.innerHTML =
    (ok
      ? '<span class="ok">Android 原生核心自检通过。</span> '
      : '<span class="warn">Android 原生核心自检未完全通过。</span> ') +
    inputText +
    '<small class="native-runtime">' + runtime +
    (state.nativeBackend.powerSaveMode ? ' · 省电模式开启' : '') +
    '</small>';
}

function renderCapabilities() {
  const c = state.capabilities;
  if (!c) return;

  const sw = state.softwareEncoders;
  const dec = state.softwareDecoders;
  const nativeMode = !!state.nativeBackend?.available;
  const t = state.nativeSelfTest;

  const badge = (value, yesText, noText = '不可用') => {
    if (value === null || value === undefined) {
      return '<span class="env-badge">检测中</span>';
    }
    return '<span class="env-badge ' + (value ? 'ok' : 'warn') + '">' +
      (value ? yesText : noText) + '</span>';
  };

  const webBase = [
    ['WebAssembly', c.webAssembly, c.webAssembly ? '支持' : '不可用'],
    ['Web Worker', c.worker, c.worker ? '支持' : '不可用'],
    ['SharedArrayBuffer', c.sharedArrayBuffer, c.sharedArrayBuffer ? '支持' : '不可用'],
    ['跨源隔离', c.crossOriginIsolated, c.crossOriginIsolated ? '支持' : '未启用']
  ];

  const browserMatrix = [
    ['H.264', c.nativePlayback.h264, c.codecs.decode.h264, c.codecs.encode.h264],
    ['H.265', c.nativePlayback.hevc, c.codecs.decode.hevc, c.codecs.encode.hevc],
    ['AV1', c.nativePlayback.av1, c.codecs.decode.av1, c.codecs.encode.av1]
  ];

  if (nativeMode) {
    if (state.nativeBackend?.backend === 'windows-native') {
      const encoders = Array.isArray(state.nativeBackend.encoders) ? state.nativeBackend.encoders : [];
      const encoderRows = encoders.map(e => {
        const name = e.Label || e.label || e.Encoder || e.encoder || e.Key || e.key || 'encoder';
        const ok = !!(e.Available ?? e.available);
        const detail = e.Hardware ?? e.hardware ? 'NVIDIA NVENC' : 'CPU software';
        const err = e.RuntimeError || e.runtimeError || '';
        return '<div class="env-codec-card"><div><strong>' + escapeHtml(name) + '</strong><small>' +
          detail + (err && !ok ? ' · ' + escapeHtml(String(err).split(/\r?\n/)[0].slice(0,120)) : '') +
          '</small></div>' + badge(ok, '可用', '不可用') + '</div>';
      }).join('');
      const gpu = nativeGpuLabel();
      $('capabilities').innerHTML =
        '<div class="env-group native-primary-group"><div class="env-group-title">Windows Native</div>' +
        '<div class="native-runtime-grid">' +
        '<div class="env-chip"><span>CPU</span><span>' + escapeHtml(state.nativeBackend.cpu || 'unknown') + '</span></div>' +
        '<div class="env-chip"><span>GPU</span><span>' + escapeHtml(gpu) + '</span></div>' +
        '<div class="env-chip"><span>FFmpeg</span><span>' + escapeHtml(state.nativeBackend.ffmpegVersion || 'unknown') + '</span></div>' +
        '<div class="env-chip"><span>来源</span><span>' + escapeHtml(state.nativeBackend.ffmpegSource || 'unknown') + '</span></div>' +
        '<div class="env-chip"><span>路径</span><span>' + escapeHtml(state.nativeBackend.ffmpeg || 'missing') + '</span></div>' +
        '<div class="env-chip"><span>fps_mode</span><span class="' + (state.nativeBackend.fpsModeSupported ? 'ok' : 'warn') + '">' +
        (state.nativeBackend.fpsModeSupported ? '支持' : '回退 -vsync') + '</span></div>' +
        '<div class="env-chip"><span>NVENC fullres multipass</span><span class="' + (state.nativeBackend.multipassFullresSupported ? 'ok' : 'warn') + '">' +
        (state.nativeBackend.multipassFullresSupported ? '支持' : '关闭 / 降级') + '</span></div>' +
        '<div class="env-chip"><span>libass</span><span class="' + (state.nativeBackend.hasAss ? 'ok' : 'warn') + '">' +
        (state.nativeBackend.hasAss ? '可用' : '缺失') + '</span></div></div>' +
        (Array.isArray(state.nativeBackend.ffmpegWarnings) && state.nativeBackend.ffmpegWarnings.length
          ? '<div class="env-warning-list">' + state.nativeBackend.ffmpegWarnings.map(x => '<div class="warn">' + escapeHtml(String(x)) + '</div>').join('') + '</div>'
          : '') +
        '</div>' +
        '<div class="env-group"><div class="env-group-title">编码器</div><div class="env-wasm-grid">' + encoderRows + '</div></div>';
      return;
    }

    const nativeRows = [
      ['H.264', 'x264 · 编码', t ? !!t.x264EncodeSmoke : null],
      ['H.265', 'x265 · 编码', t ? !!t.x265EncodeSmoke : null],
      ['AV1', 'SVT-AV1 · 编码', t ? !!t.svtAv1EncodeSmoke : null],
      ['AV1', 'dav1d · 解码', t ? !!t.dav1d : null],
      ['字幕', 'libass · 实际像素验证', t ? !!t.libassVisualSmoke : null],
      ['质量', 'SSIM · 目标质量校准', t ? !!t.ssimSmoke : null],
      ['媒体', 'FFprobe · 探测', t ? !!t.ffprobeSmoke : null],
      ['字体', 'Noto Sans SC · 回退', t ? !!t.bundledFallbackReady : null]
    ];

    const p = state.nativeInputProbe;
    const inputStatus = p
      ? p.ok
        ? '<span class="ok">' + (p.seekable ? '可直接读取' : '需要 staging') + '</span>'
        : '<span class="warn">探测失败</span>'
      : '<span>待选择视频</span>';

    $('capabilities').innerHTML = `
      <div class="env-group native-primary-group">
        <div class="env-group-title">Android 原生核心</div>
        <div class="env-wasm-grid">
          ${nativeRows.map(([codec, detail, value]) => `
            <div class="env-codec-card">
              <div><strong>${codec}</strong><small>${detail}</small></div>
              ${badge(value, '可用', '异常')}
            </div>
          `).join('')}
        </div>
      </div>

      <div class="env-group">
        <div class="env-group-title">设备与文件访问</div>
        <div class="native-runtime-grid">
          <div class="env-chip"><span>当前视频 SAF</span>${inputStatus}</div>
          <div class="env-chip"><span>私有工作空间</span><span>${formatBytes(Number(state.nativeBackend.stagingAllocatableBytes || 0))}</span></div>
          <div class="env-chip"><span>热状态</span><span>${escapeHtml(formatThermalStatus(state.nativeBackend.thermalStatus))}</span></div>
          <div class="env-chip"><span>省电模式</span><span class="${state.nativeBackend.powerSaveMode ? 'warn' : 'ok'}">${state.nativeBackend.powerSaveMode ? '已开启' : '关闭'}</span></div>
        </div>
      </div>

      <details class="platform-diagnostics">
        <summary>高级诊断：WebView / 网页后备环境</summary>
        <div class="platform-diagnostics-body">
          <div class="env-chip-grid">
            ${webBase.map(([name, ok, text]) => `
              <div class="env-chip"><span>${name}</span><span class="${ok ? 'ok' : 'warn'}">${text}</span></div>
            `).join('')}
          </div>
          <div class="env-matrix env-matrix-four" style="margin-top:10px">
            <div class="env-matrix-head">格式</div>
            <div class="env-matrix-head">播放</div>
            <div class="env-matrix-head">解码API</div>
            <div class="env-matrix-head">编码API</div>
            ${browserMatrix.map(([codec, playback, decode, encode]) => `
              <div class="env-matrix-codec">${codec}</div>
              <div>${badge(playback, '可播放', '未报告')}</div>
              <div>${badge(decode, '可用', '未暴露')}</div>
              <div>${badge(encode, '可用', '未暴露')}</div>
            `).join('')}
          </div>
          <div class="note env-explain">这些项目只描述 APK 内 WebView 的网页能力，不参与 Native 正式压制判定。</div>
        </div>
      </details>
    `;
    return;
  }

  const codecBackend = [
    ['H.264', 'x264 · 编码', sw.h264, sw.h264 === null ? '检测中' : sw.h264 ? '可用' : '未编入'],
    ['H.265', 'x265 · 编码', sw.h265, sw.h265 === null ? '检测中' : sw.h265 ? '可用' : '未编入'],
    ['AV1', 'SVT-AV1 · 编码', sw.av1, sw.av1 === null ? '检测中' : sw.av1 ? '可用' : '未编入'],
    ['AV1', 'dav1d · 解码', dec.av1Dav1d, dec.av1Dav1d === null ? '检测中' : dec.av1Dav1d ? '可用' : '未编入']
  ];

  $('capabilities').innerHTML = `
    <div class="env-group">
      <div class="env-group-title">基础环境</div>
      <div class="env-chip-grid">
        ${webBase.map(([name, ok, text]) => `
          <div class="env-chip"><span>${name}</span><span class="${ok ? 'ok' : 'warn'}">${text}</span></div>
        `).join('')}
      </div>
    </div>
    <div class="env-group">
      <div class="env-group-title">FFmpeg WASM</div>
      <div class="env-wasm-grid">
        ${codecBackend.map(([codec, detail, ok, text]) => `
          <div class="env-codec-card">
            <div><strong>${codec}</strong><small>${detail}</small></div>
            <span class="env-badge ${ok ? 'ok' : 'warn'}">${text}</span>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="env-group">
      <div class="env-group-title">浏览器原生能力</div>
      <div class="env-matrix env-matrix-four">
        <div class="env-matrix-head">格式</div>
        <div class="env-matrix-head">播放</div>
        <div class="env-matrix-head">解码API</div>
        <div class="env-matrix-head">编码API</div>
        ${browserMatrix.map(([codec, playback, decode, encode]) => `
          <div class="env-matrix-codec">${codec}</div>
          <div>${badge(playback, '可播放', '未报告')}</div>
          <div>${badge(decode, '可用', '未暴露')}</div>
          <div>${badge(encode, '可用', '未暴露')}</div>
        `).join('')}
      </div>
      <div class="note env-explain">“未暴露”只表示 WebCodecs API 没开放给网页，不等于设备硬件不支持该格式。</div>
    </div>
  `;
}

function updateEnvironmentSummary(engineReady = state.engine?.ready) {
  const c = state.capabilities;
  if (!c) {
    $('envSummary').textContent = '检测中…';
    return;
  }

  if (state.nativeBackend?.available) {
    const t = state.nativeSelfTest;
    if (state.nativeBackend?.backend === 'windows-native') {
      const ready = !!(t?.ffprobeSmoke && t?.libassVisualSmoke && (t?.x264EncodeSmoke || t?.x265EncodeSmoke || t?.svtAv1EncodeSmoke));
      $('envSummary').textContent = ready ? 'Windows Native 环境正常' : 'Windows Native 环境需要检查 · 点此查看';
      $('envSummary').className = ready ? 'env-summary ok' : 'env-summary warn';
      $('envDetails').open = !ready;
      return;
    }
    if (!t) {
      $('envSummary').textContent = 'Android 原生模式 · 正在自检';
      $('envSummary').className = 'env-summary';
      return;
    }
    const nativeOk = [
      t.x264EncodeSmoke,
      t.x265EncodeSmoke,
      t.svtAv1EncodeSmoke,
      t.dav1d,
      t.libassVisualSmoke,
      t.bundledFallbackReady,
      t.ffprobeSmoke
    ].every(Boolean);
    $('envSummary').textContent = nativeOk
      ? '原生环境正常'
      : '原生环境需要检查 · 点此查看';
    $('envSummary').className = nativeOk ? 'env-summary ok' : 'env-summary warn';
    $('envDetails').open = !nativeOk;
    return;
  }

  const baseOk = c.webAssembly && c.worker && c.sharedArrayBuffer && c.crossOriginIsolated;
  if (!baseOk) {
    $('envSummary').textContent = '基础环境存在问题 · 点此查看';
    $('envSummary').className = 'env-summary warn';
    $('envDetails').open = true;
    return;
  }

  if (!engineReady) {
    $('envSummary').textContent = '基础环境正常 · 编码核心未加载';
    $('envSummary').className = 'env-summary warn';
    return;
  }

  const enc = state.softwareEncoders;
  const available = [
    enc.h264 ? 'H.264' : null,
    enc.h265 ? 'H.265' : null,
    enc.av1 ? 'AV1' : null
  ].filter(Boolean).join(' / ');

  const dav1d = state.softwareDecoders.av1Dav1d === true
    ? ' · AV1输入✓'
    : state.softwareDecoders.av1Dav1d === false
      ? ' · AV1输入待dav1d'
      : '';

  $('envSummary').textContent = `核心已加载 · ${available || '编码器检测中'}${dav1d}`;
  $('envSummary').className = 'env-summary ok';
  $('envDetails').open = false;
}

function fontFileKey(file) {
  return `${String(file?.name || '').toLowerCase()}::${Number(file?.size || 0)}`;
}

function getEffectiveFontFiles() {
  const out = [];
  const seen = new Set();
  for (const file of [...state.fonts, ...state.savedFonts]) {
    const key = fontFileKey(file);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

function updateFontMeta() {
  const selected = state.fonts.length;

  if (state.nativeBackend?.available) {
    const windowsNative = state.nativeBackend?.backend === 'windows-native';
    $('fontMeta').textContent = selected
      ? '本次选择 ' + selected + ' 个字体；Native 任务会复制到工作目录并交给 libass/fontconfig 使用。'
      : windowsNative
        ? '未选择额外字体；Windows Native 将使用系统字体与 libass/fontconfig 的字体匹配。'
        : '未选择额外字体；缺失字体将使用内置 Noto Sans SC 回退。';
    return;
  }

  const saved = state.savedFonts.length;
  if (selected || saved) {
    $('fontMeta').textContent = `本次选择 ${selected} 个 · 常用字体库 ${saved} 个；分析时自动合并去重。`;
  } else {
    $('fontMeta').textContent = '未选择；常用字体库为空，缺失字体将使用内置 Noto Sans SC 回退。';
  }
}

function renderSavedFontLibrary() {
  const summary = $('savedFontsSummary');
  const list = $('savedFontsList');
  if (!summary || !list) return;

  summary.textContent = `常用字体库：${state.savedFonts.length} 个文件`;
  if (!state.savedFonts.length) {
    list.innerHTML = '<div class="note">还没有保存字体。第一次选择字体时保持“记住本次选择”勾选即可。</div>';
    $('clearSavedFontsBtn').disabled = true;
    return;
  }

  $('clearSavedFontsBtn').disabled = false;
  list.innerHTML = state.savedFonts.map((file, index) =>
    `<div class="font-library-item">
      <div><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}</small></div>
      <button type="button" class="remove-saved-font" data-index="${index}">删除</button>
    </div>`
  ).join('');

  document.querySelectorAll('.remove-saved-font').forEach(button => {
    button.addEventListener('click', async () => {
      const file = state.savedFonts[Number(button.dataset.index)];
      if (!file) return;
      try {
        await deleteSavedFont(file);
        state.savedFonts = await listSavedFonts();
        invalidateAnalysis();
        renderSavedFontLibrary();
        updateFontMeta();
        log(`已从常用字体库删除：${file.name}；字体来源已变化，需要重新分析与预览。`);
      } catch (error) {
        log(`删除常用字体失败：${error.message}`);
      }
    });
  });
}

function renderSourceVideoSummary(media = state.sourceMedia) {
  const box = $('sourceVideoSummary');
  if (!box) return;
  if (!media?.width || !media?.height) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const videoRate = Number(media.videoBitRate || media.bitRate || 0);
  const videoStreams = Array.isArray(media.videoStreams) ? media.videoStreams : [];
  const audioTracks = Number(media.audioTracks || 0);
  const audioCodecs = [...new Set(
    (Array.isArray(media.audioCodecs) && media.audioCodecs.length
      ? media.audioCodecs
      : media.audioCodec ? [media.audioCodec] : [])
      .map(codec => String(codec || '').trim())
      .filter(Boolean)
  )];
  const audioRate = Number(media.audioBitRate || 0);
  const audio = audioTracks > 0
    ? (audioCodecs.length ? audioCodecs.map(codec => codec.toUpperCase()).join(' / ') : 'CODEC 未知') +
      ' · ' + audioTracks + ' 轨' +
      (audioRate > 0 ? ' · ' + formatBitrate(audioRate) : '')
    : '未检测到音轨';
  const color = [media.colorPrimaries, media.colorTransfer, media.colorSpace].filter(Boolean).join(' / ') || '未标记';
  const decodeState = media.inputDecodeSmoke
    ? '已通过 1 帧实测'
    : media.sourceAdapterRequired
      ? 'FFmpeg 不可解码 · 需要 Bink 2 输入适配'
      : media.inputDecodeDeferred
        ? '将在预览 / 执行时验证'
        : '未通过';
  const videoStreamSummary = videoStreams.length
    ? videoStreams.map((stream,index)=>{
        const ordinal=Number.isInteger(Number(stream.ordinal))?Number(stream.ordinal):index;
        const codec=String(stream.codec||stream.codec_name||'unknown').toUpperCase();
        const size=Number(stream.width||0)>0&&Number(stream.height||0)>0 ? stream.width+'×'+stream.height : '尺寸未知';
        const fps=Number(stream.fps||0)>0 ? Number(stream.fps).toFixed(3)+' fps' : 'fps 未知';
        const depth=Number(stream.bitDepth||0)>0 ? stream.bitDepth+'-bit' : '位深未知';
        return '#'+ordinal+' '+codec+' · '+size+' · '+fps+' · '+depth;
      }).join(' / ')
    : '#0 '+String(media.videoCodec||'未知').toUpperCase();
  const rows = [
    ['视频流', videoStreamSummary],
    ['主视频编码', media.sourceOriginalKind === 'bink2' ? 'Bink 2' : (media.videoCodec || '未知')],
    ['分辨率', media.width + '×' + media.height],
    ['帧率', Number(media.fps || 0) > 0 ? Number(media.fps).toFixed(3) + ' fps' : '未知'],
    ['时长', Number(media.duration || 0) > 0 ? formatDuration(Number(media.duration)) : '未知'],
    ['源视频码率', videoRate > 0 ? formatBitrate(videoRate) : '未知'],
    ['像素格式', (media.pixelFormat || '未知') + ' · ' + Number(media.bitDepth || 8) + '-bit'],
    ['色彩 / HDR', (media.hdr || media.unsafeColorPipeline ? 'HDR / 高位深风险 · ' : '') + color],
    ['输入解码', decodeState],
    ...(media.sourceAdapterApplied ? [['执行输入', 'RAD Video Tools → 临时 AVI']] : []),
    ['音频', audio],
    ['文件大小', Number(media.size || state.video?.size || 0) > 0 ? formatBytes(Number(media.size || state.video?.size || 0)) : '未知']
  ];
  box.innerHTML = '<div class="source-video-summary-heading"><strong>原始视频参数</strong><span>来自 FFprobe / Native probe</span></div>' +
    rows.map(([key,value]) => '<div class="status-item"><span>' + escapeHtml(key) + '</span><span>' + escapeHtml(value) + '</span></div>').join('');
  box.classList.remove('hidden');
}

function renderSourceAdapterState(probe = state.nativeInputProbe) {
  const panel = $('sourceAdapterPanel');
  if (!panel) return;
  const importing = !!state.nativeImportJobId;
  const relevant = importing || probe?.sourceAdapter === 'rad-bink2' || probe?.sourceOriginalKind === 'bink2';
  if (!relevant) {
    panel.classList.add('hidden');
    return;
  }

  const available = !!probe?.sourceAdapterAvailable || !!state.nativeBackend?.bink2ImportAvailable;
  const applied = !!probe?.sourceAdapterApplied;
  const required = !!probe?.sourceAdapterRequired;
  const tool = probe?.sourceAdapterTool || state.nativeBackend?.bink2ImportTool || 'RAD Video Tools';

  panel.classList.remove('hidden');
  $('sourceAdapterImportBtn').classList.toggle('hidden', importing || applied || !required);
  $('sourceAdapterCancelBtn').classList.toggle('hidden', !importing);
  $('sourceAdapterInstallLink').classList.toggle('hidden', available || applied);
  $('sourceAdapterImportBtn').disabled = importing || !available || !required;
  $('sourceAdapterCancelBtn').disabled = !importing;

  if (importing) {
    $('sourceAdapterBadge').textContent = 'IMPORTING';
    $('sourceAdapterTitle').textContent = '正在导入 Bink 2';
    $('sourceAdapterDetail').textContent =
      'RAD Video Tools 正在把 Bink 2 解码到临时 AVI。这里不伪造百分比或 ETA；完成后会用 FFmpeg 再做实际解码验证。';
    return;
  }

  if (applied) {
    $('sourceAdapterBadge').textContent = 'READY';
    $('sourceAdapterTitle').textContent = 'Bink 2 已导入';
    $('sourceAdapterDetail').textContent =
      '当前任务使用 RAD Video Tools 生成的临时 AVI 作为执行输入；原始 .bk2 不会被修改。由于已经发生外部解码，Stream Copy 不再等价于复制原始 Bink 码流。Bink 2 的 Alpha 与多音轨语义仍需按素材实际情况核对。';
    $('sourceAdapterStatus').textContent = '适配器：' + tool + ' · 临时文件会在更换源视频或关闭 Windows Bridge 时清理。';
    return;
  }

  $('sourceAdapterBadge').textContent = available ? 'ADAPTER READY' : 'DECODER MISSING';
  $('sourceAdapterTitle').textContent = '检测到 Bink 2';
  if (required && available) {
    $('sourceAdapterDetail').textContent =
      'FFprobe 能识别这个 Bink 2 文件，但当前 FFmpeg 不能解码它的视频流。可以调用本机 RAD Video Tools 先解码为临时 AVI，再进入现有转码 / 硬字幕流程。';
    $('sourceAdapterStatus').textContent = '已检测到：' + tool + '。此依赖由用户单独安装，本项目不捆绑 RAD/Bink 组件。';
  } else if (required) {
    $('sourceAdapterDetail').textContent =
      'FFprobe 能识别这个 Bink 2 文件，但当前 FFmpeg 不能解码它的视频流；同时没有检测到 RAD Video Tools，因此暂时不能进入转码。';
    $('sourceAdapterStatus').textContent =
      '安装或解压 RAD Video Tools 后重新启动 Windows Bridge；也可设置 RADVIDEO64 或 RADVIDEO_HOME 指向本机工具。';
  } else {
    $('sourceAdapterDetail').textContent =
      '该源文件带有 Bink 2 标识，但当前执行路径已经能够解码；无需外部导入。';
    $('sourceAdapterStatus').textContent = '';
  }
}

async function monitorBink2Import(jobId) {
  const bridge = globalThis.NativeHardsub;
  let statusReadFailures = 0;
  while (state.nativeImportJobId === jobId) {
    let result;
    try {
      result = JSON.parse(await Promise.resolve(bridge.getBink2ImportStatus(jobId)));
      statusReadFailures = 0;
    } catch (error) {
      statusReadFailures++;
      log('Bink 2 导入状态读取失败（' + statusReadFailures + '/5）：' + error.message);
      if (statusReadFailures >= 5) {
        $('sourceAdapterStatus').textContent =
          '导入状态连接连续失败；任务 ID 已保留。保持 Windows Bridge 运行并刷新页面，可重新连接当前导入任务。';
        syncTaskInputMutationLocks();
        return;
      }
      $('sourceAdapterStatus').textContent = '导入状态读取失败，正在重试 ' + statusReadFailures + '/5…';
      await sleepMs(1000);
      continue;
    }

    if (!result?.ok) {
      statusReadFailures++;
      if (statusReadFailures >= 5) {
        $('sourceAdapterStatus').textContent =
          '无法确认导入任务状态；任务 ID 已保留。保持 Windows Bridge 运行并刷新页面重连。';
        syncTaskInputMutationLocks();
        return;
      }
      await sleepMs(1000);
      continue;
    }

    if (result.state === 'importing' || result.state === 'cancelling') {
      renderSourceAdapterState();
      const elapsed = Number(result.elapsedSeconds || 0);
      $('sourceAdapterStatus').textContent =
        (result.state === 'cancelling' ? '正在取消导入' : '正在通过 RAD Video Tools 解码') +
        (elapsed > 0 ? ' · 已用 ' + formatDuration(elapsed) : '') +
        ' · 不显示未经证实的 ETA';
      await sleepMs(800);
      continue;
    }

    if (result.state === 'completed') {
      state.nativeImportJobId = null;
      localStorage.removeItem('nativeBink2ImportJobId');
      syncTaskInputMutationLocks();
      invalidateAnalysis({ clearVideoMetadata: true });
      state.nativeInputProbe = null;
      $('sourceAdapterPanel').classList.remove('hidden');
      $('sourceAdapterTitle').textContent = 'Bink 2 导入完成';
      $('sourceAdapterBadge').textContent = 'VERIFYING';
      $('sourceAdapterDetail').textContent = '临时 AVI 已生成，正在用 FFprobe / FFmpeg 重新读取并验证可解码性。';
      $('sourceAdapterStatus').textContent = '临时输入 ' + formatBytes(Number(result.outputBytes || 0)) + '。';
      log('Bink 2 导入完成；正在重新探测 RAD staging 输入。');
      bridge.probeSelectedVideo?.();
      refreshAnalyze();
      return;
    }

    state.nativeImportJobId = null;
    localStorage.removeItem('nativeBink2ImportJobId');
    syncTaskInputMutationLocks();
    renderSourceAdapterState(state.nativeInputProbe);
    if (result.state === 'cancelled') {
      $('sourceAdapterStatus').textContent = 'Bink 2 导入已取消；原始文件仍保持选中。';
      log('Bink 2 导入已取消。');
    } else {
      $('sourceAdapterStatus').textContent = 'Bink 2 导入失败：' + (result.error || '未知错误');
      log('Bink 2 导入失败：' + (result.error || '未知错误'));
    }
    refreshAnalyze();
    return;
  }
}

async function startBink2Import() {
  const bridge = globalThis.NativeHardsub;
  const probe = state.nativeInputProbe;
  if (!bridge?.__windowsNative || !bridge?.startBink2Import || !bridge?.getBink2ImportStatus) {
    throw new Error('Windows Native Bink 2 导入桥不可用');
  }
  if (!probe?.sourceAdapterRequired) throw new Error('当前源视频不需要 Bink 2 外部导入');
  if (!probe?.sourceAdapterAvailable && !state.nativeBackend?.bink2ImportAvailable) {
    throw new Error('未检测到 RAD Video Tools');
  }
  if (state.nativeJobId || state.operationBusy || state.nativeImportJobId) {
    throw new Error('当前已有任务占用输入素材');
  }

  const started = JSON.parse(await Promise.resolve(bridge.startBink2Import()));
  if (!started?.ok || !started.jobId) throw new Error(started?.error || '创建 Bink 2 导入任务失败');
  state.nativeImportJobId = started.jobId;
  localStorage.setItem('nativeBink2ImportJobId', started.jobId);
  syncTaskInputMutationLocks();
  renderSourceAdapterState(probe);
  log('Bink 2 导入任务已创建：' + started.jobId + ' · ' + (started.converter || 'RAD Video Tools'));
  void monitorBink2Import(started.jobId);
}

async function recoverWindowsNativeVideoSelection() {
  const bridge = globalThis.NativeHardsub;
  if (!bridge?.__windowsNative || !bridge?.readSelectedVideoInfo || state.video) return;
  try {
    const info = JSON.parse(await Promise.resolve(bridge.readSelectedVideoInfo()));
    if (!info?.ok || !info.name) return;
    state.video = {
      name: String(info.name),
      size: Number(info.size || 0),
      lastModified: Number(info.lastModified || 0),
      type: 'video/x-windows-native-selection'
    };
    $('videoMeta').textContent = state.video.name + ' · ' + formatBytes(state.video.size) + ' · Windows Native 已恢复';
    $('videoMeta').className = '';
    if ($('videoWebPicker')) $('videoWebPicker').textContent = '更换视频';
    log('Windows Native：已恢复当前视频选择 ' + state.video.name + '。');
  } catch (error) {
    log('Windows Native 视频选择恢复失败：' + error.message);
  }
}

async function recoverBink2ImportJob() {
  const bridge = globalThis.NativeHardsub;
  const jobId = localStorage.getItem('nativeBink2ImportJobId');
  if (!jobId || !bridge?.getBink2ImportStatus) return;
  try {
    const status = JSON.parse(await Promise.resolve(bridge.getBink2ImportStatus(jobId)));
    if (!status?.ok || !['importing','cancelling','completed'].includes(status.state)) {
      localStorage.removeItem('nativeBink2ImportJobId');
      return;
    }
    state.nativeImportJobId = jobId;
    syncTaskInputMutationLocks();
    renderSourceAdapterState(state.nativeInputProbe);
    log('恢复 Bink 2 导入任务监视：' + jobId);
    if (status.state === 'completed') {
      await monitorBink2Import(jobId);
    } else {
      void monitorBink2Import(jobId);
    }
  } catch (error) {
    log('恢复 Bink 2 导入任务失败：' + error.message);
  }
}

async function analyzeVideoOnly() {
  invalidateAnalysis();
  if (!state.video) throw new Error('请先选择视频');

  if (state.nativeBackend?.available) {
    const p = state.nativeInputProbe;
    if (!p?.ok) throw new Error(p?.error || '原生视频参数仍在读取，请稍后重试');
    if (p.sourceAdapterRequired) {
      throw new Error(p.sourceAdapterAvailable
        ? '检测到 Bink 2；请先使用“RAD Video Tools 导入”再继续。'
        : '检测到 Bink 2，但当前 FFmpeg 无法解码且未检测到 RAD Video Tools。');
    }
    if (p.inputDecodeSmoke === false && !p.inputDecodeDeferred) {
      throw new Error('视频元数据可读取，但当前 FFmpeg 无法实际解码视频流：' + (p.inputDecodeError || 'decoder unavailable'));
    }
    state.media = mediaFromNativeProbe(p);
  } else {
    if (state.video.size > MAX_BYTES) throw new Error('浏览器输入上限为 1 GiB；请使用 Native 版本');
    const ready = await ensureWebEngineReady();
    if (!ready) throw new Error('Web 压制核心不可用');
    await state.engine.stageFiles(state.video, null, []);
    state.media = await state.engine.probe();
  }

  if (!state.media?.width || !state.media?.height) throw new Error('所选文件没有可识别的视频流');
  state.sourceMedia = { ...state.media };
  renderSourceVideoSummary();
  notifyMediaInfoChanged();
  log(
    '源视频参数：' +
    state.media.videoCodec + ' · ' +
    state.media.width + 'x' + state.media.height + ' · ' +
    Number(state.media.fps || 0).toFixed(3) + ' fps · ' +
    formatDuration(Number(state.media.duration || 0))
  );
  if (!state.ass && (document.body.dataset.mediaOperation || 'hardsub') === 'hardsub') {
    log('视频参数已读取；选择 ASS 后再次点击“分析视频与字幕”即可继续字幕预检。');
  }
}

async function analyzeCurrentInputs() {
  if (state.nativeBackend?.available && state.video && !state.nativeInputProbe?.ok) {
    try {
      state.nativeInputProbe = null;
      globalThis.NativeHardsub?.probeSelectedVideo?.();
      log(nativePlatformName() + '：正在重新读取原始视频参数…');
      refreshAnalyze();
      return;
    } catch (error) {
      state.nativeInputProbe = { ok: false, error: error.message };
      refreshAnalyze();
      throw error;
    }
  }
  const mode = document.body.dataset.mediaOperation || 'hardsub';
  if (mode === 'hardsub' && state.ass) return analyzeAll();
  return analyzeVideoOnly();
}

function refreshAnalyze() {
  const button = $('analyze');
  const mode = document.body.dataset.mediaOperation || 'hardsub';
  const fullHardsub = mode === 'hardsub' && !!state.ass;
  button.textContent = fullHardsub ? '分析视频与字幕' : '读取视频参数';
  if (state.operationBusy || state.nativeImportJobId) {
    button.disabled = true;
    if (state.nativeImportJobId) button.textContent = '正在导入 Bink 2…';
    return;
  }
  if (!state.video) { button.disabled = true; return; }
  if (state.nativeBackend?.available) {
    if (!state.nativeInputProbe) {
      button.disabled = true;
      button.textContent = '正在读取视频参数…';
      return;
    }
    if (!state.nativeInputProbe.ok) {
      button.disabled = false;
      button.textContent = '重试读取视频参数';
      return;
    }
    if (state.nativeInputProbe.sourceAdapterRequired) {
      button.disabled = true;
      button.textContent = state.nativeInputProbe.sourceAdapterAvailable ? '先导入 Bink 2' : '缺少 Bink 2 解码器';
      return;
    }
    if (state.nativeInputProbe.inputDecodeSmoke === false && !state.nativeInputProbe.inputDecodeDeferred) {
      button.disabled = true;
      button.textContent = '视频解码器不可用';
      return;
    }
    button.disabled = false;
    return;
  }
  button.disabled = state.video.size > MAX_BYTES;
}

async function analyzeAll() {
  try {
    invalidateAnalysis();
    if (!state.nativeBackend?.available) {
      const ready = await ensureWebEngineReady();
      if (!ready) throw new Error('Web 压制核心不可用');
    }
    $('analyze').disabled = true;
    log('开始分析 ASS 和字体…');
    const decodedAss = await decodeAssFile(state.ass);
    const assText = decodedAss.text;
    state.assEncoding = decodedAss.encoding;
    if (decodedAss.removedNulls > 0) {
      log('ASS 文本中发现并移除了 ' + decodedAss.removedNulls + ' 个 NUL 字符；这类字符会让部分 libass/文本解析路径提前截断。');
    }
    log('ASS 文本编码：' + state.assEncoding + '；统一转换为 UTF-8 后交给预览与正式压制。');
    state.assText = assText;
    state.activeAssText = assText;
    state.fontBindings = {};
    state.autoFontFallbacks = {};
    state.assInfo = parseAss(assText);
    state.effectiveFonts = state.nativeBackend?.available ? [...state.fonts] : getEffectiveFontFiles();
    if (state.nativeBackend?.available && state.savedFonts.length) {
      log('Native 正式压制只直接使用本次通过系统文件选择器选中的字体；浏览器常用字体库暂不传入 Native 服务。');
    }
    const inspectedFontFaces = await Promise.all(
      state.effectiveFonts.map(async file => {
        try { return await inspectFontFile(file); }
        catch (e) {
          log(`字体 ${file.name} 解析失败：${e.message}`);
          return [];
        }
      })
    );
    state.fontFaces = inspectedFontFaces.flat();
    state.fontMatches = matchRequestedFonts(state.assInfo.requestedFonts, state.fontFaces);

    if (!state.nativeBackend?.available && state.engine.ready) {
      log(`挂载媒体文件与 ${state.effectiveFonts.length} 个可用字体到浏览器 WebAssembly 文件系统…`);
      await state.engine.stageFiles(state.video, state.ass, state.effectiveFonts);
      // Normalize every subtitle path to the exact UTF-8 text parsed by the UI.
      // This avoids preview/formal-encode differences for UTF-16 BOM files.
      await state.engine.setAssText(state.activeAssText);
      if (state.engine.hasBundledFallbackFont && !state.effectiveFonts.length) {
        state.autoFontFallbacks = Object.fromEntries(
          state.fontMatches
            .filter(m => m.status === 'missing')
            .map(m => [m.requested, state.engine.fallbackFontFamily])
        );
        await state.engine.setFontMappings({ ...state.autoFontFallbacks, ...state.fontBindings });
      } else if (state.engine.ready) {
        await state.engine.setFontMappings({ ...state.fontBindings });
      }
      state.media = await state.engine.probe();
      if (!state.media.width || !state.media.height) throw new Error('所选文件没有可识别的视频流');
      state.sourceMedia = { ...state.media };
      renderSourceVideoSummary();
      notifyMediaInfoChanged();
      log(`FFprobe：${state.media.videoCodec} ${state.media.width}x${state.media.height} ${state.media.fps.toFixed(2)} fps · ${state.media.pixelFormat || '未知像素格式'} · ${state.media.bitDepth}-bit`);

      if (state.media.videoCodec === 'av1' && state.softwareDecoders.av1Dav1d === false) {
        throw new Error('当前 Web 核心没有可用的 dav1d AV1 解码器');
      }
      state.inputDecodeOk = false;
      log('媒体元数据已读取；首张真实字幕预览将同时完成输入解码验证。');
    } else if (state.nativeBackend?.available) {
      const p = state.nativeInputProbe;
      if (!p?.ok) throw new Error(p?.error || 'Native 输入探测尚未完成');
      if (p.sourceAdapterRequired) {
        throw new Error(p.sourceAdapterAvailable
          ? '检测到 Bink 2；请先使用 RAD Video Tools 导入，再进行字幕分析。'
          : '检测到 Bink 2；当前 FFmpeg 无法解码，且未检测到 RAD Video Tools。');
      }
      if (p.inputDecodeSmoke === false && !p.inputDecodeDeferred) {
        throw new Error('视频元数据可读取，但当前 FFmpeg 无法实际解码视频流：' + (p.inputDecodeError || 'decoder unavailable'));
      }
      state.media = mediaFromNativeProbe(p);
      if (!state.media.width || !state.media.height) throw new Error('所选文件没有可识别的视频流');
      state.sourceMedia = { ...state.media };
      renderSourceVideoSummary();
      notifyMediaInfoChanged();
      state.inputDecodeOk = p.inputDecodeSmoke === true;
      log(state.inputDecodeOk
        ? 'Native 媒体元数据已读取；输入视频 1 帧解码实测已通过。'
        : 'Native 媒体元数据已读取；首张真实字幕预览将同时完成输入解码验证。');

      const androidNative = state.nativeBackend?.backend === 'android-native';
      if (androidNative && state.nativeSelfTest?.bundledFallbackReady && !state.effectiveFonts.length) {
        state.autoFontFallbacks = Object.fromEntries(
          state.fontMatches
            .filter(m => m.status === 'missing')
            .map(m => [m.requested, 'Noto Sans SC'])
        );
        state.activeAssText = rewriteAssFonts(state.assText, {
          ...state.autoFontFallbacks,
          ...state.fontBindings
        });
      } else {
        state.activeAssText = rewriteAssFonts(state.assText, {
          ...state.fontBindings
        });
      }

      log(
        'Native FFprobe：' +
        state.media.videoCodec + ' ' +
        state.media.width + 'x' + state.media.height + ' ' +
        state.media.fps.toFixed(2) + ' fps · ' +
        (state.media.pixelFormat || '未知像素格式') + ' · ' +
        state.media.bitDepth + '-bit'
      );
      log('Native 输入视频实际 1 帧解码测试通过。');
    } else {
      throw new Error('没有可用的视频处理后端');
    }
    await refreshGlyphCoverage();
    renderSubtitleSummary();
    $('preflightCard').classList.remove('hidden');
    $('subtitleCard').classList.remove('hidden');
    $('planCard').classList.remove('hidden');
    $('encodeCard').classList.remove('hidden');
    syncMobileStageNav();
    renderPlanOptions();
    $('previewBtn').disabled =
      !(state.engine.ready || state.nativeBackend?.available) ||
      !state.assInfo.previewTimes.length;
    state.analyzedVideo = state.video;
    state.analyzedAss = state.ass;
    state.analyzedFontKey = currentFontKey();
    refreshBenchmarkEnabled();
  } catch (e) {
    log(`分析失败：${e.stack || e.message}`);
    alert(`分析失败：${e.message}`);
  } finally {
    refreshAnalyze();
  }
}


async function ensureBundledFallbackFontFaces() {
  const fallbackNames = new Set(Object.values(state.autoFontFallbacks || {}).filter(Boolean));
  if (!fallbackNames.has('Noto Sans SC')) return;
  if (state.fallbackFontFaces.length) return;

  try {
    const response = await fetch('./vendor/fallback-fonts/NotoSansSC-Regular.otf', { cache: 'force-cache' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const blob = await response.blob();
    const file = new File([blob], 'NotoSansSC-Regular.otf', { type: 'font/otf' });
    state.fallbackFontFaces = await inspectFontFile(file);
    log('已载入内置 Noto Sans SC 的 cmap，用于静态字形覆盖检查。');
  } catch (error) {
    log('无法读取内置回退字体的 cmap；将把这部分覆盖状态标记为未静态验证：' + error.message);
  }
}

async function refreshGlyphCoverage() {
  if (!state.assInfo) {
    state.glyphCoverage = [];
    return;
  }
  await ensureBundledFallbackFontFaces();
  const faces = [...state.fontFaces, ...state.fallbackFontFaces];
  state.glyphCoverage = analyzeFontUsageCoverage(
    state.assInfo.fontUsage || [],
    faces,
    { ...state.autoFontFallbacks, ...state.fontBindings }
  );
}

function glyphCodePointLabel(codePoint) {
  let char = '';
  try { char = String.fromCodePoint(codePoint); } catch {}
  const hex = Number(codePoint).toString(16).toUpperCase().padStart(codePoint > 0xFFFF ? 6 : 4, '0');
  return escapeHtml(char || '�') + ' <span class="glyph-code">U+' + hex + '</span>';
}

function formatMissingGlyphs(codePoints, limit = 18) {
  const list = (codePoints || []).slice(0, limit).map(glyphCodePointLabel).join(' · ');
  const more = (codePoints || []).length > limit
    ? ' · … 另有 ' + ((codePoints || []).length - limit) + ' 个'
    : '';
  return list + more;
}

function staticGlyphWarningCount() {
  return state.glyphCoverage.filter(item => item.status === 'partial' || item.status === 'unknown').length;
}

function renderSubtitleSummary() {
  const a = state.assInfo;
  const missing = state.fontMatches.filter(x => x.status === 'missing');
  const probable = state.fontMatches.filter(x => x.status === 'probable');
  const runtimeDiagnostics = state.previewFontDiagnostics.filter(Boolean);
  const runtimeFallbackFrames = runtimeDiagnostics.filter(item => item.hasFallback).length;
  const runtimeUnresolvedFrames = runtimeDiagnostics.filter(item => item.hasUnresolvedRisk).length;
  const runtimeRiskFrames = runtimeDiagnostics.filter(item => item.hasRisk).length;
  const mediaRows = state.media ? [
    ['视频', `${state.media.videoCodec} · ${state.media.width}×${state.media.height} · ${state.media.fps.toFixed(2)} fps`],
    ['时长', formatDuration(state.media.duration) + (state.media.durationSource === 'packet-scan' ? ' · packet 扫描恢复' : '')],
    ['源视频码率', formatBitrate(getSourceVideoBitrate())],
    ['压缩密度', formatBppf(getSourceBppf())],
    ['像素格式', `${state.media.pixelFormat || '未知'} · ${state.media.bitDepth}-bit`],
    ['色彩', [state.media.colorPrimaries, state.media.colorTransfer, state.media.colorSpace].filter(Boolean).join(' / ') || '未标记'],
    ['HDR/高位深', state.media.unsafeColorPipeline ? '检测到：当前版本禁止静默重编码' : '未检测到风险'],
    ['尺寸兼容', (state.media.width % 2 || state.media.height % 2)
      ? `检测到奇数尺寸；编码时将在字幕渲染后补齐到 ${state.media.width + (state.media.width % 2)}×${state.media.height + (state.media.height % 2)}`
      : '宽高均为偶数'],
    ['输入解码', state.inputDecodeOk ? '已通过 1 帧实测' : '未验证'],
    ['音频', state.media.audioCodec || '未检测到']
  ] : [];
  $('subtitleSummary').innerHTML = [
    ['ASS 对话', `${a.dialogueCount} 条`],
    ['ASS 请求字体', `${a.requestedFonts.length} 个`],
    ['实际字形使用', `${(a.fontUsage || []).reduce((sum, item) => sum + item.codePoints.length, 0)} 个去重码点`],
    ['可用字体 face', `${state.fontFaces.length} 个`],
    ['静态字形覆盖', state.glyphCoverage.length
      ? (staticGlyphWarningCount() ? `${staticGlyphWarningCount()} 组需确认` : '已覆盖')
      : '无可核对文本'],
    ['运行时字体', runtimeDiagnostics.length
      ? (runtimeUnresolvedFrames
          ? `${runtimeUnresolvedFrames} 个采样点仍有高风险`
          : runtimeFallbackFrames
            ? `${runtimeFallbackFrames} 个采样点已使用 fallback`
            : '已采样，未见缺字')
      : '等待真实预览'],
    ['常用字体库', `${state.savedFonts.length} 个文件`],
    ['预览采样点', state.previewTimes.length
      ? `${state.previewTimes.length} 个 · 其中 ${state.previewRiskTimes.length} 个风险导向`
      : (() => {
          const riskCandidates = findGlyphRiskPreviewTimes(a, state.glyphCoverage, 6).length;
          return `${a.previewTimes.length} 个常规候选${riskCandidates ? ' · ' + riskCandidates + ' 个字体风险候选' : ''}`;
        })()],
    ...mediaRows
  ].map(([k,v]) => `<div class="status-item"><span>${k}</span><span>${v}</span></div>`).join('');

  const details = state.fontMatches.map(m => {
    const forced = state.fontBindings[m.requested];
    const fallback = state.autoFontFallbacks[m.requested];
    if (forced) return `↪ ${escapeHtml(m.requested)} → 强制映射为 ${escapeHtml(forced)}`;
    if (m.status === 'matched') return `✓ ${escapeHtml(m.requested)} → ${escapeHtml(m.face.fullName || m.face.family || m.face.fileName)}`;
    if (m.status === 'probable') return `△ ${escapeHtml(m.requested)} → 可能匹配 ${escapeHtml(m.face.fullName || m.face.family || m.face.fileName)}`;
    if (fallback) return `↪ ${escapeHtml(m.requested)} → 未提供原字体，将回退到内置 ${escapeHtml(fallback)}`;
    return `✗ ${escapeHtml(m.requested)} → 未在用户提供字体中找到，且当前没有可用内置回退字体`;
  }).join('<br>');

  const glyphPartial = state.glyphCoverage.filter(item => item.status === 'partial');
  const glyphUnknown = state.glyphCoverage.filter(item => item.status === 'unknown');

  const glyphAuditRows = state.glyphCoverage.map(item => {
    const faceLabel = item.face
      ? (item.face.fullName || item.face.family || item.face.fileName)
      : item.resolved || item.requested || '未知字体';
    if (item.status === 'covered') {
      return '<div class="glyph-audit-row ok"><strong>✓ ' + escapeHtml(item.requested) + '</strong><span>' +
        escapeHtml(faceLabel) + ' · ' + item.codePointCount + ' 个实际码点均存在于 cmap</span></div>';
    }
    if (item.status === 'partial') {
      return '<div class="glyph-audit-row warn"><strong>△ ' + escapeHtml(item.requested) + '</strong><span>' +
        escapeHtml(faceLabel) + ' · 主字体缺少 ' + item.missingCodePoints.length + '/' + item.codePointCount +
        ' 个实际码点：' + formatMissingGlyphs(item.missingCodePoints) + '</span></div>';
    }
    if (item.status === 'unknown') {
      return '<div class="glyph-audit-row warn"><strong>? ' + escapeHtml(item.requested) + '</strong><span>' +
        escapeHtml(faceLabel) + ' · 字体文件可识别，但 cmap 格式无法静态核对</span></div>';
    }
    return '<div class="glyph-audit-row muted"><strong>· ' + escapeHtml(item.requested) + '</strong><span>' +
      escapeHtml(item.resolved || item.requested) + ' · 当前没有可读取 cmap 的实际字体文件；依赖 libass/fontconfig 运行时选择</span></div>';
  }).join('');

  const notices = [];
  if (runtimeDiagnostics.length) {
    if (runtimeUnresolvedFrames) {
      notices.push('<div class="error-box" style="margin-top:12px">运行时字体检查：' +
        runtimeUnresolvedFrames + '/' + runtimeDiagnostics.length +
        ' 个已生成预览的采样点仍存在未确认解决的缺字 / fallback 风险。请逐条查看字幕预览中的结构化 libass 诊断。</div>');
    } else if (runtimeFallbackFrames) {
      notices.push('<div class="warning-box" style="margin-top:12px">运行时字体检查：' +
        runtimeFallbackFrames + '/' + runtimeDiagnostics.length +
        ' 个已生成预览的采样点发生了字体 fallback；libass 已找到后备字体，但字形外观可能与原设计不同。</div>');
    } else {
      notices.push('<div class="ok-box" style="margin-top:12px">运行时字体检查：已生成的 ' +
        runtimeDiagnostics.length + ' 个预览采样点未记录 missing-glyph / fallback 风险。</div>');
    }
  }

  if (glyphAuditRows) {
    const auditClass = glyphPartial.length || glyphUnknown.length ? 'warning-box' : 'note';
    notices.push('<div class="' + auditClass + ' glyph-audit" style="margin-top:12px"><strong>字形覆盖（cmap）</strong>' +
      '<div class="glyph-audit-list">' + glyphAuditRows + '</div>' +
      '<small>这里检查的是 ASS 实际 Dialogue 使用到的 Unicode 码点，并跟踪 Style、\\fn、\\r 与绘图模式。主字体缺字并不等于最终画面一定出现方块：libass 仍可能选择 fallback；真实预览和 fontselect 日志是下一层验证。</small></div>');
  }

  if (state.media?.unsafeColorPipeline) {
    notices.push(`<div class="error-box" style="margin-top:12px">检测到 ${state.media.bitDepth}-bit / HDR 或高位深视频。当前版本尚未实现可靠的 10-bit/HDR 色彩保持，因此允许生成字幕预览，但会锁定编码测试与正式压制，避免静默转换成 8-bit/SDR。</div>`);
  }

  if (state.media && (state.media.width % 2 || state.media.height % 2)) {
    const outW = state.media.width + (state.media.width % 2);
    const outH = state.media.height + (state.media.height % 2);
    notices.push(`<div class="note" style="margin-top:12px">检测到奇数宽/高。x264 等 4:2:0 编码路径常会直接报 “width/height not divisible by 2”。正式压制会先按原始尺寸完成 libass 字幕渲染，再只在右侧/底部补最多 1 px，使输出成为 ${outW}×${outH}；不会缩放原画面或改变 ASS 坐标。</div>`);
  }

  if (missing.length || probable.length || glyphPartial.length || glyphUnknown.length || runtimeRiskFrames) {
    let bindingUi = '';
    if (state.fontFaces.length) {
      const risky = state.fontMatches
        .map((m, index) => ({ m, index }))
        .filter(({ m }) => m.status !== 'matched');
      bindingUi = `<div class="font-binding-box">
        <div class="font-binding-title">强制字体映射（可选）</div>
        <div class="note">未上传原字体时，libass 会使用内置 Noto Sans SC 回退；如果你确认上传的字体就是 ASS 想要的字体，可以在这里覆盖回退并强制映射到该字体真实的内部 Family Name。原始 ASS 文件不会修改。</div>
        ${risky.map(({ m, index }) => {
          const current = state.fontBindings[m.requested] || '';
          const opts = state.fontFaces.map((face, faceIndex) => {
            const target = getFontTargetName(face);
            const label = target
              ? `${face.fileName} → 内部名：${target}`
              : `${face.fileName} → 未解析到内部字体名`;
            const selected = current && current === target ? ' selected' : '';
            return `<option value="${faceIndex}"${selected}${target ? '' : ' disabled'}>${escapeHtml(label)}</option>`;
          }).join('');
          return `<label class="font-binding-row">
            <span>${escapeHtml(m.requested)}</span>
            <select class="font-binding-select" data-match-index="${index}">
              <option value="">不强制</option>
              ${opts}
            </select>
          </label>`;
        }).join('')}
      </div>`;
    }
    notices.push(`<div class="warning-box" style="margin-top:12px">${details || '检测到字体风险。'}<br><br>注意：这只是静态字体名分析；最终是否回退以真实 libass 预览和日志为准。${bindingUi}</div>`);
    $('warningAccept').classList.remove('hidden');
  } else {
    notices.push(`<div class="note" style="margin-top:12px">${details || 'ASS 未声明特定字体。'}<br>仍建议生成真实预览，确认 libass 实际渲染结果。</div>`);
    $('warningAccept').classList.add('hidden');
    state.acceptedWarnings = true;
  }
  $('fontWarnings').innerHTML = notices.join('');
  bindFontOverrideControls();

  const fontRisk = missing.length + probable.length + glyphPartial.length + glyphUnknown.length + runtimeRiskFrames;
  const mediaRisk = state.media?.unsafeColorPipeline ? 1 : 0;
  const decodeRisk = state.inputDecodeOk ? 0 : 1;
  const riskCount = fontRisk + mediaRisk + decodeRisk;
  const preflightDetailsEl = $('preflightDetails');
  const status = $('preflightStatus');

  if (riskCount > 0) {
    preflightDetailsEl.open = true;
    status.textContent = `${riskCount} 项需注意 · 已自动展开`;
    status.className = 'preflight-status warn';
  } else {
    preflightDetailsEl.open = false;
    const codec = state.media?.videoCodec?.toUpperCase?.() || '视频';
    const resolution = state.media?.width && state.media?.height
      ? `${state.media.width}×${state.media.height}`
      : '';
    status.textContent = `检查通过 · ${codec}${resolution ? ' · ' + resolution : ''}`;
    status.className = 'preflight-status ok';
  }
}

function getFontTargetName(face) {
  if (!face) return '';
  return String(
    face.family ||
    face.fullName ||
    face.postScriptName ||
    (face.aliases || []).find(Boolean) ||
    ''
  ).trim();
}

function bindFontOverrideControls() {
  document.querySelectorAll('.font-binding-select').forEach(select => {
    select.addEventListener('change', () => runWebTask(async () => {
      const matchIndex = Number(select.dataset.matchIndex);
      const match = state.fontMatches[matchIndex];
      if (!match) return;

      if (select.value === '') {
        delete state.fontBindings[match.requested];
      } else {
        const face = state.fontFaces[Number(select.value)];
        const target = getFontTargetName(face);
        if (!target) {
          log(`无法强制映射 ${match.requested}：所选字体没有解析到可用的内部 family/full name。`);
          return;
        }
        state.fontBindings[match.requested] = target;
      }

      state.activeAssText = rewriteAssFonts(state.assText, state.fontBindings);
      if (state.engine.ready) {
        try {
          await state.engine.setFontMappings({ ...state.autoFontFallbacks, ...state.fontBindings });
          await state.engine.setAssText(state.activeAssText);
        } catch (e) {
          log(`应用字体强制映射失败：${e.message}`);
        }
      }
      log(`字体强制映射已生效：${match.requested} → ${state.fontBindings[match.requested] || '取消强制映射'}`);

      state.previewUrls.filter(Boolean).forEach(URL.revokeObjectURL);
      state.previewBaseUrls.filter(Boolean).forEach(URL.revokeObjectURL);
      state.previewUrls = [];
      state.previewBaseUrls = [];
      state.previewFontEvents = [];
      state.previewFontDiagnostics = [];
      state.previewVisualChange = [];
      state.previewTimes = [];
      state.previewRiskTimes = [];
      clearSelectedTestCache();
      state.acceptedWarnings = false;
      $('acceptWarnings').checked = false;
      $('preview').innerHTML = '<div class="preview-placeholder">字体映射已变化，请重新生成真实字幕预览。</div>';
      await refreshGlyphCoverage();
      renderSubtitleSummary();
      refreshBenchmarkEnabled(false);
    }));
  });
}


function buildPreviewPlan(limit = 6) {
  const max = Math.max(1, Number(limit) || 6);
  const riskTimes = findGlyphRiskPreviewTimes(state.assInfo, state.glyphCoverage, max);
  return mergePreviewTimes(riskTimes, state.assInfo?.previewTimes || [], max);
}

function isRiskPreviewTime(time) {
  return state.previewRiskTimes.some(value => Math.abs(value - time) < 0.005);
}

async function renderPreviews() {
  try {
    $('previewBtn').disabled = true;
    const previewPlan = buildPreviewPlan(6);
    state.previewTimes = previewPlan.times;
    state.previewRiskTimes = previewPlan.riskTimes;
    renderPreviewSampleRail(0);
    state.previewUrls.filter(Boolean).forEach(URL.revokeObjectURL);
    state.previewUrls = new Array(state.previewTimes.length).fill(null);
    state.previewBaseUrls = new Array(state.previewTimes.length).fill(null);
    state.previewFontEvents = new Array(state.previewTimes.length).fill(null);
    state.previewFontDiagnostics = new Array(state.previewTimes.length).fill(null);
    state.previewVisualChange = new Array(state.previewTimes.length).fill(null);
    if (state.previewRiskTimes.length) {
      log('风险导向预览：已将 ' + state.previewRiskTimes.length + ' 个静态缺字/字体风险采样点优先加入预览计划，并自动逐个执行运行时验证。');
    }

    await loadPreviewAt(0);

    // Risk-directed samples are generated automatically so a user does not need
    // to discover a known missing glyph by manually paging through previews.
    // Ordinary context samples remain lazy.
    for (let index = 1; index < state.previewTimes.length; index++) {
      if (!isRiskPreviewTime(state.previewTimes[index])) continue;
      await loadPreviewAt(index);
    }

    if (state.previewTimes.length > 1 && state.previewRiskTimes.length > 1) {
      await loadPreviewAt(0);
    }
    refreshBenchmarkEnabled(true);
  } catch (e) {
    log(`预览失败：${e.message}`);
    $('preview').innerHTML = `<div class="error-box">预览失败：${escapeHtml(e.message)}</div>`;
  } finally {
    $('previewBtn').disabled = !(state.engine.ready || state.nativeBackend?.available);
  }
}


function renderPreviewSampleRail(activeIndex = 0) {
  const rail = $('previewSampleRail');
  if (!rail) return;
  const times = state.previewTimes || [];
  if (!times.length) {
    rail.innerHTML = '<div class="preview-sample-empty">生成后显示采样点</div>';
    return;
  }

  rail.innerHTML = times.map((time, index) => {
    const current = index === activeIndex;
    const ready = !!state.previewUrls[index];
    const risk = isRiskPreviewTime(time);
    const label = current ? '当前' : ready ? '已生成' : '待生成';
    return '<button type="button" class="preview-sample-card ' +
      (current ? 'is-current ' : '') +
      (risk ? 'is-risk ' : '') +
      (ready ? 'is-ready' : '') +
      '" data-preview-index="' + index + '" aria-current="' + (current ? 'true' : 'false') + '">' +
      '<span class="preview-sample-index">' + String(index + 1).padStart(2, '0') + '</span>' +
      '<span class="preview-sample-copy"><strong>' + Number(time).toFixed(2) + 's</strong><small>' +
      (risk ? '字体风险采样' : '字幕采样点') + '</small></span>' +
      '<span class="preview-sample-state">' + label + '</span>' +
      '</button>';
  }).join('');

  rail.querySelectorAll('[data-preview-index]').forEach(button => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.previewIndex);
      loadPreviewAt(index).catch(error => log('预览切换失败：' + error.message));
    });
  });
}

async function loadPreviewAt(index) {
  const times = state.previewTimes;
  if (!times.length) return;
  const safeIndex = Math.max(0, Math.min(Number(index) || 0, times.length - 1));
  const container = $('preview');

  if (!state.previewUrls[safeIndex]) {
    container.innerHTML = '<div class="preview-placeholder">正在生成…</div>';
    log(`生成预览 ${safeIndex + 1}/${times.length} @ ${times[safeIndex].toFixed(2)}s`);
    let previewResult;
    if (state.nativeBackend?.available) {
      const previewCenter = 0.5;
      const shiftBy = Math.max(0, times[safeIndex] - previewCenter);
      const previewAss = shiftAssForPreview(state.activeAssText || state.assText, shiftBy);
      previewResult = await requestNativePreview(
        times[safeIndex],
        previewAss
      );
    } else {
      const previewCenter = 0.5;
      const shiftBy = Math.max(0, times[safeIndex] - previewCenter);
      const previewAss = shiftAssForPreview(state.activeAssText || state.assText, shiftBy);
      previewResult = await state.engine.renderPreview(times[safeIndex], safeIndex, previewAss);
    }
    state.previewUrls[safeIndex] = previewResult.url;
    if (!state.inputDecodeOk) {
      state.inputDecodeOk = true;
      log('首张真实预览已成功解码输入视频；输入解码验证通过。');
    }
    state.previewBaseUrls[safeIndex] = previewResult.baseUrl || null;
    state.previewFontEvents[safeIndex] = previewResult.fontEvents || [];
    state.previewFontDiagnostics[safeIndex] = parseLibassFontDiagnostics(state.previewFontEvents[safeIndex]);
    state.previewVisualChange[safeIndex] = previewResult.visualChange;
    if (state.previewFontEvents[safeIndex].length) {
      log(`libass 字体选择 @ ${times[safeIndex].toFixed(2)}s:\n${state.previewFontEvents[safeIndex].join('\n')}`);
    }
    if (state.previewFontDiagnostics[safeIndex]?.hasRisk) {
      state.acceptedWarnings = false;
      $('acceptWarnings').checked = false;
      $('warningAccept').classList.remove('hidden');
    }
    renderSubtitleSummary();
    refreshBenchmarkEnabled(false);
  }

  renderPreviewSampleRail(safeIndex);

  const fontEvents = state.previewFontEvents[safeIndex] || [];
  const fontDiagnostics =
    state.previewFontDiagnostics[safeIndex] ||
    parseLibassFontDiagnostics(fontEvents);
  const fontInfo = renderRuntimeFontDiagnostics(fontDiagnostics, fontEvents);

  const riskBadge = isRiskPreviewTime(times[safeIndex])
    ? '<span class="preview-risk-badge">字体风险采样</span>'
    : '';
  const activeEvents = getActiveDialogue(times[safeIndex]);
  const dialogueInfo = activeEvents.length
    ? `<div class="note" style="padding:0 12px 10px">ASS 在此时刻有 ${activeEvents.length} 条活跃对白：${escapeHtml(activeEvents.slice(0,2).map(e => stripAssTags(e.text || '')).join(' / ').slice(0,180))}</div>`
    : '<div class="error-box" style="margin:0 12px 10px">解析器判断这个时间点没有任何活跃 Dialogue；这个采样点本身有问题。</div>';

  const changed = state.previewVisualChange[safeIndex];
  const verifyInfo = changed === true
    ? '<div class="ok-box" style="margin:0 12px 10px">已检测到字幕渲染前后存在像素变化。</div>'
    : changed === false
      ? `<div class="error-box" style="margin:0 12px 10px">没有检测到任何字幕叠加造成的像素变化。当前预览不能视为成功，下面可展开查看同一时刻的无字幕底图。</div>
         <details class="note" style="padding:0 12px 10px"><summary>查看无字幕底图</summary><img src="${state.previewBaseUrls[safeIndex] || ''}" alt="无字幕底图" style="width:100%;margin-top:8px;border-radius:8px"></details>`
      : '<div class="warning-box" style="margin:0 12px 10px">浏览器无法自动完成像素差校验，请人工确认预览中确实出现了字幕。</div>';

  container.innerHTML = `<div style="width:100%"><img id="previewImage" class="preview-image" src="${state.previewUrls[safeIndex]}" alt="字幕预览"><div class="button-row preview-nav"><button id="prevP" type="button" ${safeIndex === 0 ? 'disabled' : ''}>上一条</button><span class="note preview-position">${safeIndex+1}/${times.length} · ${times[safeIndex].toFixed(2)}s ${riskBadge}</span><button id="nextP" type="button" ${safeIndex === times.length - 1 ? 'disabled' : ''}>下一条</button></div>${verifyInfo}${dialogueInfo}${fontInfo}</div>`;
  const navigatePreview = targetIndex => {
    if (targetIndex < 0 || targetIndex >= times.length) return;
    loadPreviewAt(targetIndex).catch(error => {
      log(`预览翻页失败：${error.message}`);
      loadPreviewAt(safeIndex).catch(() => {});
    });
  };
  $('prevP').onclick = () => navigatePreview(safeIndex - 1);
  $('nextP').onclick = () => navigatePreview(safeIndex + 1);
}


function renderRuntimeFontDiagnostics(diagnostics, rawEvents = []) {
  if (!rawEvents.length) {
    return '<div class="note" style="text-align:center;padding:0 10px 10px">此帧未捕获到 fontselect / missing-glyph 记录。</div>';
  }

  const rows = [];

  for (const glyph of diagnostics.missingGlyphs || []) {
    const cp = codePointDisplay(glyph.codePoint);
    const char = escapeHtml(cp.char);
    const requested = escapeHtml(glyph.requested || '未知请求字体');
    if (glyph.status === 'fallback-selected') {
      const fallback = escapeHtml(glyph.fallbackSelected || glyph.fallbackPath || '后备字体');
      rows.push(
        '<div class="runtime-font-row resolved"><strong>' + char + ' <span class="glyph-code">' + cp.hex + '</span></strong>' +
        '<span>主字体 ' + requested + ' 缺字 → libass 已选择 ' + fallback + '</span><b>已回退</b></div>'
      );
    } else {
      rows.push(
        '<div class="runtime-font-row danger"><strong>' + char + ' <span class="glyph-code">' + cp.hex + '</span></strong>' +
        '<span>主字体 ' + requested + ' 缺字，当前采样日志没有确认可用 fallback</span><b>高风险</b></div>'
      );
    }
  }

  for (const failure of diagnostics.failures || []) {
    rows.push(
      '<div class="runtime-font-row danger"><strong>fallback</strong><span>' +
      escapeHtml(failure.raw) + '</span><b>失败</b></div>'
    );
  }

  if (!rows.length && diagnostics.normalSelections?.length) {
    const names = [...new Set(
      diagnostics.normalSelections
        .map(item => item.selected || item.path || item.requested)
        .filter(Boolean)
    )];
    rows.push(
      '<div class="runtime-font-row clean"><strong>✓</strong><span>本帧捕获到 ' +
      diagnostics.normalSelections.length + ' 条字体选择记录' +
      (names.length ? '：' + names.slice(0, 4).map(escapeHtml).join(' / ') : '') +
      '</span><b>未见缺字</b></div>'
    );
  }

  const summaryClass = diagnostics.hasUnresolvedRisk
    ? 'error-box'
    : diagnostics.hasFallback
      ? 'warning-box'
      : 'note';
  const summaryText = diagnostics.hasUnresolvedRisk
    ? '运行时检测到尚未确认解决的缺字 / fallback 风险。'
    : diagnostics.hasFallback
      ? '运行时检测到主字体缺字，但 libass 已在此采样帧选择后备字体。请确认后备字体外观可以接受。'
      : '运行时 fontselect 日志未记录缺字。';

  return '<div class="runtime-font-diagnostics">' +
    '<div class="' + summaryClass + ' runtime-font-summary">' + summaryText + '</div>' +
    (rows.length ? '<div class="runtime-font-list">' + rows.join('') + '</div>' : '') +
    '<details class="note runtime-font-raw"><summary>查看 libass 原始字体日志</summary>' +
    '<pre class="log">' + escapeHtml(rawEvents.join('\n')) + '</pre></details></div>';
}

function getActiveDialogue(timeSeconds) {
  return (state.assInfo?.events || []).filter(e =>
    e.kind?.toLowerCase() === 'dialogue' &&
    Number.isFinite(e.startSeconds) &&
    Number.isFinite(e.endSeconds) &&
    e.startSeconds <= timeSeconds &&
    timeSeconds < e.endSeconds
  );
}

function stripAssTags(text = '') {
  return String(text)
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N|\\n/g, ' ')
    .replace(/\\h/g, ' ')
    .trim();
}

function nativeBackendReady() {
  const t = state.nativeSelfTest;
  if (!state.nativeBackend?.available || !t) return false;

  const codecReady = state.selectedCodec
    ? state.softwareEncoders[state.selectedCodec] === true
    : (t.x264EncodeSmoke || t.x265EncodeSmoke || t.svtAv1EncodeSmoke);

  const inputDecoderReady =
    normalizeCodec(state.media?.videoCodec) !== 'av1' || t.dav1d === true;

  return !!(
    codecReady &&
    inputDecoderReady &&
    t.libassVisualSmoke &&
    (state.nativeBackend?.backend === 'windows-native' || t.bundledFallbackReady) &&
    t.ffprobeSmoke
  );
}

function workflowReadiness() {
  const analyzed = state.analyzedVideo === state.video &&
    state.analyzedAss === state.ass &&
    state.analyzedFontKey === currentFontKey() &&
    !!state.analyzedVideo && !!state.analyzedAss;
  const previewDone = state.previewUrls.some(Boolean);
  const runtimeFontWarnings = state.previewFontDiagnostics.some(
    item => item?.hasRisk === true
  );
  const warnings =
    state.fontMatches.some(x => x.status !== 'matched') ||
    state.glyphCoverage.some(x => x.status === 'partial' || x.status === 'unknown') ||
    runtimeFontWarnings;
  const unsafeColor = !!state.media?.unsafeColorPipeline;
  const rendered = state.previewVisualChange.some(v => v === true);
  const knownChecks = state.previewVisualChange.filter(v => v !== null);
  const previewOk = rendered || (previewDone && knownChecks.length === 0);
  const backendReady = state.nativeBackend?.available
    ? nativeBackendReady()
    : state.engine.ready;
  return {
    previewDone, warnings, unsafeColor, previewOk, backendReady,
    ready: !!(analyzed && backendReady && state.inputDecodeOk && previewDone && previewOk && !unsafeColor && (!warnings || state.acceptedWarnings))
  };
}

function refreshBenchmarkEnabled() {
  const status = workflowReadiness();
  const busy = state.operationBusy;
  const warningsAccepted = !status.warnings || state.acceptedWarnings;
  const webDiagnosticReady = !!(
    state.engine.ready &&
    state.inputDecodeOk &&
    !status.unsafeColor &&
    warningsAccepted
  );
  const nativeDiagnosticReady = !!(
    state.nativeBackend?.available &&
    nativeBackendReady() &&
    state.inputDecodeOk &&
    !status.unsafeColor &&
    warningsAccepted &&
    !state.nativeJobId &&
    !state.qualityCalibrationBusy
  );
  const diagnosticReady = state.nativeBackend?.available
    ? nativeDiagnosticReady
    : webDiagnosticReady;

  $('benchmarkBtn').disabled = busy || !diagnosticReady;
  $('testSelectedBtn').disabled = busy || !diagnosticReady || !state.selectedCodec;

  const plan = state.selectedCodec ? buildEncodePlan(state.selectedCodec) : null;
  const hasRecoveredOutput = !!state.nativeCompletedJob;
  $('encodeBtn').disabled = busy ? true : hasRecoveredOutput
    ? false
    : (!status.ready || !state.selectedCodec || !plan);

  if (state.nativeCompletedJob) {
    $('encodeBtn').textContent = '保存成品';
    return;
  }

  $('encodeBtn').textContent = '开始硬字幕压制';
  if (state.selectedCodec && status.backendReady && !status.previewOk) {
    $('liveEta').textContent = state.nativeBackend?.available
      ? '参数已选择；请先生成并验证 Native libass 字幕预览，随后才能正式全片压制。'
      : '参数已选择；字幕预览尚未验证。可以先生成所选方案测试片段，正式全片压制暂时锁定。';
  }
  refreshGuidedContainerDecision();
}

function getSourceVideoBitrate() {
  const media = state.media;
  if (!media?.duration || !state.video) return 0;
  if (media.videoBitRate > 0) return media.videoBitRate;
  const containerAverage = state.video.size * 8 / media.duration;
  if (media.audioBitRate > 0 && containerAverage > media.audioBitRate) return containerAverage - media.audioBitRate;
  if (media.bitRate > 0 && media.audioBitRate > 0 && media.bitRate > media.audioBitRate) return media.bitRate - media.audioBitRate;
  return containerAverage;
}

function getSourceBppf() {
  const m = state.media;
  const bitrate = getSourceVideoBitrate();
  if (!m?.width || !m?.height || !m?.fps || !bitrate) return 0;
  return bitrate / (m.width * m.height * m.fps);
}

function normalizeCodec(codec = '') {
  const c = String(codec).toLowerCase();
  if (/hevc|h265|265/.test(c)) return 'h265';
  if (/av1/.test(c)) return 'av1';
  return 'h264';
}

function codecEfficiency(codec) {
  return codec === 'av1' ? 1.50 : codec === 'h265' ? 1.30 : 1.00;
}

function profileFor(codec, goal) {
  const profiles = {
    speed: {
      h264: { crf: 21, preset: 'veryfast' },
      h265: { crf: 24, preset: 'faster' },
      av1: { crf: 34, preset: '12' }
    },
    balanced: {
      h264: { crf: 19, preset: 'medium' },
      h265: { crf: 22, preset: 'medium' },
      av1: { crf: 30, preset: '8' }
    },
    quality: {
      h264: { crf: 17, preset: 'slow' },
      h265: { crf: 20, preset: 'slow' },
      av1: { crf: 26, preset: '7' }
    }
  };
  return profiles[goal]?.[codec] || profiles.balanced[codec];
}

function codecDescription(codec) {
  if (codec === 'h264') return '兼容性高 · 软件编码较快 · 同等质量通常需要更多码率';
  if (codec === 'h265') return '兼容性与压缩效率较均衡 · 适合多数现代设备';
  return '压缩效率潜力高 · 软件编码计算量较大 · 更适合对体积敏感的场景';
}

function chooseDefaultCodec(goal) {
  const available = ['h264','h265','av1'].filter(k => state.softwareEncoders[k] !== false);
  if (!available.length) return null;
  if (goal === 'speed' && available.includes('h264')) return 'h264';
  const source = normalizeCodec(state.media?.videoCodec);
  if (available.includes(source)) return source;
  if (available.includes('h265')) return 'h265';
  return available[0];
}

function invalidateQualityCalibration() {
  state.qualityCalibration = {};
  state.rateDistortionModels = {};
  state.sizeEnvelopeEnabled = false;
  state.qualityExplorationPoints = {};
  state.sizeBudgetTargetBytes = null;
  state.sizeFrontierPointerId = null;
  state.qualityCalibrationTarget = null;
  if ($('sizeBudgetBytes')) $('sizeBudgetBytes').value = '';
  if ($('qualityCalibrationResult')) $('qualityCalibrationResult').textContent = '';
}


function renderQualityExploration() {
  const readout = $('qualityExplorationReadout');
  if (!readout) return;
  const codec = state.selectedCodec || chooseDefaultCodec('targetQuality');
  const trials = state.qualityExplorationPoints?.[codec] || [];
  if (!trials.length) {
    readout.textContent = '当前编码器尚无实测参数；校准期间会逐点显示进度。';
    return;
  }
  const target = Number(state.qualityCalibrationTarget || $('qualityTarget')?.value || .985);
  const latest = trials.at(-1);
  const passing = trials.filter(point => Number(point.ssim) >= target).length;
  readout.textContent = codec.toUpperCase() + ' · 已试压 ' + trials.length +
    ' 个 CQ/CRF 参数，' + passing + ' 个达到最低样本 SSIM ' + target.toFixed(3) +
    '；最近 CRF ' + latest.qualitySetting + '，最低样本 SSIM ' +
    Number(latest.ssim).toFixed(5) + '。结果仅代表短片样本。';
}

function updateQualityCalibrationControls() {
  const goal = $('encodeGoal')?.value || 'balanced';
  const qualityActive = goal === 'targetQuality' || goal === 'efficiency';
  const sizeActive = goal === 'sizeBudget';
  $('qualityCalibrationControls')?.classList.toggle('hidden', !qualityActive);

  const nativeOnly = !state.nativeBackend?.available;
  const inputNotReady = !state.inputDecodeOk || !state.assInfo;
  const ssimUnavailable = state.nativeBackend?.available && state.nativeSelfTest?.ssimSmoke !== true;
  const calibrationBlocked =
    state.operationBusy || nativeOnly || inputNotReady || ssimUnavailable ||
    state.qualityCalibrationBusy || !!state.nativeJobId;
  const controlsLocked = state.operationBusy || state.qualityCalibrationBusy;

  if ($('calibrateQualityBtn')) {
    $('calibrateQualityBtn').disabled = !qualityActive || calibrationBlocked;
  }
  if ($('calibrateSizeFrontierBtn')) {
    $('calibrateSizeFrontierBtn').disabled = !sizeActive || calibrationBlocked;
  }
  $('qualityTarget').disabled = controlsLocked;
  $('encodeGoal').disabled = controlsLocked;
  if ($('qualityTargetRange')) $('qualityTargetRange').disabled = controlsLocked;
  if ($('qualityAutoCodec')) $('qualityAutoCodec').disabled = controlsLocked;
  document.querySelectorAll('.plan-mode-tab').forEach(button => { button.disabled = controlsLocked; });

  if (qualityActive) {
    if (!state.qualityCalibrationBusy) {
      if (goal === 'efficiency') {
        $('calibrateQualityBtn').textContent = '比较三编码器等质量效率';
      } else {
        const codec = state.selectedCodec || chooseDefaultCodec(goal);
        const label = codec === 'h264' ? 'H.264' : codec === 'h265' ? 'H.265' : codec === 'av1' ? 'AV1' : '所选编码器';
        $('calibrateQualityBtn').textContent = '校准 ' + label + ' 目标质量';
      }
    } else {
      $('calibrateQualityBtn').textContent = '正在实测校准…';
    }

    if (nativeOnly) {
      $('qualityCalibrationResult').textContent =
        '当前版本的目标质量校准需要 Native 后端；网页模式仍使用固定 CRF / 体积预算方案。';
    } else if (ssimUnavailable) {
      $('qualityCalibrationResult').textContent =
        '当前 Native 核心没有通过 SSIM 能力检查，目标质量暂时不可用。';
    }
  }

  renderSizeFrontier();
  renderQualityExploration();
}
function renderPlanOptions() {
  if (!state.media) {
    syncPlanModeUI();
    return;
  }
  syncPlanModeUI();
  updateQualityCalibrationControls();
  const goal = $('encodeGoal').value;
  if (!state.selectedCodec || state.softwareEncoders[state.selectedCodec] === false) state.selectedCodec = chooseDefaultCodec(goal);
  const sourceRate = getSourceVideoBitrate();
  const bppf = getSourceBppf();
  $('sourceAnchor').innerHTML = '<strong>源片</strong><br>' + escapeHtml((state.media.videoCodec || 'unknown').toUpperCase()) + ' · ' + formatBitrate(sourceRate) + ' · ' + formatBppf(bppf);
  const labels = state.nativeBackend?.backend === 'windows-native'
    ? { h264: 'H.264 / Windows Native', h265: 'H.265 / Windows Native', av1: 'AV1 / Windows Native' }
    : { h264: 'H.264 / x264', h265: 'H.265 / x265', av1: 'AV1 / SVT-AV1' };
  $('codecPlanGrid').innerHTML = ['h264','h265','av1'].map(codec => {
    const available = state.softwareEncoders[codec] !== false;
    const plan = available ? buildEncodePlan(codec) : null;
    const selected = state.selectedCodec === codec;
    let param = '不可用';
    const calibration = state.qualityCalibration[codec];
    const target = Number($('qualityTarget')?.value || 0.985);
    const calibrationValid =
      calibration &&
      state.qualityCalibrationTarget === target &&
      calibration.meetsTarget;

    if (plan?.mode === 'crf' && plan.calibration) {
      param =
        '实测 CRF ' + plan.crf + ' · ' + plan.preset +
        ' · SSIM ' + Number(plan.calibration.ssim).toFixed(5) +
        ' · ' + formatBitrate(plan.calibration.sampleBitrate);
    } else if (plan?.mode === 'crf') {
      param = 'CRF ' + plan.crf + ' · preset ' + plan.preset;
    } else if (plan?.mode === 'budget-rate') {
      param = plan.frontierPrediction
        ? '实测曲线 · ' + formatBytes(plan.sizeCeiling) +
          ' · ' + formatBitrate(plan.targetVideoBitrate) +
          ' · SSIM≈' + Number(plan.frontierPrediction.quality).toFixed(5)
        : '单遍目标平均码率 ' + formatBitrate(plan.targetVideoBitrate);
    } else if (
      available &&
      (goal === 'targetQuality' || goal === 'efficiency') &&
      !calibrationValid
    ) {
      param = '待实测校准 · 目标 SSIM ' + target.toFixed(3);
    }
    return '<div class="codec-card plan-codec codec-' + codec + ' ' + (selected ? 'selected' : '') + ' ' + (available ? '' : 'disabled-card') + '" data-codec="' + codec + '" role="button" tabindex="' + (available ? '0' : '-1') + '" aria-pressed="' + (selected ? 'true' : 'false') + '" aria-disabled="' + (!available ? 'true' : 'false') + '">' +
      '<h3>' + labels[codec] + '</h3>' +
      '<div class="note codec-description">' + codecDescription(codec) + '</div>' +
      '<div class="plan-param">' + param + '</div>' +
      '<button class="plan-choose" type="button" tabindex="-1" aria-hidden="true" ' + (available ? '' : 'disabled') + '>' + (selected ? '已选择' : '可选择') + '</button>' +
      '</div>';
  }).join('');
  document.querySelectorAll('.codec-card[data-codec]').forEach(card => {
    const activate = () => {
      if (card.getAttribute('aria-disabled') === 'true') return;
      selectCodec(card.dataset.codec);
    };
    card.onclick = activate;
    card.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate();
    };
  });
  updateChosenSummary();
  restoreSelectedTestForCurrentPlan();
  refreshBenchmarkEnabled();
}

function updateChosenSummary() {
  if (!state.selectedCodec) {
    $('chosenSummary').textContent = '请选择一个编码器。';
    return;
  }

  const goal = $('encodeGoal')?.value || 'balanced';
  const plan = buildEncodePlan(state.selectedCodec);

  if (!plan) {
    if (goal === 'targetQuality' || goal === 'efficiency') {
      $('chosenSummary').textContent =
        '该模式需要先运行“实测校准目标质量”，校准完成后才会生成正式 CRF 参数。';
    } else {
      $('chosenSummary').textContent = '当前方案无法生成安全参数。';
    }
    return;
  }

  const history = localPredictionForPlan(plan);
  const historyHtml = history
    ? ' <span class="note">本机历史 ' + history.samples + ' 次 · 中位速度 ' +
      history.speed.toFixed(2) + '× realtime · 预计编码阶段约 ' +
      formatDuration(history.etaSeconds) + '。</span>'
    : '';

  if (plan.mode === 'crf') {
    if (plan.calibration) {
      $('chosenSummary').innerHTML =
        '<strong>' + state.selectedCodec.toUpperCase() + '</strong>' +
        ' · 实测 CRF ' + plan.crf + ' · preset ' + plan.preset +
        ' · 校准 SSIM ' + Number(plan.calibration.ssim).toFixed(5) +
        ' · 样本平均视频码率 ' + formatBitrate(plan.calibration.sampleBitrate) +
        ' · 样本速度 ' + Number(plan.calibration.encodeSpeed).toFixed(2) + '× realtime。' +
        '正式整片仍会因场景变化而偏离短样本结果。' + historyHtml;
    } else {
      $('chosenSummary').innerHTML =
        '<strong>' + state.selectedCodec.toUpperCase() + '</strong>' +
        ' · CRF ' + plan.crf + ' · preset ' + plan.preset +
        '。质量模式不提前给出伪精确的成品体积；正式编码开始后会用实时速度修正 ETA。' + historyHtml;
    }
  } else {
    const frontierHtml = plan.frontierPrediction
      ? ' · 实测模型 SSIM≈' + Number(plan.frontierPrediction.quality).toFixed(5) +
        '（样本范围 ' + Number(plan.frontierPrediction.lowerQuality).toFixed(5) +
        '–' + Number(plan.frontierPrediction.upperQuality).toFixed(5) + '）'
      : '';
    $('chosenSummary').innerHTML =
      '<strong>' + state.selectedCodec.toUpperCase() + '</strong>' +
      ' · 单遍目标平均码率 ' + formatBitrate(plan.targetVideoBitrate) +
      frontierHtml +
      '。规划体积约 ' + formatBytes(plan.plannedBytes) +
      '，预算边界 ' + formatBytes(plan.sizeCeiling) +
      '。这是参数规划值，不承诺最终字节数严格命中。' + historyHtml;
  }
}

function selectedTestCacheKey(codec, plan) {
  if (!codec || !plan) return '';
  const backend = state.nativeBackend?.backend || 'web';
  return [
    backend,
    codec,
    plan.mode || '',
    Number.isFinite(Number(plan.crf)) ? Number(plan.crf) : '',
    String(plan.preset ?? ''),
    Number(plan.targetVideoBitrate || 0)
  ].join('|');
}

function restoreSelectedTestForCurrentPlan() {
  const plan = state.selectedCodec ? buildEncodePlan(state.selectedCodec) : null;
  const key = selectedTestCacheKey(state.selectedCodec, plan);
  state.selectedTest = key ? (state.selectedTests?.[key] || null) : null;
  renderSelectedTestResult();
}

function renderSelectedTestResult() {
  const box = $('selectedTestResult');
  if (!box) return;
  const r = state.selectedTest;

  if (!r) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  box.classList.remove('hidden');
  const codec = r._testCodec || state.selectedCodec || '';
  const sampleBitrate = Number(r._sampleBitrate || 0);

  if (r._native) {
    const exportAvailable = !!r.sampleId && r.sampleId === state.latestNativeSampleId;
    box.innerHTML =
      '<div class="test-result"><strong>Native 测试片段完成</strong>' +
      '<span>实际样本速度：' + Number(r.encodeSpeed || 0).toFixed(2) + '× realtime</span>' +
      '<span>样本视频码率：' + formatBitrate(sampleBitrate) + (codec === 'av1' ? '（短样本估计）' : '') + '</span>' +
      '<span>SSIM：' + (Number.isFinite(Number(r.ssim)) ? Number(r.ssim).toFixed(5) : '未取得') + '</span>' +
      '<span>样本大小：' + formatBytes(Number(r.sampleBytes || 0)) + '</span>' +
      (exportAvailable
        ? '<button id="saveNativeTestSampleBtn" type="button">保存测试片段查看实际画质</button>'
        : '<small>该方案的实测参数已保留；测试片段文件已被后续测试替换，如需再次查看视频才需要重新生成片段。</small>') +
      '<small>切换压制方案不会清空这组实测参数；只有输入、字幕字体映射或实际参数变化时才会失效。</small></div>';

    const saveButton = $('saveNativeTestSampleBtn');
    if (saveButton && exportAvailable) {
      saveButton.onclick = () => {
        globalThis.NativeHardsub?.requestNativeSampleExport?.(
          r.sampleId,
          'hardsub_test_' + codec + '.mkv'
        );
      };
    }
    return;
  }

  box.innerHTML =
    '<div class="test-result"><strong>测试片段完成</strong><span>实际样本速度：' +
    Number(r.encodeSpeed || 0).toFixed(2) + '× realtime</span><span>样本视频码率：' +
    formatBitrate(sampleBitrate) + (codec === 'av1' ? '（短样本估计）' : '') +
    '</span>' +
    (r.sampleUrl
      ? '<a class="button-link" href="' + r.sampleUrl + '" download="hardsub_test_' + codec + '.mkv">下载测试片段查看实际画质</a>'
      : '') +
    '<small>该方案的实测参数会在切换压制方案后保留；这些短样本数字仍不外推整片。</small></div>';
}

function selectCodec(codec) {
  if (state.operationBusy) return;
  state.selectedCodec = codec;
  renderPlanOptions();
  refreshGuidedContainerDecision();
}

function qualityCrfRange(codec) {
  if (codec === 'h264') return { min: 12, max: 30 };
  if (codec === 'h265') return { min: 14, max: 32 };
  return { min: 18, max: 42 };
}

function qualitySampleStarts(duration) {
  if (state.nativeInputProbe?.seekable === false) return [0];

  const total = Number(state.media?.duration || 0);
  if (!(total > duration)) return [0];

  const previewTimes = state.assInfo?.previewTimes || [];
  const targets = [total * 0.35, total * 0.70];
  const starts = targets.map(target => {
    const anchor = previewTimes.length
      ? [...previewTimes].sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0]
      : target;
    return Math.max(0, Math.min(total - duration, anchor - duration * 0.35));
  });

  let distinct = [...new Set(starts.map(v => v.toFixed(3)))].map(Number);
  if (distinct.length < 2 && total >= duration * 3) {
    const fallback = Math.max(0, Math.min(total - duration, total * 0.70 - duration * 0.35));
    if (!distinct.some(v => Math.abs(v - fallback) < duration * 0.5)) {
      distinct.push(Number(fallback.toFixed(3)));
    }
  }
  return distinct.slice(0, 2);
}

async function evaluateQualityCandidate(codec, crf, preset, targetSsim = null) {
  // Two seconds reduces keyframe/GOP overhead bias compared with the tiny
  // diagnostic benchmark while keeping repeated AV1 calibration tolerable.
  const duration = Math.min(2.0, Math.max(1.2, Number(state.media?.duration || 2.0) / 20));
  const starts = qualitySampleStarts(duration);
  const originalAss = state.activeAssText || state.assText;
  const results = [];

  for (const start of starts) {
    const sample = await requestNativeSample({
      codec,
      start,
      duration,
      withSubtitles: true,
      measureSsim: true,
      crf,
      preset,
      targetVideoBitrate: 0
    }, shiftAssForPreview(originalAss, start));

    const ssim=parseMeasuredQuality(sample?.ssim);
    const measuredDuration=parseMeasuredNumber(sample?.duration);
    const videoBytes=parseMeasuredNumber(sample?.totalVideoBytes);
    if(ssim===null||!(measuredDuration>0)||!(videoBytes>0))
      throw new Error(codec.toUpperCase()+' 未取得有效 SSIM、时长或视频包字节数');
    results.push({
      start,
      ssim,
      bitrate: videoBytes * 8 / measuredDuration,
      mediaSeconds: measuredDuration,
      elapsedSeconds: Math.max(0.001, Number(sample.elapsedSeconds || 0))
    });
  }

  const totalMedia = results.reduce((sum, x) => sum + x.mediaSeconds, 0);
  const totalWall = results.reduce((sum, x) => sum + x.elapsedSeconds, 0);
  const validBitrates = results.map(x => x.bitrate).filter(v => v > 0);

  const summary = {
    codec,
    crf,
    preset,
    ssim: Math.min(...results.map(x => x.ssim)),
    averageSsim: results.reduce((sum, x) => sum + x.ssim, 0) / results.length,
    sampleBitrate: validBitrates.length
      ? validBitrates.reduce((sum, x) => sum + x, 0) / validBitrates.length
      : 0,
    encodeSpeed: totalWall > 0 ? totalMedia / totalWall : 0,
    sampleCount: results.length,
    sampleMeasurements: results.map(item => ({
      start: item.start,
      duration: item.mediaSeconds,
      ssim: item.ssim,
      bitrate: item.bitrate,
      elapsedSeconds: item.elapsedSeconds
    }))
  };

  await persistCompressionEvidence(qualityEvidenceRecord({
    media: state.media,
    sourceName: state.video?.name || state.media?.sourceName || '',
    sourceSize: Number(state.video?.size || state.media?.size || 0),
    backend: state.nativeBackend?.backend || 'web',
    runtimeIdentity: currentRuntimeEvidenceKey(),
    codec,
    preset,
    crf,
    targetSsim,
    ssim: summary.ssim,
    averageSsim: summary.averageSsim,
    sampleBitrate: summary.sampleBitrate,
    encodeSpeed: summary.encodeSpeed,
    sampleCount: summary.sampleCount,
    sampleMeasurements: summary.sampleMeasurements
  }));

  return summary;
}

async function calibrateCodecQuality(codec, target, budgetSeconds=null) {
  const range = qualityCrfRange(codec);
  const preset = profileFor(codec, 'balanced').preset;
  let low = range.min;
  let high = range.max;
  let best = null;
  let bestQuality = null;
  const tested = new Map();
  let stopReason=null;
  const canProbe=()=>{
    if(budgetSeconds===null||tested.size===0)return true;
    const decision=calibrationShouldContinue({points:[...tested.values()],budgetSeconds});
    if(!decision.continue)stopReason=decision.reason;
    return decision.continue;
  };

  const test = async crf => {
    if (tested.has(crf)) return tested.get(crf);
    $('qualityCalibrationResult').textContent =
      '正在校准 ' + codec.toUpperCase() +
      ' · CRF ' + crf +
      ' · 目标 SSIM ' + target.toFixed(3) + '…';
    const result = await evaluateQualityCandidate(codec, crf, preset, target);
    tested.set(crf, result);
    if (!state.qualityExplorationPoints[codec]) state.qualityExplorationPoints[codec]=[];
    state.qualityExplorationPoints[codec].push({
      ...result, qualitySetting:crf,
      iteration:state.qualityExplorationPoints[codec].length+1,
      meetsTarget:result.ssim>=target
    });
    renderQualityExploration();
    if (!bestQuality || result.ssim > bestQuality.ssim) bestQuality = result;
    log(
      '目标质量校准 ' + codec.toUpperCase() +
      ' · CRF ' + crf +
      ' · SSIM ' + result.ssim.toFixed(5) +
      ' · ' + formatBitrate(result.sampleBitrate) +
      ' · ' + result.encodeSpeed.toFixed(2) + '× realtime'
    );
    return result;
  };

  // Find the highest CRF that still clears the target. Higher CRF normally
  // means lower bitrate / lower quality, so this searches the quality boundary.
  for (let i = 0; i < 5 && low <= high && canProbe(); i++) {
    const mid = Math.floor((low + high) / 2);
    const result = await test(mid);
    if (result.ssim >= target) {
      best = result;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  // Binary search may stop one integer before the boundary.
  if (best && best.crf < range.max && canProbe()) {
    const next = await test(best.crf + 1);
    if (next.ssim >= target) best = next;
  }

  if (!best) {
    const strongest = tested.has(range.min) ? tested.get(range.min) :
      canProbe() ? await test(range.min) :
      [...tested.values()].reduce((a,b)=>!a||b.ssim>a.ssim?b:a,null);
    return {
      ...strongest,
      targetSsim: target,
      meetsTarget: strongest.ssim >= target,
      testedCrfs: [...tested.keys()].sort((a, b) => a - b),
      testedPoints: [...tested.values()].sort((a, b) => Number(a.sampleBitrate) - Number(b.sampleBitrate)),
      partial:!!stopReason,stopReason
    };
  }

  return {
    ...best,
    targetSsim: target,
    meetsTarget: true,
    testedCrfs: [...tested.keys()].sort((a, b) => a - b),
    testedPoints: [...tested.values()].sort((a, b) => Number(a.sampleBitrate) - Number(b.sampleBitrate)),
    partial:!!stopReason,stopReason
  };
}

function chooseEfficiencyCalibration(calibrations) {
  const candidates = calibrations.filter(x => x?.meetsTarget && x.sampleBitrate > 0);
  if (!candidates.length) return null;

  return [...candidates].sort((a, b) => {
    const rateRatio = Math.max(a.sampleBitrate, b.sampleBitrate) /
      Math.max(1, Math.min(a.sampleBitrate, b.sampleBitrate));

    // Within 5% bitrate, prefer the materially faster encoder instead of
    // pretending a tiny sample-size difference is meaningful.
    if (rateRatio <= 1.05) return b.encodeSpeed - a.encodeSpeed;
    return a.sampleBitrate - b.sampleBitrate;
  })[0];
}

async function runQualityCalibration({compareForSize=false}={}) {
  if (!state.nativeBackend?.available) {
    alert('目标质量校准当前只在 Native 模式可用。');
    return;
  }
  if (state.nativeJobId || state.qualityCalibrationBusy) return;

  const target = Number($('qualityTarget')?.value || 0.985);
  const goal = $('encodeGoal')?.value || 'targetQuality';
  const available = ['h264', 'h265', 'av1'].filter(
    codec => state.softwareEncoders[codec] !== false
  );

  if (!available.length) {
    alert('没有可用于目标质量校准的 Native 编码器。');
    return;
  }

  if (!state.selectedCodec || !available.includes(state.selectedCodec)) {
    state.selectedCodec = chooseDefaultCodec(goal) || available[0];
  }

  // “目标质量”只校准当前选择，避免用户只想用 H.265 时还被迫等待 AV1。
  // “目标质量自动选择”才需要把三个编码器拉到同一质量线后比较。
  const codecs = goal === 'efficiency'||compareForSize ? available : [state.selectedCodec];
  const budget=calibrationTimeBudget(Number(state.media?.duration||0));
  const budgetPerCodec=budget && compareForSize ? Math.max(8,budget/codecs.length) : budget;

  state.qualityCalibrationBusy = true;
  if (goal === 'efficiency'||compareForSize) {
    state.qualityCalibration = {};
    state.rateDistortionModels = {};
    state.qualityExplorationPoints = {};
    state.sizeEnvelopeEnabled = false;
  } else {
    delete state.qualityCalibration[state.selectedCodec];
    delete state.rateDistortionModels[state.selectedCodec];
    delete state.qualityExplorationPoints[state.selectedCodec];
  }
  state.qualityCalibrationTarget = target;
  updateQualityCalibrationControls();
  refreshBenchmarkEnabled();

  try {
    for (const codec of codecs) {
      try {
        state.qualityCalibration[codec] = await calibrateCodecQuality(codec, target, budgetPerCodec);
        const rdModel = fitRateDistortionModel(state.qualityCalibration[codec].testedPoints || []);
        state.rateDistortionModels[codec] = rdModel.ok ? rdModel : null;
        if (rdModel.ok) {
          const knee = rdModel.estimateKnee();
          log(
            'R-D 模型 ' + codec.toUpperCase() +
            ' · ' + rdModel.points.length + ' 个实测码率点' +
            ' · ' + formatBitrate(rdModel.minBitrate) + '–' + formatBitrate(rdModel.maxBitrate) +
            (knee ? ' · 局部效率拐点≈' + formatBitrate(knee.bitrate) : '')
          );
        }
      } catch (error) {
        state.qualityCalibration[codec] = {
          codec,
          targetSsim: target,
          meetsTarget: false,
          error: error.message
        };
        delete state.rateDistortionModels[codec];
        log('目标质量校准 ' + codec.toUpperCase() + ' 失败：' + error.message);
      }
      renderPlanOptions();
    }

    state.sizeEnvelopeEnabled=compareForSize &&
      codecs.filter(id=>state.rateDistortionModels[id]?.ok).length>=2;
    const values = codecs.map(codec => state.qualityCalibration[codec]);
    const efficient = goal === 'efficiency'
      ? chooseEfficiencyCalibration(values)
      : null;

    if (efficient) {
      state.selectedCodec = efficient.codec;
    }

    const labels = { h264: 'H.264', h265: 'H.265', av1: 'AV1' };
    const resultRows = codecs.map(codec => {
      const r = state.qualityCalibration[codec];
      if (!r || r.error) {
        return '<div><strong>' + labels[codec] + '</strong>：<span class="bad">' +
          escapeHtml(r?.error || '校准失败') + '</span></div>';
      }
      return '<div><strong>' + labels[codec] + '</strong>：CRF ' + r.crf +
        ' · SSIM ' + r.ssim.toFixed(5) +
        ' · ' + formatBitrate(r.sampleBitrate) +
        ' · ' + r.encodeSpeed.toFixed(2) + '×' +
        (r.meetsTarget ? '' : ' · <span class="warn">未达到目标</span>') +
        '</div>';
    }).join('');

    const conclusion = goal === 'efficiency'
      ? (
          efficient
            ? '<div class="quality-efficiency-pick"><strong>等质量压缩效率选择：</strong>' +
              labels[efficient.codec] +
              '（样本码率最低；差异在 5% 内时优先更快者）</div>'
            : '<div class="warn">没有编码器在当前 CRF 搜索范围内达到目标 SSIM。</div>'
        )
      : '';

    $('qualityCalibrationResult').innerHTML =
      '<div class="quality-calibration-results">' +
      resultRows +
      conclusion +
      '<small>SSIM 以相同字幕渲染后的源画面为参考；最多取两个约 2 秒代表性片段中的较低分数作为校准值。它仍不是整片质量保证。</small>' +
      '</div>';

    renderPlanOptions();
    refreshBenchmarkEnabled();
    if(compareForSize) {
      const frontier=currentSizeFrontier();
      log(frontier?.kind==='multi-branch'
        ? '跨编码器上包络已构建：'+frontier.branchIds.join(', ')
        : '未取得共同实测预算区间：保留单分支曲线，不伪造上包络。');
    }
  } catch (error) {
    $('qualityCalibrationResult').innerHTML =
      '<span class="bad">目标质量校准失败：' + escapeHtml(error.message) + '</span>';
    log('目标质量校准失败：' + error.message);
  } finally {
    state.qualityCalibrationBusy = false;
    updateQualityCalibrationControls();
  }
}

async function runSelectedTest() {
  if (!state.selectedCodec) return;
  const testCodec = state.selectedCodec;
  const plan = buildEncodePlan(testCodec);
  if (!plan) return;
  const testKey = selectedTestCacheKey(testCodec, plan);
  try {
    $('testSelectedBtn').disabled = true;
    $('selectedTestResult').classList.remove('hidden');
    $('selectedTestResult').innerHTML = '<div class="note">正在生成所选方案测试片段…</div>';
    const fps = state.media?.fps || 30;
    const targetFrames = testCodec === 'av1' ? 120 : 72;
    const maxSampleSeconds = testCodec === 'av1' ? 4.0 : 2.4;
    const minSampleSeconds = testCodec === 'av1' ? 2.5 : 1.2;
    const duration = Math.min(maxSampleSeconds, Math.max(minSampleSeconds, targetFrames / fps));
    const total = state.media?.duration || 0;
    const candidates = state.assInfo?.previewTimes || [];
    const anchor = candidates.length
      ? [...candidates].sort((a,b) => Math.abs(a - total * 0.45) - Math.abs(b - total * 0.45))[0]
      : total * 0.45;
    const startAt = Math.max(0, Math.min(Math.max(0, total - duration), anchor - 0.45));
    log('所选方案测试：' + testCodec.toUpperCase() + ' · ' + duration.toFixed(2) + ' 秒 / 约 ' + Math.round(duration * fps) + ' 帧 · 含真实字幕' + (testCodec === 'av1' ? ' · AV1 使用较长样本降低首个关键帧/启动开销对码率与速度的偏差' : ''));
    const originalAss = state.activeAssText || state.assText;
    const shiftedAss = shiftAssForPreview(originalAss, startAt);
    let r;

    if (state.nativeBackend?.available) {
      const nativeStart = state.nativeInputProbe?.seekable === false ? 0 : startAt;
      if (nativeStart !== startAt) {
        log('当前 SAF 输入不可 seek；Native 测试片段改从视频开头生成。');
      }
      r = await requestNativeSample({
        codec: testCodec,
        start: nativeStart,
        duration,
        withSubtitles: true,
        crf: plan.crf,
        preset: plan.preset,
        targetVideoBitrate: plan.mode === 'budget-rate' ? plan.targetVideoBitrate : 0,
        measureSsim: true,
        retainSample: true
      }, shiftAssForPreview(originalAss, nativeStart));

      r.packetStats = {
        totalVideoBytes: Number(r.totalVideoBytes || 0),
        packetCount: Number(r.packetCount || 0)
      };
    } else {
      await state.engine.setAssText(shiftedAss);
      try {
        r = await state.engine.benchmarkCodec(testCodec, {
          start: startAt, duration, withSubtitles: true, crf: plan.crf, preset: plan.preset,
          targetVideoBitrate: plan.mode === 'budget-rate' ? plan.targetVideoBitrate : 0,
          twoPass: false,
          measureSsim: false,
          timeoutMs: testCodec === 'av1' ? 120000 : 60000
        });
      } finally {
        await state.engine.setAssText(originalAss);
      }
    }

    const measuredDuration = Number(r.duration || duration);
    const sampleBitrate = r.packetStats?.totalVideoBytes
      ? r.packetStats.totalVideoBytes * 8 / Math.max(0.001, measuredDuration)
      : 0;

    const previous = state.selectedTests?.[testKey];
    if (previous?.sampleUrl && previous.sampleUrl !== r.sampleUrl) {
      URL.revokeObjectURL(previous.sampleUrl);
    }

    r._testCodec = testCodec;
    r._testDuration = measuredDuration;
    r._sampleBitrate = sampleBitrate;
    r._native = !!state.nativeBackend?.available;

    if (!state.selectedTests) state.selectedTests = {};
    state.selectedTests[testKey] = r;
    state.selectedTest = r;
    if (r._native && r.sampleId) state.latestNativeSampleId = r.sampleId;
    renderSelectedTestResult();
  } catch (e) {
    log('所选方案测试失败：' + e.message);
    $('selectedTestResult').innerHTML = '<div class="error-box">测试失败：' + escapeHtml(e.message) + '</div>';
  } finally {
    refreshBenchmarkEnabled();
  }
}

async function runBenchmarks() {
  try {
    $('benchmarkBtn').disabled = true;
    state.benchmarks = {};
    renderCodecCards();
    const fps = state.media?.fps || 30;
    const duration = Math.min(1.5, Math.max(0.6, 36 / fps));
    const total = state.media?.duration || 0;
    const startAt = total > duration * 2 ? Math.max(0, total * 0.45) : 0;
    log('高级比较：每个编码器约 ' + duration.toFixed(2) + ' 秒样本；结果不外推整片。');
    for (const codec of ['h264','h265','av1']) {
      if (state.softwareEncoders[codec] === false) {
        state.benchmarks[codec] = { codecKey: codec, error: '当前核心未编入该编码器。' };
        renderCodecCards();
        continue;
      }
      try {
        const p = profileFor(codec, 'balanced');
        if (state.nativeBackend?.available) {
          const nativeStart = state.nativeInputProbe?.seekable === false ? 0 : startAt;
          const nr = await requestNativeSample({
            codec,
            start: nativeStart,
            duration,
            withSubtitles: false,
            crf: p.crf,
            preset: p.preset,
            targetVideoBitrate: 0,
            measureSsim: true
          }, '');
          state.benchmarks[codec] = {
            codecKey: codec,
            crf: p.crf,
            preset: p.preset,
            encodeSpeed: Number(nr.encodeSpeed || 0),
            ssim: Number.isFinite(Number(nr.ssim)) ? Number(nr.ssim) : null,
            packetStats: {
              totalVideoBytes: Number(nr.totalVideoBytes || 0),
              packetCount: Number(nr.packetCount || 0)
            },
            duration: Number(nr.duration || duration)
          };
        } else {
          state.benchmarks[codec] = await state.engine.benchmarkCodec(codec, {
            start: startAt,
            duration,
            withSubtitles: false,
            crf: p.crf,
            preset: p.preset,
            timeoutMs: codec === 'av1' ? 90000 : codec === 'h265' ? 60000 : 45000
          });
        }
      } catch (e) {
        state.benchmarks[codec] = { codecKey: codec, error: e.message };
      }
      renderCodecCards();
    }
    if (!state.nativeBackend?.available) {
      try { await state.engine.resetRuntime('高级样本测试完成后清理临时文件'); }
      catch (e) { log('样本测试后的 runtime 清理失败：' + e.message); }
    }
  } finally {
    refreshBenchmarkEnabled();
  }
}

function renderCodecCards() {
  const labels = state.nativeBackend?.backend === 'windows-native'
    ? { h264:'H.264 / Windows Native', h265:'H.265 / Windows Native', av1:'AV1 / Windows Native' }
    : { h264:'H.264 / x264', h265:'H.265 / x265', av1:'AV1 / SVT-AV1' };
  $('codecGrid').innerHTML = ['h264','h265','av1'].map(codec => {
    const r = state.benchmarks[codec];
    if (!r) return '<div class="codec-card codec-' + codec + '"><h3>' + labels[codec] + '</h3><div class="note">等待测试</div></div>';
    if (r.error) return '<div class="codec-card codec-' + codec + '"><h3>' + labels[codec] + '</h3><div class="bad">测试失败</div><div class="note">' + escapeHtml(r.error.slice(0,180)) + '</div></div>';
    const sampleDuration = Math.max(
      0.001,
      Number(r.duration || 0) || (r.packetStats?.packetCount / (state.media?.fps || 30))
    );
    const sampleBitrate = r.packetStats?.totalVideoBytes ? r.packetStats.totalVideoBytes * 8 / sampleDuration : 0;
    return '<div class="codec-card codec-' + codec + '"><h3>' + labels[codec] + '</h3><dl>' +
      '<dt>样本速度</dt><dd>' + r.encodeSpeed.toFixed(2) + '× realtime</dd>' +
      '<dt>样本视频码率</dt><dd>' + formatBitrate(sampleBitrate) + '</dd>' +
      '<dt>SSIM</dt><dd>' + (r.ssim ? r.ssim.toFixed(5) : '未取得') + '</dd>' +
      '<dt>参数</dt><dd>CRF ' + r.crf + ' · ' + r.preset + '</dd></dl>' +
      '<div class="button-row"><button class="advanced-choose" data-codec="' + codec + '">采用此编码器</button></div></div>';
  }).join('');
  document.querySelectorAll('.advanced-choose').forEach(btn => btn.onclick = () => selectCodec(btn.dataset.codec));
}

async function runEncode() {
  if (state.nativeCompletedJob && state.nativeBackend?.available) {
    const bridge = globalThis.NativeHardsub;
    bridge?.requestNativeExport?.(
      state.nativeCompletedJob.jobId,
      state.nativeCompletedJob.suggestedName || 'hardsub.mkv'
    );
    return;
  }

  if (!state.selectedCodec) return;
  if (state.nativeBackend?.available) {
    await runNativeEncode();
    return;
  }
  if (state.media?.unsafeColorPipeline) { alert('检测到 HDR/高位深输入。当前版本不会静默转换，正式压制已锁定。'); return; }
  const plan = buildEncodePlan(state.selectedCodec);
  if (!plan) { alert('无法生成安全的压制方案。'); return; }
  const audioSettings = guidedHardsubAudioSettings();
  if (['aac','libopus'].includes(audioSettings.audio)) {
    const audioCaps = await state.engine.taskCapabilities(audioSettings.audio);
    if (!audioCaps.encoder.available) {
      alert('当前 Web 核心不支持音频编码器 ' + audioSettings.audio);
      return;
    }
  }
  let container;
  try {
    container = resolveGuidedHardsubContainer(state.selectedCodec);
    refreshGuidedContainerDecision();
  } catch (error) {
    alert('输出容器不可用：' + error.message);
    return;
  }
  try {
    $('encodeBtn').disabled = true;
    $('progressBar').style.width = '1%';
    $('liveEta').textContent = '正在启动编码器；前几秒不计算 ETA。';
    log('正式压制：' + state.selectedCodec.toUpperCase() + ' · ' + container.key.toUpperCase() + ' · ' + (plan.mode === 'budget-rate' ? '单遍预算码率' : 'CRF质量') + '模式');
    if (plan.mode === 'budget-rate') log('体积预算边界 ' + formatBytes(plan.sizeCeiling) + '；源码率锚点 ' + formatBitrate(plan.sourceVideoBitrate) + '；单遍目标视频码率 ' + formatBitrate(plan.targetVideoBitrate) + '。');
    else log('CRF ' + plan.crf + ' · preset ' + plan.preset + '；不提前猜整片大小。');
    const durationMs = state.media.duration * 1000;
    let phaseName = '';
    let samples = [];
    let lastUi = 0;
    const result = await state.engine.encodeFullStream(state.selectedCodec, {
      crf: plan.crf, preset: plan.preset,
      targetVideoBitrate: plan.mode === 'budget-rate' ? plan.targetVideoBitrate : 0,
      outputContainer: container.key,
      outputFormat: container.format,
      outputExtension: container.extension,
      outputMime: container.mime,
      ...audioSettings,
      onPhase: phase => { phaseName = phase; samples = []; $('liveEta').textContent = phase === 'pass1' ? '第一遍：正在稳定编码速度…' : phase === 'pass2' ? '第二遍：正在稳定编码速度…' : '正在稳定编码速度…'; },
      onStatistics: stat => {
        const currentPhase = stat.phase || phaseName || 'encode';
        if (currentPhase !== phaseName) { phaseName = currentPhase; samples = []; }
        const mediaSec = Math.max(0, (stat.timeMs || 0) / 1000);
        const now = performance.now();
        samples.push({ wall: now, media: mediaSec });
        samples = samples.filter(x => now - x.wall <= 20000);
        const phaseProgress = durationMs > 0 ? Math.min(1, (stat.timeMs || 0) / durationMs) : 0;
        const overall = phaseProgress * 0.98;
        $('progressBar').style.width = Math.max(1, Math.min(98, overall * 100)).toFixed(1) + '%';
        if (now - lastUi < 500) return;
        lastUi = now;
        let rollingSpeed = 0;
        if (samples.length >= 2) {
          const a = samples[0], b = samples[samples.length - 1];
          const wallSec = (b.wall - a.wall) / 1000;
          if (wallSec >= 6 && b.media > a.media) rollingSpeed = (b.media - a.media) / wallSec;
        }
        const phaseLabel = '正式压制';
        if (!(rollingSpeed > 0)) {
          $('liveEta').textContent = phaseLabel + ' · 已处理 ' + (phaseProgress * 100).toFixed(1) + '% · 正在稳定编码速度…';
          return;
        }
        const remainMedia = Math.max(0, state.media.duration - mediaSec);
        const eta = remainMedia / rollingSpeed;
        const fps = rollingSpeed * (state.media.fps || 0);
        $('liveEta').textContent = phaseLabel + ' · 已处理 ' + (phaseProgress * 100).toFixed(1) + '% · 最近20秒 ' + fps.toFixed(1) + ' fps / ' + rollingSpeed.toFixed(2) + '× realtime · 当前阶段预计剩余 ' + formatDuration(eta);
      }
    });
    $('progressBar').style.width = '99%';
    $('liveEta').textContent = '编码完成；正在快速扫描成品 packet 完整性…';

    let packetScan = null;
    try {
      packetScan = await state.engine.scanEncodedPackets(
        result.blob,
        state.media.duration,
        { expectedAudioTracks: audioSettings.audio === 'none' ? 0 : Number(state.media.audioTracks || 0) }
      );
      const deltaText = packetScan.durationDelta == null
        ? ''
        : ' · 与源视频差 ' + (packetScan.durationDelta >= 0 ? '+' : '') + packetScan.durationDelta.toFixed(3) + ' s';
      const audioEndText = packetScan.audioTrackCount
        ? ' · 音频 ' + packetScan.audioTrackCount + ' 轨，总体末端 ' +
          packetScan.audioEnds.map(v => v == null ? 'N/A' : v.toFixed(3) + ' s').join(' / ')
        : ' · 无音频';
      log(
        '成品全量解复用扫描：视频末端 ' +
        packetScan.videoEnd.toFixed(3) + ' s' +
        (packetScan.videoFrameCount > 0 ? ' · 视频帧/包进度 ' + packetScan.videoFrameCount : '') +
        deltaText +
        audioEndText +
        ' · 扫描耗时 ' + packetScan.scanSeconds.toFixed(2) + ' s。'
      );

      if (!packetScan.ok) {
        log(
          '成品完整性警告：全量解复用扫描未通过。' +
          (packetScan.videoStreamCount !== 1 ? ' 视频流数量=' + packetScan.videoStreamCount + '（预期 1）。' : '') +
          (!packetScan.durationOk && packetScan.durationDelta != null
            ? ' 视频末端与源时长偏差 ' + packetScan.durationDelta.toFixed(3) + ' s，容差 ±' + packetScan.tolerance.toFixed(3) + ' s。'
            : '') +
          (!packetScan.audioTrackCountOk
            ? ' 音频轨数量=' + packetScan.audioTrackCount + '，源视频=' + packetScan.expectedAudioTracks + '。'
            : '') +
          (!packetScan.audioDurationsOk
            ? ' 音频总体末端与源时长偏差超过 ±' + packetScan.audioTolerance.toFixed(1) + ' s。'
            : '')
        );
      }
    } catch (scanError) {
      log('成品 packet 扫描失败，但不会丢弃已经完成的文件：' + scanError.message);
    }

    $('progressBar').style.width = '100%';
    if (packetScan?.ok) {
      $('liveEta').textContent =
        '压制完成 · ' + formatBytes(result.byteLength) +
        ' · 完整性扫描通过 · 视频末端 ' + formatDurationPrecise(packetScan.videoEnd);
    } else if (packetScan) {
      $('liveEta').textContent =
        '压制完成 · ' + formatBytes(result.byteLength) +
        ' · 完整性扫描有警告，请查看技术日志';
    } else {
      $('liveEta').textContent =
        '压制完成 · ' + formatBytes(result.byteLength) +
        ' · 完整性扫描未完成，请查看技术日志';
    }

    const base = state.video.name.replace(/\.[^.]+$/, '');
    downloadBlob(result.blob, base + '_hardsub_' + state.selectedCodec + '.' + container.extension);
    if (plan.sizeCeiling && result.byteLength > plan.sizeCeiling) {
      const over = (result.byteLength / plan.sizeCeiling - 1) * 100;
      log('成品 ' + formatBytes(result.byteLength) + '，比规划预算边界高 ' + over.toFixed(2) + '%；这是单遍码率控制的正常可能误差，成品已保留并下载。');
      alert('压制完成。实际成品比规划预算边界高 ' + over.toFixed(2) + '%；预算用于自动选参数，并不是严格字节上限。成品已正常下载。');
    }
    try { await state.engine.resetRuntime('正式压制完成后释放 WASM heap'); }
    catch (e) { log('完成后的内存清理失败：' + e.message); }
  } catch (e) {
    $('progressBar').style.width = '0%';
    $('liveEta').textContent = '压制失败。';
    log('压制失败：' + (e.stack || e.message));
    alert('压制失败：' + e.message);
  } finally {
    refreshBenchmarkEnabled();
  }
}

function mediaFromNativeProbe(p) {
  const rawVideos = Array.isArray(p.videoStreams) ? p.videoStreams : [];
  const videoStreams = rawVideos.length
    ? rawVideos.map((stream,index)=>{
        const bitDepth=Number(stream.bitDepth||8);
        return {
          ordinal:Number.isInteger(Number(stream.ordinal))?Number(stream.ordinal):index,
          index:Number.isInteger(Number(stream.index))?Number(stream.index):index,
          codec:stream.codec||stream.codec_name||'unknown',
          bitRate:Number(stream.bitRate||stream.bit_rate||0),
          width:Number(stream.width||0),
          height:Number(stream.height||0),
          fps:parseFpsText(stream.fps||stream.avg_frame_rate),
          pixelFormat:stream.pixelFormat||stream.pix_fmt||'',
          bitDepth,
          colorTransfer:stream.colorTransfer||stream.color_transfer||'',
          colorPrimaries:stream.colorPrimaries||stream.color_primaries||'',
          colorSpace:stream.colorSpace||stream.color_space||'',
          hdr:!!stream.hdr,
          highBitDepth:bitDepth>8,
          unsafeColorPipeline:!!stream.unsafeColorPipeline || !!stream.hdr || bitDepth>8
        };
      })
    : [{
        ordinal:0,index:0,codec:p.videoCodec||'unknown',bitRate:Number(p.videoBitRate||0),
        width:Number(p.width||0),height:Number(p.height||0),fps:parseFpsText(p.fps),
        pixelFormat:p.pixelFormat||'',bitDepth:Number(p.bitDepth||8),
        colorTransfer:p.colorTransfer||'',colorPrimaries:p.colorPrimaries||'',colorSpace:p.colorSpace||'',
        hdr:!!p.hdr,highBitDepth:Number(p.bitDepth||8)>8,unsafeColorPipeline:!!p.unsafeColorPipeline
      }];
  const primary=videoStreams[0]||{};
  const rawAudios=Array.isArray(p.audioStreams)?p.audioStreams:[];
  const audioStreams=rawAudios.length
    ? rawAudios.map((stream,index)=>({
        ordinal:Number.isInteger(Number(stream.ordinal))?Number(stream.ordinal):index,
        index:Number.isInteger(Number(stream.index))?Number(stream.index):index,
        codec:stream.codec||stream.codec_name||'',
        bitRate:Number(stream.bitRate||stream.bit_rate||0),
        channels:Number(stream.channels||0),
        sampleRate:Number(stream.sampleRate||stream.sample_rate||0)
      }))
    : (Array.isArray(p.audioCodecs)?p.audioCodecs:[]).map((codec,index)=>({ordinal:index,index,codec,bitRate:0,channels:0,sampleRate:0}));
  return {
    duration: Number(p.duration || 0),
    durationSource: 'native-ffprobe',
    formatName: p.format || '',
    sourceName: state.video?.name || '',
    size: Number(p.statSize > 0 ? p.statSize : state.video?.size || 0),
    bitRate: Number(p.bitRate || 0),
    videoStreams,
    videoTracks: videoStreams.length,
    videoCodec: primary.codec || 'unknown',
    videoBitRate: Number(primary.bitRate || 0),
    width: Number(primary.width || 0),
    height: Number(primary.height || 0),
    fps: Number(primary.fps || 0),
    pixelFormat: primary.pixelFormat || '',
    bitDepth: Number(primary.bitDepth || 8),
    colorTransfer: primary.colorTransfer || '',
    colorPrimaries: primary.colorPrimaries || '',
    colorSpace: primary.colorSpace || '',
    hdr: !!primary.hdr,
    highBitDepth: !!primary.highBitDepth,
    unsafeColorPipeline: !!primary.unsafeColorPipeline,
    audioStreams,
    audioCodec: audioStreams[0]?.codec || p.audioCodec || '',
    audioCodecs: audioStreams.length ? audioStreams.map(x=>x.codec).filter(Boolean) : (Array.isArray(p.audioCodecs) ? p.audioCodecs : (p.audioCodec ? [p.audioCodec] : [])),
    audioTracks: Number(p.audioTracks ?? audioStreams.length),
    audioBitRate: Number(p.audioBitRate || audioStreams.reduce((sum,x)=>sum+Number(x.bitRate||0),0)),
    inputDecodeSmoke: p.inputDecodeSmoke === true,
    inputDecodeDeferred: p.inputDecodeDeferred === true,
    inputDecodeError: p.inputDecodeError || '',
    sourceAdapter: p.sourceAdapter || '',
    sourceAdapterRequired: p.sourceAdapterRequired === true,
    sourceAdapterAvailable: p.sourceAdapterAvailable === true,
    sourceAdapterApplied: p.sourceAdapterApplied === true,
    sourceAdapterTool: p.sourceAdapterTool || '',
    sourceOriginalName: p.sourceOriginalName || state.video?.name || '',
    sourceOriginalKind: p.sourceOriginalKind || '',
    executionStatSize: Number(p.executionStatSize || 0)
  };
}

function parseFpsText(value) {
  if (typeof value === 'number') return value;
  const parts = String(value || '').split('/').map(Number);
  if (parts.length === 2 && parts[1]) return parts[0] / parts[1];
  return Number(parts[0] || 0);
}

function requestNativePreview(timeSeconds, assText) {
  const bridge = globalThis.NativeHardsub;
  if (!bridge?.renderNativePreview) {
    return Promise.reject(new Error('Native 字幕预览桥不可用'));
  }
  const requestId = (crypto.randomUUID?.() || (Date.now() + '-' + Math.random())).toString();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.nativePreviewWaiters.delete(requestId);
      reject(new Error('Native 字幕预览超时'));
    }, 90000);
    state.nativePreviewWaiters.set(requestId, { resolve, reject, timer });
    bridge.renderNativePreview(requestId, Number(timeSeconds || 0), assText);
  });
}

function requestNativeFrame(timeSeconds, width = 720, videoStream = 0) {
  const bridge = globalThis.NativeHardsub;
  if (!bridge?.renderNativeFrame) {
    return Promise.reject(new Error('Native 时间轴画面桥不可用'));
  }
  const requestId = (crypto.randomUUID?.() || (Date.now() + '-' + Math.random())).toString();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.nativeFrameWaiters.delete(requestId);
      reject(new Error('Native 时间轴画面预览超时'));
    }, 60000);
    state.nativeFrameWaiters.set(requestId, { resolve, reject, timer });
    bridge.renderNativeFrame(requestId, Number(timeSeconds || 0), Number(width || 720), Math.max(0, Math.floor(Number(videoStream) || 0)));
  });
}

function requestNativeOutputFrame(jobId, timeSeconds, width = 960) {
  const bridge = globalThis.NativeHardsub;
  if (!bridge?.renderNativeOutputFrame) {
    return Promise.reject(new Error('Native 成品验证帧桥不可用'));
  }
  const requestId = (crypto.randomUUID?.() || (Date.now() + '-' + Math.random())).toString();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.nativeOutputFrameWaiters.delete(requestId);
      reject(new Error('Native 成品验证帧生成超时'));
    }, 60000);
    state.nativeOutputFrameWaiters.set(requestId, { resolve, reject, timer });
    bridge.renderNativeOutputFrame(requestId, String(jobId || ''), Number(timeSeconds || 0), Number(width || 960));
  });
}

function requestNativeReferenceFrame(jobId, timeSeconds, width = 1200) {
  const bridge = globalThis.NativeHardsub;
  if (!bridge?.renderNativeReferenceFrame) {
    return Promise.reject(new Error('Native 硬字幕参考帧桥不可用'));
  }
  const requestId = (crypto.randomUUID?.() || (Date.now() + '-' + Math.random())).toString();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.nativeReferenceFrameWaiters.delete(requestId);
      reject(new Error('Native 硬字幕参考帧生成超时'));
    }, 60000);
    state.nativeReferenceFrameWaiters.set(requestId, { resolve, reject, timer });
    bridge.renderNativeReferenceFrame(requestId, String(jobId || ''), Number(timeSeconds || 0), Number(width || 1200));
  });
}

function requestNativeWaveform(options = {}) {
  const bridge = globalThis.NativeHardsub;
  if (!bridge?.renderNativeWaveform) {
    return Promise.reject(new Error('Native 音频波形桥不可用'));
  }
  const requestId = (crypto.randomUUID?.() || (Date.now() + '-' + Math.random())).toString();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.nativeWaveformWaiters.delete(requestId);
      reject(new Error('Native 音频波形生成超时'));
    }, 90000);
    state.nativeWaveformWaiters.set(requestId, { resolve, reject, timer });
    bridge.renderNativeWaveform(requestId, JSON.stringify(options));
  });
}

function requestNativeSample(options, assText) {
  const bridge = globalThis.NativeHardsub;
  if (!bridge?.runNativeSample) {
    return Promise.reject(new Error('Native 测试片段桥不可用'));
  }

  const requestId = (crypto.randomUUID?.() || (Date.now() + '-' + Math.random())).toString();
  // Long 4K short-sample probes may encode slower than realtime on CPU.
  // Bound each request; cancellation remains cooperative between samples.
  const timeoutMs = Math.min(600000, Math.max(
    options.codec === 'av1' ? 120000 : 90000,
    Math.ceil(Number(options.duration || 2) * (options.codec === 'av1' ? 75000 : 45000))
  ));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.nativeSampleWaiters.delete(requestId);
      reject(new Error('Native 测试片段生成超时'));
    }, timeoutMs);

    state.nativeSampleWaiters.set(requestId, { resolve, reject, timer });
    bridge.runNativeSample(
      requestId,
      JSON.stringify(options),
      assText || ''
    );
  });
}

async function runNativeEncode() {
  const bridge = globalThis.NativeHardsub;
  if (!bridge?.startNativeEncode || !bridge?.getNativeJobStatus) {
    throw new Error('Native 正式压制桥不可用');
  }
  if (state.nativeImportJobId) {
    throw new Error('Bink 2 输入仍在导入；请等待完成或取消导入。');
  }
  if (state.nativeInputProbe?.sourceAdapterRequired) {
    throw new Error(state.nativeInputProbe.sourceAdapterAvailable
      ? 'Bink 2 需要先通过 RAD Video Tools 导入，之后才能开始正式压制。'
      : 'Bink 2 当前无法由 FFmpeg 解码，且未检测到 RAD Video Tools。');
  }
  if (state.nativeInputProbe?.inputDecodeSmoke === false && !state.nativeInputProbe?.inputDecodeDeferred) {
    throw new Error('视频元数据可读取，但当前 FFmpeg 无法解码视频流：' + (state.nativeInputProbe.inputDecodeError || 'decoder unavailable'));
  }
  if (state.media?.unsafeColorPipeline) {
    alert('检测到 HDR/高位深输入。当前 Native 版本不会静默转换，正式压制已锁定。');
    return;
  }

  const plan = buildEncodePlan(state.selectedCodec);
  if (!plan) {
    alert('无法生成安全的 Native 压制方案。');
    return;
  }

  const audioSettings = guidedHardsubAudioSettings();
  const container = resolveGuidedHardsubContainer(state.selectedCodec);
  const base = (state.video?.name || 'video').replace(/\.[^.]+$/, '');
  const suggestedName = base + '_hardsub_' + state.selectedCodec + '.' + container.extension;
  const duration = Number(state.media?.duration || 0);
  const sourceAudioTracks = Number(state.media?.audioTracks || 0);
  const audioBitrate = audioSettings.audio === 'none'
    ? 0
    : ['aac','libopus'].includes(audioSettings.audio)
      ? Math.max(0, Number(audioSettings.audioBitrate || 128000)) * sourceAudioTracks
      : Number(state.media?.audioBitRate || 0) || Math.max(1, sourceAudioTracks) * 192000;
  const calibratedVideoBitrate = Number(plan.calibration?.sampleBitrate || 0);

  const estimatedOutputBytes = plan.mode === 'budget-rate'
    ? Math.max(
        Number(plan.sizeCeiling || 0),
        Number(plan.plannedBytes || 0),
        64 * 1024 * 1024
      )
    : calibratedVideoBitrate > 0 && duration > 0
      ? Math.max(
          Math.ceil(((calibratedVideoBitrate * 1.45 + audioBitrate) * duration) / 8),
          128 * 1024 * 1024
        )
      : Math.max(
          Math.ceil(Number(state.video?.size || 0) * 1.75),
          256 * 1024 * 1024
        );

  const request = {
    codec: state.selectedCodec,
    mode: plan.mode,
    crf: plan.crf,
    preset: plan.preset,
    targetVideoBitrate: plan.mode === 'budget-rate' ? plan.targetVideoBitrate : 0,
    expectedDuration: Number(state.media.duration || 0),
    expectedAudioTracks: audioSettings.audio === 'none' ? 0 : sourceAudioTracks,
    audio: audioSettings.audio,
    audioBitrate: audioSettings.audioBitrate,
    audioChannels: audioSettings.audioChannels,
    audioSampleRate: audioSettings.audioSampleRate,
    estimatedOutputBytes,
    goal: plan.goal || '',
    subtitleEventCount: Number(state.assInfo?.events?.filter?.(x => x.kind?.toLowerCase() === 'dialogue')?.length || 0),
    selectedFontCount: Number(state.fonts?.length || 0),
    sampleEncodeSpeed: Number(
      plan.calibration?.encodeSpeed ||
      (state.selectedTest?.codec === state.selectedCodec ? state.selectedTest?.encodeSpeed : 0) ||
      0
    ),
    calibrationSampleBitrate: Number(plan.calibration?.sampleBitrate || 0),
    sourceIdentity: currentSourceEvidenceKey(),
    sourceCodec: state.media?.videoCodec || '',
    sourcePixelFormat: state.media?.pixelFormat || '',
    sourceVideoBitrate: Number(state.media?.videoBitRate || 0),
    sourceWidth: Number(state.media?.width || 0),
    sourceHeight: Number(state.media?.height || 0),
    sourceFps: Number(state.media?.fps || 0),
    sourceSize: Number(state.video?.size || state.media?.size || 0),
    outputContainer: container.key,
    outputFormat: container.format,
    outputExtension: container.extension,
    outputMime: container.mime,
    suggestedName
  };

  let started;
  try {
    started = JSON.parse(
      await Promise.resolve(
        bridge.startNativeEncode(
          JSON.stringify(request),
          state.activeAssText || state.assText
        )
      )
    );
  } catch (error) {
    started = { ok: false, error: error.message };
  }
  if (!started?.ok || !started.jobId) {
    throw new Error(started?.error || '无法创建 Native 压制任务');
  }

  state.nativeJobId = started.jobId;
  state.nativeCompletedJob = null;
  localStorage.setItem('nativeEncodeJobId', started.jobId);
  $('encodeBtn').disabled = true;
  $('cancelEncodeBtn').classList.remove('hidden');
  $('cancelEncodeBtn').disabled = false;
  $('progressBar').style.width = '1%';
  const localPrediction = localPredictionForPlan(plan);
  $('liveEta').textContent = localPrediction
    ? nativePlatformName() + ' 任务已创建 · 本机历史预计编码约 ' +
      formatDuration(localPrediction.etaSeconds) +
      '（' + localPrediction.samples + ' 次记录），开始后会用实时速度修正。'
    : nativePlatformName() + ' 任务已创建，正在准备输入与字体…';
  log(
    'Native 正式压制：' + state.selectedCodec.toUpperCase() +
    ' · ' + container.key.toUpperCase() +
    ' · 音频 ' + audioSettings.audio.toUpperCase() +
    ' · ' + (plan.mode === 'budget-rate' ? '单遍预算码率' : 'CRF 质量') +
    ' · job=' + started.jobId
  );

  await monitorNativeJob(started.jobId);
}

async function monitorNativeJob(jobId) {
  const bridge = globalThis.NativeHardsub;
  let statusReadFailures = 0;
  while (state.nativeJobId === jobId) {
    let status;
    try {
      status = JSON.parse(await Promise.resolve(bridge.getNativeJobStatus(jobId)));
    } catch (error) {
      status = { ok: false, error: error.message };
    }

    if (!status?.ok) {
      statusReadFailures++;
      const detail = status?.error || '未知错误';
      log('Native 状态读取失败（' + statusReadFailures + '/5）：' + detail);
      if (statusReadFailures >= 5) {
        $('liveEta').textContent =
          'Native 状态连续读取失败；当前任务 ID 已保留。请保持 Native Bridge 运行并刷新页面重新连接。';
        syncTaskInputMutationLocks();
        return;
      }
      $('liveEta').textContent = 'Native 状态读取失败，正在重试 ' + statusReadFailures + '/5…';
      await sleepMs(1000);
      continue;
    }
    statusReadFailures = 0;

    const progress = Math.max(0, Math.min(1, Number(status.progress || 0)));
    $('progressBar').style.width = Math.max(1, progress * 100).toFixed(1) + '%';

    if (status.state === 'encoding') {
      const liveSpeed = Number(status.speed || 0);
      const timeSec = Number(status.timeMs || 0) / 1000;
      const currentPlan = state.selectedCodec ? buildEncodePlan(state.selectedCodec) : null;
      const history = localPredictionForPlan(currentPlan);
      const historySpeed = Number(history?.speed || 0);
      const liveWeight = Math.max(0, Math.min(1, timeSec / 30));
      const predictionSpeed = liveSpeed > 0 && historySpeed > 0
        ? historySpeed * (1 - liveWeight) + liveSpeed * liveWeight
        : liveSpeed > 0
          ? liveSpeed
          : historySpeed;
      const remain = predictionSpeed > 0
        ? Math.max(0, Number(status.duration || state.media?.duration || 0) - timeSec) / predictionSpeed
        : null;
      $('liveEta').textContent =
        nativePlatformName() + ' · ' + (progress * 100).toFixed(1) + '%' +
        (liveSpeed > 0 ? ' · 当前 ' + liveSpeed.toFixed(2) + '× realtime' : '') +
        (historySpeed > 0 && liveWeight < 1 ? ' · 本机历史参与预测' : '') +
        (remain != null ? ' · 预计剩余 ' + formatDuration(remain) : '');
    } else if (status.state === 'staging') {
      $('liveEta').textContent = status.message || '正在准备 Native staging…';
    } else if (status.state === 'validating') {
      $('liveEta').textContent = status.message || '正在扫描成品完整性…';
    } else if (status.state === 'cancelling') {
      $('liveEta').textContent = '正在取消 Native 压制…';
    } else if (status.state === 'completed') {
      state.nativeCompletedJob = {
        jobId,
        suggestedName: status.suggestedName || 'hardsub.mkv'
      };
      state.nativeJobId = null;
      syncTaskInputMutationLocks();
      $('cancelEncodeBtn').classList.add('hidden');
      $('progressBar').style.width = '100%';
      $('liveEta').textContent =
        'Native 压制完成 · ' + formatBytes(Number(status.outputBytes || 0)) +
        ' · packet 扫描 + 完整解码验证通过 · 点击“保存成品”选择保存位置';
      $('encodeBtn').disabled = false;
      $('encodeBtn').textContent = '保存成品';
      loadLocalBenchmarkHistory();
      log(
        nativePlatformName() + ' 成品验证通过：输出时长 ' +
        Number(status.outputDuration || 0).toFixed(3) +
        ' s · 与输入差 ' + Number(status.durationDelta || 0).toFixed(3) +
        ' s · 视频完整解码 ' + Number(status.videoDecodeSeconds || 0).toFixed(2) +
        ' s' +
        (status.audioDecodeSeconds != null
          ? ' · 音频完整解码 ' + Number(status.audioDecodeSeconds || 0).toFixed(2) + ' s'
          : '') +
        ' · SHA-256 ' + (status.sha256 || '')
      );
      return;
    } else if (status.state === 'failed') {
      state.nativeJobId = null;
      localStorage.removeItem('nativeEncodeJobId');
      syncTaskInputMutationLocks();
      $('cancelEncodeBtn').classList.add('hidden');
      $('progressBar').style.width = '0%';
      $('liveEta').textContent = 'Native 压制失败。';
      $('encodeBtn').disabled = false;
      log('Native 压制失败：' + (status.error || status.message || '未知错误'));
      alert('Native 压制失败：' + (status.error || status.message || '未知错误'));
      refreshBenchmarkEnabled();
      return;
    } else if (status.state === 'cancelled') {
      state.nativeJobId = null;
      localStorage.removeItem('nativeEncodeJobId');
      syncTaskInputMutationLocks();
      $('cancelEncodeBtn').classList.add('hidden');
      $('progressBar').style.width = '0%';
      $('liveEta').textContent = 'Native 压制已取消。';
      refreshBenchmarkEnabled();
      return;
    }

    await sleepMs(800);
  }
}

async function recoverNativeJob() {
  const bridge = globalThis.NativeHardsub;
  const jobId = localStorage.getItem('nativeEncodeJobId');
  if (!jobId || !bridge?.getNativeJobStatus) return;

  try {
    const status = JSON.parse(await Promise.resolve(bridge.getNativeJobStatus(jobId)));
    if (!status?.ok) {
      localStorage.removeItem('nativeEncodeJobId');
      return;
    }

    $('encodeCard').classList.remove('hidden');
    syncMobileStageNav();
    if (document.body.classList.contains('ui-mobile')) setMobileStage('produce', { scroll: false });
    if (status.state === 'completed') {
      state.nativeCompletedJob = {
        jobId,
        suggestedName: status.suggestedName || 'hardsub.mkv'
      };
      $('progressBar').style.width = '100%';
      $('liveEta').textContent =
        '检测到上次已完成的 Native 成品 · ' +
        formatBytes(Number(status.outputBytes || 0)) +
        ' · 可直接保存';
      $('encodeBtn').disabled = false;
      $('encodeBtn').textContent = '保存上次成品';
      return;
    }

    if (['queued', 'staging', 'encoding', 'validating', 'cancelling'].includes(status.state)) {
      state.nativeJobId = jobId;
      syncTaskInputMutationLocks();
      $('cancelEncodeBtn').classList.remove('hidden');
      $('encodeBtn').disabled = true;
      log('恢复 ' + nativePlatformName() + ' 任务监视：' + jobId);
      monitorNativeJob(jobId);
      return;
    }

    localStorage.removeItem('nativeEncodeJobId');
  } catch (error) {
    log('恢复 Native 任务失败：' + error.message);
  }
}

function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function guidedHardsubAudioSettings() {
  const audio = document.querySelector('[name="audio"]')?.value || 'copy';
  if (!['copy','aac','libopus','none'].includes(audio)) throw new Error('未知音频策略');
  return {
    audio,
    audioBitrate: Number(document.querySelector('[name="audioBitrate"]')?.value || 128000),
    audioChannels: document.querySelector('[name="audioChannels"]')?.value || '',
    audioSampleRate: document.querySelector('[name="audioSampleRate"]')?.value || ''
  };
}

function resolveGuidedHardsubContainer(codec = state.selectedCodec) {
  if (!codec || !state.media) throw new Error('尚未形成可执行的硬字幕编码方案');
  const requested = document.querySelector('[name="outputContainer"]')?.value || 'auto';
  const audioSettings = guidedHardsubAudioSettings();
  return resolveOutputContainer(
    requested,
    { operation:'hardsub', codec, audio:audioSettings.audio, keepAttachments:false, keepSubtitles:false },
    { ...state.media, sourceName:state.video?.name || state.media.sourceName || '' }
  );
}

function refreshGuidedContainerDecision() {
  if (document.body.dataset.mediaOperation !== 'hardsub' || document.body.dataset.hardsubStrategy !== 'guided') return;
  const target = document.querySelector('#taskContainerDecision');
  if (!target) return;
  try {
    const container = resolveGuidedHardsubContainer();
    target.textContent = '实际输出：' + container.key.toUpperCase() + ' · ' + container.reason +
      (container.source ? ' · 源容器 ' + container.source.toUpperCase() : '');
    target.dataset.state = 'resolved';
  } catch (error) {
    target.textContent = state.selectedCodec ? ('当前组合需要调整：' + error.message) : '选择编码方案后显示实际容器选择。';
    target.dataset.state = state.selectedCodec ? 'error' : 'idle';
  }
}

function buildEncodePlan(codec) {
  const media = state.media;
  if (!media?.duration || !state.video || state.softwareEncoders[codec] === false) return null;
  const goal = $('encodeGoal')?.value || 'balanced';

  if (goal === 'balanced' || goal === 'quality' || goal === 'speed') {
    const p = profileFor(codec, goal);
    return {
      mode: 'crf',
      goal,
      codec,
      crf: p.crf,
      preset: p.preset,
      sizeCeiling: null,
      sourceVideoBitrate: getSourceVideoBitrate()
    };
  }

  if (goal === 'targetQuality' || goal === 'efficiency') {
    const target = Number($('qualityTarget')?.value || 0.985);
    const calibration = state.qualityCalibration[codec];
    if (
      !calibration ||
      state.qualityCalibrationTarget !== target ||
      !calibration.meetsTarget
    ) {
      return null;
    }
    return {
      mode: 'crf',
      goal,
      codec,
      crf: calibration.crf,
      preset: calibration.preset,
      sizeCeiling: null,
      sourceVideoBitrate: getSourceVideoBitrate(),
      calibration
    };
  }

  if (goal !== 'sizeBudget') return null;
  const manualMultiplier = Math.max(0.75, Math.min(2.0, Number($('sizeBudgetMultiplier')?.value || 1.6)));
  const directBudgetBytes = Number(state.sizeBudgetTargetBytes || 0);
  const sizeCeiling = Math.floor(
    directBudgetBytes > 0
      ? directBudgetBytes
      : state.video.size * manualMultiplier
  );
  const multiplier = state.video.size > 0 ? sizeCeiling / state.video.size : manualMultiplier;
  const safeBudgetBytes = Math.floor(sizeCeiling * 0.96);
  const containerReserveBytes = Math.max(256 * 1024, Math.floor(safeBudgetBytes * 0.01));
  const sourceVideoBitrate = getSourceVideoBitrate();
  const audioBitRate = estimatedSizeBudgetAudioBitrate();
  const ceilingVideoBitrate = Math.floor(((safeBudgetBytes - containerReserveBytes) * 8 / media.duration) - audioBitRate);
  if (!(ceilingVideoBitrate > 150000)) return null;
  const sourceCodec = normalizeCodec(media.videoCodec);
  const budgetHeadroom = 1.05 + Math.max(0, Math.min(1, (manualMultiplier - 0.75) / 1.25)) * 0.07;
  const sourceEquivalent = sourceVideoBitrate > 0
    ? sourceVideoBitrate * (codecEfficiency(sourceCodec) / codecEfficiency(codec)) * budgetHeadroom
    : ceilingVideoBitrate;
  const targetVideoBitrate = Math.floor(
    directBudgetBytes > 0
      ? ceilingVideoBitrate
      : Math.max(150000, Math.min(ceilingVideoBitrate, sourceEquivalent))
  );
  const plannedBytes = Math.round(((targetVideoBitrate + audioBitRate) * media.duration / 8) + containerReserveBytes);
  const frontier = directBudgetBytes > 0 ? currentSizeFrontier(codec) : null;
  const frontierEvaluation = frontier?.evaluateTargetBytes(sizeCeiling) || null;
  const frontierPrediction = frontierEvaluation?.status === 'within-evidence'
    ? frontierEvaluation.prediction
    : null;
  const p = profileFor(codec, 'balanced');
  return {
    mode: 'budget-rate',
    goal,
    codec,
    crf: p.crf,
    preset: p.preset,
    multiplier,
    sizeCeiling,
    safeBudgetBytes,
    plannedBytes,
    targetVideoBitrate,
    ceilingVideoBitrate,
    sourceVideoBitrate,
    audioBitRate,
    budgetSource: directBudgetBytes > 0 ? 'frontier' : 'multiplier',
    frontierPrediction
  };
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function formatThermalStatus(status) {
  if (status === null || status === undefined || status === '') return 'API 不可用';
  const n = Number(status);
  if (!Number.isFinite(n)) return '未知';
  return ({
    0: '无节流',
    1: '轻微',
    2: '中等',
    3: '严重',
    4: '临界',
    5: '紧急',
    6: '关机阈值'
  })[n] || ('未知(' + n + ')');
}
function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const units = ['B','KB','MB','GB']; let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}
function formatBitrate(bitsPerSecond) {
  if (!(bitsPerSecond > 0)) return '未知';
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}
function formatBppf(v) {
  if (!(v > 0)) return '未知 bppf';
  return `${v.toFixed(4)} bppf`;
}
function formatDuration(sec) {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.round(sec); const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const r = s%60;
  return h ? `${h}时${m}分${r}秒` : m ? `${m}分${r}秒` : `${r}秒`;
}

function formatDurationPrecise(sec) {
  if (!Number.isFinite(sec)) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h
    ? `${h}:${String(m).padStart(2,'0')}:${s.toFixed(3).padStart(6,'0')}`
    : `${m}:${s.toFixed(3).padStart(6,'0')}`;
}
function escapeHtml(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }


// Manual tasks use the same selected files and owned native job lifecycle.
let manualCancelRequested = false;
mountMediaWorkspace({
  busy: () => state.operationBusy || !!state.nativeJobId || !!state.nativeImportJobId,
  onModeChange: mode => {
    if (mode !== 'hardsub') setMobileStage('prepare', { scroll: false });
    queueMicrotask(refreshAnalyze);
  },
  isWindows: () => !!globalThis.NativeHardsub?.__windowsNative,
  hasNvenc: codec => {
    const key = {h264:'h264_nvenc',h265:'hevc_nvenc',av1:'av1_nvenc'}[codec];
    return !!state.nativeBackend?.encoders?.some(e => (e.key || e.Key) === key && (e.available || e.Available));
  },
  platformKey: () => state.nativeBackend || {},
  mediaSnapshot: () => {
    if (state.sourceMedia) return state.sourceMedia;
    if (state.media) return state.media;
    if (state.nativeInputProbe?.ok) return mediaFromNativeProbe(state.nativeInputProbe);
    return null;
  },
  videoIdentity: () => state.video
    ? [state.video.name,state.video.size,state.video.lastModified].join('|') : '',
  setBusy: value => {
    state.operationBusy=value;
    for (const id of ['video','ass','fonts','videoNativePickerBtn','assNativePickerBtn','fontsNativePickerBtn','analyze','encodeBtn','previewBtn','benchmarkBtn','calibrateQualityBtn']) if($(id)) $(id).disabled=value;
    document.querySelectorAll('.font-binding-select, .plan-interaction, .remove-saved-font').forEach(control=>{control.disabled=value;});
    if($('clearSavedFontsBtn')) $('clearSavedFontsBtn').disabled=value||!state.savedFonts.length;
    if(!value){refreshAnalyze();refreshBenchmarkEnabled();}
  },
  log,
  prepare: async operation => {
    if (!state.video) throw new Error('请先选择视频');
    if (operation === 'hardsub' && !workflowReadiness().ready) {
      throw new Error('硬字幕模式请先在下方完成字幕分析与真实预览');
    }
    if(state.nativeBackend?.available){
      if(state.nativeBackend.taskSchemaVersion<4)throw new Error('当前原生后端版本过旧，请更新 Android APP 或 Windows 包；多流任务需要 task schema v4');
      if(!state.nativeInputProbe?.ok)throw new Error('视频尚未完成原生探测');
      if(state.nativeInputProbe.sourceAdapterRequired)throw new Error(
        state.nativeInputProbe.sourceAdapterAvailable
          ? 'Bink 2 需要先通过 RAD Video Tools 导入，之后才能执行转码。'
          : 'Bink 2 当前无法由 FFmpeg 解码，且未检测到 RAD Video Tools。'
      );
      if(state.nativeInputProbe.inputDecodeSmoke===false && !state.nativeInputProbe.inputDecodeDeferred)throw new Error(
        '视频元数据可读取，但当前 FFmpeg 无法解码视频流：'+(state.nativeInputProbe.inputDecodeError||'decoder unavailable')
      );
      if(state.nativeInputProbe.sourceAdapterApplied && operation==='copy')throw new Error(
        'Bink 2 已经过外部解码导入；“无损快速剪切”不能表示复制原始 Bink 码流，请改用纯视频转码。'
      );
      return {
        ...mediaFromNativeProbe(state.nativeInputProbe),
        sourceName:state.video.name,
        fpsModeSupported:state.nativeBackend.fpsModeSupported,
        nvencMultipassSupported:state.nativeBackend.multipassSupported,
        nvencMultipassFullresSupported:state.nativeBackend.multipassFullresSupported
      };
    }
    if(state.video.size>MAX_BYTES)throw new Error('浏览器输入上限为 1 GiB；请使用 Native 版本');
    if(!await ensureWebEngineReady())throw new Error('浏览器 FFmpeg 核心不可用');
    if(operation !== 'hardsub')await state.engine.stageFiles(state.video,null,[]);
    else { await state.engine.stageFiles(state.video,state.ass,state.effectiveFonts); await state.engine.setAssText(state.activeAssText||state.assText); }
    const media=await state.engine.probe();
    const caps=await state.engine.taskCapabilities('copy');
    return {...media,sourceName:state.video.name,fpsModeSupported:caps.fpsModeSupported};
  },
  // Curves must measure exactly the encoder/preset selected in the manual
  // transcode task. Refuse unsupported backends rather than sample a different
  // implementation and silently label its result as the user's configuration.
  calibrationSample: async ({codec, encoder, preset, multipass, quality, bitrate, mode='quality', start, duration}) => {
    if (!state.nativeBackend?.available || !globalThis.NativeHardsub?.__windowsNative) {
      throw new Error('实测曲线目前需要 Windows Native；当前后端不能保证样本编码器与正式方案一致');
    }
    const actual = await requestNativeSample({
      codec, encoder, preset, multipass, sampleExact: true,
      crf: mode==='bitrate' ? 0 : quality,
      start, duration, withSubtitles: false,
      targetVideoBitrate: mode==='bitrate' ? bitrate : 0, measureSsim: true, retainSample: false
    }, '');
    if (actual.encoder !== encoder) {
      throw new Error('实际测试编码器 '+String(actual.encoder)+' 与当前选择 '+encoder+' 不一致，拒绝生成曲线');
    }
    return actual;
  },
  frame: async options => {
    if (!state.video) throw new Error('请先选择视频');
    const time = Math.max(0, Number(options?.time) || 0);
    const width = Math.max(320, Math.min(1280, Math.floor(Number(options?.width) || 720)));
    const videoStream = Math.max(0, Math.floor(Number(options?.videoStream) || 0));
    if (state.nativeBackend?.available) {
      if (!state.nativeInputProbe?.ok) throw new Error('视频尚未完成原生探测');
      if (state.nativeInputProbe.sourceAdapterRequired) throw new Error('Bink 2 需要先通过 RAD Video Tools 导入才能生成时间轴画面');
      if (state.nativeInputProbe.inputDecodeSmoke === false && !state.nativeInputProbe.inputDecodeDeferred) throw new Error('当前 FFmpeg 无法解码该视频流');
      return requestNativeFrame(time, width, videoStream);
    }
    if (state.video.size > MAX_BYTES) throw new Error('浏览器输入上限为 1 GiB；请使用 Native 版本预览时间轴画面');
    if (!await ensureWebEngineReady()) throw new Error('浏览器 FFmpeg 核心不可用');
    if (state.engine.sourceVideoFile !== state.video) await state.engine.stageFiles(state.video, null, []);
    if (!state.engine.mediaInfo) await state.engine.probe();
    return state.engine.renderTimelineFrame(time, { width, videoStream });
  },
  waveform: async options => {
    if (!state.video) throw new Error('请先选择视频');
    const audioTrack = Math.max(0, Math.floor(Number(options?.audioTrack) || 0));
    const videoStream = Math.max(0, Math.floor(Number(options?.videoStream) || 0));
    const width = Math.max(512, Math.min(4096, Math.floor(Number(options?.width) || 2048)));
    const height = Math.max(96, Math.min(320, Math.floor(Number(options?.height) || 160)));
    const includeKeyframes = !!options?.includeKeyframes;
    const allowNoWaveform = !!options?.allowNoWaveform;
    const maxKeyframes = Math.max(256, Math.min(50000, Math.floor(Number(options?.maxKeyframes) || 12000)));
    const emptyTimeline = (duration, error = '当前视频没有音频轨') => ({
      url: null,
      waveformError: error,
      duration: Number(duration || 0),
      width,
      height,
      audioTrack,
      keyframes: [],
      keyframesTruncated: false
    });
    if (state.nativeBackend?.available) {
      if (!state.nativeInputProbe?.ok) throw new Error('视频尚未完成原生探测');
      if (state.nativeInputProbe.sourceAdapterRequired) throw new Error('Bink 2 需要先通过 RAD Video Tools 导入才能分析时间轴');
      if (state.nativeInputProbe.inputDecodeSmoke === false && !state.nativeInputProbe.inputDecodeDeferred) throw new Error('当前 FFmpeg 无法解码该视频流');
      const duration = Number(state.nativeInputProbe.duration || 0);
      if (!includeKeyframes && Number(state.nativeInputProbe.audioTracks || 0) < 1) {
        if (allowNoWaveform) return emptyTimeline(duration);
        throw new Error('当前视频没有可用于波形显示的音轨');
      }
      try {
        return await requestNativeWaveform({
          audioTrack,
          videoStream,
          width,
          height,
          includeKeyframes,
          maxKeyframes,
          duration
        });
      } catch (error) {
        if (allowNoWaveform && !includeKeyframes) return emptyTimeline(duration, error.message || '音频波形生成失败');
        throw error;
      }
    }
    if (state.video.size > MAX_BYTES) throw new Error('浏览器输入上限为 1 GiB；请使用 Native 版本分析时间轴');
    if (!await ensureWebEngineReady()) throw new Error('浏览器 FFmpeg 核心不可用');
    if (state.engine.sourceVideoFile !== state.video) await state.engine.stageFiles(state.video, null, []);
    const media = state.engine.mediaInfo || await state.engine.probe();
    const duration = Number(media.duration || 0);
    if (!includeKeyframes && Number(media.audioTracks || 0) < 1) {
      if (allowNoWaveform) return emptyTimeline(duration);
      throw new Error('当前视频没有可用于波形显示的音轨');
    }
    try {
      return await state.engine.renderWaveform({
        audioTrack,
        videoStream,
        width,
        height,
        includeKeyframes,
        maxKeyframes,
        duration
      });
    } catch (error) {
      if (allowNoWaveform && !includeKeyframes) return emptyTimeline(duration, error.message || '音频波形生成失败');
      throw error;
    }
  },
  verifyFramePair: async options => {
    if (!state.video) throw new Error('请先选择视频');
    const completed = options?.completed || {};
    const task = options?.task || {};
    const sourceTime = Math.max(0, Number(options?.sourceTime) || 0);
    const outputTime = Math.max(0, Number(options?.outputTime) || 0);
    const width = Math.max(480, Math.min(1600, Math.floor(Number(options?.width) || 1200)));
    const hardsub = task.operation === 'hardsub';
    const primaryVideoStream = Math.max(0, Math.floor(Number(task.videoStreams?.[0] ?? task.videoStream ?? 0)));

    let sourceFrame;
    let outputFrame;
    if (state.nativeBackend?.available) {
      if (!completed.jobId) throw new Error('Native 成品验证缺少 job id');
      sourceFrame = hardsub
        ? await requestNativeReferenceFrame(completed.jobId, sourceTime, width)
        : await requestNativeFrame(sourceTime, width, primaryVideoStream);
      outputFrame = await requestNativeOutputFrame(completed.jobId, outputTime, width);
    } else {
      if (!completed.blob) throw new Error('浏览器成品验证缺少成品数据');
      if (!await ensureWebEngineReady()) throw new Error('浏览器 FFmpeg 核心不可用');
      if (hardsub) {
        const sameSource = state.engine.sourceVideoFile === state.video;
        const sameAss = state.engine.sourceAssFile === state.ass;
        if (!sameSource || !sameAss) {
          await state.engine.stageFiles(state.video, state.ass, state.effectiveFonts);
          await state.engine.setAssText(state.activeAssText || state.assText);
        } else if (state.activeAssText) {
          await state.engine.setAssText(state.activeAssText);
        }
        if (!state.engine.mediaInfo) await state.engine.probe();
        sourceFrame = await state.engine.renderHardsubReferenceFrame(sourceTime, task, { width, videoStream: primaryVideoStream });
      } else {
        if (state.engine.sourceVideoFile !== state.video) await state.engine.stageFiles(state.video, null, []);
        if (!state.engine.mediaInfo) await state.engine.probe();
        sourceFrame = await state.engine.renderTimelineFrame(sourceTime, { width, videoStream: primaryVideoStream });
      }
      outputFrame = await state.engine.renderVerifiedOutputFrame(
        completed.blob,
        outputTime,
        { width, extension: options?.outputExtension }
      );
    }
    return {
      source: sourceFrame,
      output: outputFrame,
      sourceTime,
      outputTime,
      width,
      referenceKind: hardsub ? 'hardsub-authoritative' : 'source-frame'
    };
  },
  validate: async task => {
    if(state.nativeBackend?.available){
      if(globalThis.NativeHardsub?.__windowsNative){
        // Windows performs authoritative structured-task validation again when
        // the job starts. For video Stream Copy there is no video encoder to
        // preflight here; audio encoder capability is checked by that backend.
        if(task.operation!=='copy'){
          const encoder=state.nativeBackend.encoders?.find(e=>(e.key||e.Key)===task.encoder);
          if(!encoder || !(encoder.available || encoder.Available))throw Error('当前原生后端不支持此编码器');
          validateEncoderSupport(task,encoder,state.nativeBackend.globalOptions||[]);
        }
      }else if(globalThis.NativeHardsub?.validateMediaTask){
        const result=JSON.parse(globalThis.NativeHardsub.validateMediaTask(JSON.stringify(task)));
        if(!result.ok)throw Error(result.error||'原生参数能力检查失败');
      }
    }else await state.engine.validateTask(task);
  },
  cancel: () => {
    manualCancelRequested=true;
    if(state.nativeJobId)globalThis.NativeHardsub?.cancelNativeEncode(state.nativeJobId);
    else void state.engine.api?.FFmpegKit?.cancel();
  },
  save: completed => {
    if(completed.jobId){
      const bridge=globalThis.NativeHardsub;
      if(!bridge?.requestNativeExport)throw new Error('Native 成品保存桥不可用');
      void bridge.requestNativeExport(completed.jobId,completed.name);
      return {pending:true,jobId:completed.jobId};
    }
    downloadBlob(completed.blob,completed.name);
    return {ok:true,kind:'browser-download'};
  },
  run: async (task,media,progress) => {
    manualCancelRequested=false;
    const base=state.video.name.replace(/\.[^.]+$/,'');
    const name=outputFileName(base,task);
    log('媒体任务：'+task.operation+' · '+task.outputContainer.toUpperCase()+' · '+task.outputArgs.join(' '));
    if(state.nativeBackend?.available){
      const primaryVideoOrdinal=Number(task.videoStreams?.[0] ?? task.videoStream ?? 0);
      const primaryVideo=Array.isArray(media.videoStreams) ? (media.videoStreams[primaryVideoOrdinal] || null) : null;
      const streamIdentity=currentSourceEvidenceKey()+'|video='+String((task.videoStreams||[primaryVideoOrdinal]).join(','));
      const request={
        codec:task.codec||'h264',
        mode:task.rateMode!=='quality'?'budget-rate':'crf',
        goal:'manual',
        preset:task.preset||'medium',
        crf:Number(task.quality||23),
        targetVideoBitrate:Number(task.bitrate||0),
        task,
        expectedDuration:media.duration,
        expectedAudioTracks:task.expectedAudioTracks,
        estimatedOutputBytes:Math.max(128*1024*1024,task.estimatedBytes ? Math.ceil(task.estimatedBytes*1.15) : Number(state.video.size||media.size||0)*2),
        sourceIdentity:streamIdentity,
        sourceCodec:primaryVideo?.codec||media.videoCodec||'',
        sourcePixelFormat:primaryVideo?.pixelFormat||media.pixelFormat||'',
        sourceVideoBitrate:Number(primaryVideo?.bitRate||media.videoBitRate||0),
        sourceWidth:Number(primaryVideo?.width||media.width||0),
        sourceHeight:Number(primaryVideo?.height||media.height||0),
        sourceFps:Number(primaryVideo?.fps||media.fps||0),
        sourceSize:Number(state.video.size||media.size||0),
        subtitleEventCount:Number(state.assInfo?.events?.filter?.(x=>x.kind?.toLowerCase()==='dialogue')?.length||0),
        selectedFontCount:Number(state.fonts?.length||0),
        suggestedName:name
      };
      const bridge=globalThis.NativeHardsub;
      const started=JSON.parse(await Promise.resolve(bridge.startNativeEncode(JSON.stringify(request),task.operation==='hardsub'?(state.activeAssText||state.assText):'')));
      if(!started.ok||!started.jobId)throw new Error(started.error||'创建任务失败');
      state.nativeJobId=started.jobId;
      localStorage.setItem('nativeEncodeJobId',started.jobId);
      try {
        while(true){
          const result=JSON.parse(await Promise.resolve(bridge.getNativeJobStatus(started.jobId)));
          if(!result.ok)throw new Error(result.error||'状态读取失败');
          const actual=result.actualStart != null ? ' · 实际起点 '+Number(result.actualStart).toFixed(3)+' 秒' : '';
          progress(Number(result.progress||0),(result.message||result.state)+actual,{
            state:result.state,
            timeSec:Number(result.timeMs||0)/1000,
            duration:Number(result.duration||task.expectedDuration||0),
            speed:Number(result.speed||0),
            actualStart:Number(result.actualStart??started.actualStart??task.start??0)
          });
          if(result.state==='completed')return {jobId:started.jobId,name,outputBytes:result.outputBytes,outputDuration:result.outputDuration,verified:true,actualStart:result.actualStart??started.actualStart??task.start};
          if(['failed','cancelled'].includes(result.state))throw new Error(result.error||result.state);
          if(manualCancelRequested)bridge.cancelNativeEncode(started.jobId);
          await sleepMs(700);
        }
      } finally {state.nativeJobId=null;localStorage.removeItem('nativeEncodeJobId');}
    }
    if(task.operation!=='copy'&&!state.softwareEncoders[task.codec])throw new Error('当前浏览器核心未提供此编码器');
    task=await state.engine.snapTaskStart(task);
    if(manualCancelRequested)throw new Error('已取消');
    const webEncodeStarted=performance.now();
    progress(0,'正在处理 · 实际起点 '+task.start.toFixed(3)+' 秒',{
      state:'encoding',timeSec:0,duration:task.expectedDuration,speed:0,actualStart:task.start
    });
    const result=await state.engine.encodeFullStream(task.codec||'h264',{task,onPhase:()=>{if(manualCancelRequested)throw Error('已取消');},onStatistics:stat=>{
      const timeSec=Math.max(0,Number(stat.timeMs||0)/1000);
      const fraction=Math.min(.98,timeSec/task.expectedDuration);
      const elapsed=Math.max(.001,(performance.now()-webEncodeStarted)/1000);
      const speed=timeSec/elapsed;
      progress(task.twoPass?(stat.phase==='pass1'?fraction*.5:.5+fraction*.5):fraction,(stat.phase==='pass1'?'第一遍统计':'正在处理')+' · '+timeSec.toFixed(1)+' 秒 · 起点 '+task.start.toFixed(3)+' 秒',{
        state:'encoding',timeSec,duration:task.expectedDuration,speed,phase:stat.phase||''
      });
    }});
    if(manualCancelRequested)throw new Error('已取消');
    progress(.99,'正在验证成品…',{state:'validating',timeSec:task.expectedDuration,duration:task.expectedDuration,speed:0});
    const check=await state.engine.scanEncodedPackets(result.blob,task.expectedDuration,{task,allowShortAudio:true,expectedAudioTracks:task.expectedAudioTracks,tolerance:task.operation==='copy'?2:undefined});
    if(!check.ok)throw new Error('成品轨道或时长验证未通过：'+JSON.stringify(check));
    return {blob:result.blob,name,verified:true,actualStart:task.start};
  }
});
