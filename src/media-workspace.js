import {commitVerifiedSizeBudget} from './size-budget-adoption.js';
import {sharedTaskPresentation} from './shared-task-presentation.js';
import {guidedTaskSettings} from './guided-task-handoff.js';
import {compileGuidedCpuHandoff,commitGuidedCpuHandoff} from './guided-cpu-compiler-contract.js';
import {buildTaskReview,renderTaskReview} from './task-review.js';
import { formatSize, outputReport, sampleSettings, sampleProjection, sampleQualityTrial } from './media-planning.js';
import {buildAuxiliaryPreflightRequest} from './auxiliary-preflight-request.js';
import {assessFlacEncodeObservation} from './flac-encode-preflight.js';
import {assessIsolatedTrimCopyPreflight} from './trim-copy-preflight.js';
import {reconcileAuxiliaryMuxObservation} from './auxiliary-mux-reconciliation.js';
import { compileTask, commandPreview, SOFTWARE } from './media-task.js';
import { vvcCapability } from './media-capabilities.js';
import { mountAudioStreamPlan } from './audio-stream-plan-ui.js';
import { audioCopyPlaybackWarning } from './media-container.js';
import { mountTranscodeCurves } from './transcode-calibration-panel.js';
import {commitVerifiedManualCandidate} from './manual-transcode-adoption.js';
import { parseMediaTime, formatMediaTimeInput } from './media-time.js';
import {makeQueuedClip,validateQueuedCopySettings,clipOutputName} from './clip-queue.js';
import {assessCopyCutStart} from './copy-cut-feasibility.js';
import {createOutputRecipe,validateOutputRecipe,outputRecipeFilename} from './output-recipe-matrix.js';
import { verificationDuration, verificationSourceTime, verificationHasSpatialTransforms } from './media-verification.js';
import './media-workspace-ui.css';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const select = (key,label,options) => `<label>${label}<select name="${key}">${options.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>`;
const input = (key,label,placeholder='',value='') => `<label>${label}<input name="${key}" value="${value}" placeholder="${placeholder}" autocomplete="off"></label>`;
const check = (key,label,on=false) => `<label class="task-check"><input type="checkbox" name="${key}" ${on?'checked':''}>${label}</label>`;
export function mountMediaWorkspace(hooks) {
  const section = document.createElement('section');
  section.className = 'card media-workspace';
  section.id = 'mediaWorkspace';
  section.dataset.mobileStageSection = 'prepare';
  section.dataset.taskState = 'idle';
  const modeNav = document.createElement('nav');
  modeNav.className = 'media-mode-switcher';
  modeNav.setAttribute('aria-label', '视频处理工作区');
  modeNav.innerHTML =
    '<button type="button" data-media-mode="hardsub" aria-label="硬字幕压制" aria-pressed="true"><span class="media-mode-index">ASS</span><span><strong>硬压</strong><small>ASS · libass</small></span></button>' +
    '<button type="button" data-media-mode="transcode" aria-label="纯视频转码" aria-pressed="false"><span class="media-mode-index">VIDEO</span><span><strong>转码</strong><small>视频 · 音频</small></span></button>' +
    '<button type="button" data-media-mode="copy" aria-label="视频流复制与快速剪辑" aria-pressed="false"><span class="media-mode-index">COPY</span><span><strong>剪切</strong><small>Stream Copy</small></span></button>';
  section.innerHTML = `<div class="media-workspace-heading">
    <div>
      <span id="mediaWorkspaceEyebrow" class="media-workspace-eyebrow">HARDSUB</span>
      <h2 id="mediaWorkspaceTitle">硬字幕压制工作区</h2>
      <p id="mediaWorkspaceDescription">编码与封装</p>
    </div>
    <div class="media-workspace-badges"><span>同一任务格式</span><span>Native / Web</span></div>
  </div>
  <form id="mediaTaskForm"><input type="hidden" name="subtitleRenderOrder" value="after-scale">
  <div class="task-grid media-mode-meta">${select('operation','工作模式',[['hardsub','硬字幕压制'],['transcode','纯视频转码'],['copy','视频流复制 / 快速剪辑']])}${input('start','开始时间','例如 3:57.250','0')}${input('end','结束时间','留空表示片尾；例如 5:12.800')}</div>
  <p class="note media-time-format-note">支持 MM:SS.mmm / HH:MM:SS.mmm</p>
  <section id="taskWaveformPanel" class="media-waveform-panel" aria-label="媒体剪辑时间轴">
    <div class="media-waveform-heading">
      <div><strong>剪辑时间轴</strong><span id="taskWaveformStatus">尚未分析 · 可显示波形和关键帧</span></div>
      <button type="button" id="taskWaveformLoad" class="secondary">分析时间轴</button>
    </div>
    <div class="media-timeline-legend" aria-label="时间轴图例">
      <span><i class="media-timeline-legend-wave"></i>音频波形</span>
      <span class="media-timeline-keyframe-only"><i class="media-timeline-legend-key"></i>关键帧</span>
      <span><i class="media-timeline-legend-request"></i>请求边界</span>
      <span class="media-timeline-keyframe-only"><i class="media-timeline-legend-actual"></i>实际无损起点</span>
    </div>
    <div id="taskWaveformScroll" class="media-waveform-scroll">
      <div id="taskWaveformTrack" class="media-waveform-track" tabindex="0" aria-label="可点击定位的媒体剪辑时间轴">
        <div id="taskWaveformRuler" class="media-waveform-ruler" aria-hidden="true"></div>
        <div id="taskWaveformPlaceholder" class="media-waveform-placeholder">选择视频后分析时间轴。拖动 IN / OUT 调整范围，点击空白处移动光标。</div>
        <img id="taskWaveformImage" alt="音频波形" draggable="false" hidden>
        <span id="taskWaveformSelection" class="media-waveform-selection" hidden></span>
        <div id="taskKeyframeLane" class="media-keyframe-lane media-timeline-keyframe-only" aria-label="视频关键帧分布"></div>
        <span id="taskWaveformActualStart" class="media-waveform-actual-start media-timeline-keyframe-only" title="无损剪切实际起点" hidden></span>
        <span id="taskWaveformStart" class="media-waveform-boundary media-waveform-boundary-start" data-boundary="start" data-label="IN" title="拖动请求开始时间" hidden></span>
        <span id="taskWaveformEnd" class="media-waveform-boundary media-waveform-boundary-end" data-boundary="end" data-label="OUT" title="拖动结束时间" hidden></span>
        <span id="taskWaveformCursor" class="media-waveform-cursor" aria-hidden="true" hidden></span>
      </div>
    </div>
    <div id="taskCopyBoundaryInfo" class="media-copy-boundary-info media-timeline-keyframe-only" hidden>
      <span>请求起点 <strong id="taskRequestedStartTime">—</strong></span>
      <span>实际无损起点 <strong id="taskActualStartTime">—</strong></span>
      <span id="taskKeyframeDelta">分析关键帧后显示偏移</span>
    </div>
    <section id="taskCopyStrategyPanel" class="media-copy-strategy" hidden aria-label="快速复制切点可行性">
    <div class="media-copy-strategy-title"><strong>剪切策略 · 快速复制（关键帧约束）</strong><span id="taskCopyStrategyStatus" role="status">待检查</span></div>
    <p id="taskCopyStrategyDescription">复制编码包不等于任意帧精确；成品时间戳和音画同步仍须独立验证。</p>
    <button id="taskPreferTranscodeTrim" type="button" class="secondary">改用重编码剪切（需要复核编码设置）</button>
    <small>只有明确点击并确认才会更换模式。重编码也不代表已验证帧精确。</small>
  </section>
  <section id="taskFramePreviewPanel" class="media-frame-preview-panel" hidden aria-label="时间轴画面预览">
      <div class="media-frame-preview-heading">
        <div><strong>画面预览</strong><span id="taskFramePreviewStatus">移动时间轴光标后显示源视频画面</span></div>
        <span id="taskFramePreviewTime">—</span>
      </div>
      <div class="media-frame-preview-current">
        <div class="media-frame-preview-image-shell">
          <img id="taskFramePreviewImage" alt="时间轴光标处源视频画面" data-frame-fullscreen="cursor" tabindex="0" role="button" title="点击全屏查看" hidden>
          <div id="taskFramePreviewPlaceholder">点击或拖动时间轴以预览画面。</div>
        </div>
      </div>
      <div id="taskBoundaryFrameInspector" class="media-boundary-frame-inspector media-timeline-keyframe-only" hidden>
        <article>
          <header><span>请求 IN</span><strong id="taskRequestedFrameTime">—</strong></header>
          <div class="media-boundary-frame-image-shell"><img id="taskRequestedFrameImage" alt="请求 IN 对应画面" data-frame-fullscreen="requested" tabindex="0" role="button" title="点击全屏对比请求 IN 与实际无损 IN" hidden><span id="taskRequestedFramePlaceholder">等待请求边界</span></div>
        </article>
        <article>
          <header><span>实际无损 IN</span><strong id="taskActualFrameTime">—</strong></header>
          <div class="media-boundary-frame-image-shell"><img id="taskActualFrameImage" alt="实际无损起点对应画面" data-frame-fullscreen="actual" tabindex="0" role="button" title="点击全屏对比请求 IN 与实际无损 IN" hidden><span id="taskActualFramePlaceholder">等待关键帧分析</span></div>
        </article>
      </div>
    </section>
    <div class="media-waveform-controls">
      <span>光标 <strong id="taskWaveformCursorTime">0:00</strong></span>
      <button type="button" id="taskWaveformSetStart" class="secondary">设为 IN</button>
      <button type="button" id="taskWaveformSetEnd" class="secondary">设为 OUT</button>
      <button type="button" id="taskKeyframePrev" class="secondary media-timeline-keyframe-only" hidden>← 前一关键帧</button>
      <button type="button" id="taskKeyframeNext" class="secondary media-timeline-keyframe-only" hidden>后一关键帧 →</button>
      <button type="button" id="taskKeyframeSnapStart" class="secondary media-timeline-keyframe-only" hidden>将 IN 对齐关键帧</button>
      <label class="media-waveform-zoom">缩放 <input id="taskWaveformZoom" type="range" min="1" max="12" step="1" value="1" aria-label="剪辑时间轴缩放"></label>
    </div>
  </section>
  <section id="taskClipQueuePanel" class="media-clip-queue" hidden aria-label="多片段无损剪切">
    <div class="media-clip-queue-header">
      <div><strong>多片段剪切</strong><span>可选 · 每段分别导出，不拼接</span></div>
      <div class="media-clip-queue-header-actions"><button id="taskCancelClipEdit" type="button" class="secondary" hidden>取消编辑</button><button id="taskAddClip" type="button" class="secondary">加入片段</button></div>
    </div>
    <ol id="taskClipQueueList" aria-label="待导出片段"></ol>
    <p id="taskClipQueueStatus" role="status">设置 IN / OUT 后加入片段。实际起点可能受关键帧约束。</p>
    <div class="media-clip-queue-actions">
      <button id="taskExportClips" type="button" disabled>导出全部</button>
      <button id="taskStopClips" type="button" class="secondary" hidden>停止批量</button>
      <button id="taskClearClips" type="button" class="secondary" disabled>清空</button>
    </div>
  </section>
  <details id="taskRecipeMatrixPanel" class="media-clip-queue media-recipe-matrix">
    <summary><strong>多输出方案矩阵</strong> · 同一来源分别硬压／转码／剪切</summary>
    <p class="note">把当前正式方案加入矩阵；每个方案独立执行、独立验证并分别保存。此版本不支持多来源输入。</p>
    <div class="media-clip-queue-header-actions">
      <button type="button" class="secondary" id="taskAddRecipe">加入当前方案</button>
      <button type="button" class="secondary" id="taskClearRecipes">清空矩阵</button>
    </div>
    <ol id="taskRecipeMatrixList" aria-label="多输出独立任务"></ol>
    <p id="taskRecipeMatrixStatus" role="status">尚未添加输出方案。</p>
    <div class="media-clip-queue-actions">
      <button type="button" id="taskRunRecipes" disabled>执行未完成方案</button>
      <button type="button" class="secondary" id="taskStopRecipes" hidden>停止后续输出</button>
    </div>
  </details>
  <div id="taskFrameFullscreen" class="media-frame-lightbox" hidden role="dialog" aria-modal="true" aria-labelledby="taskFrameFullscreenTitle">
    <div class="media-frame-lightbox-shell">
      <header class="media-frame-lightbox-header">
        <div>
          <strong id="taskFrameFullscreenTitle">画面全屏预览</strong>
          <span id="taskFrameFullscreenMeta">—</span>
        </div>
        <button type="button" id="taskFrameFullscreenClose" class="secondary" aria-label="关闭全屏画面对比">关闭</button>
      </header>
      <div id="taskFrameFullscreenStage" class="media-frame-lightbox-stage" tabindex="0" aria-label="全屏画面对比区域">
        <div id="taskFrameFullscreenBaseLayer" class="media-frame-lightbox-layer">
          <img id="taskFrameFullscreenBase" alt="" draggable="false">
        </div>
        <div id="taskFrameFullscreenCompareLayer" class="media-frame-lightbox-layer media-frame-lightbox-compare-layer" hidden>
          <img id="taskFrameFullscreenCompare" alt="" draggable="false">
        </div>
        <span id="taskFrameFullscreenDivider" class="media-frame-lightbox-divider" hidden><i></i></span>
        <span id="taskFrameFullscreenLeftLabel" class="media-frame-lightbox-label media-frame-lightbox-label-left" hidden></span>
        <span id="taskFrameFullscreenRightLabel" class="media-frame-lightbox-label media-frame-lightbox-label-right" hidden></span>
      </div>
      <div id="taskFrameFullscreenControls" class="media-frame-lightbox-controls" hidden>
        <span>请求 IN</span>
        <input id="taskFrameFullscreenWipe" type="range" min="0" max="100" step="1" value="50" aria-label="请求帧与实际无损帧对比分割位置">
        <span>实际无损 IN</span>
        <button type="button" id="taskFrameFullscreenReset" class="secondary">复位对比</button>
      </div>
      <div id="taskFrameFullscreenViewportControls" class="media-frame-lightbox-viewport-controls" aria-label="全屏画面缩放">
        <span>视图</span>
        <button type="button" class="secondary" data-frame-zoom="fit" aria-pressed="true">Fit</button>
        <button type="button" class="secondary" data-frame-zoom="100" aria-pressed="false">100%</button>
        <button type="button" class="secondary" data-frame-zoom="200" aria-pressed="false">200%</button>
        <button type="button" class="secondary" data-frame-zoom="400" aria-pressed="false">400%</button>
        <strong id="taskFrameFullscreenZoomStatus">Fit</strong>
      </div>
      <p class="media-frame-lightbox-help">拖动中线或下方滑块比较；放大后拖动画面同步平移，滚轮可连续缩放。双击恢复 50/50，Esc 退出。</p>
    </div>
  </div>
  <p id="taskModeHint" class="note media-mode-hint"></p>
  <details class="media-workflow-notes"><summary>处理方式说明</summary>
  <div class="media-branch-map" aria-label="当前媒体任务结构">
    <span>共享入口 · 源媒体 / 探测</span><b>→</b><strong>当前任务分支</strong><b>→</b><span>共享出口 · 封装 / 执行 / 验证 / 保存</span>
  </div>
  <section class="media-operation-branch media-operation-branch-hardsub" data-operation-branch="hardsub">
    <strong>硬字幕压制分支</strong><span>ASS / 字体 → 字幕预检 → libass 真实预览 → 视频编码。字幕语义只属于这一分支。</span>
  </section>
  <section class="media-operation-branch media-operation-branch-transcode" data-operation-branch="transcode">
    <strong>纯视频转码分支</strong><span>编码器 / 质量或码率 → 帧率 / 尺寸 / 像素格式 / 画面处理 → 音频策略。不会要求 ASS。</span>
  </section>
  <section class="media-operation-branch media-operation-branch-copy" data-operation-branch="copy">
    <strong>视频流复制 / 快速剪辑分支</strong><span>所选视频保持 Stream Copy；视频、音频、软字幕可独立选择完整时间轴或 IN/OUT 范围，音频仍可显式转码。</span>
  </section>
  <div class="media-mode-explainer media-mode-explainer-hardsub">
    <strong>硬字幕链路</strong><span>视频 + ASS + 字体 → 预检 → libass 真实预览 → 视频重编码 → 输出验证</span>
  </div>
  <div class="media-mode-explainer media-mode-explainer-transcode">
    <strong>纯视频转码</strong><span>不要求 ASS。直接配置编码、尺寸、帧率、画面处理、音频与封装；不会静默更换你选择的编码器。</span>
  </div>
  <div class="media-mode-explainer media-mode-explainer-copy">
    <strong>视频 Stream Copy</strong><span>所选视频码流不重新编码；若视频使用 IN/OUT，主选视频流决定关键帧切入。音频可保持完整、独立剪辑、复制、转码或关闭。</span>
  </div>
  </details>
  <details id="taskReviewDetails" class="task-review-details"><summary><span>来源、计划与成品</span><strong data-review-overview aria-live="polite">未选择来源 · 当前方案未检查 · 尚无成品</strong></summary>
  <section id="taskObjectReview" class="task-object-review" aria-label="来源、计划与成品">
    <article><h3>来源</h3><strong data-review="source-status"></strong><ul data-review="source-facts"></ul><p id="taskReviewSourceName"></p></article>
    <article><h3>拟输出计划</h3><strong data-review="plan-status"></strong><p data-review="plan-codec"></p><details><summary>逐流去向与完整预算</summary><ul data-review="plan-rows"></ul><ul data-review="plan-budget"></ul></details></article>
    <article><h3>实际成品</h3><strong data-review="artifact-status"></strong><p data-review="artifact-facts"></p><p data-review="artifact-evidence"></p></article>
  </section>
  </details>
  <section id="taskPlanSummary" class="task-plan-summary" aria-live="polite">
    <div class="task-plan-heading"><span>当前方案</span><strong id="taskPlanTitle">等待选择参数</strong></div>
    <div class="task-plan-facts">
      <div><span>编码</span><strong id="taskPlanEncoder">—</strong></div>
      <div><span>速度倾向</span><strong id="taskPlanSpeed">—</strong></div>
      <div><span>质量 / 体积</span><strong id="taskPlanRate">—</strong></div>
      <div><span>输出</span><strong id="taskPlanOutput">—</strong></div>
    </div>
    <p id="taskPlanNote">检查方案后开始执行。</p>
    <div class="button-row task-plan-actions"><button type="button" id="taskLoadPreset" class="secondary">恢复推荐方案</button><button type="button" id="taskInspect" class="secondary">验证当前方案</button></div>
  </section>
  <fieldset id="taskEncoding" class="media-encoding-panel"><legend>核心视频方案</legend><p class="note media-decision-hint">不确定时直接保留推荐方案；其他参数按需展开。</p><div class="task-grid media-core-decision-grid">
  ${select('codec','编码格式',[['h264','H.264'],['h265','H.265 / HEVC'],['av1','AV1'],['h266','H.266 / VVC · 实验']])}${select('encoder','编码器',[['libx264','x264 · CPU']])}${select('preset','编码速度 preset',[['medium','medium']])}
  ${select('rateMode','码率控制',[['quality','固定质量 CRF / CQ'],['bitrate','目标码率'],['size','目标体积']])}${input('quality','质量值 CRF / CQ（通常越低越保真）','','23')}${input('bitrate','目标视频码率（bit/s）','4000000')}
  ${input('targetSize','目标成品体积','','500')}${select('sizeUnit','体积单位',[['MB','MB（十进制）'],['GB','GB（十进制）'],['MiB','MiB（二进制）'],['GiB','GiB（二进制）']])}${input('sizeReserve','体积余量（%）','','4')}${check('twoPass','整片两遍编码（x264 码率模式）')}${select('budgetPolicy','体积交付策略',[['best-effort','目标体积 · 允许偏差'],['strict-ceiling','严格字节上限 · 超限禁止保存']])}
  </div><p id="taskBudgetLedger" class="task-budget-ledger" role="status">复制流与附件成本未测量。</p><button type="button" id="taskMeasureBudget" class="secondary">测量源流与附件成本</button><button type="button" id="taskAuxiliaryPreflight" class="secondary">实测 FLAC / 裁切复制成本</button><p id="taskAuxiliaryPreflightStatus" role="status" class="note">可选 Windows Native 预编码观测；不改变正式体积预算，也不视为最终封装大小证明。</p><p id="taskVvcCapability" class="note" role="status"></p><details class="media-advanced-panel media-video-details"><summary>帧率、尺寸、码率边界与像素格式</summary><div class="task-grid">
  ${check('legacyFps','兼容旧 FFmpeg（使用 -vsync）')}
  ${input('maxrate','最大码率（bit/s）','编码器默认')}${input('bufsize','码率缓冲区（bit）','编码器默认')}
  ${select('fpsMode','帧率策略',[['auto','编码器自动'],['passthrough','保持源时间戳'],['cfr','恒定帧率 CFR'],['vfr','可变帧率 VFR']])}${input('fps','目标帧率','例如 24 或 24000/1001；留空保持')}${input('frames','输出总帧数上限','留空表示不限；设置后需关闭音频')}
  ${input('width','输出宽度','留空按比例计算')}${input('height','输出高度','留空按比例计算')}${select('scaleAlgorithm','缩放算法',[['lanczos','Lanczos'],['bicubic','Bicubic'],['bilinear','Bilinear'],['spline','Spline'],['neighbor','Nearest neighbor']])}
  ${select('pixelFormat','像素格式 / 位深',[['yuv420p','8-bit · 4:2:0'],['yuv420p10le','10-bit · 4:2:0'],['yuv444p','8-bit · 4:4:4'],['yuv444p10le','10-bit · 4:4:4']])}
  </div></details><details class="media-advanced-panel"><summary>画面处理、编码细节</summary><div class="task-grid">
  ${input('crop','裁切 宽:高:x:y','例如 1920:800:0:140')}${select('rotation','旋转',[['none','保持'],['clock','顺时针 90°'],['cclock','逆时针 90°'],['flip','180°']])}${select('deinterlace','去隔行',[['none','关闭'],['bwdif','BWDIF'],['yadif','YADIF']])}
  ${input('gop','关键帧间隔（帧）','编码器默认')}${input('bf','B 帧数量','编码器默认')}${input('refs','参考帧数量','编码器默认')}${input('threads','编码线程数','编码器默认')}
  ${input('codecParams','软件编码器专用参数','例如 aq-mode=2:rc-lookahead=20')}${input('profile','profile','编码器默认')}${input('level','level','编码器默认')}${input('tune','tune','编码器默认')}
  ${check('squarePixels','设为方形像素')}${check('denoise','降噪 hqdn3d')}${check('deband','去色带 deband')}${check('sharpen','锐化 unsharp')}
  </div><p>处理顺序：裁切 → 去隔行 → 缩放 → 旋转 → 画面滤镜 → 字幕 → 补齐偶数尺寸。编码器不支持的组合会明确报错。</p></details>
  <details id="taskNvencDetails" class="media-advanced-panel" hidden><summary>NVENC 详细设置</summary><fieldset id="taskNvenc"><div class="task-grid">${select('multipass','多阶段分析',[['fullres','全分辨率'],['qres','低分辨率'],['disabled','关闭']])}${input('lookahead','前瞻帧数 0–32','编码器默认')}${input('aqStrength','空间 AQ 强度 1–15','编码器默认')}${check('spatialAq','空间自适应量化')}${check('temporalAq','时间自适应量化')}</div></fieldset><p class="note">NVENC 多阶段分析属于逐帧码率控制，与整片两遍编码不同；空间 AQ 与时间 AQ 选择一种。目标体积不会通过截断视频来满足。</p></details></fieldset>
  <details class="media-advanced-panel media-track-panel"><summary>流选择与时间策略</summary><div class="task-grid">
  ${input('videoStreams','视频流','0、0,1 或 all','0')}${select('videoRange','视频时间轴',[['trim','按 IN / OUT 剪辑'],['full','保持完整视频']])}
  ${input('audioTrack','音频轨','all 或音频轨序号，从 0 开始','all')}${select('audioRange','音频时间轴',[['trim','按 IN / OUT 剪辑'],['full','保持完整音频']])}
  ${select('subtitleRange','软字幕时间轴',[['trim','按 IN / OUT 剪辑'],['full','保持完整软字幕']])}
  ${check('keepSubtitles','保留内封软字幕')}${check('keepAttachments','保留附件 / 字体')}${check('keepMetadata','保留元数据',true)}${check('keepChapters','保留章节')}</div>
  <div class="task-grid">${input('subtitleStreams','内封字幕选择','all 或字幕轨序号，例如 0,2','all')}${input('attachmentStreams','附件选择','all 或附件序号，例如 0,1','all')}</div>
  <p id="taskVideoStreamInfo">读取容器后显示可用视频流。视频流序号按 FFmpeg 的 v:N 顺序，从 0 开始。</p>
  <p>时间策略彼此独立：例如“视频按 IN/OUT、音频保持完整”会只剪视频。主动制造不同时长的流可能改变音画对应关系，这是显式任务语义，不会被自动修正。</p></details>
  <section id="taskOutputPolicy" class="media-output-policy">
    <div class="media-output-policy-heading"><span>共享出口</span><strong>音频与封装</strong><p>音频转换需手动选择。</p></div>
    <div class="task-grid media-output-core-grid">${select('audio','音频策略',[['copy','复制原音频'],['aac','转为 AAC'],['libopus','转为 Opus（需核心支持）'],['none','关闭音频']])}${select('outputContainer','成品容器',[['auto','Auto · 自动选择安全容器'],['keep','保持源容器（可用时）'],['mkv','MKV · Matroska'],['mp4','MP4 · MPEG-4']])}</div>
    <details class="media-output-audio-details media-advanced-panel"><summary>音频详细设置</summary>
      <div class="task-grid">${input('audioBitrate','每条输出音轨码率（bit/s）','','128000')}${select('audioChannels','输出声道',[['','保持源声道'],['1','单声道'],['2','双声道'],['6','5.1']])}${select('audioSampleRate','音频采样率',[['','编码器默认'],['48000','48000 Hz'],['44100','44100 Hz']])}</div>
    </details>
    <p id="taskAudioPlaybackWarning" class="media-audio-playback-warning" role="status" data-state="warning">注意：复制原音频只保留现有码流。尚未取得源音频 codec；读取视频参数后会显示更具体的播放兼容性提示。如果成品无声，可改为“转为 AAC”。</p>
    <p id="taskContainerDecision" class="note">执行检查后显示实际容器选择及原因。</p>
  </section>
  <details class="media-sample-panel"><summary>配置保存与短片试压比较</summary><div class="task-grid">${input('configName','配置名称','我的配置')}${select('savedConfig','已保存配置',[])}${input('sampleStart','试压起点','例如 3:57.250','0')}${input('sampleLength','试压长度（秒）','2–60','15')}</div><div class="button-row"><button type="button" id="taskStore" class="secondary">保存当前配置</button><button type="button" id="taskRestore" class="secondary">加载配置</button><button type="button" id="taskDelete" class="secondary">删除配置</button><button type="button" id="taskExportConfig" class="secondary">导出配置 JSON</button><label>导入配置 JSON<input type="file" id="taskImportConfig" accept="application/json,.json"></label><button type="button" id="taskSamples" class="secondary">比较三组短片</button></div><p class="note">质量模式比较质量值 ±2；码率模式比较码率 ±20%。片段体积外推不保证整片大小，建议选择运动或细节复杂的片段。原生短片可保存到设备后比较。</p><div id="taskSampleResults" aria-live="polite"></div></details>
    <p id="taskEstimate" class="note" aria-live="polite"></p>
  <section id="taskRunState" class="task-run-state" aria-live="polite">
    <div class="task-run-state-heading"><div><span>任务状态</span><strong id="taskStage">等待开始</strong></div><strong id="taskPercent">0%</strong></div>
    <progress id="taskProgress" max="1" value="0"></progress>
    <div class="task-progress-grid">
      <div><span>媒体进度</span><strong id="taskMediaTime">—</strong></div>
      <div><span>已用时间</span><strong id="taskElapsed">—</strong></div>
      <div><span>处理速度</span><strong id="taskSpeed">—</strong></div>
      <div><span>预计剩余</span><strong id="taskEta">尚未估计</strong></div>
    </div>
    <p id="taskStatus" role="status">未开始</p>
  </section>
  <section id="taskOutputVerification" class="media-output-verification" hidden aria-label="成品画质验证">
    <div class="media-output-verification-heading">
      <div><span>OUTPUT VERIFICATION</span><strong id="taskVerifyTitle">源帧 ↔ 转码成品</strong><p id="taskVerifyDescription">按时间位置映射，不按“第 N 帧”强行对应。用于检查转码后的实际画面变化。</p></div>
      <button type="button" id="taskVerifyFrames" class="secondary">提取对比帧</button>
    </div>
    <div class="media-output-verification-controls">
      <label>成品时间<input id="taskVerifyOutputTime" value="0:00" autocomplete="off"></label>
      <input id="taskVerifyOutputSlider" type="range" min="0" max="1" step="0.001" value="0" aria-label="成品画质验证时间">
      <span id="taskVerifyMapping">源 0:00 ↔ 成品 0:00</span>
    </div>
    <p id="taskVerifyTransformWarning" class="media-output-verification-warning" hidden>当前任务包含缩放、裁切、旋转或画面滤镜；比较结果会同时包含这些有意处理，不应全部归因于编码损失。</p>
    <div class="media-output-verification-grid">
      <article>
        <div><span id="taskVerifyReferenceLabel">源素材</span><strong id="taskVerifySourceTime">—</strong></div>
        <div class="media-output-verification-image-shell"><img id="taskVerifySourceImage" alt="源素材验证帧" tabindex="0" role="button" title="点击全屏比较参考帧与成品" hidden><span id="taskVerifySourcePlaceholder">等待提取</span></div>
      </article>
      <article>
        <div><span id="taskVerifyOutputLabel">转码成品</span><strong id="taskVerifyOutputFrameTime">—</strong></div>
        <div class="media-output-verification-image-shell"><img id="taskVerifyOutputImage" alt="成品验证帧" tabindex="0" role="button" title="点击全屏比较参考帧与成品" hidden><span id="taskVerifyOutputPlaceholder">等待提取</span></div>
      </article>
    </div>
    <p id="taskVerifyStatus" class="note">任务完成后可从任意时间点提取源帧与成品帧；点击任一图进入全屏中线滑块比较。</p>
  </section>
  <div class="button-row media-action-dock"><button type="submit" id="taskRun">开始硬字幕压制</button><button type="button" id="taskCancel" class="secondary" disabled>取消</button><button type="button" id="taskReport" class="secondary" disabled>导出任务报告</button><button type="button" id="taskSave" class="secondary" disabled>保存成品</button></div>
  <details class="task-technical-details"><summary>技术详情 · 实际 FFmpeg 命令</summary><pre id="taskCommand" class="task-command" aria-live="polite">等待检查设置。</pre></details>
  </form>`;
  const modeDock = document.querySelector('#studioModeDock');
  if (modeDock) modeDock.append(modeNav);
  else document.querySelector('#inputCard').before(modeNav);
  document.querySelector('#inputCard').after(section);
  // Initial disclosure depends on viewport only; refreshes/view switches never reset user choice.
  section.querySelector('#taskReviewDetails').open=window.matchMedia('(min-width: 821px)').matches;
  const form = section.querySelector('form'), get = name => form.elements.namedItem(name);
  const budgetTools=document.createElement('section');budgetTools.className='shared-budget-tools';budgetTools.id='taskBudgetTools';budgetTools.setAttribute('aria-label','完整文件预算');
  section.querySelector('#taskPlanSummary').after(budgetTools);
  budgetTools.append(section.querySelector('#taskBudgetLedger'),section.querySelector('#taskMeasureBudget'),section.querySelector('#taskAuxiliaryPreflight'),section.querySelector('#taskAuxiliaryPreflightStatus'));

  const modeButtons = [...modeNav.querySelectorAll('[data-media-mode]')];
  const strategyButtons = [...document.querySelectorAll('[data-hardsub-strategy]')];
  const manualMount = document.querySelector('#hardsubManualMount');
  const sharedOutputMount = document.querySelector('#sharedMediaOutputMount');
  const inputCard = document.querySelector('#inputCard');
  const productionDeck = document.querySelector('#hardsubControlDeck');
  const outputPolicy = section.querySelector('#taskOutputPolicy');
  const audioStreamPlan=mountAudioStreamPlan({container:outputPolicy,form,media:()=>hooks.mediaSnapshot?.(),sourceIdentity:()=>hooks.videoIdentity?.()});
  const outputPolicyAnchor = document.createComment('task-output-policy-home');
  outputPolicy?.before(outputPolicyAnchor);
  outputPolicy?.querySelectorAll('[name]').forEach(control => control.setAttribute('form','mediaTaskForm'));
  let hardsubStrategy = localStorage.getItem('hardsub-control-strategy-v1') === 'manual' ? 'manual' : 'guided';
  const qualityField = get('quality').closest('label');
  const qualityRange = document.createElement('input');
  qualityRange.type = 'range';
  qualityRange.className = 'media-inline-range';
  qualityRange.min = '1';
  qualityRange.max = '51';
  qualityRange.step = '1';
  qualityRange.value = get('quality').value;
  qualityRange.setAttribute('aria-label', '质量值滑块');
  qualityField.classList.add('media-range-field');
  qualityField.append(qualityRange);
  const syncQualityRange = () => {
    qualityRange.min = get('codec').value === 'h266' ? '0' : '1';
    qualityRange.max = ['av1','h266'].includes(get('codec').value) ? '63' : '51';
    const entered=Number(get('quality').value);
    const value = Math.max(Number(qualityRange.min), Math.min(Number(qualityRange.max), Number.isFinite(entered) ? entered : 1));
    get('quality').value = String(value);
    qualityRange.value = String(value);
    qualityRange.style.setProperty('--media-range-progress', ((value - Number(qualityRange.min)) / (Number(qualityRange.max) - Number(qualityRange.min)) * 100) + '%');
  };
  qualityRange.addEventListener('input', () => {
    get('quality').value = qualityRange.value;
    syncQualityRange();
    get('quality').dispatchEvent(new Event('input',{bubbles:true}));
  });
  get('quality').addEventListener('input', syncQualityRange);
  let budgetEvidence=null,budgetSourceIdentity='';
  let latestAuxPreflight=null;
  const buildAuditedTaskReport=(task,result,elapsed)=>{
    const report=outputReport(task,result,elapsed);
    if(latestAuxPreflight && result?.verified){
      report.auxiliaryParity=reconcileAuxiliaryMuxObservation({
        task,completed:result,preflight:latestAuxPreflight,
        currentSourceKey:hooks.videoIdentity?.()||''
      });
    }
    return report;
  };
  const completedByteLedgerMessage=report=>{
    const ledger=report?.completedMuxByteLedger;
    if(!ledger||ledger.status!=='completed-mux-byte-ledger')return '';
    return ' · 成品包账本：视频 '+formatSize(ledger.videoPacketBytes)+
      '，音频 '+formatSize(ledger.audioPacketBytes)+
      '，字幕 '+formatSize(ledger.subtitlePacketBytes)+
      '，其他数据与封装 '+formatSize(ledger.otherAndMuxBytes)+
      '（不等于纯封装开销，不可外推下次预算）';
  };
  const auxiliaryParityMessage=report=>{
    const pair=report?.auxiliaryParity;
    if(!pair)return '';
    if(!pair.comparable)return ' · 逐流预演/成品对照不可用：'+pair.reason;
    const diff=pair.deltaBytes;
    return ' · 本次辅助流预演/成品包字节'+
      (diff===0?'一致':('差 '+(diff>0?'+':'')+diff+' B'))+
      '（仅供审计，不进入下次体积预算）';
  };
  let busy = false, completed = null, completedStale = false, lastReport = null, sampleUrls=[], taskStartedAt=0, activeTask=null;
  let currentPlanTask=null,artifactReview=null,executingSourceName='',reviewSourceIdentity=hooks.videoIdentity?.()||'';
  function syncTaskReview(){
    const media=hooks.mediaSnapshot?.()||null;
    const model=buildTaskReview({media,hasSource:!!hooks.videoIdentity?.(),task:currentPlanTask,artifact:artifactReview,stale:completedStale,state:section.dataset.taskState});
    renderTaskReview(section.querySelector('#taskObjectReview'),model);
    section.querySelector('#taskReviewSourceName').textContent=hooks.sourceName?.()||'';
  }
  const clips=[],clipList=section.querySelector('#taskClipQueueList');
  const clipPanel=section.querySelector('#taskClipQueuePanel');
  const clipMessage=section.querySelector('#taskClipQueueStatus');
  let clipSourceKey='',clipBatchRunning=false,clipBatchStopRequested=false,clipBatchCurrent=null,clipAwaitingSave=null,clipEditingIndex=-1;
  const recipes=[],recipeList=section.querySelector('#taskRecipeMatrixList');
  const recipeMessage=section.querySelector('#taskRecipeMatrixStatus');
  let recipeSourceKey='',recipeBatchRunning=false,recipeStopRequested=false,recipeCurrent=null,recipePendingSave=null,recipeSequence=0;
  const recipeSource=()=>hooks.videoIdentity?.()||'';
  const recipeAsset=()=>hooks.recipeAssetIdentity?.()||'';
  const syncRecipeMatrix=()=>{
    const source=recipeSource();
    const stale=!!recipeSourceKey&&recipeSourceKey!==source;
    const locked=busy||hooks.busy()||clipBatchRunning||recipeBatchRunning||section.dataset.taskState==='saving';
    recipeList.replaceChildren();
    recipes.forEach((entry,index)=>{
      const row=document.createElement('li');
      const description=document.createElement('div');
      const heading=document.createElement('strong');heading.textContent=entry.recipe.label;
      const detail=document.createElement('span');
      detail.textContent=entry.recipe.task.operation+' · '+(entry.recipe.task.encoder||'copy')+
        ' · '+String(entry.recipe.task.outputContainer||'mkv').toUpperCase();
      const progress=document.createElement('small');
      progress.textContent={queued:'待执行',running:'执行中',saving:'正在保存',saved:'已保存',
        failed:'执行失败，可重试',save_failed:'成品已验证，待重试保存'}[entry.state]||entry.state;
      description.append(heading,detail,progress);
      const action=document.createElement('button');action.type='button';action.className='secondary';
      action.dataset.recipeIndex=String(index);
      action.dataset.recipeAction=recipePendingSave===entry?'retry-save':'remove';
      action.textContent=recipePendingSave===entry?'重试保存':'删除';
      action.disabled=locked||(!!recipePendingSave&&recipePendingSave!==entry);
      row.append(description,action);recipeList.append(row);
    });
    section.querySelector('#taskAddRecipe').disabled=locked||!!recipePendingSave||
      !source||!hooks.mediaSnapshot?.()||recipes.length>=12||stale;
    section.querySelector('#taskClearRecipes').disabled=locked||!!recipePendingSave||!recipes.length;
    section.querySelector('#taskRunRecipes').disabled=locked||!!recipePendingSave||stale||
      !source||!recipes.some(r=>r.state!=='saved');
    section.querySelector('#taskStopRecipes').hidden=!recipeBatchRunning;
    section.querySelector('#taskStopRecipes').disabled=!recipeBatchRunning||recipeStopRequested;
    if(stale)recipeMessage.textContent='来源已变化；不能执行旧来源的方案。请清空后重新添加。';
  };
  const settlePendingRecipeSave=saved=>{
    if(!recipePendingSave)return;
    const entry=recipePendingSave;
    entry.state=saved?'saved':'save_failed';
    if(saved)recipePendingSave=null;
    recipeMessage.textContent=saved?'上一方案成品已保存，可以继续执行剩余方案。':
      '上一方案成品未保存；只重试保存，不要重新编码。';
    syncRecipeMatrix();
  };
  section.querySelector('#taskAddRecipe').onclick=()=>{
    try{
      if(busy||hooks.busy()||recipeBatchRunning||clipBatchRunning||clipAwaitingSave||recipePendingSave)
        throw Error('请先完成当前任务或保存上一个成品');
      const source=recipeSource(),media=hooks.mediaSnapshot?.(),asset=recipeAsset();
      if(!source||!media)throw Error('请先选择视频并读取视频参数');
      if(recipeSourceKey&&recipeSourceKey!==source)throw Error('视频已变化，请清空旧方案矩阵');
      const raw=read();
      const task=compileTask({...raw,
        budgetPolicy:raw.operation!=='copy'&&raw.rateMode==='size'?raw.budgetPolicy:'best-effort'
      },{...media,budgetEvidence:budgetSourceIdentity===source?budgetEvidence:undefined});
      // A queued executable hardsub task cannot silently borrow another ASS/font.
      if(task.operation==='hardsub'&&recipes.some(entry=>
        entry.recipe.task.operation==='hardsub'&&entry.recipe.assetKey!==asset))
        throw Error('矩阵已有其他字幕／字体版本；先清空或执行原方案');
      const label={
        hardsub:'硬字幕',transcode:'纯转码',copy:'Stream Copy'
      }[task.operation]+' · '+(task.codec||'原码流')+' · 方案 '+(recipes.length+1);
      const recipe=createOutputRecipe({task,media,sourceKey:source,assetKey:asset,
        name:label,index:++recipeSequence});
      recipeSourceKey=source;
      recipes.push({recipe,state:'queued'});
      recipeMessage.textContent='已冻结 '+recipes.length+' 个正式任务，执行时不会读取当前表单中的新参数。';
      syncRecipeMatrix();
    }catch(error){recipeMessage.textContent='方案未加入：'+error.message;}
  };
  recipeList.addEventListener('click',event=>{
    if(busy||recipeBatchRunning||hooks.busy())return;
    const button=event.target.closest('button[data-recipe-action]');
    if(!button)return;
    const index=Number(button.dataset.recipeIndex),entry=recipes[index];
    if(!entry)return;
    if(button.dataset.recipeAction==='retry-save'){
      if(entry===recipePendingSave)section.querySelector('#taskSave').click();
      return;
    }
    if(recipePendingSave)return;
    recipes.splice(index,1);
    if(!recipes.length)recipeSourceKey='';
    recipeMessage.textContent=recipes.length?'已删除方案。':'矩阵已清空。';
    syncRecipeMatrix();
  });
  section.querySelector('#taskClearRecipes').onclick=()=>{
    if(busy||hooks.busy()||recipeBatchRunning||recipePendingSave)return;
    recipes.length=0;recipeSourceKey='';
    recipeMessage.textContent='矩阵已清空；其他输出方案不受影响。';
    syncRecipeMatrix();
  };

  const clipSource=()=>hooks.videoIdentity?.()||'';
  const clipMedia=()=>hooks.mediaSnapshot?.()||null;
  const showClipMessage=text=>{clipMessage.textContent=text;};
  const syncClipQueue=()=>{
    const copy=get('operation').value==='copy',locked=clipBatchRunning||busy||hooks.busy()||section.dataset.taskState==='saving';
    clipPanel.hidden=!copy;
    clipList.replaceChildren();
    clips.forEach((clip,index)=>{
      const item=document.createElement('li');
      item.classList.toggle('media-clip-queue-row-editing',index===clipEditingIndex);
      const description=document.createElement('div');
      const title=document.createElement('strong');
      title.textContent='片段 '+String(index+1).padStart(2,'0');
      const range=document.createElement('span');
      range.textContent=clip.startText+' → '+clip.endText+' · '+clip.duration.toFixed(2)+' 秒';
      const state=document.createElement('small');
      state.textContent={queued:'待导出',running:'处理中',saving:'正在保存',saved:'已导出',save_failed:'待重试保存',failed:'失败'}[clip.state]||'待导出';
      description.append(title,range,state);
      const use=document.createElement('button');
      use.type='button';use.className='secondary';
      use.textContent=clipAwaitingSave===clip?'重试保存':clip.state==='saved'?'复用':'编辑';
      use.dataset.clipAction=clipAwaitingSave===clip?'retry-save':clip.state==='saved'?'reuse':'edit';
      use.dataset.clipIndex=String(index);
      use.setAttribute('aria-label',use.textContent+'片段 '+(index+1));
      use.disabled=locked||(!!clipAwaitingSave&&clipAwaitingSave!==clip);
      const del=document.createElement('button');
      del.type='button';del.className='secondary';del.textContent='删除';
      del.dataset.clipAction='remove';del.dataset.clipIndex=String(index);del.disabled=locked||!!clipAwaitingSave;
      del.setAttribute('aria-label','删除片段 '+(index+1));
      item.append(description,use,del);clipList.append(item);
    });
    section.querySelector('#taskAddClip').textContent=clipEditingIndex>=0?'更新片段':'加入片段';
    section.querySelector('#taskAddClip').disabled=locked||!!clipAwaitingSave||!clipSource()||!clipMedia()||(clips.length>=50&&clipEditingIndex<0);
    section.querySelector('#taskCancelClipEdit').hidden=clipEditingIndex<0;
    section.querySelector('#taskCancelClipEdit').disabled=locked||!!clipAwaitingSave;
    section.querySelector('#taskExportClips').disabled=locked||!!clipAwaitingSave||clipEditingIndex>=0||!clips.some(c=>c.state!=='saved')||!clipSource()||!clipMedia();
    section.querySelector('#taskClearClips').disabled=locked||!!clipAwaitingSave||!clips.length;
    section.querySelector('#taskStopClips').hidden=!clipBatchRunning;
    section.querySelector('#taskStopClips').disabled=!clipBatchRunning||clipBatchStopRequested;
    section.querySelector('#taskExportClips').textContent=clips.some(c=>c.state==='saved')?'导出剩余':'导出全部';
  };
  const clearClipQueueOnSourceChange=()=>{
    if(!clips.length||clipBatchRunning||clipAwaitingSave)return;
    const key=clipSource();
    if(key===clipSourceKey)return;
    clips.length=0;clipSourceKey='';clipEditingIndex=-1;
    showClipMessage('视频已更换，旧视频的片段列表已清空。');
  };
  const settlePendingClipSave=(saved)=>{
    if(!clipAwaitingSave)return;
    const clip=clipAwaitingSave;
    clip.state=saved?'saved':'save_failed';
    if(saved){
      clipAwaitingSave=null;
      showClipMessage('片段成品已保存；可以继续导出剩余片段。');
      clearClipQueueOnSourceChange();
    }else{
      showClipMessage('成品仍保留，点击对应片段“重试保存”，不必重新剪切。');
    }
    syncClipQueue();
  };
  section.querySelector('#taskCancelClipEdit').onclick=()=>{
    if(clipBatchRunning||busy||hooks.busy()||clipAwaitingSave)return;
    clipEditingIndex=-1;
    showClipMessage('已取消编辑；当前 IN / OUT 可作为新片段加入。');
    syncClipQueue();
  };
  section.querySelector('#taskAddClip').onclick=()=>{
    try{
      if(busy||hooks.busy())return;
      const source=clipSource(),media=clipMedia();
      if(!source||!media)throw Error('先选择视频并读取视频参数');
      if(clipAwaitingSave)throw Error('请先重试保存上一片段的成品');
      validateQueuedCopySettings(read());
      const clip=makeQueuedClip(get('start').value,get('end').value,media);
      if(clipSourceKey&&clipSourceKey!==source)throw Error('视频已更换，请重新建立片段列表');
      const editing=clipEditingIndex;
      if(clips.some((c,index)=>index!==editing&&c.start===clip.start&&c.end===clip.end))
        throw Error('这个 IN / OUT 片段已经加入');
      if(editing>=0){
        if(!clips[editing]||clips[editing].state==='saved')throw Error('已导出的片段不可原位修改，请使用“复用”创建新片段');
        clips[editing]={...clip,state:'queued'};
        clipEditingIndex=-1;
        showClipMessage('片段 '+(editing+1)+' 已更新，导出时将使用新的 IN / OUT。');
      }else{
        if(clips.length>=50)throw Error('单次最多加入 50 个片段');
        clipSourceKey=source;clips.push({...clip,state:'queued'});
        showClipMessage('已加入 '+clips.length+' 段。每段将单独保存；无损实际 IN 可能前移到关键帧。');
      }
      syncClipQueue();
    }catch(err){showClipMessage(err.message);}
  };
  clipList.addEventListener('click',event=>{
    if(clipBatchRunning||busy||hooks.busy())return;
    const btn=event.target.closest('button[data-clip-action]');
    if(!btn)return;
    const index=Number(btn.dataset.clipIndex),clip=clips[index];
    if(!clip)return;
    if(btn.dataset.clipAction==='retry-save'){
      if(clipAwaitingSave===clip)section.querySelector('#taskSave').click();
      return;
    }
    if(clipAwaitingSave)return;
    if(btn.dataset.clipAction==='remove'){
      clips.splice(index,1);
      if(clipEditingIndex===index)clipEditingIndex=-1;
      else if(clipEditingIndex>index)clipEditingIndex--;
      if(!clips.length)clipSourceKey='';
      showClipMessage(clips.length?'已删除片段。':'队列已清空；可继续单段剪切。');
      syncClipQueue();return;
    }
    clipEditingIndex=btn.dataset.clipAction==='edit'?index:-1;
    get('start').value=clip.startText;get('end').value=clip.endText;
    for(const field of [get('start'),get('end')])field.dispatchEvent(new Event('change',{bubbles:true}));
    showClipMessage(clipEditingIndex>=0
      ?'正在编辑片段 '+(index+1)+'，修改 IN / OUT 后点击“更新片段”，或取消编辑。'
      :'已复用片段 '+(index+1)+' 的时间范围；可修改后作为新片段加入，不会修改已导出的文件。');
    syncClipQueue();
  });
  section.querySelector('#taskClearClips').onclick=()=>{
    if(clipBatchRunning||busy||hooks.busy()||clipAwaitingSave)return;
    clips.length=0;clipSourceKey='';clipEditingIndex=-1;
    showClipMessage('队列已清空；现有单段剪切仍可使用。');
    syncClipQueue();
  };
  let waveformUrl=null,waveformDuration=0,waveformCursor=0,waveformDragging=null,waveformScrubbing=false;
  let timelineKeyframes=[],timelineKeyframesTruncated=false;
  let timelineSourceKey='',timelineVideoOrdinal=-1;
  let timelineFrameTimer=null,timelineFrameRequestSeq=0,boundaryFrameTimer=null,boundaryFrameRequestSeq=0,lastBoundaryPreviewKey='',timelineFrameGeneration=0;
  const timelineFrameCache=new Map();
  const timelineFramePending=new Map();
  let timelineFrameFetchQueue=Promise.resolve();
  const storageKey='media-workspace-configs-v2';
  const download=(data,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const configs=()=>{try{return JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{return {};}};
  const refreshConfigs=()=>{get('savedConfig').innerHTML=Object.keys(configs()).map(n=>`<option value="${escape(n)}">${escape(n)}</option>`).join('');};
  const applyConfig=raw=>{if(raw.codec==='h266'&&!vvcCapability(hooks.platformKey?.()||{}).available)throw Error('当前平台未通过 H.266 运行探测，不能导入此编码配置');markCompletedAsPrevious('config');for(const key of ['operation','codec'])if(get(key)&&raw[key]!=null)get(key).value=raw[key];updateEncoder();if(raw.encoder){if(![...get('encoder').options].some(o=>o.value===raw.encoder))throw Error('当前平台不支持配置中的编码器 '+raw.encoder+'；请手动选择编码器');get('encoder').value=raw.encoder;}updatePreset();for(const [key,value] of Object.entries(raw)){const el=get(key);if(!el||['savedConfig','configName'].includes(key))continue;if(el.type==='checkbox')el.checked=value===true;else if(el.tagName==='SELECT'){if([...el.options].some(o=>o.value===String(value)))el.value=String(value);}else el.value=key==='audioPlan'&&Array.isArray(value)?JSON.stringify(value):String(value??'');}lastManualCodec=get('codec').value;updateMode();updateRate();syncQualityRange();audioStreamPlan.refresh();hooks.onBudgetEvidenceChange?.();};
  const status = text => { section.querySelector('#taskStatus').textContent = text; };
  const read = () => Object.fromEntries([...form.elements].filter(x=>x.name).map(x=>[x.name,x.type==='checkbox'?x.checked:x.value]));
  const windows = () => hooks.isWindows();
  const transcodeCurves = mountTranscodeCurves(section, {
    settings: read,
    busy: hooks.busy,
    isWindows: hooks.isWindows,
    sourceIdentity: () => hooks.videoIdentity?.() || '',
    prepare: hooks.prepare,
    validate: hooks.validate,
    calibrationSample: hooks.calibrationSample,
    budgetEvidence:()=>budgetSourceIdentity===hooks.videoIdentity?.()?budgetEvidence:null,
    setBusy: hooks.setBusy,
    log: hooks.log,
    applySizeBudget:({budget,expectedSettings,expectedSourceIdentity,media})=>{
      const result=commitVerifiedSizeBudget({budget,expectedSettings,expectedSourceIdentity,read,sourceIdentity:()=>hooks.videoIdentity?.()||'',get,updateRate,compile:compileTask,media:{...media,budgetEvidence:budgetSourceIdentity===hooks.videoIdentity?.()?budgetEvidence:undefined}});
      if(result.ok)get('targetSize').dispatchEvent(new Event('input',{bubbles:true}));
      return result;
    },
    applyBitrate: bitrate => {
      markCompletedAsPrevious('bitrate');
      get('rateMode').value = 'bitrate';
      get('bitrate').value = String(bitrate);
      updateRate();
      get('bitrate').dispatchEvent(new Event('input',{bubbles:true}));
    },
    applyQuality: quality => {
      markCompletedAsPrevious('quality');
      get('rateMode').value = 'quality';
      get('quality').value = String(quality);
      syncQualityRange();
      updateRate();
      get('quality').dispatchEvent(new Event('input',{bubbles:true}));
    },
    adoptCandidate: ({candidate,bitrate,wholeBudget,expectedSettings,expectedSourceIdentity,media})=>{
      const committed=commitVerifiedManualCandidate({
        candidate,bitrate,wholeBudget,expectedSettings,expectedSourceIdentity,
        read,sourceIdentity:()=>hooks.videoIdentity?.()||'',get,
        updateEncoder,updatePreset,updateRate,compile:compileTask,media:{...media,budgetEvidence:budgetSourceIdentity===hooks.videoIdentity?.()?budgetEvidence:undefined}
      });
      if(!committed.ok)return committed;
      // Exactly one coherent event after all form fields have been committed:
      // the existing plan/candidate invalidation happens only now.
      get('bitrate').dispatchEvent(new Event('input',{bubbles:true}));
      return committed;
    }
  });

  const formatTaskClock = seconds => {
    const value=Math.max(0,Number(seconds)||0),whole=Math.floor(value),h=Math.floor(whole/3600),m=Math.floor((whole%3600)/60),s=whole%60;
    return h ? h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0') : m+':'+String(s).padStart(2,'0');
  };
  const timeLabels={start:'开始时间',end:'结束时间',sampleStart:'试压起点'};
  const normalizeTimeControl=(name,allowEmpty=false)=>{
    const el=get(name);if(!el)return true;
    const raw=String(el.value||'').trim();
    if(!raw&&allowEmpty){el.setCustomValidity('');syncWaveformMarkers();return true;}
    try{
      const seconds=parseMediaTime(raw,{empty:allowEmpty?undefined:0,label:timeLabels[name]||'时间'});
      el.value=formatMediaTimeInput(seconds,3);
      el.setCustomValidity('');
      syncWaveformMarkers();
      return true;
    }catch(error){
      el.setCustomValidity(error.message);
      return false;
    }
  };
  for(const [name,allowEmpty] of [['start',false],['end',true],['sampleStart',false]]){
    const el=get(name);
    el?.addEventListener('blur',()=>normalizeTimeControl(name,allowEmpty));
    el?.addEventListener('input',()=>{el.setCustomValidity('');if(name!=='sampleStart')syncWaveformMarkers();});
  }
  const waveformPanel=section.querySelector('#taskWaveformPanel');
  const waveformScroll=section.querySelector('#taskWaveformScroll');
  const waveformTrack=section.querySelector('#taskWaveformTrack');
  const waveformImage=section.querySelector('#taskWaveformImage');
  const waveformPlaceholder=section.querySelector('#taskWaveformPlaceholder');
  const waveformStatus=section.querySelector('#taskWaveformStatus');
  const waveformCursorEl=section.querySelector('#taskWaveformCursor');
  const waveformCursorTime=section.querySelector('#taskWaveformCursorTime');
  const waveformStartEl=section.querySelector('#taskWaveformStart');
  const waveformEndEl=section.querySelector('#taskWaveformEnd');
  const waveformSelection=section.querySelector('#taskWaveformSelection');
  const waveformRuler=section.querySelector('#taskWaveformRuler');
  const keyframeLane=section.querySelector('#taskKeyframeLane');
  const actualStartEl=section.querySelector('#taskWaveformActualStart');
  const copyBoundaryInfo=section.querySelector('#taskCopyBoundaryInfo');
  const requestedStartTime=section.querySelector('#taskRequestedStartTime');
  const actualStartTime=section.querySelector('#taskActualStartTime');
  const keyframeDelta=section.querySelector('#taskKeyframeDelta');
  const cutStrategyPanel=section.querySelector('#taskCopyStrategyPanel');
  const cutStrategyStatus=section.querySelector('#taskCopyStrategyStatus');
  const cutStrategyDescription=section.querySelector('#taskCopyStrategyDescription');
  const preferTranscodeTrim=section.querySelector('#taskPreferTranscodeTrim');
  const keyframePrev=section.querySelector('#taskKeyframePrev');
  const keyframeNext=section.querySelector('#taskKeyframeNext');
  const keyframeSnapStart=section.querySelector('#taskKeyframeSnapStart');
  const waveformZoom=section.querySelector('#taskWaveformZoom');
  const framePreviewPanel=section.querySelector('#taskFramePreviewPanel');
  const framePreviewImage=section.querySelector('#taskFramePreviewImage');
  const framePreviewPlaceholder=section.querySelector('#taskFramePreviewPlaceholder');
  const framePreviewStatus=section.querySelector('#taskFramePreviewStatus');
  const framePreviewTime=section.querySelector('#taskFramePreviewTime');
  const boundaryFrameInspector=section.querySelector('#taskBoundaryFrameInspector');
  const requestedFrameImage=section.querySelector('#taskRequestedFrameImage');
  const actualFrameImage=section.querySelector('#taskActualFrameImage');
  const requestedFramePlaceholder=section.querySelector('#taskRequestedFramePlaceholder');
  const actualFramePlaceholder=section.querySelector('#taskActualFramePlaceholder');
  const requestedFrameTime=section.querySelector('#taskRequestedFrameTime');
  const actualFrameTime=section.querySelector('#taskActualFrameTime');
  const frameFullscreen=section.querySelector('#taskFrameFullscreen');
  const frameFullscreenShell=frameFullscreen.querySelector('.media-frame-lightbox-shell');
  const frameFullscreenTitle=section.querySelector('#taskFrameFullscreenTitle');
  const frameFullscreenMeta=section.querySelector('#taskFrameFullscreenMeta');
  const frameFullscreenStage=section.querySelector('#taskFrameFullscreenStage');
  const frameFullscreenBaseLayer=section.querySelector('#taskFrameFullscreenBaseLayer');
  const frameFullscreenCompareLayer=section.querySelector('#taskFrameFullscreenCompareLayer');
  const frameFullscreenBase=section.querySelector('#taskFrameFullscreenBase');
  const frameFullscreenCompare=section.querySelector('#taskFrameFullscreenCompare');
  const frameFullscreenDivider=section.querySelector('#taskFrameFullscreenDivider');
  const frameFullscreenLeftLabel=section.querySelector('#taskFrameFullscreenLeftLabel');
  const frameFullscreenRightLabel=section.querySelector('#taskFrameFullscreenRightLabel');
  const frameFullscreenControls=section.querySelector('#taskFrameFullscreenControls');
  const frameFullscreenWipe=section.querySelector('#taskFrameFullscreenWipe');
  const frameFullscreenReset=section.querySelector('#taskFrameFullscreenReset');
  const frameFullscreenViewportControls=section.querySelector('#taskFrameFullscreenViewportControls');
  const frameFullscreenZoomButtons=[...frameFullscreenViewportControls.querySelectorAll('[data-frame-zoom]')];
  const frameFullscreenZoomStatus=section.querySelector('#taskFrameFullscreenZoomStatus');
  const frameFullscreenClose=section.querySelector('#taskFrameFullscreenClose');
  const outputVerification=section.querySelector('#taskOutputVerification');
  const verifyFramesButton=section.querySelector('#taskVerifyFrames');
  const verifyTitle=section.querySelector('#taskVerifyTitle');
  const verifyDescription=section.querySelector('#taskVerifyDescription');
  const verifyReferenceLabel=section.querySelector('#taskVerifyReferenceLabel');
  const verifyOutputLabel=section.querySelector('#taskVerifyOutputLabel');
  const verifyOutputTime=section.querySelector('#taskVerifyOutputTime');
  const verifyOutputSlider=section.querySelector('#taskVerifyOutputSlider');
  const verifyMapping=section.querySelector('#taskVerifyMapping');
  const verifyTransformWarning=section.querySelector('#taskVerifyTransformWarning');
  const verifySourceImage=section.querySelector('#taskVerifySourceImage');
  const verifyOutputImage=section.querySelector('#taskVerifyOutputImage');
  const verifySourcePlaceholder=section.querySelector('#taskVerifySourcePlaceholder');
  const verifyOutputPlaceholder=section.querySelector('#taskVerifyOutputPlaceholder');
  const verifySourceTime=section.querySelector('#taskVerifySourceTime');
  const verifyOutputFrameTime=section.querySelector('#taskVerifyOutputFrameTime');
  const verifyStatus=section.querySelector('#taskVerifyStatus');
  let verificationSourceUrl=null,verificationOutputUrl=null,verificationFrameSourceTime=null,verificationFrameOutputTime=null;
  let frameFullscreenMode='single';
  let frameFullscreenGesture=null;
  let frameFullscreenZoomMode='fit';
  let frameFullscreenScale=1;
  let frameFullscreenPanX=0;
  let frameFullscreenPanY=0;
  let frameFullscreenPointerStart=null;
  const clampWaveformTime=value=>Math.max(0,Math.min(waveformDuration||0,Number(value)||0));
  function readBoundary(name,fallback){
    try{return clampWaveformTime(parseMediaTime(get(name)?.value,{empty:fallback,label:timeLabels[name]||'时间'}));}
    catch{return clampWaveformTime(fallback);}
  }
  const niceTimelineStep = raw => {
    const choices=[.1,.2,.5,1,2,5,10,15,30,60,120,300,600,900,1800,3600];
    return choices.find(value=>value>=raw)||choices.at(-1);
  };
  function renderTimelineRuler(){
    if(!(waveformDuration>0)){waveformRuler.replaceChildren();return;}
    const zoom=Math.max(1,Number(waveformZoom.value)||1);
    const step=niceTimelineStep(waveformDuration/Math.max(8,Math.min(80,12*zoom)));
    const frag=document.createDocumentFragment();
    for(let time=0,count=0;time<=waveformDuration+.0001&&count<160;time+=step,count++){
      const tick=document.createElement('span');
      tick.className='media-waveform-ruler-tick';
      tick.style.left=(time/waveformDuration*100)+'%';
      tick.innerHTML='<i></i><b>'+escape(formatMediaTimeInput(time,step<1?1:0))+'</b>';
      frag.append(tick);
    }
    waveformRuler.replaceChildren(frag);
  }
  const previousKeyframe = value => {
    if(timelineSourceKey!==(hooks.videoIdentity?.()||'')||timelineVideoOrdinal!==primaryVideoStream())return null;
    const time=clampWaveformTime(value);
    if(timelineKeyframesTruncated&&timelineKeyframes.length&&time>timelineKeyframes.at(-1)+.000001)return null;
    let previous=null;
    for(const key of timelineKeyframes){if(key>time+.000001)break;previous=key;}
    return previous;
  };
  const nextKeyframe = value => {
    const time=clampWaveformTime(value);
    return timelineKeyframes.find(key=>key>time+.000001) ?? null;
  };
  function setFrameFullscreenWipe(value){
    const percent=Math.max(0,Math.min(100,Number(value)||0));
    frameFullscreenWipe.value=String(Math.round(percent));
    frameFullscreenCompareLayer.style.clipPath='inset(0 '+(100-percent)+'% 0 0)';
    frameFullscreenDivider.style.left=percent+'%';
  }
  function frameFullscreenMetrics(){
    const rect=frameFullscreenStage.getBoundingClientRect();
    const naturalWidth=Number(frameFullscreenBase.naturalWidth||frameFullscreenCompare.naturalWidth||0);
    const naturalHeight=Number(frameFullscreenBase.naturalHeight||frameFullscreenCompare.naturalHeight||0);
    if(!(rect.width>0&&rect.height>0&&naturalWidth>0&&naturalHeight>0))return null;
    const containScale=Math.min(rect.width/naturalWidth,rect.height/naturalHeight);
    return {
      rect,naturalWidth,naturalHeight,containScale,
      containWidth:naturalWidth*containScale,
      containHeight:naturalHeight*containScale
    };
  }
  function syncFrameFullscreenZoomChrome(){
    for(const button of frameFullscreenZoomButtons){
      button.setAttribute('aria-pressed',String(button.dataset.frameZoom===frameFullscreenZoomMode));
    }
    const metrics=frameFullscreenMetrics();
    if(frameFullscreenZoomMode==='fit'){
      frameFullscreenZoomStatus.textContent='Fit';
    }else if(/^\d+$/.test(frameFullscreenZoomMode)){
      frameFullscreenZoomStatus.textContent=frameFullscreenZoomMode+'%';
    }else if(metrics){
      frameFullscreenZoomStatus.textContent=Math.round(frameFullscreenScale*metrics.containScale*100)+'%';
    }else{
      frameFullscreenZoomStatus.textContent='—';
    }
  }
  function resolveFrameFullscreenPresetScale(){
    const metrics=frameFullscreenMetrics();
    if(!metrics)return frameFullscreenScale||1;
    if(frameFullscreenZoomMode==='fit')return 1;
    if(/^\d+$/.test(frameFullscreenZoomMode)){
      return (Number(frameFullscreenZoomMode)/100)/metrics.containScale;
    }
    return frameFullscreenScale||1;
  }
  function applyFrameFullscreenViewport(){
    const metrics=frameFullscreenMetrics();
    if(!metrics){syncFrameFullscreenZoomChrome();return;}
    if(frameFullscreenZoomMode!=='custom')frameFullscreenScale=resolveFrameFullscreenPresetScale();
    frameFullscreenScale=Math.max(.08,Math.min(20,frameFullscreenScale||1));
    const contentWidth=metrics.containWidth*frameFullscreenScale;
    const contentHeight=metrics.containHeight*frameFullscreenScale;
    const maxPanX=Math.max(0,(contentWidth-metrics.rect.width)/2);
    const maxPanY=Math.max(0,(contentHeight-metrics.rect.height)/2);
    frameFullscreenPanX=Math.max(-maxPanX,Math.min(maxPanX,frameFullscreenPanX));
    frameFullscreenPanY=Math.max(-maxPanY,Math.min(maxPanY,frameFullscreenPanY));
    const width=metrics.containWidth+'px';
    const height=metrics.containHeight+'px';
    const leftMargin=(-metrics.containWidth/2)+'px';
    const topMargin=(-metrics.containHeight/2)+'px';
    const transform='translate3d('+frameFullscreenPanX+'px,'+frameFullscreenPanY+'px,0) scale('+frameFullscreenScale+')';
    for(const image of [frameFullscreenBase,frameFullscreenCompare]){
      image.style.width=width;
      image.style.height=height;
      image.style.left='50%';
      image.style.top='50%';
      image.style.marginLeft=leftMargin;
      image.style.marginTop=topMargin;
      image.style.transform=transform;
    }
    frameFullscreenStage.dataset.zoomed=String(frameFullscreenScale>1.001||Math.abs(frameFullscreenPanX)>.5||Math.abs(frameFullscreenPanY)>.5);
    syncFrameFullscreenZoomChrome();
  }
  function setFrameFullscreenZoomPreset(mode){
    frameFullscreenZoomMode=String(mode||'fit');
    frameFullscreenPanX=0;
    frameFullscreenPanY=0;
    frameFullscreenScale=resolveFrameFullscreenPresetScale();
    applyFrameFullscreenViewport();
  }
  function resetFrameFullscreenViewport(){
    frameFullscreenZoomMode='fit';
    frameFullscreenScale=1;
    frameFullscreenPanX=0;
    frameFullscreenPanY=0;
    applyFrameFullscreenViewport();
  }
  function closeFrameFullscreen(){
    if(frameFullscreen.hidden)return;
    frameFullscreen.hidden=true;
    frameFullscreenGesture=null;
    frameFullscreenPointerStart=null;
    document.body.classList.remove('media-frame-lightbox-open');
    frameFullscreenBase.removeAttribute('src');
    frameFullscreenCompare.removeAttribute('src');
    frameFullscreenCompareLayer.hidden=true;
    delete frameFullscreenStage.dataset.mode;
    delete frameFullscreenStage.dataset.gesture;
    delete frameFullscreenStage.dataset.zoomed;
  }
  function prepareFrameFullscreenView(){
    frameFullscreen.hidden=false;
    frameFullscreenStage.dataset.mode=frameFullscreenMode;
    document.body.classList.add('media-frame-lightbox-open');
    frameFullscreenCompareLayer.hidden=frameFullscreenMode!=='compare';
    frameFullscreenViewportControls.hidden=false;
    setFrameFullscreenWipe(50);
    resetFrameFullscreenViewport();
    requestAnimationFrame(()=>{
      applyFrameFullscreenViewport();
      frameFullscreenStage.focus({preventScroll:true});
    });
  }
  function openFrameFullscreen(kind){
    frameFullscreenControls.querySelector('span:first-child').textContent='请求 IN';
    frameFullscreenControls.querySelector('span:nth-of-type(2)').textContent='实际无损 IN';
    const compareReady=!requestedFrameImage.hidden&&!actualFrameImage.hidden&&requestedFrameImage.src&&actualFrameImage.src;
    const boundary=kind==='requested'||kind==='actual';
    frameFullscreenMode=boundary&&compareReady?'compare':'single';
    if(frameFullscreenMode==='compare'){
      frameFullscreenTitle.textContent='请求 IN ↔ 实际无损 IN';
      frameFullscreenMeta.textContent=(requestedFrameTime.textContent||'—')+' ↔ '+(actualFrameTime.textContent||'—');
      frameFullscreenBase.src=actualFrameImage.src;
      frameFullscreenBase.alt='实际无损 IN 全屏画面';
      frameFullscreenCompare.src=requestedFrameImage.src;
      frameFullscreenCompare.alt='请求 IN 全屏画面';
      frameFullscreenCompare.hidden=false;
      frameFullscreenDivider.hidden=false;
      frameFullscreenLeftLabel.hidden=false;
      frameFullscreenRightLabel.hidden=false;
      frameFullscreenControls.hidden=false;
      frameFullscreenLeftLabel.textContent='请求 IN · '+(requestedFrameTime.textContent||'—');
      frameFullscreenRightLabel.textContent='实际无损 IN · '+(actualFrameTime.textContent||'—');
    }else{
      const source=kind==='cursor'?framePreviewImage:(kind==='requested'?requestedFrameImage:actualFrameImage);
      const time=kind==='cursor'?framePreviewTime.textContent:(kind==='requested'?requestedFrameTime.textContent:actualFrameTime.textContent);
      frameFullscreenTitle.textContent=kind==='cursor'?'时间轴画面预览':kind==='requested'?'请求 IN':'实际无损 IN';
      frameFullscreenMeta.textContent=time||'—';
      frameFullscreenBase.src=source.src;
      frameFullscreenBase.alt=source.alt||'全屏画面预览';
      frameFullscreenCompare.hidden=true;
      frameFullscreenDivider.hidden=true;
      frameFullscreenLeftLabel.hidden=true;
      frameFullscreenRightLabel.hidden=true;
      frameFullscreenControls.hidden=true;
    }
    prepareFrameFullscreenView();
  }
  function updateFullscreenWipeFromPointer(event){
    if(frameFullscreenMode!=='compare')return;
    const rect=frameFullscreenStage.getBoundingClientRect();
    if(!(rect.width>0))return;
    setFrameFullscreenWipe((event.clientX-rect.left)/rect.width*100);
  }
  function frameFullscreenDividerDistance(event){
    const rect=frameFullscreenStage.getBoundingClientRect();
    const dividerX=rect.left+rect.width*(Number(frameFullscreenWipe.value)||0)/100;
    return Math.abs(event.clientX-dividerX);
  }
  for(const image of [framePreviewImage,requestedFrameImage,actualFrameImage]){
    image.addEventListener('click',()=>{if(!image.hidden&&image.src)openFrameFullscreen(image.dataset.frameFullscreen);});
    image.addEventListener('keydown',event=>{
      if((event.key==='Enter'||event.key===' ')&&!image.hidden&&image.src){
        event.preventDefault();
        openFrameFullscreen(image.dataset.frameFullscreen);
      }
    });
  }
  for(const image of [frameFullscreenBase,frameFullscreenCompare]){
    image.addEventListener('load',()=>{if(!frameFullscreen.hidden)requestAnimationFrame(applyFrameFullscreenViewport);});
  }
  for(const button of frameFullscreenZoomButtons){
    button.addEventListener('click',()=>setFrameFullscreenZoomPreset(button.dataset.frameZoom));
  }
  frameFullscreenClose.onclick=closeFrameFullscreen;
  frameFullscreenReset.onclick=()=>{setFrameFullscreenWipe(50);resetFrameFullscreenViewport();};
  frameFullscreenWipe.addEventListener('input',()=>setFrameFullscreenWipe(frameFullscreenWipe.value));
  frameFullscreenStage.addEventListener('dblclick',()=>{if(frameFullscreenMode==='compare')setFrameFullscreenWipe(50);});
  frameFullscreenStage.addEventListener('wheel',event=>{
    if(frameFullscreen.hidden)return;
    const metrics=frameFullscreenMetrics();
    if(!metrics)return;
    event.preventDefault();
    if(frameFullscreenZoomMode!=='custom')frameFullscreenScale=resolveFrameFullscreenPresetScale();
    const oldScale=Math.max(.08,frameFullscreenScale||1);
    const factor=Math.exp(-Math.max(-600,Math.min(600,event.deltaY))*.0015);
    const newScale=Math.max(.08,Math.min(20,oldScale*factor));
    const centerX=metrics.rect.left+metrics.rect.width/2;
    const centerY=metrics.rect.top+metrics.rect.height/2;
    const cursorX=event.clientX-centerX;
    const cursorY=event.clientY-centerY;
    const ratio=newScale/oldScale;
    frameFullscreenPanX=cursorX-ratio*(cursorX-frameFullscreenPanX);
    frameFullscreenPanY=cursorY-ratio*(cursorY-frameFullscreenPanY);
    frameFullscreenZoomMode='custom';
    frameFullscreenScale=newScale;
    applyFrameFullscreenViewport();
  },{passive:false});
  frameFullscreenStage.addEventListener('pointerdown',event=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;
    const compareHandle=frameFullscreenMode==='compare'&&frameFullscreenDividerDistance(event)<=28;
    frameFullscreenGesture=compareHandle?'wipe':'pan';
    frameFullscreenStage.dataset.gesture=frameFullscreenGesture;
    if(frameFullscreenGesture==='wipe'){
      updateFullscreenWipeFromPointer(event);
    }else{
      frameFullscreenPointerStart={
        x:event.clientX,y:event.clientY,
        panX:frameFullscreenPanX,panY:frameFullscreenPanY
      };
    }
    frameFullscreenStage.setPointerCapture?.(event.pointerId);
  });
  frameFullscreenStage.addEventListener('pointermove',event=>{
    if(frameFullscreenGesture==='wipe'){
      updateFullscreenWipeFromPointer(event);
    }else if(frameFullscreenGesture==='pan'&&frameFullscreenPointerStart){
      frameFullscreenPanX=frameFullscreenPointerStart.panX+(event.clientX-frameFullscreenPointerStart.x);
      frameFullscreenPanY=frameFullscreenPointerStart.panY+(event.clientY-frameFullscreenPointerStart.y);
      applyFrameFullscreenViewport();
    }
  });
  const stopFullscreenDrag=event=>{
    frameFullscreenGesture=null;
    frameFullscreenPointerStart=null;
    delete frameFullscreenStage.dataset.gesture;
    try{frameFullscreenStage.releasePointerCapture?.(event.pointerId);}catch{}
  };
  frameFullscreenStage.addEventListener('pointerup',stopFullscreenDrag);
  frameFullscreenStage.addEventListener('pointercancel',stopFullscreenDrag);
  frameFullscreen.addEventListener('click',event=>{if(event.target===frameFullscreen)closeFrameFullscreen();});
  frameFullscreenShell.addEventListener('click',event=>event.stopPropagation());
  const frameFullscreenKeyHandler=event=>{
    if(frameFullscreen.hidden)return;
    if(event.key==='Escape'){event.preventDefault();closeFrameFullscreen();return;}
    if(event.key==='0'){event.preventDefault();setFrameFullscreenZoomPreset('fit');}
    if(event.key==='1'){event.preventDefault();setFrameFullscreenZoomPreset('100');}
    if(event.key==='2'){event.preventDefault();setFrameFullscreenZoomPreset('200');}
    if(event.key==='4'){event.preventDefault();setFrameFullscreenZoomPreset('400');}
  };
  const frameFullscreenResizeHandler=()=>{if(!frameFullscreen.hidden)applyFrameFullscreenViewport();};
  window.addEventListener('resize',frameFullscreenResizeHandler);
  document.addEventListener('keydown',frameFullscreenKeyHandler);
  function revokeVerificationFrames(){
    for(const url of [verificationSourceUrl,verificationOutputUrl]){
      if(url?.startsWith('blob:'))URL.revokeObjectURL(url);
    }
    verificationSourceUrl=null;
    verificationOutputUrl=null;
    verificationFrameSourceTime=null;
    verificationFrameOutputTime=null;
    for(const [img,placeholder] of [[verifySourceImage,verifySourcePlaceholder],[verifyOutputImage,verifyOutputPlaceholder]]){
      img.removeAttribute('src');img.hidden=true;placeholder.hidden=false;
    }
    verifySourceTime.textContent='—';
    verifyOutputFrameTime.textContent='—';
  }
  function outputVerificationTimes(){
    const duration=verificationDuration(activeTask,completed);
    const max=Math.max(0,duration-.001);
    let outputTime=0;
    try{outputTime=parseMediaTime(verifyOutputTime.value,{empty:0,max:duration,label:'成品验证时间'});}catch{outputTime=Number(verifyOutputSlider.value)||0;}
    outputTime=Math.max(0,Math.min(max,outputTime));
    const sourceTime=verificationSourceTime(activeTask,completed,outputTime);
    return {duration,outputTime,sourceTime};
  }
  function syncOutputVerificationTime(value,fromSlider=false){
    if(!activeTask||!completed)return;
    const duration=verificationDuration(activeTask,completed);
    const max=Math.max(0,duration-.001);
    const outputTime=Math.max(0,Math.min(max,Number(value)||0));
    const hadFrames=verificationFrameOutputTime!=null;
    const changed=hadFrames&&Math.abs(outputTime-verificationFrameOutputTime)>.0005;
    if(changed){
      revokeVerificationFrames();
      verifyStatus.textContent='验证时间已改变；请重新提取这一位置的源帧与成品帧。';
    }
    verifyOutputSlider.max=String(max||1);
    verifyOutputSlider.value=String(outputTime);
    if(fromSlider||document.activeElement!==verifyOutputTime)verifyOutputTime.value=formatMediaTimeInput(outputTime,3);
    const sourceTime=verificationSourceTime(activeTask,completed,outputTime);
    verifyMapping.textContent='源 '+formatMediaTimeInput(sourceTime,3)+' ↔ 成品 '+formatMediaTimeInput(outputTime,3);
  }
  function syncOutputVerificationAvailability(){
    const operation=activeTask?.operation;
    const available=!!completed&&!!activeTask&&['transcode','hardsub'].includes(operation)&&get('operation').value===operation&&!!hooks.verifyFramePair;
    outputVerification.hidden=!available;
    if(!available){
      revokeVerificationFrames();
      return;
    }
    const hardsub=operation==='hardsub';
    verifyTitle.textContent=hardsub?'权威字幕参考 ↔ 硬压成品':'源帧 ↔ 转码成品';
    verifyDescription.textContent=hardsub
      ? '参考侧重新执行与正式任务一致的预编码画面滤镜和 libass 字幕渲染，再与已验证硬压成品按时间位置比较。'
      : '按时间位置映射，不按“第 N 帧”强行对应。用于检查转码后的实际画面变化。';
    verifyReferenceLabel.textContent=hardsub?'权威字幕参考':'源素材';
    verifyOutputLabel.textContent=hardsub?'硬压成品':'转码成品';
    verifySourceImage.alt=hardsub?'权威字幕参考帧':'源素材验证帧';
    verifyOutputImage.alt=hardsub?'硬字幕成品验证帧':'转码成品验证帧';
    const duration=verificationDuration(activeTask,completed);
    const midpoint=Math.max(0,Math.min(Math.max(0,duration-.001),duration/2));
    const cadenceChanged=!!activeTask.expectedFps;
    const spatialChanged=verificationHasSpatialTransforms(activeTask);
    verifyTransformWarning.hidden=hardsub?!cadenceChanged:!(spatialChanged||cadenceChanged);
    verifyTransformWarning.textContent=hardsub
      ? '当前硬压任务指定了目标帧率；参考侧按时间戳重新取源帧，成品侧可能因 CFR 采样 / 丢帧 / 复制帧选择到相邻画面。不要把这种时序采样差异当成编码损失。'
      : [
          spatialChanged?'当前转码任务包含缩放、裁切、旋转或画面滤镜；比较结果会同时包含这些有意处理，不应全部归因于编码损失。':'',
          cadenceChanged?'任务指定了目标帧率；时间点附近可能出现 CFR 帧采样差异。':''
        ].filter(Boolean).join(' ');
    verifyStatus.textContent=hardsub
      ? '任务完成后可提取“预编码权威字幕参考帧”和硬压成品帧；参考侧包含任务画面滤镜与 libass 字幕，但不包含最终有损编码。'
      : '任务完成后可从任意时间点提取源帧与成品帧；点击任一图进入全屏中线滑块比较。';
    if(!verificationSourceUrl&&!verificationOutputUrl)syncOutputVerificationTime(midpoint,true);
  }
  function openOutputVerificationFullscreen(){
    if(!verificationSourceUrl||!verificationOutputUrl)return;
    if(verificationFrameSourceTime==null||verificationFrameOutputTime==null)return;
    const times={sourceTime:verificationFrameSourceTime,outputTime:verificationFrameOutputTime};
    frameFullscreenMode='compare';
    const hardsub=activeTask?.operation==='hardsub';
    const leftLabel=hardsub?'权威字幕参考':'源素材';
    const rightLabel=hardsub?'硬压成品':'转码成品';
    frameFullscreenTitle.textContent=hardsub?'权威字幕参考 ↔ 硬压成品':'源帧 ↔ 转码成品';
    frameFullscreenMeta.textContent=formatMediaTimeInput(times.sourceTime,3)+' ↔ '+formatMediaTimeInput(times.outputTime,3);
    frameFullscreenBase.src=verificationOutputUrl;
    frameFullscreenBase.alt=rightLabel+'全屏验证帧';
    frameFullscreenCompare.src=verificationSourceUrl;
    frameFullscreenCompare.alt=leftLabel+'全屏验证帧';
    frameFullscreenCompare.hidden=false;
    frameFullscreenCompareLayer.hidden=false;
    frameFullscreenDivider.hidden=false;
    frameFullscreenLeftLabel.hidden=false;
    frameFullscreenRightLabel.hidden=false;
    frameFullscreenControls.hidden=false;
    frameFullscreenLeftLabel.textContent=leftLabel+' · '+formatMediaTimeInput(times.sourceTime,3);
    frameFullscreenRightLabel.textContent=rightLabel+' · '+formatMediaTimeInput(times.outputTime,3);
    frameFullscreenControls.querySelector('span:first-child').textContent=leftLabel;
    frameFullscreenControls.querySelector('span:nth-of-type(2)').textContent=rightLabel;
    prepareFrameFullscreenView();
  }
  for(const img of [verifySourceImage,verifyOutputImage]){
    img.addEventListener('click',openOutputVerificationFullscreen);
    img.addEventListener('keydown',event=>{
      if((event.key==='Enter'||event.key===' ')&&!img.hidden){
        event.preventDefault();openOutputVerificationFullscreen();
      }
    });
  }
  verifyOutputSlider.addEventListener('input',()=>syncOutputVerificationTime(verifyOutputSlider.value,true));
  verifyOutputTime.addEventListener('blur',()=>{
    try{
      const duration=verificationDuration(activeTask,completed);
      const value=parseMediaTime(verifyOutputTime.value,{empty:0,max:duration,label:'成品验证时间'});
      verifyOutputTime.setCustomValidity('');
      syncOutputVerificationTime(value,true);
    }catch(error){verifyOutputTime.setCustomValidity(error.message);}
  });
  verifyFramesButton.onclick=async()=>{
    if(!completed||!activeTask||!['transcode','hardsub'].includes(activeTask.operation)||!hooks.verifyFramePair)return;
    if(busy||hooks.busy())return;
    const {duration,outputTime,sourceTime}=outputVerificationTimes();
    if(!(duration>0)){verifyStatus.textContent='成品时长不可用，无法建立源帧映射。';return;}
    verifyFramesButton.disabled=true;
    const hardsub=activeTask.operation==='hardsub';
    verifyStatus.textContent=hardsub?'正在生成权威字幕参考帧并读取已验证硬压成品…':'正在从源素材与已验证成品提取对应画面…';
    try{
      const result=await hooks.verifyFramePair({
        completed,
        task:activeTask,
        sourceTime,
        outputTime,
        outputExtension:activeTask.outputExtension,
        width:1200
      });
      revokeVerificationFrames();
      verificationSourceUrl=result.source?.url||null;
      verificationOutputUrl=result.output?.url||null;
      if(!verificationSourceUrl||!verificationOutputUrl)throw Error('画质验证没有返回完整帧对');
      verificationFrameSourceTime=Number(result.source?.time??sourceTime);
      verificationFrameOutputTime=Number(result.output?.time??outputTime);
      verifySourceImage.src=verificationSourceUrl;verifySourceImage.hidden=false;verifySourcePlaceholder.hidden=true;
      verifyOutputImage.src=verificationOutputUrl;verifyOutputImage.hidden=false;verifyOutputPlaceholder.hidden=true;
      verifySourceTime.textContent=formatMediaTimeInput(verificationFrameSourceTime,3);
      verifyOutputFrameTime.textContent=formatMediaTimeInput(verificationFrameOutputTime,3);
      verifyStatus.textContent=hardsub
        ? '参考帧与硬压成品已提取。参考侧复现预编码画面滤镜 + libass 字幕；点击任一图进入全屏中线滑块比较。'
        : '帧对已提取。点击任一图进入全屏中线滑块比较；这是一种视觉检查，不等同于 SSIM / VMAF 分数。';
    }catch(error){
      verifyStatus.textContent='成品画质验证失败：'+error.message;
    }finally{verifyFramesButton.disabled=false;}
  };
  function clearTimelineFrameCache(){
    closeFrameFullscreen();
    clearTimeout(timelineFrameTimer);
    clearTimeout(boundaryFrameTimer);
    timelineFrameRequestSeq++;
    boundaryFrameRequestSeq++;
    timelineFrameGeneration++;
    lastBoundaryPreviewKey='';
    timelineFramePending.clear();
    for(const value of timelineFrameCache.values()){
      if(value?.url?.startsWith('blob:'))URL.revokeObjectURL(value.url);
    }
    timelineFrameCache.clear();
    framePreviewImage.removeAttribute('src');
    framePreviewImage.hidden=true;
    framePreviewPlaceholder.hidden=false;
    framePreviewPlaceholder.textContent='点击或拖动时间轴以预览画面。';
    framePreviewTime.textContent='—';
    framePreviewStatus.textContent='移动时间轴光标后显示源视频画面';
    for(const [img,placeholder,label] of [
      [requestedFrameImage,requestedFramePlaceholder,'等待请求边界'],
      [actualFrameImage,actualFramePlaceholder,'等待关键帧分析']
    ]){
      img.removeAttribute('src');img.hidden=true;placeholder.hidden=false;placeholder.textContent=label;
    }
    requestedFrameTime.textContent='—';
    actualFrameTime.textContent='—';
  }
  const primaryVideoStream=()=>{
    const raw=String(get('videoStreams')?.value||'0').trim().toLowerCase();
    if(raw==='all')return 0;
    const first=raw.split(',').map(x=>x.trim()).find(x=>/^\d+$/.test(x));
    return Math.max(0,Number(first||0));
  };
  const frameCacheKey=(time,stream=primaryVideoStream())=>stream+'@'+Math.max(0,Number(time)||0).toFixed(3);
  async function getTimelineFrame(time){
    if(!hooks.frame)throw Error('当前后端未提供时间轴画面预览');
    const clamped=clampWaveformTime(time);
    const videoStream=primaryVideoStream();
    const key=frameCacheKey(clamped,videoStream);
    if(timelineFrameCache.has(key))return timelineFrameCache.get(key);
    if(timelineFramePending.has(key))return timelineFramePending.get(key);
    const generation=timelineFrameGeneration;
    const request=timelineFrameFetchQueue
      .catch(()=>{})
      .then(()=>hooks.frame({time:clamped,width:720,videoStream}))
      .then(result=>{
        if(!result?.url)throw Error('画面预览没有返回图像');
        if(generation!==timelineFrameGeneration){
          if(result.url.startsWith?.('blob:'))URL.revokeObjectURL(result.url);
          throw Error('时间轴画面预览已过期');
        }
        const value={url:result.url,time:Number(result.time??clamped)};
        timelineFrameCache.set(key,value);
        while(timelineFrameCache.size>24){
          const oldest=timelineFrameCache.keys().next().value;
          const removed=timelineFrameCache.get(oldest);
          if(removed?.url?.startsWith('blob:'))URL.revokeObjectURL(removed.url);
          timelineFrameCache.delete(oldest);
        }
        return value;
      })
      .finally(()=>{if(timelineFramePending.get(key)===request)timelineFramePending.delete(key);});
    timelineFramePending.set(key,request);
    timelineFrameFetchQueue=request.then(()=>undefined,()=>undefined);
    return request;
  }
  function scheduleCursorFramePreview(time,delay=150){
    if(!hooks.frame||!(waveformDuration>0)||busy||hooks.busy())return;
    clearTimeout(timelineFrameTimer);
    const seq=++timelineFrameRequestSeq;
    framePreviewPanel.hidden=false;
    framePreviewTime.textContent=formatMediaTimeInput(time,3);
    framePreviewStatus.textContent='正在读取光标处画面…';
    timelineFrameTimer=setTimeout(async()=>{
      try{
        const result=await getTimelineFrame(time);
        if(seq!==timelineFrameRequestSeq)return;
        framePreviewImage.src=result.url;
        framePreviewImage.hidden=false;
        framePreviewPlaceholder.hidden=true;
        framePreviewTime.textContent=formatMediaTimeInput(result.time,3);
        framePreviewStatus.textContent='源视频解码帧 #'+primaryVideoStream()+' · 用于定位，不作为 HDR 色彩判定';
      }catch(error){
        if(seq!==timelineFrameRequestSeq)return;
        framePreviewStatus.textContent='画面预览失败：'+error.message;
      }
    },delay);
  }
  function scheduleBoundaryFramePreview(requested,actual){
    if(!hooks.frame||get('operation').value!=='copy'||!(waveformDuration>0)||busy||hooks.busy())return;
    const previewKey=frameCacheKey(requested)+'|'+(actual==null?'none':frameCacheKey(actual));
    if(previewKey===lastBoundaryPreviewKey)return;
    lastBoundaryPreviewKey=previewKey;
    clearTimeout(boundaryFrameTimer);
    boundaryFrameInspector.hidden=false;
    requestedFrameTime.textContent=formatMediaTimeInput(requested,3);
    actualFrameTime.textContent=actual==null?'—':formatMediaTimeInput(actual,3);
    requestedFramePlaceholder.textContent='正在读取请求 IN…';
    requestedFramePlaceholder.hidden=false;requestedFrameImage.hidden=true;
    actualFramePlaceholder.textContent=actual==null?'尚未取得实际无损起点':'正在读取实际无损 IN…';
    actualFramePlaceholder.hidden=false;actualFrameImage.hidden=true;
    const seq=++boundaryFrameRequestSeq;
    boundaryFrameTimer=setTimeout(async()=>{
      try{
        const requestedResult=await getTimelineFrame(requested);
        if(seq!==boundaryFrameRequestSeq)return;
        requestedFrameImage.src=requestedResult.url;
        requestedFrameImage.hidden=false;
        requestedFramePlaceholder.hidden=true;
        if(actual!=null){
          const actualResult=Math.abs(actual-requested)<.0005?requestedResult:await getTimelineFrame(actual);
          if(seq!==boundaryFrameRequestSeq)return;
          actualFrameImage.src=actualResult.url;
          actualFrameImage.hidden=false;
          actualFramePlaceholder.hidden=true;
        }
      }catch(error){
        if(seq!==boundaryFrameRequestSeq)return;
        requestedFramePlaceholder.textContent='边界画面读取失败：'+error.message;
        actualFramePlaceholder.textContent='边界画面读取失败';
      }
    },220);
  }
  function renderKeyframeLane(){
    keyframeLane.replaceChildren();
    if(get('operation').value!=='copy'||!(waveformDuration>0)||!timelineKeyframes.length)return;
    const maxMarkers=1400;
    const stride=Math.max(1,Math.ceil(timelineKeyframes.length/maxMarkers));
    const frag=document.createDocumentFragment();
    for(let i=0;i<timelineKeyframes.length;i+=stride){
      const key=timelineKeyframes[i];
      const mark=document.createElement('span');
      mark.className='media-keyframe-mark';
      mark.style.left=(key/waveformDuration*100)+'%';
      mark.title='关键帧 '+formatMediaTimeInput(key,3);
      frag.append(mark);
    }
    keyframeLane.replaceChildren(frag);
  }
  function syncCopyStrategy(){
    const copy=get('operation').value==='copy'&&get('videoRange').value==='trim';
    cutStrategyPanel.hidden=!copy;
    if(!copy)return;
    let start=0;
    try{start=parseMediaTime(get('start').value,{empty:0,label:'请求 IN'});}
    catch{cutStrategyStatus.textContent='切点输入无效';cutStrategyStatus.dataset.state='unknown';return;}
    const identity=hooks.videoIdentity?.()||'';
    const validEvidence=!!identity&&identity===timelineSourceKey&&
      timelineVideoOrdinal===primaryVideoStream()&&waveformDuration>0;
    const assessment=assessCopyCutStart({requestedIn:start,
      keyframes:timelineKeyframes,truncated:timelineKeyframesTruncated,
      evidenceCurrent:validEvidence});
    cutStrategyStatus.dataset.state=assessment.state;
    // Evaluate only the selected state: UNKNOWN has no numeric delta.
    cutStrategyStatus.textContent=assessment.state==='predicted-early'
      ? '可能提前 '+assessment.delta.toFixed(3)+' 秒（仅预测）'
      : assessment.state==='predicted-aligned'
        ? '关键帧接近 IN（仅预测）'
        : assessment.state==='beginning'?'源文件起点':'切点尚未知晓';
    cutStrategyDescription.textContent=assessment.description+
      ' 本功能不会自动重编码；是否保留快速复制由你决定。';
    preferTranscodeTrim.disabled=busy||hooks.busy()||clipBatchRunning||
      recipeBatchRunning||!identity||!hooks.mediaSnapshot?.();
  }
  preferTranscodeTrim.onclick=()=>{
    if(cutStrategyPanel.hidden||busy||hooks.busy()||clipBatchRunning||recipeBatchRunning)return;
    if(!window.confirm('切换到视频重编码剪切？将保持当前 IN/OUT，并使用当前转码编码器及质量设置。输出不再是 Stream Copy；仍需独立验证成品时间轴。'))return;
    get('operation').value='transcode';
    get('videoRange').value='trim';
    get('operation').dispatchEvent(new Event('change',{bubbles:true}));
    status('已按你的确认改用重编码剪切。IN/OUT 保留；请核对编码器、质量、音轨和输出方案，再开始任务。');
  };
  function syncCopyBoundaryPreview(start){
    const copy=get('operation').value==='copy';
    copyBoundaryInfo.hidden=!copy||!(waveformDuration>0);
    for(const el of [keyframePrev,keyframeNext,keyframeSnapStart])el.hidden=!copy||!(waveformDuration>0);
    if(!copy)return;
    keyframePrev.disabled=previousKeyframe(waveformCursor-.000001)==null;
    keyframeNext.disabled=nextKeyframe(waveformCursor)==null;
    requestedStartTime.textContent=formatMediaTimeInput(start,3);
    const actual=start<=0?0:previousKeyframe(start);
    if(actual==null){
      actualStartEl.hidden=true;
      actualStartTime.textContent='尚未取得';
      keyframeDelta.textContent=timelineKeyframes.length
        ? '当前关键帧数据不足以确定该位置'
        : '分析时间轴后显示实际无损切入点';
      keyframeSnapStart.disabled=true;
      scheduleBoundaryFramePreview(start,null);
      return;
    }
    actualStartEl.hidden=false;
    actualStartEl.style.left=(actual/waveformDuration*100)+'%';
    actualStartTime.textContent=formatMediaTimeInput(actual,3);
    const delta=Math.max(0,start-actual);
    keyframeDelta.textContent=delta<.0005?'请求起点已经位于关键帧':'实际起点会提前 '+delta.toFixed(3)+' 秒';
    keyframeSnapStart.disabled=delta<.0005;
    scheduleBoundaryFramePreview(start,actual);
  }
  function syncWaveformMarkers(){
    syncCopyStrategy();
    if(!(waveformDuration>0))return;
    const start=readBoundary('start',0);
    const end=Math.max(start,readBoundary('end',waveformDuration));
    const left=start/waveformDuration*100;
    const right=end/waveformDuration*100;
    waveformStartEl.style.left=left+'%';
    waveformEndEl.style.left=right+'%';
    waveformSelection.hidden=false;
    waveformSelection.style.left=left+'%';
    waveformSelection.style.width=Math.max(0,right-left)+'%';
    waveformCursor=clampWaveformTime(waveformCursor);
    waveformCursorEl.style.left=(waveformCursor/waveformDuration*100)+'%';
    waveformCursorTime.textContent=formatMediaTimeInput(waveformCursor,3);
    syncCopyBoundaryPreview(start);
  }
  function setBoundary(name,value){
    const el=get(name);if(!el)return;
    let next=clampWaveformTime(value);
    if(name==='start'){
      const end=readBoundary('end',waveformDuration);
      next=Math.min(next,end);
    }else if(name==='end'){
      const start=readBoundary('start',0);
      next=Math.max(next,start);
    }
    el.value=formatMediaTimeInput(next,3);
    el.setCustomValidity('');
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    syncWaveformMarkers();
  }
  function pointerTime(event){
    if(!(waveformDuration>0))return 0;
    const rect=waveformTrack.getBoundingClientRect();
    return clampWaveformTime((event.clientX-rect.left)/Math.max(1,rect.width)*waveformDuration);
  }
  function setWaveformCursor(value,{preview=true}={}){
    waveformCursor=clampWaveformTime(value);
    syncWaveformMarkers();
    if(preview)scheduleCursorFramePreview(waveformCursor);
  }
  function autoScrollTimeline(event){
    if(!waveformScroll||waveformScroll.scrollWidth<=waveformScroll.clientWidth)return;
    const rect=waveformScroll.getBoundingClientRect();
    const edge=Math.min(56,Math.max(28,rect.width*.1));
    let delta=0;
    if(event.clientX<rect.left+edge)delta=-Math.max(10,(rect.left+edge-event.clientX)*.45);
    else if(event.clientX>rect.right-edge)delta=Math.max(10,(event.clientX-(rect.right-edge))*.45);
    if(delta)waveformScroll.scrollLeft=Math.max(0,Math.min(waveformScroll.scrollWidth-waveformScroll.clientWidth,waveformScroll.scrollLeft+delta));
  }
  waveformTrack.addEventListener('pointerdown',event=>{
    if(!(waveformDuration>0))return;
    const boundary=event.target?.dataset?.boundary;
    waveformDragging=boundary==='start'||boundary==='end'?boundary:null;
    waveformScrubbing=!waveformDragging;
    setWaveformCursor(pointerTime(event));
    if(waveformDragging)setBoundary(waveformDragging,waveformCursor);
    waveformTrack.setPointerCapture?.(event.pointerId);
  });
  waveformTrack.addEventListener('pointermove',event=>{
    if(!waveformDragging&&!waveformScrubbing)return;
    autoScrollTimeline(event);
    setWaveformCursor(pointerTime(event));
    if(waveformDragging)setBoundary(waveformDragging,waveformCursor);
  });
  const finishWaveformDrag=event=>{
    const hadInteraction=!!(waveformDragging||waveformScrubbing);
    waveformDragging=null;waveformScrubbing=false;
    try{waveformTrack.releasePointerCapture?.(event.pointerId);}catch{}
    if(hadInteraction)scheduleCursorFramePreview(waveformCursor,0);
  };
  waveformTrack.addEventListener('pointerup',finishWaveformDrag);
  waveformTrack.addEventListener('pointercancel',finishWaveformDrag);
  waveformTrack.addEventListener('keydown',event=>{
    if(!(waveformDuration>0)||['INPUT','SELECT','TEXTAREA'].includes(event.target?.tagName))return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();
      const step=event.shiftKey?1:Math.max(.01,Math.min(.25,waveformDuration/5000));
      setWaveformCursor(waveformCursor+(event.key==='ArrowRight'?step:-step));
    }
  });
  section.querySelector('#taskWaveformSetStart').onclick=()=>{if(waveformDuration>0)setBoundary('start',waveformCursor);};
  section.querySelector('#taskWaveformSetEnd').onclick=()=>{if(waveformDuration>0)setBoundary('end',waveformCursor);};
  keyframePrev.onclick=()=>{const value=previousKeyframe(waveformCursor-.000001);if(value!=null)setWaveformCursor(value);};
  keyframeNext.onclick=()=>{const value=nextKeyframe(waveformCursor);if(value!=null)setWaveformCursor(value);};
  keyframeSnapStart.onclick=()=>{const value=previousKeyframe(readBoundary('start',0));if(value!=null){setBoundary('start',value);setWaveformCursor(value);}};
  waveformZoom.oninput=()=>{
    const zoom=Math.max(1,Number(waveformZoom.value)||1);
    waveformTrack.style.width=(zoom*100)+'%';
    renderTimelineRuler();
    renderKeyframeLane();
    syncWaveformMarkers();
    requestAnimationFrame(()=>{
      const cursorX=(waveformCursor/Math.max(.001,waveformDuration))*waveformTrack.scrollWidth;
      waveformScroll.scrollLeft=Math.max(0,Math.min(waveformScroll.scrollWidth-waveformScroll.clientWidth,cursorX-waveformScroll.clientWidth/2));
    });
  };
  section.querySelector('#taskWaveformLoad').onclick=async()=>{
    const button=section.querySelector('#taskWaveformLoad');
    if(!hooks.waveform){waveformStatus.textContent='当前后端未提供时间轴分析能力';return;}
    if(busy||hooks.busy())return;
    button.disabled=true;
    clearTimelineFrameCache();
    framePreviewPanel.hidden=!hooks.frame;
    boundaryFrameInspector.hidden=true;
    const copy=get('operation').value==='copy';
    const videoTrim=copy&&get('videoRange').value==='trim';
    const requestedSourceKey=hooks.videoIdentity?.()||'';
    const requestedVideoOrdinal=primaryVideoStream();
    waveformStatus.textContent=videoTrim?'正在分析时间范围、波形与主选视频关键帧…':'正在分析时间范围与音频波形…';
    try{
      const audioValue=String(get('audioTrack')?.value||'all');
      const audioTrack=audioValue==='all'?0:Math.max(0,Number(audioValue)||0);
      const result=await hooks.waveform({audioTrack,videoStream:primaryVideoStream(),width:2400,height:160,includeKeyframes:videoTrim,maxKeyframes:12000,allowNoWaveform:true});
      if(!(Number(result?.duration)>0))throw Error('时间轴结果缺少有效时长');
      if(requestedSourceKey!==(hooks.videoIdentity?.()||'')||requestedVideoOrdinal!==primaryVideoStream())throw Error('来源或视频流在时间轴分析期间改变；丢弃旧关键帧');
      if(waveformUrl?.startsWith('blob:'))URL.revokeObjectURL(waveformUrl);
      waveformUrl=result.url||null;
      waveformDuration=Number(result.duration);
      timelineKeyframes=videoTrim&&Array.isArray(result.keyframes)
        ? result.keyframes.map(Number).filter(Number.isFinite).filter(value=>value>=0&&value<=waveformDuration).sort((a,b)=>a-b)
        : [];
      timelineKeyframesTruncated=!!result.keyframesTruncated;
      timelineSourceKey=requestedSourceKey;
      timelineVideoOrdinal=requestedVideoOrdinal;
      if(waveformUrl){
        waveformImage.src=waveformUrl;
        waveformImage.hidden=false;
        waveformPlaceholder.hidden=true;
      }else{
        waveformImage.removeAttribute('src');
        waveformImage.hidden=true;
        waveformPlaceholder.hidden=false;
        waveformPlaceholder.textContent=videoTrim
          ? '没有可显示的音频波形；主选视频关键帧与剪切范围仍可使用。'
          : '没有可显示的音频波形；时间范围与画面预览仍可使用。';
      }
      waveformStartEl.hidden=false;
      waveformEndEl.hidden=false;
      waveformCursorEl.hidden=false;
      waveformCursor=readBoundary('start',0);
      renderTimelineRuler();
      renderKeyframeLane();
      if(hooks.frame)scheduleCursorFramePreview(waveformCursor,0);
      const waveText=waveformUrl
        ? '第 '+(Number(result.audioTrack??audioTrack)+1)+' 条音轨'
        : (copy?'无音频波形':'无音频波形 · 时间范围仍可用');
      const keyText=copy
        ? ' · 关键帧 '+timelineKeyframes.length+(timelineKeyframesTruncated?'（已截断显示）':'')
        : '';
      waveformStatus.textContent=waveText+keyText+' · '+formatMediaTimeInput(waveformDuration,3);
      syncWaveformMarkers();
    }catch(error){
      waveformStatus.textContent='时间轴分析失败：'+error.message;
    }finally{button.disabled=false;}
  };
  const runButtonLabel = () => get('operation').value==='hardsub'?'使用当前参数开始硬压':get('operation').value==='transcode'?'开始视频转码':'开始视频流复制 / 剪辑';
  const presetIntent = (encoder,preset) => {
    if(String(encoder).endsWith('_nvenc')){
      const n=Number(String(preset).replace(/^p/i,''));
      return n<=2?'偏速度':n>=6?'偏质量':'均衡';
    }
    if(encoder==='libsvtav1'){
      const n=Number(preset);
      return n>=9?'偏速度':n<=4?'偏质量':'均衡';
    }
    if(['ultrafast','superfast','veryfast','faster','fast'].includes(preset))return '偏速度';
    if(['slow','slower','veryslow'].includes(preset))return '偏质量';
    return '均衡';
  };
  const renderPlanSummary = task => {
    syncTaskReview();
    const raw=read(),operation=raw.operation,copy=operation==='copy';
    const operationLabel=operation==='hardsub'?'硬字幕压制':operation==='transcode'?'纯视频转码':'视频流复制 / 快速剪辑';
  const codecLabel={h264:'H.264',h265:'H.265 / HEVC',av1:'AV1',h266:'H.266 / VVC'}[raw.codec]||raw.codec||'—';
    const encoderLabel=get('encoder').selectedOptions?.[0]?.textContent||raw.encoder||'—';
    const speed=copy?'无需编码':presetIntent(raw.encoder,raw.preset);
    let rate='无损复制',note='不重新编码；实际切入点受关键帧约束。';
    if(!copy && raw.rateMode==='quality'){
      rate='质量优先 · '+(raw.encoder==='libvvenc'?'QP ':String(raw.encoder).endsWith('_nvenc')?'CQ ':'CRF ')+(raw.quality||'—');
      note='质量模式不会根据 CQ / CRF 伪造精确成品大小；需要大小判断时先做短片试压。';
    }else if(!copy && raw.rateMode==='bitrate'){
      const b=Number(raw.bitrate||0);
      rate='码率受控'+(b>0?' · '+(b/1000000).toFixed(2)+' Mbps':'');
      note='固定视频码率目标；实际成品大小仍受音频、封装与时长影响。';
    }else if(!copy && raw.rateMode==='size'){
      rate='目标体积 · '+(raw.targetSize||'—')+' '+(raw.sizeUnit||'');
      note='目标体积会换算为视频码率预算；封装、音频和实际编码偏差仍会影响最终大小。';
    }
    const size=copy?'保持源画面':raw.width&&raw.height?raw.width+'×'+raw.height:raw.width?raw.width+' 宽 · 高度按比例':raw.height?'宽度按比例 · '+raw.height+' 高':'保持源分辨率';
    let audio=raw.audio==='copy'?'原音频复制':raw.audio==='none'?'无音频':String(raw.audio||'').toUpperCase();
    if(raw.audioPlan){try{audio='逐轨 · '+JSON.parse(raw.audioPlan).filter(a=>a.action!=='drop').map(a=>'a:'+a.sourceOrdinal+' '+a.action).join(' / ');}catch{audio='音轨计划待修正';}}
    const container=task?.outputContainer ? task.outputContainer.toUpperCase() : ({auto:'AUTO',keep:'保持源容器',mkv:'MKV',mp4:'MP4'}[raw.outputContainer]||'AUTO');
    section.querySelector('#taskPlanTitle').textContent=operationLabel+(copy?'':' · '+codecLabel+' · '+speed);
    section.querySelector('#taskPlanEncoder').textContent=copy?'直接复制':codecLabel+' · '+encoderLabel;
    section.querySelector('#taskPlanSpeed').textContent=speed+(copy?'':' · preset '+raw.preset);
    section.querySelector('#taskPlanRate').textContent=rate;
    const selectedVideos=String(raw.videoStreams||'0').trim().toLowerCase()==='all'?'全部视频流':'视频 #'+String(raw.videoStreams||'0').split(',').map(x=>x.trim()).filter(Boolean).join(' / #');
    const rangeSummary='视频'+(raw.videoRange==='full'?'完整':'IN/OUT')+' · 音频'+(raw.audioRange==='full'?'完整':'IN/OUT');
    section.querySelector('#taskPlanOutput').textContent=selectedVideos+' · '+size+' · '+audio+' · '+container;
    if(task?.sizePlan){const b=task.sizePlan;section.querySelector('#taskBudgetLedger').textContent='目标 '+formatSize(b.targetBytes)+' · 固定流/附件 '+formatSize(b.fixedPayloadBytes)+' · 编码音频 '+formatSize(b.encodedAudioBytes)+' · 封装余量 '+formatSize(b.containerReserveBytes)+' · 视频 '+(b.videoRate/1e6).toFixed(3)+' Mbps'+(b.copiedTrimReserveBytes>0?' · 裁切复制流按完整源流预留 '+formatSize(b.copiedTrimReserveBytes):'');}
    section.querySelector('#taskPlanNote').textContent=note+' '+rangeSummary+'。'+(task?.estimatedBytes>0?' 当前任务估计数据量 '+formatSize(task.estimatedBytes)+'。':'');
  };
  const renderContainerDecision = task => {
    const el=section.querySelector('#taskContainerDecision');
    if(!el)return;
    if(!task){
      el.textContent='执行检查后显示实际容器选择及原因。';
      el.dataset.state='idle';
      return;
    }
    el.textContent='实际输出：'+task.outputContainer.toUpperCase()+' · '+task.containerReason+(task.sourceContainer?' · 源容器 '+task.sourceContainer.toUpperCase():'');
    el.dataset.state='resolved';
  };
  const syncVideoStreamInfo = () => {
    const el=section.querySelector('#taskVideoStreamInfo'); if(!el)return;
    const media=hooks.mediaSnapshot?.() || null;
    const streams=Array.isArray(media?.videoStreams) ? media.videoStreams : [];
    if(!streams.length){el.textContent='读取容器后显示可用视频流。视频流序号按 FFmpeg 的 v:N 顺序，从 0 开始。';return;}
    const facts=streams.map((stream,index)=>{
      const ordinal=Number.isInteger(Number(stream.ordinal))?Number(stream.ordinal):index;
      const codec=String(stream.codec||stream.codec_name||'unknown').toUpperCase();
      const size=Number(stream.width||0)>0&&Number(stream.height||0)>0?' '+stream.width+'×'+stream.height:'';
      const depth=Number(stream.bitDepth||0)>0?' '+stream.bitDepth+'-bit':'';
      return '#'+ordinal+' '+codec+size+depth;
    });
    el.textContent='可用视频流 '+streams.length+' 条：'+facts.join(' · ')+'。可输入 0、0,1 或 all。';
  };
  const syncAudioPlaybackWarning = (task=null, media=null) => {
    const el=outputPolicy?.querySelector('#taskAudioPlaybackWarning');
    if(!el)return;
    const audioControl=outputPolicy?.querySelector('[name="audio"]');
    const copy=audioControl?.value==='copy';
    if(!copy){
      el.hidden=true;
      el.textContent='';
      el.removeAttribute('data-state');
      return;
    }

    const currentMedia = media || hooks.mediaSnapshot?.() || null;
    const assessment = currentMedia
      ? audioCopyPlaybackWarning(task || {audio:'copy'}, currentMedia)
      : null;

    el.hidden=false;
    el.dataset.state=assessment?.severity || 'warning';
    el.textContent=assessment?.message ||
      '注意：复制原音频只保留现有码流。尚未取得源音频 codec；封装成功、成品中存在音轨，也不等于目标播放器一定能解码。读取视频参数后会显示更具体的兼容性提示。如果成品无声，可改为“转为 AAC”。';
  };
  const syncTaskActions = () => {
    const stateName=section.dataset.taskState||'idle',run=section.querySelector('#taskRun'),save=section.querySelector('#taskSave');
    const finished=['verified','save_failed','saved'].includes(stateName);
    const previousResult=finished&&completedStale;
    // The real UI exposes these source/probe hooks; keep synthetic consumers
    // with omitted hooks compatible with their submit-time validation.
    const hasSource=typeof hooks.videoIdentity!=='function'||!!hooks.videoIdentity();
    const hasMedia=typeof hooks.mediaSnapshot!=='function'||!!hooks.mediaSnapshot();
    const requirement=!hasSource?'video':!hasMedia?'probe':'';
    run.dataset.inputRequirement=requirement||'ready';
    run.textContent=requirement==='video'?'先选择视频'
      :requirement==='probe'?'先读取视频参数'
      :finished&&!previousResult?'重新压制':runButtonLabel();
    run.title=requirement==='video'?'从左侧素材区选择视频后继续'
      :requirement==='probe'?'先点击“读取视频参数”或等待原生媒体探测完成':'';
    run.classList.toggle('task-secondary-action',finished&&!previousResult);
    save.textContent=stateName==='saving'
      ? '正在保存…'
      : previousResult
        ? (stateName==='save_failed'?'重试保存上一成品':stateName==='saved'?'再次保存上一成品':'保存上一成品')
        : stateName==='save_failed'?'重试保存成品':stateName==='saved'?'再次保存成品':'保存成品';
    save.classList.toggle('task-primary-action',['verified','save_failed'].includes(stateName));
    save.disabled=lastReport?.deliveryAllowed===false||busy||stateName==='saving'||!completed||!['verified','save_failed','saved'].includes(stateName);
    run.disabled=busy||stateName==='saving'||!!requirement||!!clipAwaitingSave||!!recipePendingSave;
    section.dataset.completedStale=previousResult?'true':'false';
    syncTaskReview();
  };
  const setTaskState = next => {
    section.dataset.taskState=next;
    const labels={
      idle:'等待开始',preparing:'正在检查设置',encoding:'正在处理',validating:'正在验证成品',
      verified:'成品已验证，等待保存',saving:'正在保存成品',saved:'成品已保存',
      save_failed:'保存失败，可直接重试',failed:'任务失败',cancelling:'正在取消'
    };
    section.querySelector('#taskStage').textContent=labels[next]||next;
    section.querySelector('#taskRunState').dataset.state=next;
    syncTaskActions();
  };
  const nonOutputFields=new Set(['configName','savedConfig','sampleStart','sampleLength']);
  const markCompletedAsPrevious = sourceName => {
    if(!sourceName||!nonOutputFields.has(sourceName))currentPlanTask=null;
    const stateName=section.dataset.taskState||'idle';
    if(!completed||!['verified','save_failed','saved'].includes(stateName))return;
    if(sourceName&&nonOutputFields.has(sourceName))return;
    if(completedStale)return;
    completedStale=true;
    section.dataset.completedStale='true';
    section.querySelector('#taskStage').textContent=stateName==='saved'?'上一任务成品已保存':'上一任务成品仍可保存';
    if(stateName==='save_failed'){
      status('当前设置已改变；上一任务成品上次保存失败，但仍可直接重试保存。下次执行将使用当前新设置。');
    }else if(stateName==='verified'){
      status('当前设置已改变；上一任务成品仍已验证，可先保存。下次执行将使用当前新设置。');
    }else{
      status('当前设置已改变；下次执行将使用当前新设置。上一任务成品仍可再次保存。');
    }
    syncTaskActions();
  };
  const isCancellationError = error => {
    const text=String(error?.message||error||'').toLowerCase();
    return text.includes('取消')||text.includes('cancelled')||text.includes('canceled');
  };
  const updateTaskProgress = (p,message,meta={}) => {
    const fraction=Math.max(0,Math.min(1,Number(p)||0));
    section.querySelector('#taskProgress').value=fraction;
    section.querySelector('#taskPercent').textContent=(fraction*100).toFixed(fraction>0&&fraction<1?1:0)+'%';
    if(meta.state==='encoding'||meta.state==='validating'||meta.state==='cancelling')setTaskState(meta.state);
    const duration=Number(meta.duration||activeTask?.expectedDuration||0);
    const timeSec=Number(meta.timeSec);
    section.querySelector('#taskMediaTime').textContent=Number.isFinite(timeSec)&&duration>0?formatTaskClock(timeSec)+' / '+formatTaskClock(duration):duration>0?'— / '+formatTaskClock(duration):'—';
    const elapsed=taskStartedAt?Math.max(0,(performance.now()-taskStartedAt)/1000):0;
    section.querySelector('#taskElapsed').textContent=taskStartedAt?formatTaskClock(elapsed):'—';
    const speed=Number(meta.speed||0);
    section.querySelector('#taskSpeed').textContent=speed>0?speed.toFixed(2)+'× realtime':'正在采样';
    if(activeTask?.twoPass){
      section.querySelector('#taskEta').textContent='两遍编码不做单阶段外推';
    }else if(meta.state==='encoding'&&speed>0&&Number.isFinite(timeSec)&&duration>timeSec&&elapsed>=6&&timeSec>=5){
      section.querySelector('#taskEta').textContent='约 '+formatTaskClock((duration-timeSec)/speed);
    }else{
      section.querySelector('#taskEta').textContent=meta.state==='validating'?'验证中':'尚未可靠估计';
    }
    if(message)status(message);
  };
  const nativeExportListener = event => {
    const data=event.detail||{};
    if(!completed?.jobId)return;
    if(data.jobId&&data.jobId!==completed.jobId)return;
    if(data.ok){
      setTaskState('saved');
      status('成品已保存'+(data.path?' · '+data.path:'')+(data.bytes?' · '+formatSize(Number(data.bytes)):'')+'。');
      hooks.log?.('成品保存完成。');
      settlePendingClipSave(true);
    }else if(String(data.error||'').toLowerCase().includes('cancel')){
      setTaskState('verified');
      status('已取消保存；成品仍已验证，可再次点击“保存成品”。');
      settlePendingClipSave(false);
    }else{
      setTaskState('save_failed');
      status('保存失败：'+(data.error||'未知错误')+'。已验证成品仍保留在当前 Native 会话，可直接重试保存，无需重新压制。');
      hooks.log?.('成品保存失败：'+(data.error||'未知错误'));
      settlePendingClipSave(false);
    }
  };
  window.addEventListener('quick-hardsub-native-export-result',nativeExportListener);
  function updateEncoder() {
    const c=get('codec').value,previousEncoder=get('encoder').value;
    const capability=vvcCapability(hooks.platformKey?.()||{});
    get('codec').querySelector('option[value="h266"]').disabled=!capability.available;
    section.querySelector('#taskVvcCapability').textContent=capability.reason;
    const choices=[[SOFTWARE[c],{h264:'x264',h265:'x265',av1:'SVT-AV1',h266:'VVenC'}[c]+' · CPU']];
    if(c!=='h266' && windows() && hooks.hasNvenc(c)) choices.push([{h264:'h264_nvenc',h265:'hevc_nvenc',av1:'av1_nvenc'}[c],'NVENC · GPU']);
    get('encoder').innerHTML=choices.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
    if(choices.some(([v])=>v===previousEncoder))get('encoder').value=previousEncoder;
    updatePreset();updateRate();
  }
  function updatePreset(reset=false) {
    const previous=get('preset').value;
    const nv=get('encoder').value.endsWith('_nvenc');
    const vals=get('codec').value==='h266'?['faster','fast','medium','slow','slower']:nv?['p1','p2','p3','p4','p5','p6','p7']:get('codec').value==='av1'?Array.from({length:14},(_,i)=>String(i)):['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'];
    get('preset').innerHTML=vals.map(v=>`<option value="${v}">${v} · ${presetIntent(get('encoder').value,v)}</option>`).join('');
    get('preset').value=!reset&&vals.includes(previous)?previous:nv?'p5':get('codec').value==='av1'?'6':'medium';
    section.querySelector('#taskNvencDetails').hidden=!nv;
  }
  function syncModeChrome(mode) {
    document.body.dataset.mediaOperation = mode;
    section.dataset.operation = mode;
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mediaMode === mode));

    const copy = mode === 'copy';
    const transcode = mode === 'transcode';
    const hardsub = mode === 'hardsub';
    const title = hardsub ? '硬字幕压制工作区' : transcode ? '纯视频转码工作区' : '视频流复制 / 快速剪辑工作区';
    const eyebrow = hardsub ? 'HARDSUB · PARAMETERS' : transcode ? 'TRANSCODE' : 'STREAM PLAN · COPY';
    const description = hardsub
      ? 'ASS 预检与编码参数。'
      : transcode
        ? '视频与音频编码参数。'
        : '无损复制与时间范围。';

    section.querySelector('#mediaWorkspaceTitle').textContent = title;
    section.querySelector('#mediaWorkspaceEyebrow').textContent = eyebrow;
    section.querySelector('#mediaWorkspaceDescription').textContent = description;
    syncTaskActions();
    renderPlanSummary(activeTask);

    const heroSubtitle = document.querySelector('#heroSubtitle');
    if (heroSubtitle) heroSubtitle.textContent = hardsub
      ? '硬字幕 · libass · 编码'
      : transcode
        ? '视频转码 · 质量 · 输出'
        : '无损剪切 · 流映射';

    const inputHeading = document.querySelector('#inputCard .card-heading h2');
    const inputDeck = document.querySelector('#inputCard .card-heading p');
    if (inputHeading) inputHeading.textContent = hardsub ? '准备硬字幕素材' : transcode ? '准备转码素材' : '准备剪切素材';
    if (inputDeck) inputDeck.textContent = hardsub
      ? '视频 · ASS · 字体'
      : transcode
        ? '选择视频'
        : '选择视频 · 不重编码';

    for (const id of ['preflightCard','subtitleCard','planCard','encodeCard','taskOverviewRail']) {
      document.querySelector('#'+id)?.classList.toggle('media-mode-suppressed', !hardsub);
    }
    const stageNav = document.querySelector('#mobileStageNav');
    if (stageNav) stageNav.classList.toggle('media-mode-suppressed', !hardsub);
    section.querySelector('#taskSamples').closest('.button-row')?.classList.toggle('media-copy-suppressed', copy);
    section.querySelector('#taskLoadPreset').classList.toggle('media-copy-suppressed', copy);
    syncWorkflowStrip(mode);
    syncHardsubStrategyChrome(mode);
    transcodeCurves.refresh();
    hooks.onModeChange?.(mode);
  }

  function syncWorkflowStrip(mode) {
    const strip = document.querySelector('#workflowStrip');
    if (!strip) return;
    const steps = mode === 'hardsub'
      ? [['01','素材'],['02','预检'],['03','预览'],['04','方案'],['05','压制']]
      : mode === 'transcode'
        ? [['01','素材'],['02','参数'],['03','执行']]
        : [['01','素材'],['02','边界'],['03','导出']];
    strip.setAttribute('aria-label', mode === 'hardsub' ? '硬字幕压制流程' : mode === 'transcode' ? '视频转码流程' : '无损剪切流程');
    strip.innerHTML = steps.map(([index,label]) => '<span><b>'+index+'</b>'+label+'</span>').join('');
  }

  function syncHardsubStrategyChrome(mode = get('operation').value) {
    const hardsub = mode === 'hardsub';
    const guided = hardsubStrategy === 'guided';
    audioStreamPlan.panel.hidden=hardsub&&guided;
    document.body.dataset.hardsubStrategy = hardsubStrategy;
    section.dataset.mobileStageSection = hardsub ? 'produce' : 'prepare';
    for (const button of strategyButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.hardsubStrategy === hardsubStrategy));
    }

    const subtitleCard = document.querySelector('#subtitleCard');
    const productionAvailable = hardsub && subtitleCard && !subtitleCard.classList.contains('hidden');
    productionDeck?.classList.toggle('hidden', !productionAvailable);
    productionDeck?.classList.toggle('media-mode-suppressed', !hardsub);

    if (hardsub) {
      if (manualMount && section.parentElement !== manualMount) manualMount.append(section);
      if (guided && sharedOutputMount && outputPolicy && outputPolicy.parentElement !== sharedOutputMount) {
        sharedOutputMount.append(outputPolicy);
      } else if (!guided && outputPolicy && outputPolicy.parentElement !== form) {
        outputPolicyAnchor.after(outputPolicy);
      }
    } else {
      // All operations share the central editor slot. Keeping transcode/copy
      // next to #inputCard confines the full timeline and codec form to the
      // narrow source shelf in Studio v3's desktop three-zone layout.
      // Preserve original nodes/events and the phone prepare-stage semantic.
      if (manualMount && section.parentElement !== manualMount) manualMount.append(section);
      else if (!manualMount && inputCard && section.previousElementSibling !== inputCard) inputCard.after(section);
      if (outputPolicy && outputPolicy.parentElement !== form) outputPolicyAnchor.after(outputPolicy);
    }

    const view=sharedTaskPresentation({operation:mode,strategy:hardsubStrategy,sourceReady:!!productionAvailable,legacyJob:!!hooks.legacyGuidedJob?.()});
    section.classList.toggle('hardsub-strategy-suppressed',view.workspaceSuppressed);
    section.classList.toggle('guided-shared-task',view.hideParameters);
    section.querySelector('#taskEncoding').hidden=view.hideParameters;
    document.querySelector('#planCard')?.classList.toggle('hardsub-strategy-suppressed',view.hideGoalExplorer);
    document.querySelector('#encodeCard')?.classList.toggle('hardsub-strategy-suppressed',view.hideLegacyExecution);
  }

  for (const button of strategyButtons) {
    button.addEventListener('click', () => {
      if (busy || hooks.busy()) return;
      hardsubStrategy = button.dataset.hardsubStrategy === 'manual' ? 'manual' : 'guided';
      localStorage.setItem('hardsub-control-strategy-v1', hardsubStrategy);
      syncHardsubStrategyChrome();
    });
  }

  const guidedHandoffButton=document.querySelector('#guidedToManual');
  let initialManualSettings;
  if(guidedHandoffButton)guidedHandoffButton.onclick=()=>{
    if(busy||hooks.busy()||clipBatchRunning||clipAwaitingSave)return;
    try{
      const sourceKey=hooks.videoIdentity?.()||'';
      const source=hooks.mediaSnapshot?.();
      const evidence=budgetSourceIdentity===sourceKey?budgetEvidence:null;
      const compiled=compileGuidedCpuHandoff({
        snapshot:hooks.guidedSnapshot?.(),defaults:initialManualSettings,
        media:source,evidence,sourceKey,evidenceSourceKey:budgetSourceIdentity
      });
      if(!compiled.ok)throw Error('无法安全交接 CPU 任务：'+compiled.reason+
        (compiled.detail?' · '+compiled.detail:''));
      const applied=commitGuidedCpuHandoff({
        contract:compiled,read,apply:applyConfig,media:source,evidence,
        sourceIdentity:()=>hooks.videoIdentity?.()||'',
        expectedSourceIdentity:sourceKey
      });
      if(!applied.ok)throw Error('交接没有采用任何新任务：'+applied.reason+
        (applied.detail?' · '+applied.detail:''));
      hardsubStrategy='manual';
      localStorage.setItem('hardsub-control-strategy-v1',hardsubStrategy);
      activeTask=null;currentPlanTask=applied.task;transcodeCurves.invalidate();
      syncHardsubStrategyChrome();syncTaskReview();renderPlanSummary(applied.task);
      status('CPU 交接已通过共同任务编译与实际表单复核；保留原目标体积、逐流成本和双遍/严格策略。需要重新验证编码结果，ASS / VBR 短样证据不转移。');
      section.scrollIntoView?.({block:'start'});
    }catch(error){hooks.log?.('方案交接未完成：'+error.message);alert(error.message);}
  };

  const subtitleCardObserver = new MutationObserver(() => syncHardsubStrategyChrome());
  const observedSubtitleCard = document.querySelector('#subtitleCard');
  if (observedSubtitleCard) subtitleCardObserver.observe(observedSubtitleCard, { attributes:true, attributeFilter:['class'] });

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      if(busy||hooks.busy()||clipBatchRunning||clipAwaitingSave)return;
      const nextMode=button.dataset.mediaMode;
      if(get('operation').value!==nextMode)markCompletedAsPrevious('operation');
      get('operation').value = nextMode;
      if(nextMode==='copy')get('budgetPolicy').value='best-effort';
      updateMode();
      updateRate();
    });
  }

  function updateMode() {
    const mode=get('operation').value;
    if(currentPlanTask&&currentPlanTask.operation!==mode)currentPlanTask=null;
    const copy=mode==='copy';
    if(!copy)clipEditingIndex=-1;
    syncModeChrome(mode);
    section.querySelector('#taskEncoding').disabled=copy;
    document.querySelectorAll('.input-ass,.input-font').forEach(el=>el.classList.toggle('hidden',get('operation').value!=='hardsub'));
    syncClipQueue();
    syncCopyStrategy();
    section.querySelector('#taskModeHint').textContent=copy
      ? (get('videoRange').value==='trim'
        ? '无损剪切：IN 可能提前对齐关键帧；音频可独立处理。'
        : '视频完整复制；音频与软字幕可单独剪切。')
      : mode==='hardsub'
        ? '硬字幕需要 ASS 与 libass 真实预览。'
        : '转码时间轴不是转码前后质量对比；不需要 ASS，也不会自动换编码器。';
    renderContainerDecision(null);
    renderKeyframeLane();
    syncOutputVerificationAvailability();
    if(copy&&waveformDuration>0)syncWaveformMarkers();
    else{
      copyBoundaryInfo.hidden=true;
      boundaryFrameInspector.hidden=true;
      actualStartEl.hidden=true;
      for(const el of [keyframePrev,keyframeNext,keyframeSnapStart])el.hidden=true;
    }
  }
  function setRateControl(key, active) {
    const control=get(key);
    if(!control)return;
    control.disabled=!active;
    const owner=control.closest('label');
    if(owner){
      owner.hidden=!active;
      owner.setAttribute('aria-hidden', active ? 'false' : 'true');
    }
  }
  function updateRate(){
    const mode=get('rateMode').value;
    const copy=get('operation').value==='copy';
    const vvc=get('codec').value==='h266';
    qualityField.firstChild.textContent=vvc?'量化参数 QP（0–63，越低通常越保真）':'质量值 CRF / CQ（通常越低越保真）';
    setRateControl('budgetPolicy',!copy && mode==='size');
    get('rateMode').querySelector('option[value="quality"]').textContent=vvc?'固定量化参数 QP':'固定质量 CRF / CQ';
    setRateControl('quality', !copy && mode==='quality');
    setRateControl('bitrate', !copy && mode==='bitrate');
    for(const key of ['targetSize','sizeUnit','sizeReserve'])setRateControl(key, !copy && mode==='size');

    get('twoPass').disabled=copy||get('encoder').value!=='libx264'||mode==='quality';
    if(get('twoPass').disabled)get('twoPass').checked=false;

    const encoded=['aac','libopus'].includes(get('audio').value);
    for(const key of ['audioBitrate','audioChannels','audioSampleRate'])get(key).disabled=!encoded;
  }
  const handleSharedAudioChange = event => {
    const audioControl=outputPolicy?.querySelector('[name="audio"]');
    if (event.target !== audioControl) return;
    updateRate();audioStreamPlan.refresh();
    syncAudioPlaybackWarning();
  };
  const invalidateBudgetEvidence = () => {if(budgetSourceIdentity!==hooks.videoIdentity?.()){latestAuxPreflight=null;budgetEvidence=null;section.querySelector('#taskBudgetLedger').textContent='来源已变更；复制流与附件成本未测量。';section.querySelector('#taskAuxiliaryPreflightStatus').textContent='来源已变更：旧 FLAC / 裁切复制观测已失效。';}};
  function syncReviewSource(){
    currentPlanTask=null;const identity=hooks.videoIdentity?.()||'';
    if(identity!==reviewSourceIdentity){reviewSourceIdentity=identity;markCompletedAsPrevious('source');activeTask=null;syncOutputVerificationAvailability();}
    syncTaskReview();
  }
  const mediaInfoListener = () => { syncReviewSource();invalidateBudgetEvidence();syncCopyStrategy();audioStreamPlan.refresh();syncAudioPlaybackWarning(); syncVideoStreamInfo(); syncTaskActions(); clearClipQueueOnSourceChange(); syncClipQueue(); syncRecipeMatrix(); hooks.onBudgetEvidenceChange?.(); };
  document.addEventListener('change',handleSharedAudioChange);
  document.addEventListener('quick-hardsub-media-info-changed',mediaInfoListener);
  const invalidateCurvesOnMediaChange = () => transcodeCurves.invalidate();
  document.addEventListener('quick-hardsub-media-info-changed',invalidateCurvesOnMediaChange);
  get('rateMode').onchange=updateRate;
  section.querySelector('#taskStore').onclick=()=>{try{const name=get('configName').value.trim();if(!name||name.length>80)throw Error('请输入 1–80 字的配置名称');const c=configs();Object.defineProperty(c,name,{value:read(),enumerable:true,configurable:true,writable:true});localStorage.setItem(storageKey,JSON.stringify(c));refreshConfigs();get('savedConfig').value=name;status('配置已保存');}catch(e){status(e.message);}};
  section.querySelector('#taskRestore').onclick=()=>{try{const raw=configs()[get('savedConfig').value];if(raw){applyConfig(raw);renderPlanSummary(activeTask);}}catch(e){status(e.message);}};
  section.querySelector('#taskDelete').onclick=()=>{const c=configs();delete c[get('savedConfig').value];localStorage.setItem(storageKey,JSON.stringify(c));refreshConfigs();};
  section.querySelector('#taskExportConfig').onclick=()=>download({version:2,settings:read()},'media-config.json');
  section.querySelector('#taskImportConfig').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>65536)throw Error('配置文件超过 64 KiB');const data=JSON.parse(await file.text());if(data.version!==2||!data.settings||typeof data.settings!=='object')throw Error('配置格式无效');applyConfig(data.settings);status('已导入配置，执行前仍会验证参数');}catch(err){status(err.message);}finally{e.target.value='';}};
  section.querySelector('#taskReport').onclick=async()=>{
    if(!lastReport)return;
    const jobId=completed?.jobId;
    if(jobId && lastReport.trimCopyAuditState==='running' && hooks.refreshCompletedAudit){
      try{
        const evidence=await hooks.refreshCompletedAudit(jobId);
        if(evidence?.state==='completed' && completed?.jobId===jobId){
          completed={...completed,outputPacketEvidence:evidence.outputPacketEvidence,
            outputPacketAuditState:evidence.outputPacketAuditState};
          lastReport=buildAuditedTaskReport(activeTask||completed.task,completed,lastReport.elapsedSeconds);
          if(artifactReview)artifactReview.report=structuredClone(lastReport);
          if(lastReport.auxiliaryParity?.comparable){
            status('后台逐流成品审计完成'+auxiliaryParityMessage(lastReport)+completedByteLedgerMessage(lastReport)+'。');
          }else if(lastReport.trimCopyAudit){
            status('后台裁切复制流审计完成'+completedByteLedgerMessage(lastReport)+'；正式完整源流预算未改变。');
          }else if(lastReport.trimCopyAuditState==='unavailable'){
            status('后台裁切复制流审计不可用；现有成品与正式预算仍有效。');
          }
        }
      }catch(err){hooks.log?.('裁切审计收据刷新失败：'+err.message);}
    }
    download(lastReport,'media-task-report.json');
  };
  let lastManualCodec=get('codec').value;
  let previousPixelFormat=null;
  get('codec').onchange=()=>{
    const codec=get('codec').value;
    if(codec==='h266' && lastManualCodec!=='h266'){
      previousPixelFormat=get('pixelFormat').value;
      get('pixelFormat').value='yuv420p10le';
    }else if(lastManualCodec==='h266' && previousPixelFormat){
      get('pixelFormat').value=previousPixelFormat;previousPixelFormat=null;
    }
    lastManualCodec=codec;
    updateEncoder();get('quality').value=['av1','h266'].includes(codec)?'32':'23';
    syncQualityRange();transcodeCurves.refresh();
  };
  get('encoder').onchange=()=>{updatePreset();updateRate();};
  get('operation').onchange=()=>{if(get('operation').value==='copy')get('budgetPolicy').value='best-effort';updateMode();updateRate();};
  get('videoRange').onchange=()=>{updateMode();renderPlanSummary(activeTask);};
  get('audioRange').onchange=()=>renderPlanSummary(activeTask);
  get('subtitleRange').onchange=()=>renderPlanSummary(activeTask);
  get('videoStreams').addEventListener('input',()=>{clearTimelineFrameCache();renderPlanSummary(activeTask);});
  section.querySelector('#taskLoadPreset').onclick=()=>{markCompletedAsPrevious('preset');updatePreset(true);get('quality').value=['av1','h266'].includes(get('codec').value)?'32':'23';get('rateMode').value='quality';updateRate();renderPlanSummary(activeTask);status('已恢复推荐方案；其他高级设置保持当前值。先确认“当前方案”，需要时再展开详细参数。');};
  let platformKey='';
  const platformTimer=setInterval(()=>{syncHardsubStrategyChrome();const key=JSON.stringify(hooks.platformKey());if(key!==platformKey&&!busy){platformKey=key;updateEncoder();}},1000);
  const prepare=async()=>{
    const raw=read(),media=await hooks.prepare(raw.operation);
    const task=compileTask({...raw,budgetPolicy:raw.operation!=='copy'&&raw.rateMode==='size'?raw.budgetPolicy:'best-effort'},{...media,budgetEvidence:budgetSourceIdentity===hooks.videoIdentity?.()?budgetEvidence:undefined});
    await hooks.validate?.(task);
    currentPlanTask=task;
    renderContainerDecision(task);
    syncAudioPlaybackWarning(task,media);
    const compat = Array.isArray(task.compatibilityWarnings) && task.compatibilityWarnings.length
      ? ' 兼容性：'+task.compatibilityWarnings.join(' ')
      : '';
    section.querySelector('#taskEstimate').textContent=(task.sizePlan ? '目标 '+formatSize(task.sizePlan.targetBytes)+' · 视频 '+task.bitrate+' bit/s · 预留 '+task.sizePlan.reservePercent+'% · ' : '')+'预计音视频数据：'+formatSize(task.estimatedBytes)+'。质量模式需试压估计；封装、字幕与码率偏差仍影响实际大小。'+compat;
    section.querySelector('#taskCommand').textContent=commandPreview(task);
    renderPlanSummary(task);
    return {task,media};
  };
  // Queue export reuses the existing compile/validate/run/save hooks. Never
  // launch the next Native job while a save dialog for this job is pending.
  const saveQueuedResult=async result=>{
    let listener=null;
    const nativeOutcome=result.jobId?new Promise((resolve,reject)=>{
      listener=event=>{
        const data=event.detail||{};
        if(data.jobId!==result.jobId)return;
        window.removeEventListener('quick-hardsub-native-export-result',listener);
        listener=null;
        if(data.ok)resolve(data);
        else reject(Error(data.error||'本机导出未完成'));
      };
      window.addEventListener('quick-hardsub-native-export-result',listener);
    }):null;
    try{
      const saved=await Promise.resolve(hooks.save(result));
      if(artifactReview)artifactReview.saveKind=saved?.kind||'';
      if(saved?.ok===false)throw Error(saved.error||'保存失败');
      if(saved?.pending){
        if(!nativeOutcome)throw Error('无法确认成品保存完成，批量任务已暂停');
        await nativeOutcome;
      }
    }finally{
      if(listener)window.removeEventListener('quick-hardsub-native-export-result',listener);
    }
  };

  section.querySelector('#taskStopRecipes').onclick=()=>{
    if(!recipeBatchRunning||recipeStopRequested)return;
    recipeStopRequested=true;
    recipeMessage.textContent='停止请求已记录。当前保存窗口须先完成或取消。';
    if(recipeCurrent?.state==='running')hooks.cancel();
    syncRecipeMatrix();
  };
  section.querySelector('#taskRunRecipes').onclick=async()=>{
    if(busy||hooks.busy()||recipeBatchRunning||clipBatchRunning||clipAwaitingSave||recipePendingSave)return;
    let current=null,phase='preflight';
    try{
      if(!recipes.length)throw Error('先加入至少一个输出方案');
      if(!recipeSource()||recipeSourceKey!==recipeSource())throw Error('来源已变化，拒绝执行旧矩阵');
      if(completed&&['verified','save_failed'].includes(section.dataset.taskState))
        throw Error('先保存当前已验证成品，避免覆盖');
      busy=true;recipeBatchRunning=true;recipeStopRequested=false;
      hooks.setBusy(true);
      for(const element of form.elements)element.disabled=true;
      for(const button of modeButtons)button.disabled=true;
      setTaskState('preparing');syncRecipeMatrix();
      const pending=recipes.map((entry,index)=>({entry,index})).filter(x=>x.entry.state!=='saved');
      // Compile at "add" time, freeze, then validate EVERY immutable task
      // before the first encoding step. This never reads the mutable form.
      const jobs=[];
      for(const {entry,index} of pending){
        const source=recipeSource(),asset=recipeAsset();
        const media=await hooks.prepare(entry.recipe.task.operation);
        const task=validateOutputRecipe(entry.recipe,{sourceKey:source,assetKey:asset,media});
        await hooks.validate?.(task);
        jobs.push({entry,index,task,media});
      }
      for(const item of jobs){
        if(recipeStopRequested)break;
        current=item;recipeCurrent=item.entry;phase='encode';
        validateOutputRecipe(item.entry.recipe,{
          sourceKey:recipeSource(),assetKey:recipeAsset(),media:hooks.mediaSnapshot?.()
        });
        item.entry.state='running';activeTask=item.task;currentPlanTask=item.task;
        executingSourceName=hooks.sourceName?.()||'来源';
        taskStartedAt=performance.now();
        section.querySelector('#taskProgress').value=0;
        section.querySelector('#taskPercent').textContent='0%';
        setTaskState('encoding');syncRecipeMatrix();
        recipeMessage.textContent='正在生成独立输出 '+(item.index+1)+' / '+recipes.length+
          '：'+item.entry.recipe.label;
        const result=await hooks.run(item.task,item.media,(p,message,meta)=>updateTaskProgress(p,message,meta));
        if(!result?.verified)throw Error('当前配方尚未通过后端成品验证');
        completed={...result,name:outputRecipeFilename(result.name,item.index+1)};
        completedStale=false;
        lastReport=buildAuditedTaskReport(item.task,completed,(performance.now()-taskStartedAt)/1000);
        artifactReview={source:executingSourceName,task:structuredClone(item.task),report:structuredClone(lastReport)};
        if(lastReport.deliveryAllowed===false)throw Error('成品未通过交付预算，拒绝保存');
        section.querySelector('#taskProgress').value=1;
        section.querySelector('#taskPercent').textContent='100%';
        section.querySelector('#taskReport').disabled=false;
        setTaskState('verified');
        phase='save';item.entry.state='saving';syncRecipeMatrix();
        setTaskState('saving');
        await saveQueuedResult(completed);
        item.entry.state='saved';setTaskState('saved');
        recipeMessage.textContent='已保存 '+recipes.filter(r=>r.state==='saved').length+
          ' / '+recipes.length+' 个独立输出。';
        syncRecipeMatrix();
      }
      if(recipeStopRequested)recipeMessage.textContent='已停止后续输出；已保存成品保持有效。';
      else if(recipes.every(r=>r.state==='saved'))recipeMessage.textContent=
        '全部 '+recipes.length+' 个输出已独立执行、验证并保存。';
    }catch(err){
      if(current){
        if(phase==='save'&&completed?.verified){
          current.entry.state='save_failed';
          recipePendingSave=current.entry;
          setTaskState('save_failed');
        }else{
          current.entry.state='failed';
          setTaskState(isCancellationError(err)?'idle':'failed');
        }
      }else setTaskState('failed');
      recipeMessage.textContent='矩阵在'+(current?'方案 '+(current.index+1):'预检查')+
        '停止：'+err.message+(recipePendingSave?'；成品仍在，点击“重试保存”即可':'；已保存输出不会重做');
      hooks.log?.(err.stack||err.message);
    }finally{
      recipeCurrent=null;recipeBatchRunning=false;recipeStopRequested=false;
      busy=false;hooks.setBusy(false);
      for(const el of form.elements)el.disabled=false;
      for(const btn of modeButtons)btn.disabled=false;
      section.querySelector('#taskCancel').disabled=true;
      updateMode();updateRate();audioStreamPlan.refresh();
      syncTaskActions();syncClipQueue();syncRecipeMatrix();
    }
  };
  section.querySelector('#taskStopClips').onclick=()=>{
    if(!clipBatchRunning||clipBatchStopRequested)return;
    clipBatchStopRequested=true;
    showClipMessage('停止请求已记录；若已打开系统保存对话框，请先完成或取消该对话框。');
    if(clipBatchCurrent?.state==='running')hooks.cancel();
    syncClipQueue();
  };
  section.querySelector('#taskExportClips').onclick=async()=>{
    if(clipBatchRunning||recipeBatchRunning||recipePendingSave||busy||hooks.busy())return;
    let current=null,phase='prepare';
    try{
      if(!clips.length)throw Error('请先加入至少一个片段');
      if(clipSourceKey!==clipSource()||!clipSource())throw Error('视频已变化，请重新建立片段列表');
      if(!clipMedia())throw Error('请先读取视频参数');
      const settings=read();
      validateQueuedCopySettings(settings);
      if(clipEditingIndex>=0)throw Error('请先更新或取消正在编辑的片段');
      if(clipAwaitingSave||recipePendingSave)throw Error('先重试保存未导出的队列成品，避免重新压制');
      if(completed&&['verified','save_failed'].includes(section.dataset.taskState))
        throw Error('先保存或处理上一任务的成品，避免批量剪切覆盖未保存的结果');
      // Reserve task ownership before await: no duplicate bulk runs, mode
      // changes or one-off submissions while Native input preparation awaits.
      busy=true;clipBatchRunning=true;clipBatchStopRequested=false;
      hooks.setBusy(true);
      for(const element of form.elements)element.disabled=true;
      for(const button of modeButtons)button.disabled=true;
      setTaskState('preparing');
      syncClipQueue();
      const media=await hooks.prepare('copy');
      if(!media)throw Error('未能读取当前视频参数');
      // Validate all pending ranges before running the first irreversible export.
      const pending=clips.map((clip,index)=>({clip,index}))
        .filter(({clip})=>clip.state!=='saved');
      const tasks=pending.map(({clip,index})=>{
        const raw={...settings,start:clip.startText,end:clip.endText};
        return {clip,index,task:compileTask(raw,media)};
      });
      if(!tasks.length){showClipMessage('全部片段已导出。');syncClipQueue();return;}
      for(const {task} of tasks)await hooks.validate?.(task);
      section.querySelector('#taskStopClips').disabled=false;
      syncClipQueue();
      for(const item of tasks){
        if(clipBatchStopRequested)break;
        current=item;clipBatchCurrent=item.clip;phase='run';
        item.clip.state='running';
        activeTask=item.task;currentPlanTask=item.task;executingSourceName=hooks.sourceName?.()||'执行时来源';taskStartedAt=performance.now();
        section.querySelector('#taskProgress').value=0;
        section.querySelector('#taskPercent').textContent='0%';
        showClipMessage('正在处理片段 '+(item.index+1)+' / '+clips.length+'：'+item.clip.startText+' → '+item.clip.endText);
        setTaskState('encoding');syncClipQueue();
        const result=await hooks.run(item.task,media,(fraction,message,meta)=>updateTaskProgress(fraction,message,meta));
        if(!result?.verified)throw Error('该片段尚未通过成品验证');
        if(clipBatchStopRequested)break;
        // The output is unique even for repeated same-source clips.
        completed={...result,name:clipOutputName(result.name,item.index+1)};
        completedStale=false;lastReport=null;
        artifactReview={source:executingSourceName,task:structuredClone(item.task),report:outputReport(item.task,completed,(performance.now()-taskStartedAt)/1000)};
        section.querySelector('#taskProgress').value=1;
        section.querySelector('#taskPercent').textContent='100%';
        setTaskState('verified');
        phase='save';item.clip.state='saving';syncClipQueue();
        showClipMessage('片段 '+(item.index+1)+' 已完成，正在分别保存成品…');
        setTaskState('saving');
        await saveQueuedResult(completed);
        item.clip.state='saved';
        setTaskState('saved');
        showClipMessage('已导出 '+clips.filter(c=>c.state==='saved').length+' / '+clips.length+' 段。');
        syncClipQueue();
      }
      if(clipBatchStopRequested){
        showClipMessage('批量任务已停止；已成功保存的片段仍然保留。');
        if(!completed||section.dataset.taskState==='encoding')setTaskState('idle');
      }else if(clips.every(c=>c.state==='saved')){
        showClipMessage('全部 '+clips.length+' 个独立片段已导出。实际无损起点可能按关键帧调整。');
      }
    }catch(err){
      if(current){
        if(phase==='save'&&completed?.verified){
          // The copy job succeeded. Keep its verified output and offer a
          // save-only retry, without launching FFmpeg a second time.
          current.clip.state='save_failed';
          clipAwaitingSave=current.clip;
          setTaskState('save_failed');
        }else{
          current.clip.state='failed';
          setTaskState(isCancellationError(err)?'idle':'failed');
        }
      }
      if(current&&phase==='save'&&completed?.verified){
        showClipMessage('片段 '+(current.index+1)+' 保存未完成：'+err.message+'。已验证成品仍保留；点击“重试保存”，无需重新剪切。');
      }else{
        showClipMessage('片段 '+(current?current.index+1:'队列')+' 未完成：'+err.message+'。已导出的片段不会撤销；可重试未完成片段。');
      }
      hooks.log?.(err.stack||err.message);
    }finally{
      clipBatchCurrent=null;clipBatchRunning=false;clipBatchStopRequested=false;
      busy=false;hooks.setBusy(false);
      for(const element of form.elements)element.disabled=false;
      for(const button of modeButtons)button.disabled=false;
      section.querySelector('#taskCancel').disabled=true;
      updateMode();updateRate();audioStreamPlan.refresh();syncTaskActions();syncClipQueue();
    }
  };

  section.querySelector('#taskMeasureBudget').onclick=async()=>{
    if(busy||hooks.busy())return;
    const button=section.querySelector('#taskMeasureBudget'),ledger=section.querySelector('#taskBudgetLedger');
    const identity=hooks.videoIdentity?.();
    if(!hooks.measureBudget||!identity){ledger.textContent='当前后端未提供成本计量；可选择 AAC / Opus 并关闭未测流。';return;}
    busy=true;hooks.setBusy(true);button.disabled=true;syncTaskActions();
    ledger.textContent='正在扫描完整源文件，最多 80 秒；不会重编码…';
    try{
      latestAuxPreflight=null;
      const result=await hooks.measureBudget();
      if(identity!==hooks.videoIdentity?.())throw Error('测量期间来源变更，结果已丢弃');
      if(result?.version!==1||result.scope!=='full-source')throw Error('成本测量格式无效');
      budgetEvidence=result;budgetSourceIdentity=identity;
      ledger.textContent='完整源流成本已测量。点击“验证当前方案”查看预算分项；裁切复制流按完整源流保守预留，FLAC 重编码仍未知。';
    }catch(e){budgetEvidence=null;ledger.textContent='成本仍未知：'+e.message;}
    finally{busy=false;hooks.setBusy(false);button.disabled=false;transcodeCurves.invalidate();hooks.onBudgetEvidenceChange?.();syncTaskActions();}
  };
  section.querySelector('#taskAuxiliaryPreflight').onclick=async()=>{
    const statusEl=section.querySelector('#taskAuxiliaryPreflightStatus');
    const btn=section.querySelector('#taskAuxiliaryPreflight');
    if(busy||hooks.busy())return;
    const sourceKey=hooks.videoIdentity?.()||'';
    const budget=budgetSourceIdentity===sourceKey?budgetEvidence:null;
    const selected=buildAuxiliaryPreflightRequest({
      settings:read(),media:hooks.mediaSnapshot?.(),budgetEvidence:budget
    });
    if(!selected.ok){
      statusEl.textContent='无法建立逐流预演：'+selected.reason+
        (selected.detail?' · '+selected.detail:'')+'。请先测量完整源流并检查音轨及 IN/OUT。';
      return;
    }
    if(!hooks.auxiliaryPreflight){
      statusEl.textContent='此预演仅支持 Windows Native；当前后端不提供独立逐流预编码器。';
      return;
    }
    busy=true;hooks.setBusy(true);btn.disabled=true;syncTaskActions();
    statusEl.textContent=(selected.mode==='flac'?'FLAC':'裁切复制')+
      ' 独立预编码观测进行中；不会修改当前方案或目标字节数。';
    try{
      const response=await hooks.auxiliaryPreflight(selected.request);
      if(sourceKey!==hooks.videoIdentity?.() ||
         budgetSourceIdentity!==sourceKey ||
         response?.receipt?.measurementId!==budget?.measurementId)
        throw Error('来源或完整源流计量已更换，拒收预演。');
      const receipt=response.receipt;
      const sourceStat={length:Number(response.sourceSize),writeTicks:String(receipt.sourceWriteTicks)};
      const result=selected.mode==='flac'
        ?assessFlacEncodeObservation({receipt,request:selected.request,sourceStat,fullSourceEvidence:budget})
        :assessIsolatedTrimCopyPreflight({receipt,request:selected.request,sourceStat,fullSourceEvidence:budget});
      if(!result.ok)throw Error(result.reason);
      latestAuxPreflight={request:selected.request,receipt,
        sourceKey,measurementId:budget.measurementId,
        sourceStat,partial:selected.partial};
      statusEl.textContent=(selected.mode==='flac'?'真实 FLAC 音频':'隔离裁切复制')+
        ' 观察包字节 '+formatSize(result.observedBytes)+
        ' · '+(result.tracks?.length||result.mapped?.length||0)+' 条流'+
        (selected.partial?' · 仅覆盖其中一部分选流':'')+
        '。此收据仅供诊断，严格体积预算仍按独立保守规则；未经最终混合封装证明不能采用此数值。';
    }catch(e){statusEl.textContent='预演不可采用：'+e.message+'；正式体积预算保持不变。';}
    finally{busy=false;hooks.setBusy(false);btn.disabled=false;syncTaskActions();}
  };
  section.querySelector('#taskInspect').onclick=async()=>{if(busy||hooks.busy())return;busy=true;hooks.setBusy(true);try{await prepare();status('当前方案验证通过，可以直接开始；原始 FFmpeg 命令仅用于技术核对。');}catch(e){status(e.message);}finally{busy=false;hooks.setBusy(false);syncTaskActions();}};
  section.querySelector('#taskCancel').onclick=()=>{setTaskState('cancelling');hooks.cancel();status('正在取消…');};
  section.querySelector('#taskSave').onclick=async()=>{
    if(lastReport?.deliveryAllowed===false){status('成品超限或字节数未知，禁止保存。请增大预算、降低视频码率或调整流计划后重新执行。');return;}
    if(!completed||clipBatchRunning||recipeBatchRunning||busy||hooks.busy()||section.dataset.taskState==='saving')return;
    setTaskState('saving');
    syncClipQueue();
    status('正在打开保存位置；取消选择不会丢失已验证成品。');
    try{
      const result=await Promise.resolve(hooks.save(completed));
      if(result?.pending)return;
      if(result?.ok===false)throw Error(result.error||'保存失败');
      if(artifactReview)artifactReview.saveKind=result?.kind||'';
      setTaskState('saved');
      settlePendingClipSave(true);
      settlePendingRecipeSave(true);
      status(result?.kind==='browser-download'?'已交给浏览器保存。':'成品已保存。');
    }catch(e){
      setTaskState('save_failed');
      settlePendingClipSave(false);
      settlePendingRecipeSave(false);
      status('保存失败：'+e.message+'。已验证成品仍可直接重试保存，无需重新压制。');
      hooks.log?.(e.stack||e.message);
    }
  };
  form.onsubmit=async e=>{
    e.preventDefault();
    if(clipAwaitingSave||recipePendingSave){status('先重试保存已验证的队列成品，避免重新编码或覆盖。');return;}
    if(busy||hooks.busy()){status('已有任务正在运行，请等待或取消。');return;}
    busy=true;completed=null;completedStale=false;lastReport=null;activeTask=null;artifactReview=null;currentPlanTask=null;revokeVerificationFrames();outputVerification.hidden=true;taskStartedAt=performance.now();
    section.querySelector('#taskReport').disabled=true;
    section.querySelector('#taskProgress').value=0;
    section.querySelector('#taskPercent').textContent='0%';
    section.querySelector('#taskMediaTime').textContent='—';
    section.querySelector('#taskElapsed').textContent='0:00';
    section.querySelector('#taskSpeed').textContent='正在采样';
    section.querySelector('#taskEta').textContent='尚未可靠估计';
    setTaskState('preparing');
    hooks.setBusy(true);
    try {
      status('正在读取素材与检查设置…');
      const {task,media}=await prepare();
      activeTask=task;executingSourceName=hooks.sourceName?.()||'执行时来源';
      renderPlanSummary(task);
      for(const control of form.elements)control.disabled=true;
      section.querySelector('#taskCancel').disabled=false;
      setTaskState('encoding');
      const started=performance.now();
      completed=await hooks.run(task,media,(p,message,meta)=>updateTaskProgress(p,message,meta));
      lastReport=buildAuditedTaskReport(task,completed,(performance.now()-started)/1000);
      artifactReview={source:executingSourceName,task:structuredClone(task),report:structuredClone(lastReport)};
      section.querySelector('#taskReport').disabled=false;
      section.querySelector('#taskProgress').value=1;
      section.querySelector('#taskPercent').textContent='100%';
      section.querySelector('#taskMediaTime').textContent=formatTaskClock(task.expectedDuration)+' / '+formatTaskClock(task.expectedDuration);
      section.querySelector('#taskElapsed').textContent=formatTaskClock((performance.now()-taskStartedAt)/1000);
      section.querySelector('#taskEta').textContent='处理完成';
      if(!lastReport.deliveryAllowed){setTaskState('failed');status('成品超限或字节数未知，禁止交付。请增大预算、降低视频码率或调整流计划后重新执行；不会自动重编码。');return;}
      setTaskState('verified');
      syncOutputVerificationAvailability();
      const trimAudit=lastReport.trimCopyAudit;
      const trimAuditText=trimAudit
        ? ' · 裁切复制流：源预算上界 '+formatSize(trimAudit.sourcePacketBytes)+
          '，成品实测 '+formatSize(trimAudit.outputPacketBytes)+
          (trimAudit.status==='observed'
            ? '（节省 '+formatSize(trimAudit.overreserveBytes)+'，不减少正式预算）'
            : '（实测超出源预算，请复核来源流）')
        : lastReport.trimCopyAuditState==='running'
          ? ' · 裁切复制流审计正在后台运行；可稍后点任务报告刷新（不影响成品保存）'
          : lastReport.trimCopyAuditState==='unavailable'
            ? ' · 裁切复制流审计不可用；完整源流预算仍保留'
            : '';
      status('成品已验证 · '+formatSize(lastReport.outputBytes)+(lastReport.withinBudget===false?' · 超出体积预算；建议视频码率 '+lastReport.suggestedVideoRate+' bit/s':lastReport.withinBudget===true?' · 在体积预算内':'')+trimAuditText+auxiliaryParityMessage(lastReport)+completedByteLedgerMessage(lastReport)+' · 尚未保存到你的文件夹。下一步：保存成品。');
    }catch(e){
      if(isCancellationError(e)){
        setTaskState('idle');
        status('任务已取消。');
        section.querySelector('#taskEta').textContent='已取消';
      }else{
        setTaskState('failed');
        status('处理失败：'+e.message);
        section.querySelector('#taskEta').textContent='处理失败';
      }
      hooks.log(e.stack||e.message);
    }
    finally{
      busy=false;hooks.setBusy(false);for(const control of form.elements)control.disabled=false;
      updateMode();section.querySelector('#taskCancel').disabled=true;section.querySelector('#taskReport').disabled=!lastReport;updateRate();audioStreamPlan.refresh();syncTaskActions();
    }
  };
  section.querySelector('#taskSamples').onclick=async()=>{
    if(busy||hooks.busy())return;
    busy=true;hooks.setBusy(true);const raw=read();const results=section.querySelector('#taskSampleResults');
    try{
      const media=await hooks.prepare(raw.operation),full=compileTask({...raw,budgetPolicy:raw.rateMode==='size'?raw.budgetPolicy:'best-effort'},{...media,budgetEvidence:budgetSourceIdentity===hooks.videoIdentity?.()?budgetEvidence:undefined}),range=sampleSettings(raw,media);
      results.replaceChildren();for(const url of sampleUrls)URL.revokeObjectURL(url);sampleUrls=[];
      for(const control of form.elements)control.disabled=true;section.querySelector('#taskCancel').disabled=false;
      for(const adjustment of [-1,0,1]){
        const options={...raw,budgetPolicy:'best-effort',...range,frames:'',twoPass:false,keepAttachments:false,keepSubtitles:false,keepChapters:false};
        if(raw.rateMode==='quality')options.quality=sampleQualityTrial(full,adjustment).quality;
        else {options.rateMode='bitrate';options.bitrate=Math.round(Number(full.bitrate)*(1+adjustment*.2));}
        const task=compileTask(options,media);await hooks.validate?.(task);const started=performance.now();
        const result=await hooks.run(task,media,(p,message)=>{section.querySelector('#taskProgress').value=(adjustment+1+p)/3;status('短片 '+(adjustment+2)+'/3 · '+message);});
        const report=outputReport(task,result,(performance.now()-started)/1000),row=document.createElement('div');row.className='task-sample';
        row.innerHTML=`<p>${escape(raw.rateMode==='quality'?sampleQualityTrial(full,adjustment).label+' '+options.quality:'视频码率 '+options.bitrate+' bit/s')} · ${escape(formatSize(report.outputBytes))} · ${report.elapsedSeconds.toFixed(1)} 秒；整片外推 ${escape(formatSize(sampleProjection(report.outputBytes,task.expectedDuration,full.expectedDuration)))}</p>`;
        if(result.blob){const video=document.createElement('video');video.controls=true;video.preload='metadata';const url=URL.createObjectURL(result.blob);sampleUrls.push(url);video.src=url;row.append(video);}
        const save=document.createElement('button');save.type='button';save.textContent='保存此短片';save.onclick=()=>hooks.save(result);row.append(save);
        const use=document.createElement('button');use.type='button';use.textContent='采用此参数';use.onclick=()=>{markCompletedAsPrevious('sample');if(raw.rateMode==='quality')get('quality').value=options.quality;else{get('rateMode').value='bitrate';get('bitrate').value=options.bitrate;}updateRate();status('已采用此短片参数；请重新检查整片体积预算。');};row.append(use);results.append(row);
      }
      status('三组试压完成；浏览器播放受 AV1 / H.266 / MKV 支持限制，可保存短片比较。');
    }catch(e){status('试压失败：'+e.message);}
    finally{busy=false;hooks.setBusy(false);for(const control of form.elements)control.disabled=false;updateMode();updateRate();audioStreamPlan.refresh();section.querySelector('#taskCancel').disabled=true;section.querySelector('#taskReport').disabled=!lastReport;syncTaskActions();}
  };
  const invalidateCompiledPlan = event => {
    const sourceName=event?.target?.name||'';
    if(!sourceName)return;
    if(['audio','audioTrack','audioRange','audioBitrate'].includes(sourceName))audioStreamPlan.refresh();
    if(!new Set(['sampleStart','sampleLength','configName','savedConfig']).has(sourceName)) transcodeCurves.invalidate();
    markCompletedAsPrevious(sourceName);
    latestAuxPreflight=null;
    activeTask=null;currentPlanTask=null;
    renderContainerDecision(null);
    syncAudioPlaybackWarning();
    renderPlanSummary();
    // Audio choices change the full-container cost coordinate even when
    // source packet evidence and video-only CQ measurements stay valid.
    if(['audio','audioTrack','audioRange','audioBitrate','audioChannels',
        'audioSampleRate','audioPlan'].includes(sourceName)){
      hooks.onBudgetEvidenceChange?.();
    }
  };
  outputPolicy?.addEventListener('input',event=>{if(!form.contains(event.target))invalidateCompiledPlan(event);});
  outputPolicy?.addEventListener('change',event=>{if(!form.contains(event.target))invalidateCompiledPlan(event);});
  form.addEventListener('input',invalidateCompiledPlan);
  form.addEventListener('change',invalidateCompiledPlan);
  updateEncoder();updateMode();updateRate();refreshConfigs();syncQualityRange();syncAudioPlaybackWarning();renderPlanSummary();setTaskState('idle');syncRecipeMatrix();
  initialManualSettings=read();
  return {section,runCurrent:()=>form.onsubmit({preventDefault(){}}),getActiveBudgetEvidence:()=>budgetSourceIdentity===hooks.videoIdentity?.()?budgetEvidence:null,refreshAudioPlaybackWarning:()=>syncAudioPlaybackWarning(),dispose:()=>{transcodeCurves.dispose();closeFrameFullscreen();revokeVerificationFrames();clearInterval(platformTimer);subtitleCardObserver.disconnect();document.removeEventListener('change',handleSharedAudioChange);document.removeEventListener('quick-hardsub-media-info-changed',mediaInfoListener);document.removeEventListener('quick-hardsub-media-info-changed',invalidateCurvesOnMediaChange);document.removeEventListener('keydown',frameFullscreenKeyHandler);window.removeEventListener('resize',frameFullscreenResizeHandler);window.removeEventListener('quick-hardsub-native-export-result',nativeExportListener);for(const url of sampleUrls)URL.revokeObjectURL(url);if(waveformUrl?.startsWith('blob:'))URL.revokeObjectURL(waveformUrl);modeNav.remove();outputPolicy?.remove();outputPolicyAnchor.remove();delete document.body.dataset.mediaOperation;delete document.body.dataset.hardsubStrategy;}};
}
