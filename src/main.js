import {executeGuidedTask} from './shared-task-presentation.js';
let mediaWorkspace;
import {outputReport} from './media-planning.js';
import { validateEncoderSupport, vvcCapability } from './media-capabilities.js';
import { mountMediaWorkspace } from './media-workspace.js';
import { outputFileName, resolveOutputContainer } from './media-container.js';
import './style.css';
import './focused-workbench.css';
import './studio-v2.css';
import './studio-v3.css';
import {mountExpectedWorkbench} from './expected-workbench.js';
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
import { guidedResolutionCandidates, COMMON_REFERENCE_METRIC } from './compression-resolutions.js';
import { SCENE_PLAN_VERSION, sceneProbeStarts, selectPairedSceneWindows } from './scene-risk-selection.js';
import { planPairedRefinement, appendMatchedSceneObservation } from './calibration-refinement.js';
import { resolveGuidedSizePolicy } from './guided-size-policy.js';
import { guidedWholeFileProjection, assessGuidedWholeFileBudget } from './guided-whole-file-budget.js';
import {guidedAssDecisionScope} from './decision-reference-scope.js';
import {evaluateSharedEvidenceDecision} from './shared-evidence-decision.js';
import {verifyGuidedNativeVbr} from './guided-native-vbr-verification.js';
import {createGuidedBranchProposal,currentGuidedBranchProposal,commitVerifiedGuidedBranch} from './guided-branch-adoption.js';
import { completedGuidedNativeBudget, formatCompletedGuidedNativeBudget } from './native-guided-budget-recovery.js';

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
  nativeJobProjection: null,
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
  resolutionRateDistortionModels: {},
  guidedOutputSize: null,
  sizeEnvelopeEnabled: false,
  guidedModelScopes: {},
  guidedVbrVerification: null,
  guidedPendingBranch: null,
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
    <p id="heroSubtitle" class="hero-subtitle">硬压 · 转码 · 剪切</p>
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
      <span id="runtimeModeDetail">浏览器 FFmpeg/WASM · 建议 ≤ 1 GB</span>
    </div>
  </section>
  <div id="studioModeDock" class="studio-mode-dock" aria-label="处理模式导航"></div>

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
    <div class="card-heading"><span class="step-no">01</span><div><h2>准备素材</h2><p>添加输入文件</p></div></div>
    <div class="grid two">
      <div class="file-row input-video"><label id="videoLabel">视频（网页≤ 1 GB；Native 后端适合更大文件）</label><input id="video" class="file-input-control" type="file"><label id="videoWebPicker" class="file-picker-trigger" for="video">选择视频</label><button id="videoNativePickerBtn" class="native-picker-button hidden" type="button">选择视频</button><small id="videoMeta">未选择视频</small></div>
      <div class="file-row input-ass"><label>ASS 字幕</label><input id="ass" class="file-input-control" type="file" accept=".ass,text/plain"><label id="assWebPicker" class="file-picker-trigger" for="ass">选择 ASS 字幕</label><button id="assNativePickerBtn" class="native-picker-button hidden" type="button">选择 ASS 字幕</button><small id="assMeta">未选择</small>
        <div id="embeddedAssImportPanel" hidden>
          <label>容器内封 ASS <select id="embeddedAssStream"></select></label>
          <button type="button" id="importEmbeddedAss" class="secondary">从当前 MKV 导入 ASS 与字体</button>
          <small id="embeddedAssStatus" role="status">仅 Windows Native；需显式选择字幕轨</small>
        </div></div>
      <div class="file-row input-font">
        <label id="fontLabel">字体（可选，可多选）</label>
        <input id="fonts" class="file-input-control" type="file" multiple accept=".ttf,.otf,.ttc,.otc">
        <label id="fontsWebPicker" class="file-picker-trigger" for="fonts">选择字体文件</label>
        <button id="fontsNativePickerBtn" class="native-picker-button hidden" type="button">选择字体文件</button>
        <label id="fontPersistCheck" class="font-persist-check"><input id="rememberFonts" type="checkbox" checked> 记住本次选择，加入本机常用字体库</label>
        <small id="fontMeta">未选择字体</small>
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
  <section id="studioEmptyStage" class="studio-empty-stage" data-mobile-stage-section="produce" aria-label="媒体预览区域">
    <div class="studio-empty-visual" aria-hidden="true"><span></span></div>
    <div class="studio-empty-copy"><strong>媒体预览</strong><span>添加视频并完成分析后显示实际画面</span></div>
  </section>
  <section id="subtitleCard" class="card preview-card hidden" data-mobile-stage-section="produce">
    <div class="card-heading preview-card-heading">
      <span class="step-no">03</span>
      <div><h2>真实字幕预览</h2><p>libass 渲染</p></div>
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
        <p>自动选参或精确控制</p>
      </div>
      <span class="hardsub-control-badge">HARDSUB</span>
    </div>
    <div id="hardsubStrategySwitcher" class="hardsub-strategy-switcher" role="group" aria-label="硬字幕压制控制方式">
      <button type="button" data-hardsub-strategy="guided" aria-pressed="true">
        <span class="hardsub-strategy-kicker">GUIDED</span>
        <strong>目标控制</strong>
        <small>预设 · 质量 · 体积</small>
      </button>
      <button type="button" data-hardsub-strategy="manual" aria-pressed="false">
        <span class="hardsub-strategy-kicker">MANUAL</span>
        <strong>参数控制</strong>
        <small>编码器 · 画面 · 音频</small>
      </button>
    </div>
  </section>
  <div id="hardsubManualMount"></div>
  <section id="planCard" class="card plan-card hidden" data-mobile-stage-section="produce">
    <div class="card-heading"><span class="step-no">04</span><div><h2>引导目标</h2><p>探索目标，确认后写入下方当前任务</p></div></div>
    <button type="button" id="guidedToManual" class="secondary">将引导目标写入当前任务（CPU）</button>
    <p class="note">目标探索不会直接改变下方当前任务；确认写入后，执行与保存都使用当前任务。</p>

    <input id="encodeGoal" type="hidden"…82629 tokens truncated…reshAnalyze);
  },
  isWindows: () => !!globalThis.NativeHardsub?.__windowsNative,
  hasNvenc: codec => {
    const key = {h264:'h264_nvenc',h265:'hevc_nvenc',av1:'av1_nvenc'}[codec];
    return !!state.nativeBackend?.encoders?.some(e => (e.key || e.Key) === key && (e.available || e.Available));
  },
  platformKey: () => state.nativeBackend || {},
  // WU08: only user-provided browser File objects, never synthetic native paths.
  supportsBrowserSourceBatch:()=>!state.nativeBackend?.available,
  activateBrowserBatchSource:async file=>{
    if(state.nativeBackend?.available)throw Error('Native 多来源文件授权未实现');
    if(!(file instanceof File)||file.size<=0||file.size>MAX_BYTES)
      throw Error('无效或超限的浏览器来源');
    if(state.video!==file){
      $('video').value='';
      state.video=file;state.nativeInputProbe=null;
      state.ass=null;state.fonts=[];state.embeddedAssSourceIdentity='';
      $('assMeta').textContent='未选择';updateFontMeta();
      invalidateAnalysis({clearVideoMetadata:true});
      renderSourceAdapterState(null);notifyMediaInfoChanged();
      $('videoMeta').textContent=file.name+' · '+formatBytes(file.size)+' · 多来源队列';
      $('videoMeta').className='';
      if($('videoWebPicker'))$('videoWebPicker').textContent='更换视频';
    }
    return state.video;
  },
  mediaSnapshot: () => {
    if (state.sourceMedia) return state.sourceMedia;
    if (state.media) return state.media;
    if (state.nativeInputProbe?.ok) return mediaFromNativeProbe(state.nativeInputProbe);
    return null;
  },
  sourceName: () => state.video?.name||'',
  videoIdentity: () => state.video
    ? [state.video.name,state.video.size,state.video.lastModified].join('|') : '',
  recipeAssetIdentity:()=>JSON.stringify({
    ass:state.ass?[state.ass.name,state.ass.size,state.ass.lastModified??0]:null,
    assContent:state.activeAssText||state.assText||'',
    fonts:state.fonts.map(f=>[f.name,f.size,f.lastModified??0]),
    fontBindings:state.fontBindings||{},autoFontFallbacks:state.autoFontFallbacks||{}
  }),
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
  // The same Windows Native scene-signal primitive used by Guided ASS.
  // Pure-transcode comparisons pass no subtitle rendering; the probe is not
  // a quality metric and never certifies Native CQ or VBR results.
  sceneRiskProbe: async ({start,duration,timeoutSeconds=3})=>{
    if(!state.nativeBackend?.available||!globalThis.NativeHardsub?.__windowsNative)
      throw Error('场景风险探测需要 Windows Native FFmpeg');
    const sample=await requestNativeSample({
      sceneRiskOnly:true,start,duration,timeoutSeconds
    },'');
    if(!Number.isFinite(Number(sample?.frameCount))||Number(sample.frameCount)<=0)
      throw Error('Native 场景风险探测未返回有效帧');
    return sample;
  },
  // Curves must measure exactly the encoder/preset selected in the manual
  // transcode task. Refuse unsupported backends rather than sample a different
  // implementation and silently label its result as the user's configuration.
  calibrationSample: async ({codec, encoder, preset, multipass, quality, bitrate, mode='quality', start, duration, timeoutSeconds, commonReference, outputWidth, outputHeight, referenceWidth, referenceHeight}) => {
    if (!state.nativeBackend?.available || !globalThis.NativeHardsub?.__windowsNative) {
      throw new Error('实测曲线目前需要 Windows Native；当前后端不能保证样本编码器与正式方案一致');
    }
    const actual = await requestNativeSample({
      codec, encoder, preset, multipass, sampleExact: true,
      commonReference, outputWidth, outputHeight, referenceWidth, referenceHeight,
      crf: mode==='bitrate' ? 0 : quality,
      start, duration, withSubtitles: false,
      targetVideoBitrate: mode==='bitrate' ? bitrate : 0, measureSsim: true, retainSample: false,
      timeoutSeconds
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
    if(task.encoder==='libvvenc'){
      const capability=vvcCapability(state.nativeBackend||{});
      if(!capability.available)throw Error(capability.reason);
    }
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
  onBudgetEvidenceChange: () => {
    // A measured source ledger alters only the size coordinate, not CQ evidence.
    if ($('encodeGoal')?.value === 'sizeBudget') {
      updateSizeBudgetPreview();
      renderPlanOptions();
    }
  },
  measureBudget: async () => {
    const bridge=globalThis.NativeHardsub;
    if(!bridge?.__windowsNative||!bridge.measureSourceBudget)throw Error('当前仅 Windows Native 提供完整源流计量');
    return JSON.parse(await bridge.measureSourceBudget());
  },
  auxiliaryPreflight: async request => {
    const bridge=globalThis.NativeHardsub;
    if(!bridge?.__windowsNative||!state.nativeInputProbe?.ok)
      throw Error('逐流预编码观测仅支持已完成来源探测的 Windows Native');
    const flac=request?.mode==='isolated-flac-encode';
    const start=flac?bridge.startFlacEncodePreflight:bridge.startTrimCopyPreflight;
    const poll=flac?bridge.getFlacEncodePreflightStatus:bridge.getTrimCopyPreflightStatus;
    if(typeof start!=='function'||typeof poll!=='function')
      throw Error('Windows Bridge 未更新为 B16 预编码计量版本');
    const source=state.video;
    const selected=JSON.parse(await bridge.readSelectedVideoInfo());
    if(!selected.ok||!source||selected.size!==source.size)
      throw Error('Windows 选中源与当前 UI 来源不一致');
    const started=JSON.parse(await start.call(bridge,request));
    if(!started.ok||started.state!=='running'||!started.jobId)
      throw Error('预编码任务未能启动');
    const deadline=Date.now()+11*60*1000;
    while(Date.now()<deadline){
      if(state.video!==source)throw Error('预编码进行时用户切换了来源');
      await new Promise(resolve=>setTimeout(resolve,1200));
      const observed=JSON.parse(await poll.call(bridge));
      if(observed.jobId!==started.jobId&&observed.state!=='not-requested')
        throw Error('异步回执与本次任务不一致');
      if(observed.state==='running')continue;
      if(observed.state!=='ready'||!observed.receipt)
        throw Error('预编码没有形成有效收据：'+(observed.reason||observed.state));
      return {receipt:observed.receipt,sourceSize:Number(selected.size)};
    }
    throw Error('独立预编码超出有界执行时间，请检查 Windows Bridge 状态');
  },
  inspectCutTimeline: async jobId => {
    const bridge=globalThis.NativeHardsub;
    if(!bridge?.__windowsNative||!bridge.getNativeCutTimeline)throw Error('当前后端尚不支持独立成品剪切时间轴收据');
    return JSON.parse(await Promise.resolve(bridge.getNativeCutTimeline(jobId)));
  },
  refreshCompletedAudit: async jobId => {
    const bridge=globalThis.NativeHardsub;
    if(!bridge?.__windowsNative || !bridge.getNativeJobStatus || !jobId)return null;
    const response=JSON.parse(await Promise.resolve(bridge.getNativeJobStatus(jobId)));
    if(!response.ok || response.state!=='completed')return null;
    return {
      state:'completed',
      outputPacketEvidence:response.outputPacketEvidence??null,
      outputPacketAuditState:response.outputPacketAuditState??null
    };
  },
  save: completed => {
    if(completed.task?.budgetPolicy==='strict-ceiling' && outputReport(completed.task,completed,0).deliveryAllowed!==true)throw Error('严格成品字节上限未通过');
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
          if(result.state==='completed')return {task,jobId:started.jobId,name,outputBytes:result.outputBytes,outputDuration:result.outputDuration,outputPacketEvidence:result.outputPacketEvidence??null,outputPacketAuditState:result.outputPacketAuditState??null,verified:true,actualStart:result.actualStart??started.actualStart??task.start};
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
    return {task,blob:result.blob,name,verified:true,actualStart:task.start};
  }
});

mountExpectedWorkbench({source:()=>state.video,media:()=>state.sourceMedia||state.media});
