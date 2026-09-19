import './style.css';
import { parseAss, rewriteAssFonts, shiftAssForPreview } from './ass.js';
import { inspectFontFile, matchRequestedFonts } from './fonts.js';
import { listSavedFonts, saveFonts as persistFonts, deleteSavedFont, clearSavedFonts, requestPersistentFontStorage, getFontStorageEstimate } from './font-store.js';
import { detectCapabilities } from './capabilities.js';
import { EncoderEngine } from './engine.js';

const MAX_BYTES = 1024 ** 3;
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
  fontMatches: [],
  media: null,
  engine: null,
  capabilities: null,
  nativeBackend: null,
  nativeSelfTest: null,
  softwareEncoders: { h264: null, h265: null, av1: null },
  softwareDecoders: { av1Dav1d: null },
  inputDecodeOk: false,
  previewUrls: [],
  previewBaseUrls: [],
  previewFontEvents: [],
  previewVisualChange: [],
  previewTimes: [],
  benchmarks: {},
  selectedCodec: null,
  selectedTest: null,
  acceptedWarnings: false
};

const app = document.querySelector('#app');
app.innerHTML = `
<div class="app-shell">
  <header class="hero">
    <h1>快捷自动硬字幕压制器</h1>
    <p>一种在浏览器本地运行，自动完成 ASS 字幕预检、字体检查、编码比较与 H.264 / H.265 / AV1 硬字幕压制的快捷工具。</p>
  </header>

  <section class="card">
    <h2>1. 选择文件</h2>
    <div class="grid two">
      <div class="file-row"><label>视频（≤ 1 GB）</label><input id="video" type="file"><small id="videoMeta">未选择；使用通用文件选择器，视频格式交给 FFprobe 判断。</small></div>
      <div class="file-row"><label>ASS 字幕</label><input id="ass" type="file" accept=".ass,text/plain"><small id="assMeta">未选择</small></div>
      <div class="file-row">
        <label>字体（可选，可多选）</label>
        <input id="fonts" type="file" multiple accept=".ttf,.otf,.ttc,.otc">
        <label class="font-persist-check"><input id="rememberFonts" type="checkbox" checked> 记住本次选择，加入本机常用字体库</label>
        <small id="fontMeta">未选择；常用字体库会自动参与 ASS 字体匹配。</small>
        <details class="font-library-details">
          <summary id="savedFontsSummary">常用字体库：加载中…</summary>
          <div id="savedFontsList" class="font-library-list"></div>
          <div class="button-row"><button id="clearSavedFontsBtn" type="button">清空常用字体库</button></div>
        </details>
      </div>
      <div class="file-row"><label>处理后端</label>
        <div id="backendSummary" class="note">正在检测网页 / Android 原生后端…</div>
      </div>
    </div>
    <div class="button-row"><button id="analyze" class="primary" disabled>分析字幕与设备</button></div>
  </section>

  <section class="card env-card">
    <details id="envDetails" class="env-details">
      <summary>
        <span class="env-heading">2. 运行环境</span>
        <span id="envSummary" class="env-summary">检测中…</span>
      </summary>
      <div class="env-body">
        <div id="capabilities" class="status-list"><div class="status-item"><span>状态</span><span>检测中…</span></div></div>
        <p id="engineHint" class="note"></p>
      </div>
    </details>
  </section>

  <section id="preflightCard" class="card preflight-card hidden">
    <details id="preflightDetails" class="preflight-details">
      <summary>
        <span class="preflight-heading">3. 媒体与字幕预检</span>
        <span id="preflightStatus" class="preflight-status">等待分析</span>
      </summary>
      <div class="preflight-body">
        <div id="subtitleSummary" class="status-list"></div>
        <div id="fontWarnings"></div>
      </div>
    </details>
  </section>

  <section id="subtitleCard" class="card hidden">
    <h2>4. 字幕预览</h2>
    <p class="note">使用实际 FFmpeg + libass 渲染结果检查字体、位置、描边和回退；预览与上面的媒体信息分开。</p>
    <div class="button-row">
      <button id="previewBtn" disabled>生成真实字幕预览</button>
    </div>
    <div id="preview" class="preview-wrap"><div class="preview-placeholder">分析完成后可生成真实预览帧。</div></div>
    <div id="warningAccept" class="hidden" style="margin-top:12px"><label><input type="checkbox" id="acceptWarnings"> 已查看预览，接受当前字体回退/缺失警告并继续。</label></div>
  </section>

  <section id="planCard" class="card hidden">
    <h2>5. 选择压制方案</h2>
    <p class="note">主流程不再先压三种短样本再猜整片。体积约束模式按目标码率控制；质量模式使用 CRF/CQ。测试片段只用于看画质、字幕和当前设备速度。</p>

    <div class="grid two plan-controls">
      <div class="file-row">
        <label>压制目标</label>
        <select id="encodeGoal">
          <option value="balanced">均衡：CRF 质量模式</option>
          <option value="quality">质量优先：CRF 质量模式</option>
          <option value="speed">速度优先：CRF 质量模式</option>
          <option value="size16">体积预算：1.6×（用于自动选参数）</option>
          <option value="size20">体积预算：2.0×（用于自动选参数）</option>
        </select>
        <small>1.6× / 2.0× 只参与参数规划：结合源码率、音频、时长和目标编码器计算单遍目标平均码率。它不是严格成品大小保证，也不会改变成两遍流程。</small>
      </div>
      <div id="sourceAnchor" class="plan-anchor note">分析完成后显示源码率与压缩密度。</div>
    </div>

    <div id="codecPlanGrid" class="grid three codec-plan-grid" style="margin-top:14px"></div>
    <div id="chosenSummary" class="note plan-summary">请选择一个编码器。</div>

    <div class="button-row">
      <button id="testSelectedBtn" disabled>生成所选方案测试片段</button>
    </div>
    <div id="selectedTestResult" class="hidden"></div>

    <details class="advanced-box">
      <summary>高级：三编码器比较实验</summary>
      <p class="note">仅用于研究，不参与主流程自动决策。短样本的速度、SSIM 和码率不能当成整片的精确预测。</p>
      <div class="button-row"><button id="benchmarkBtn" disabled>比较 H.264 / H.265 / AV1</button></div>
      <div id="codecGrid" class="grid three" style="margin-top:14px"></div>
    </details>
  </section>

  <section id="encodeCard" class="card hidden">
    <h2>6. 正式压制</h2>
    <div id="liveEta" class="note">开始压制后根据 FFmpeg 实际进度动态计算速度与剩余时间。</div>
    <div class="button-row">
      <button id="encodeBtn" class="primary" disabled>开始硬字幕压制</button>
    </div>
    <div class="progress"><div id="progressBar"></div></div>
  </section>

  <section class="card">
    <h2>技术日志</h2>
    <div id="log" class="log">Quick-Automatic-Hardsub-Encoder v0.1.0\n</div>
  </section>
</div>`;

const $ = id => document.getElementById(id);
const log = msg => { $('log').textContent += `${msg}\n`; $('log').scrollTop = $('log').scrollHeight; };
state.engine = new EncoderEngine(log);

$('video').addEventListener('change', e => {
  state.video = e.target.files?.[0] || null;
  $('videoMeta').textContent = state.video ? `${state.video.name} · ${formatBytes(state.video.size)}` : '未选择';
  $('videoMeta').className = state.video?.size > MAX_BYTES ? 'bad' : '';
  refreshAnalyze();
});
$('ass').addEventListener('change', e => {
  state.ass = e.target.files?.[0] || null;
  $('assMeta').textContent = state.ass ? state.ass.name : '未选择';
  refreshAnalyze();
});
$('fonts').addEventListener('change', async e => {
  state.fonts = [...(e.target.files || [])];
  updateFontMeta();

  if ($('rememberFonts').checked && state.fonts.length) {
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

$('analyze').addEventListener('click', analyzeAll);
$('previewBtn').addEventListener('click', renderPreviews);
$('encodeGoal').addEventListener('change', () => {
  renderPlanOptions();
  refreshBenchmarkEnabled();
});
$('benchmarkBtn').addEventListener('click', runBenchmarks);
$('testSelectedBtn').addEventListener('click', runSelectedTest);
$('encodeBtn').addEventListener('click', runEncode);
$('clearSavedFontsBtn').addEventListener('click', async () => {
  if (!state.savedFonts.length) return;
  if (!confirm('清空本机常用字体库？这不会删除设备上的原字体文件。')) return;
  try {
    await clearSavedFonts();
    state.savedFonts = [];
    renderSavedFontLibrary();
    updateFontMeta();
    log('本机常用字体库已清空。');
  } catch (error) {
    log(`清空常用字体库失败：${error.message}`);
  }
});

bootstrap();

async function bootstrap() {
  detectNativeBackend();

  try {
    state.savedFonts = await listSavedFonts();
    renderSavedFontLibrary();
    updateFontMeta();
    if (state.savedFonts.length) log(`已加载本机常用字体库：${state.savedFonts.length} 个文件。`);
  } catch (error) {
    log(`读取常用字体库失败：${error.message}`);
    renderSavedFontLibrary();
  }

  state.capabilities = await detectCapabilities();
  renderCapabilities();
  const engineStatus = await state.engine.init();
  if (engineStatus.ready) {
    try {
      state.softwareEncoders = await state.engine.detectSoftwareEncoders();
      state.softwareDecoders = await state.engine.detectSoftwareDecoders();
      log(`WASM 软件编码器：x264=${state.softwareEncoders.h264} x265=${state.softwareEncoders.h265} SVT-AV1=${state.softwareEncoders.av1}`);
      log(`WASM 软件解码器：dav1d=${state.softwareDecoders.av1Dav1d}`);
    } catch (e) {
      log(`软件编码器检测失败：${e.message}`);
    }
    renderCapabilities();
    updateEnvironmentSummary(true);
    $('engineHint').innerHTML = '<span class="ok">FFmpegKitNext Web 核心已加载。</span> FFmpeg WASM 与浏览器原生能力是两套独立路径：dav1d/SVT-AV1 属于网页自带的软件编解码；“播放”表示浏览器能否直接处理该格式，“解码API/编码API”则表示 WebCodecs 是否进一步向网页开放接口。';
  } else {
    $('engineHint').innerHTML = '<span class="warn">FFmpegKitNext Web 核心尚未放入 vendor。</span> 当前可使用文件/ASS/字体分析和浏览器能力检测；真实预览与压制按钮会保持关闭。';
    $('envDetails').open = true;
  }
  updateEnvironmentSummary(engineStatus.ready);
  refreshAnalyze();
}

function detectNativeBackend() {
  const bridge = globalThis.NativeHardsub;
  if (!bridge?.getBackendInfo) {
    state.nativeBackend = null;
    state.nativeSelfTest = null;
    renderBackendSummary();
    return;
  }

  try {
    state.nativeBackend = JSON.parse(bridge.getBackendInfo());
    renderBackendSummary();
    log(`检测到 Android 原生壳：ABI=${state.nativeBackend.abi || 'unknown'} · FFmpegKitNext=${state.nativeBackend.ffmpegKitVersion || 'unknown'}`);

    globalThis.__onNativeSelfTest = payload => {
      try {
        state.nativeSelfTest = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        state.nativeSelfTest = { error: '原生自检结果解析失败' };
      }
      renderBackendSummary();
      const t = state.nativeSelfTest || {};
      log(
        `Android 原生自检：` +
        `x264=${!!t.x264EncodeSmoke} ` +
        `x265=${!!t.x265EncodeSmoke} ` +
        `SVT-AV1=${!!t.svtAv1EncodeSmoke} ` +
        `dav1d=${!!t.dav1d} ` +
        `libass视觉=${!!t.libassVisualSmoke} ` +
        `内置回退字体=${!!t.bundledFallbackReady}`
      );
    };

    if (bridge.runSelfTest) {
      bridge.runSelfTest();
    }
  } catch (error) {
    state.nativeBackend = { available: false, error: error.message };
    renderBackendSummary();
    log(`Android 原生后端检测失败：${error.message}`);
  }
}

function renderBackendSummary() {
  const el = $('backendSummary');
  if (!el) return;

  if (!state.nativeBackend?.available) {
    el.innerHTML = '浏览器模式：正式处理仍使用 FFmpeg WASM。Android APK 可提供 ARM64 原生后端；网页保留为免安装后备。';
    return;
  }

  const t = state.nativeSelfTest;
  if (!t) {
    el.innerHTML = `Android 原生壳已检测到：${escapeHtml(state.nativeBackend.abi || 'unknown')} · FFmpegKitNext ${escapeHtml(state.nativeBackend.ffmpegKitVersion || 'unknown')}。正在执行原生编解码/字幕自检；当前正式压制仍先保持 WASM，直到原生任务桥接完成。`;
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
  const details = [
    `x264实际编码 ${t.x264EncodeSmoke ? '✓' : '✗'}`,
    `x265实际编码 ${t.x265EncodeSmoke ? '✓' : '✗'}`,
    `SVT-AV1实际编码 ${t.svtAv1EncodeSmoke ? '✓' : '✗'}`,
    `dav1d ${t.dav1d ? '✓' : '✗'}`,
    `libass像素验证 ${t.libassVisualSmoke ? '✓' : '✗'}`,
    `Noto回退 ${t.bundledFallbackReady ? '✓' : '✗'}`,
    `FFprobe ${t.ffprobeSmoke ? '✓' : '✗'}`
  ].join(' · ');

  const fontDirs = t.fontDirs
    ? `<small class="native-font-dirs">字体目录：${escapeHtml(t.fontDirs)}</small>`
    : '';

  el.innerHTML =
    `${ok ? '<span class="ok">Android 原生核心实际自检通过。</span>' : '<span class="warn">Android 原生核心实际自检未完全通过。</span>'} ` +
    `${details}。正式压制切换到 Native 之前仍会保持 WASM 后备。${fontDirs}`;
}

function renderCapabilities() {
  const c = state.capabilities;
  const sw = state.softwareEncoders;
  const dec = state.softwareDecoders;

  const badge = (ok, text) =>
    `<span class="env-badge ${ok ? 'ok' : 'warn'}">${text}</span>`;

  const base = [
    ['WebAssembly', c.webAssembly, c.webAssembly ? '支持' : '不可用'],
    ['Web Worker', c.worker, c.worker ? '支持' : '不可用'],
    ['SharedArrayBuffer', c.sharedArrayBuffer, c.sharedArrayBuffer ? '支持' : '不可用'],
    ['跨源隔离', c.crossOriginIsolated, c.crossOriginIsolated ? '支持' : '未启用']
  ];

  const wasm = [
    ['H.264', 'x264 · 编码', sw.h264, sw.h264 === null ? '检测中' : sw.h264 ? '可用' : '未编入'],
    ['H.265', 'x265 · 编码', sw.h265, sw.h265 === null ? '检测中' : sw.h265 ? '可用' : '未编入'],
    ['AV1', 'SVT-AV1 · 编码', sw.av1, sw.av1 === null ? '检测中' : sw.av1 ? '可用' : '未编入'],
    ['AV1', 'dav1d · 解码', dec.av1Dav1d, dec.av1Dav1d === null ? '检测中' : dec.av1Dav1d ? '可用' : '未编入']
  ];

  const browserMatrix = [
    ['H.264', c.nativePlayback.h264, c.codecs.decode.h264, c.codecs.encode.h264],
    ['H.265', c.nativePlayback.hevc, c.codecs.decode.hevc, c.codecs.encode.hevc],
    ['AV1', c.nativePlayback.av1, c.codecs.decode.av1, c.codecs.encode.av1]
  ];

  $('capabilities').innerHTML = `
    <div class="env-group">
      <div class="env-group-title">基础环境</div>
      <div class="env-chip-grid">
        ${base.map(([name, ok, text]) => `
          <div class="env-chip"><span>${name}</span>${badge(ok, text)}</div>
        `).join('')}
      </div>
    </div>

    <div class="env-group">
      <div class="env-group-title">FFmpeg WASM</div>
      <div class="env-wasm-grid">
        ${wasm.map(([codec, detail, ok, text]) => `
          <div class="env-codec-card">
            <div><strong>${codec}</strong><small>${detail}</small></div>
            ${badge(ok, text)}
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
          <div>${badge(playback, playback ? '可播放' : '未报告')}</div>
          <div>${badge(decode, decode ? '可用' : '未暴露')}</div>
          <div>${badge(encode, encode ? '可用' : '未暴露')}</div>
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
  $('envSummary').className = 'env-summary';
}

async function decodeAssFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let encoding = 'UTF-8';
  let offset = 0;
  let text = '';

  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    encoding = 'UTF-8 BOM';
    offset = 3;
    text = new TextDecoder('utf-8').decode(bytes.subarray(offset));
  } else if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    encoding = 'UTF-16 LE BOM';
    offset = 2;
    text = new TextDecoder('utf-16le').decode(bytes.subarray(offset));
  } else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    encoding = 'UTF-16 BE BOM';
    offset = 2;
    try {
      text = new TextDecoder('utf-16be').decode(bytes.subarray(offset));
    } catch {
      const le = new Uint8Array(bytes.length - offset);
      for (let i = offset, j = 0; i + 1 < bytes.length; i += 2, j += 2) {
        le[j] = bytes[i + 1];
        le[j + 1] = bytes[i];
      }
      text = new TextDecoder('utf-16le').decode(le);
    }
  } else {
    text = new TextDecoder('utf-8').decode(bytes);
  }

  const nulMatches = text.match(/\u0000/g);
  const removedNulls = nulMatches ? nulMatches.length : 0;
  if (removedNulls) text = text.replaceAll('\u0000', '');

  if (!/\[Events\]/i.test(text) || !/Dialogue\s*:/i.test(text)) {
    throw new Error(
      'ASS 文本解析前检查失败：按 ' + encoding + ' 解码后没有找到 [Events]/Dialogue。' +
      '如果这是旧式 ANSI/GBK/Shift-JIS 字幕，需要先确认原始字符编码，不能静默猜测。'
    );
  }

  return { text, encoding, removedNulls };
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
        renderSavedFontLibrary();
        updateFontMeta();
        log(`已从常用字体库删除：${file.name}`);
      } catch (error) {
        log(`删除常用字体失败：${error.message}`);
      }
    });
  });
}

function refreshAnalyze() {
  $('analyze').disabled = !(state.video && state.ass && state.video.size <= MAX_BYTES);
}

async function analyzeAll() {
  try {
    $('analyze').disabled = true;
    state.acceptedWarnings = false;
    $('acceptWarnings').checked = false;
    state.previewUrls.filter(Boolean).forEach(URL.revokeObjectURL);
    state.previewBaseUrls.filter(Boolean).forEach(URL.revokeObjectURL);
    state.previewUrls = [];
    state.previewBaseUrls = [];
    state.previewFontEvents = [];
    state.previewVisualChange = [];
    state.previewTimes = [];
    state.inputDecodeOk = false;
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
    state.effectiveFonts = getEffectiveFontFiles();
    state.fontFaces = [];
    for (const file of state.effectiveFonts) {
      try { state.fontFaces.push(...await inspectFontFile(file)); }
      catch (e) { log(`字体 ${file.name} 解析失败：${e.message}`); }
    }
    state.fontMatches = matchRequestedFonts(state.assInfo.requestedFonts, state.fontFaces);

    if (state.engine.ready) {
      log(`挂载媒体文件与 ${state.effectiveFonts.length} 个可用字体到浏览器 WebAssembly 文件系统…`);
      await state.engine.stageFiles(state.video, state.ass, state.effectiveFonts);
      // Normalize every subtitle path to the exact UTF-8 text parsed by the UI.
      // This avoids preview/formal-encode differences for UTF-16 BOM files.
      await state.engine.setAssText(state.activeAssText);
      if (state.engine.hasBundledFallbackFont) {
        state.autoFontFallbacks = Object.fromEntries(
          state.fontMatches
            .filter(m => m.status === 'missing')
            .map(m => [m.requested, state.engine.fallbackFontFamily])
        );
        await state.engine.setFontMappings({ ...state.autoFontFallbacks, ...state.fontBindings });
      }
      state.media = await state.engine.probe();
      if (!state.media.width || !state.media.height) throw new Error('所选文件没有可识别的视频流');
      log(`FFprobe：${state.media.videoCodec} ${state.media.width}x${state.media.height} ${state.media.fps.toFixed(2)} fps · ${state.media.pixelFormat || '未知像素格式'} · ${state.media.bitDepth}-bit`);

      const smokeTime = Math.max(0, Math.min(state.media.duration * 0.1, 1));

      if (state.media.videoCodec === 'av1') {
        log('AV1 输入：直接执行 dav1d 真实 1 帧解码测试…');
        try {
          await state.engine.testDav1dInput(smokeTime);
          state.softwareDecoders.av1Dav1d = true;
          renderCapabilities();
          updateEnvironmentSummary(true);
          log('dav1d 实际解码通过。');
        } catch (dav1dError) {
          state.softwareDecoders.av1Dav1d = false;
          renderCapabilities();
          updateEnvironmentSummary(true);
          const nativeAv1 = !!state.capabilities?.codecs?.decode?.av1;
          const nativeHint = nativeAv1
            ? '浏览器的 WebCodecs AV1 解码可用，但当前正式压制流水线尚未接入该通道。'
            : '浏览器也没有通过 WebCodecs 暴露 AV1 解码能力。';
          throw new Error(`dav1d 实际解码测试失败：${dav1dError.message}。${nativeHint}`);
        }
      } else {
        log('执行输入解码 smoke test（只解码 1 帧）…');
        await state.engine.testInputDecode(smokeTime);
      }

      state.inputDecodeOk = true;
      log('输入视频解码测试通过。');
    }
    renderSubtitleSummary();
    $('preflightCard').classList.remove('hidden');
    $('subtitleCard').classList.remove('hidden');
    $('planCard').classList.remove('hidden');
    $('encodeCard').classList.remove('hidden');
    renderPlanOptions();
    $('previewBtn').disabled = !state.engine.ready || !state.assInfo.previewTimes.length;
    refreshBenchmarkEnabled();
  } catch (e) {
    log(`分析失败：${e.stack || e.message}`);
    alert(`分析失败：${e.message}`);
  } finally {
    refreshAnalyze();
  }
}

function renderSubtitleSummary() {
  const a = state.assInfo;
  const missing = state.fontMatches.filter(x => x.status === 'missing');
  const probable = state.fontMatches.filter(x => x.status === 'probable');
  const mediaRows = state.media ? [
    ['视频', `${state.media.videoCodec} · ${state.media.width}×${state.media.height} · ${state.media.fps.toFixed(2)} fps`],
    ['时长', formatDuration(state.media.duration)],
    ['源视频码率', formatBitrate(getSourceVideoBitrate())],
    ['压缩密度', formatBppf(getSourceBppf())],
    ['像素格式', `${state.media.pixelFormat || '未知'} · ${state.media.bitDepth}-bit`],
    ['色彩', [state.media.colorPrimaries, state.media.colorTransfer, state.media.colorSpace].filter(Boolean).join(' / ') || '未标记'],
    ['HDR/高位深', state.media.unsafeColorPipeline ? '检测到：当前版本禁止静默重编码' : '未检测到风险'],
    ['输入解码', state.inputDecodeOk ? '已通过 1 帧实测' : '未验证'],
    ['音频', state.media.audioCodec || '未检测到']
  ] : [];
  $('subtitleSummary').innerHTML = [
    ['ASS 对话', `${a.dialogueCount} 条`],
    ['ASS 请求字体', `${a.requestedFonts.length} 个`],
    ['可用字体 face', `${state.fontFaces.length} 个`],
    ['常用字体库', `${state.savedFonts.length} 个文件`],
    ['预览采样点', `${a.previewTimes.length} 个`],
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

  const notices = [];
  if (state.media?.unsafeColorPipeline) {
    notices.push(`<div class="error-box" style="margin-top:12px">检测到 ${state.media.bitDepth}-bit / HDR 或高位深视频。当前版本尚未实现可靠的 10-bit/HDR 色彩保持，因此允许生成字幕预览，但会锁定编码测试与正式压制，避免静默转换成 8-bit/SDR。</div>`);
  }

  if (missing.length || probable.length) {
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

  const fontRisk = missing.length + probable.length;
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
    select.addEventListener('change', async () => {
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
      try {
        await state.engine.setFontMappings({ ...state.autoFontFallbacks, ...state.fontBindings });
        await state.engine.setAssText(state.activeAssText);
        log(`字体强制映射已生效：${match.requested} → ${state.fontBindings[match.requested] || '取消强制映射'}`);
      } catch (e) {
        log(`应用字体强制映射失败：${e.message}`);
      }

      state.previewUrls.filter(Boolean).forEach(URL.revokeObjectURL);
      state.previewBaseUrls.filter(Boolean).forEach(URL.revokeObjectURL);
      state.previewUrls = [];
      state.previewBaseUrls = [];
      state.previewFontEvents = [];
      state.previewVisualChange = [];
      state.previewTimes = [];
      state.acceptedWarnings = false;
      $('acceptWarnings').checked = false;
      $('preview').innerHTML = '<div class="preview-placeholder">字体映射已变化，请重新生成真实字幕预览。</div>';
      renderSubtitleSummary();
      refreshBenchmarkEnabled(false);
    });
  });
}

async function renderPreviews() {
  try {
    $('previewBtn').disabled = true;
    state.previewTimes = state.assInfo.previewTimes.slice(0, 6);
    state.previewUrls.filter(Boolean).forEach(URL.revokeObjectURL);
    state.previewUrls = new Array(state.previewTimes.length).fill(null);
    state.previewBaseUrls = new Array(state.previewTimes.length).fill(null);
    state.previewFontEvents = new Array(state.previewTimes.length).fill(null);
    state.previewVisualChange = new Array(state.previewTimes.length).fill(null);
    await loadPreviewAt(0);
    refreshBenchmarkEnabled(true);
  } catch (e) {
    log(`预览失败：${e.message}`);
    $('preview').innerHTML = `<div class="error-box">预览失败：${escapeHtml(e.message)}</div>`;
  } finally {
    $('previewBtn').disabled = !state.engine.ready;
  }
}

async function loadPreviewAt(index) {
  const times = state.previewTimes;
  if (!times.length) return;
  const safeIndex = (index + times.length) % times.length;
  const container = $('preview');

  if (!state.previewUrls[safeIndex]) {
    container.innerHTML = `<div class="preview-placeholder">正在生成第 ${safeIndex + 1}/${times.length} 张真实 libass 预览…<br><small>首张先生成，其余仅在翻页时按需生成。</small></div>`;
    log(`生成预览 ${safeIndex + 1}/${times.length} @ ${times[safeIndex].toFixed(2)}s`);
    const previewCenter = 0.5;
    const shiftBy = Math.max(0, times[safeIndex] - previewCenter);
    const previewAss = shiftAssForPreview(state.activeAssText || state.assText, shiftBy);
    const previewResult = await state.engine.renderPreview(times[safeIndex], safeIndex, previewAss);
    state.previewUrls[safeIndex] = previewResult.url;
    state.previewBaseUrls[safeIndex] = previewResult.baseUrl || null;
    state.previewFontEvents[safeIndex] = previewResult.fontEvents || [];
    state.previewVisualChange[safeIndex] = previewResult.visualChange;
    if (state.previewFontEvents[safeIndex].length) {
      log(`libass 字体选择 @ ${times[safeIndex].toFixed(2)}s:\n${state.previewFontEvents[safeIndex].join('\n')}`);
    }
  }

  const fontInfo = state.previewFontEvents[safeIndex]?.length
    ? `<details class="note" style="padding:0 12px 12px"><summary>查看 libass 实际字体选择</summary><pre class="log" style="max-height:140px">${escapeHtml(state.previewFontEvents[safeIndex].join('\n'))}</pre></details>`
    : '<div class="note" style="text-align:center;padding:0 10px 10px">此帧未捕获到 fontselect 警告/记录。</div>';

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

  container.innerHTML = `<div style="width:100%"><img src="${state.previewUrls[safeIndex]}" alt="字幕预览"><div class="button-row" style="justify-content:center;padding:8px"><button id="prevP">上一张</button><span class="note" style="padding:10px">${safeIndex+1}/${times.length} · ${times[safeIndex].toFixed(2)}s</span><button id="nextP">下一张</button></div>${verifyInfo}${dialogueInfo}<div class="note" style="text-align:center;padding:0 10px 10px">只生成你实际查看的预览帧，避免一次等待全部采样点。</div>${fontInfo}</div>`;
  $('prevP').onclick = () => loadPreviewAt(safeIndex - 1);
  $('nextP').onclick = () => loadPreviewAt(safeIndex + 1);
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

function workflowReadiness() {
  const previewDone = state.previewUrls.some(Boolean);
  const warnings = state.fontMatches.some(x => x.status !== 'matched');
  const unsafeColor = !!state.media?.unsafeColorPipeline;
  const rendered = state.previewVisualChange.some(v => v === true);
  const knownChecks = state.previewVisualChange.filter(v => v !== null);
  const previewOk = rendered || (previewDone && knownChecks.length === 0);
  return {
    previewDone, warnings, unsafeColor, previewOk,
    ready: !!(state.engine.ready && state.inputDecodeOk && previewDone && previewOk && !unsafeColor && (!warnings || state.acceptedWarnings))
  };
}

function refreshBenchmarkEnabled() {
  const status = workflowReadiness();
  const warningsAccepted = !status.warnings || state.acceptedWarnings;
  const basicReady = !!(state.engine.ready && state.inputDecodeOk && !status.unsafeColor && warningsAccepted);

  // Parameter selection and a short test clip are diagnostic tools, so they
  // must remain available even when the PNG subtitle preview itself failed.
  $('benchmarkBtn').disabled = !basicReady;
  $('testSelectedBtn').disabled = !basicReady || !state.selectedCodec;

  // Full-length encoding remains guarded until subtitle rendering is verified.
  const plan = state.selectedCodec ? buildEncodePlan(state.selectedCodec) : null;
  $('encodeBtn').disabled = !status.ready || !state.selectedCodec || !plan;

  if (state.selectedCodec && basicReady && !status.previewOk) {
    $('liveEta').textContent = '参数已选择；字幕预览尚未验证。可以先生成所选方案测试片段，正式全片压制暂时锁定。';
  }
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
  return '压缩效率高 · 当前浏览器 WASM 软件编码较慢；原生后端完成后更有价值';
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

function renderPlanOptions() {
  if (!state.media) return;
  const goal = $('encodeGoal').value;
  if (!state.selectedCodec || state.softwareEncoders[state.selectedCodec] === false) state.selectedCodec = chooseDefaultCodec(goal);
  const sourceRate = getSourceVideoBitrate();
  const bppf = getSourceBppf();
  $('sourceAnchor').innerHTML = '<strong>源片锚点</strong><br>' + escapeHtml((state.media.videoCodec || 'unknown').toUpperCase()) + ' · ' + formatBitrate(sourceRate) + ' · ' + formatBppf(bppf) + '<br><span class="note">源码率只作为压缩状态参考，不当成质量分数。</span>';
  const labels = { h264: 'H.264 / x264', h265: 'H.265 / x265', av1: 'AV1 / SVT-AV1' };
  $('codecPlanGrid').innerHTML = ['h264','h265','av1'].map(codec => {
    const available = state.softwareEncoders[codec] !== false;
    const plan = available ? buildEncodePlan(codec) : null;
    const selected = state.selectedCodec === codec;
    let param = '不可用';
    if (plan?.mode === 'crf') param = 'CRF ' + plan.crf + ' · preset ' + plan.preset;
    else if (plan?.mode === 'budget-rate') param = '单遍目标平均码率 ' + formatBitrate(plan.targetVideoBitrate);
    return '<div class="codec-card plan-codec ' + (selected ? 'selected' : '') + ' ' + (available ? '' : 'disabled-card') + '">' +
      '<h3>' + labels[codec] + '</h3>' +
      '<div class="note">' + codecDescription(codec) + '</div>' +
      '<div class="plan-param">' + param + '</div>' +
      '<button class="plan-choose" data-codec="' + codec + '" ' + (available ? '' : 'disabled') + '>' + (selected ? '已选择' : '选择') + '</button>' +
      '</div>';
  }).join('');
  document.querySelectorAll('.plan-choose').forEach(btn => btn.onclick = () => selectCodec(btn.dataset.codec));
  updateChosenSummary();
  refreshBenchmarkEnabled();
}

function updateChosenSummary() {
  if (!state.selectedCodec) { $('chosenSummary').textContent = '请选择一个编码器。'; return; }
  const plan = buildEncodePlan(state.selectedCodec);
  if (!plan) { $('chosenSummary').textContent = '当前方案无法生成安全参数。'; return; }
  if (plan.mode === 'crf') {
    $('chosenSummary').innerHTML = '<strong>' + state.selectedCodec.toUpperCase() + '</strong> · CRF ' + plan.crf + ' · preset ' + plan.preset + '。质量模式不提前给出伪精确的成品体积或总耗时；正式编码后根据实时 statistics 计算 ETA。';
  } else {
    $('chosenSummary').innerHTML = '<strong>' + state.selectedCodec.toUpperCase() + '</strong> · 单遍目标平均码率 ' + formatBitrate(plan.targetVideoBitrate) + '。规划体积约 ' + formatBytes(plan.plannedBytes) + '，预算边界 ' + formatBytes(plan.sizeCeiling) + '。这是参数规划值，不承诺最终字节数严格命中。';
  }
}

function selectCodec(codec) {
  state.selectedCodec = codec;
  if (state.selectedTest?.sampleUrl) URL.revokeObjectURL(state.selectedTest.sampleUrl);
  state.selectedTest = null;
  $('selectedTestResult').classList.add('hidden');
  renderPlanOptions();
}

async function runSelectedTest() {
  if (!state.selectedCodec) return;
  const plan = buildEncodePlan(state.selectedCodec);
  if (!plan) return;
  try {
    $('testSelectedBtn').disabled = true;
    $('selectedTestResult').classList.remove('hidden');
    $('selectedTestResult').innerHTML = '<div class="note">正在生成所选方案测试片段…</div>';
    const fps = state.media?.fps || 30;
    const targetFrames = state.selectedCodec === 'av1' ? 24 : 45;
    const duration = Math.min(1.5, Math.max(0.6, targetFrames / fps));
    const total = state.media?.duration || 0;
    const candidates = state.assInfo?.previewTimes || [];
    const anchor = candidates.length
      ? [...candidates].sort((a,b) => Math.abs(a - total * 0.45) - Math.abs(b - total * 0.45))[0]
      : total * 0.45;
    const startAt = Math.max(0, Math.min(Math.max(0, total - duration), anchor - 0.45));
    log('所选方案测试：' + state.selectedCodec.toUpperCase() + ' · ' + duration.toFixed(2) + ' 秒 / 约 ' + Math.round(duration * fps) + ' 帧 · 含真实字幕');
    const originalAss = state.activeAssText || state.assText;
    const shiftedAss = shiftAssForPreview(originalAss, startAt);
    await state.engine.setAssText(shiftedAss);
    let r;
    try {
      r = await state.engine.benchmarkCodec(state.selectedCodec, {
        start: startAt, duration, withSubtitles: true, crf: plan.crf, preset: plan.preset,
        targetVideoBitrate: plan.mode === 'budget-rate' ? plan.targetVideoBitrate : 0,
        twoPass: false,
        measureSsim: false,
        timeoutMs: state.selectedCodec === 'av1' ? 60000 : 45000
      });
    } finally {
      await state.engine.setAssText(originalAss);
    }
    if (state.selectedTest?.sampleUrl) URL.revokeObjectURL(state.selectedTest.sampleUrl);
    state.selectedTest = r;
    const sampleBitrate = r.packetStats?.totalVideoBytes ? r.packetStats.totalVideoBytes * 8 / duration : 0;
    $('selectedTestResult').innerHTML = '<div class="test-result"><strong>测试片段完成</strong><span>实际样本速度：' + r.encodeSpeed.toFixed(2) + '× realtime</span><span>样本视频码率：' + formatBitrate(sampleBitrate) + '</span><a class="button-link" href="' + r.sampleUrl + '" download="hardsub_test_' + state.selectedCodec + '.mkv">下载测试片段查看实际画质</a><small>所选方案测试只验证真实字幕、画质和设备速度，不再额外跑一次 SSIM；这些数字也不外推整片。</small></div>';
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
        state.benchmarks[codec] = await state.engine.benchmarkCodec(codec, { start: startAt, duration, withSubtitles: false, crf: p.crf, preset: p.preset, timeoutMs: codec === 'av1' ? 90000 : codec === 'h265' ? 60000 : 45000 });
      } catch (e) {
        state.benchmarks[codec] = { codecKey: codec, error: e.message };
      }
      renderCodecCards();
    }
    try { await state.engine.resetRuntime('高级样本测试完成后清理临时文件'); }
    catch (e) { log('样本测试后的 runtime 清理失败：' + e.message); }
  } finally {
    refreshBenchmarkEnabled();
  }
}

function renderCodecCards() {
  const labels = { h264:'H.264 / x264', h265:'H.265 / x265', av1:'AV1 / SVT-AV1' };
  $('codecGrid').innerHTML = ['h264','h265','av1'].map(codec => {
    const r = state.benchmarks[codec];
    if (!r) return '<div class="codec-card"><h3>' + labels[codec] + '</h3><div class="note">等待测试</div></div>';
    if (r.error) return '<div class="codec-card"><h3>' + labels[codec] + '</h3><div class="bad">测试失败</div><div class="note">' + escapeHtml(r.error.slice(0,180)) + '</div></div>';
    const sampleDuration = Math.max(0.001, r.packetStats?.packetCount / (state.media?.fps || 30));
    const sampleBitrate = r.packetStats?.totalVideoBytes ? r.packetStats.totalVideoBytes * 8 / sampleDuration : 0;
    return '<div class="codec-card"><h3>' + labels[codec] + '</h3><dl>' +
      '<dt>样本速度</dt><dd>' + r.encodeSpeed.toFixed(2) + '× realtime</dd>' +
      '<dt>样本视频码率</dt><dd>' + formatBitrate(sampleBitrate) + '</dd>' +
      '<dt>SSIM</dt><dd>' + (r.ssim ? r.ssim.toFixed(5) : '未取得') + '</dd>' +
      '<dt>参数</dt><dd>CRF ' + r.crf + ' · ' + r.preset + '</dd></dl>' +
      '<div class="button-row"><button class="advanced-choose" data-codec="' + codec + '">采用此编码器</button></div></div>';
  }).join('');
  document.querySelectorAll('.advanced-choose').forEach(btn => btn.onclick = () => selectCodec(btn.dataset.codec));
}

async function runEncode() {
  if (!state.selectedCodec) return;
  if (state.media?.unsafeColorPipeline) { alert('检测到 HDR/高位深输入。当前版本不会静默转换，正式压制已锁定。'); return; }
  const plan = buildEncodePlan(state.selectedCodec);
  if (!plan) { alert('无法生成安全的压制方案。'); return; }
  try {
    $('encodeBtn').disabled = true;
    $('progressBar').style.width = '1%';
    $('liveEta').textContent = '正在启动编码器；前几秒不计算 ETA。';
    log('正式压制：' + state.selectedCodec.toUpperCase() + ' · ' + (plan.mode === 'budget-rate' ? '单遍预算码率' : 'CRF质量') + '模式');
    if (plan.mode === 'budget-rate') log('体积预算边界 ' + formatBytes(plan.sizeCeiling) + '；源码率锚点 ' + formatBitrate(plan.sourceVideoBitrate) + '；单遍目标视频码率 ' + formatBitrate(plan.targetVideoBitrate) + '。');
    else log('CRF ' + plan.crf + ' · preset ' + plan.preset + '；不提前猜整片大小。');
    const durationMs = state.media.duration * 1000;
    let phaseName = '';
    let samples = [];
    let lastUi = 0;
    const result = await state.engine.encodeFullStream(state.selectedCodec, {
      crf: plan.crf, preset: plan.preset,
      targetVideoBitrate: plan.mode === 'budget-rate' ? plan.targetVideoBitrate : 0,
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
      packetScan = await state.engine.scanEncodedPackets(result.blob, state.media.duration);
      const deltaText = packetScan.durationDelta == null
        ? ''
        : ' · 与源视频差 ' + (packetScan.durationDelta >= 0 ? '+' : '') + packetScan.durationDelta.toFixed(3) + ' s';
      log(
        '成品 packet 扫描：视频 ' +
        packetScan.packetCount + ' 个 packet · 末端 ' +
        packetScan.videoEnd.toFixed(3) + ' s' +
        deltaText +
        ' · corrupt=' + packetScan.corruptCount +
        ' · 扫描耗时 ' + packetScan.scanSeconds.toFixed(2) + ' s。'
      );

      if (!packetScan.ok) {
        log(
          '成品完整性警告：packet 扫描未通过。' +
          (packetScan.corruptCount ? ' 检测到损坏标记 packet=' + packetScan.corruptCount + '。' : '') +
          (!packetScan.durationOk && packetScan.durationDelta != null
            ? ' 视频末端与源时长偏差 ' + packetScan.durationDelta.toFixed(3) + ' s，容差 ±' + packetScan.tolerance.toFixed(3) + ' s。'
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
        ' · packet 扫描通过 · 视频末端 ' + formatDurationPrecise(packetScan.videoEnd);
    } else if (packetScan) {
      $('liveEta').textContent =
        '压制完成 · ' + formatBytes(result.byteLength) +
        ' · packet 扫描有警告，请查看技术日志';
    } else {
      $('liveEta').textContent =
        '压制完成 · ' + formatBytes(result.byteLength) +
        ' · packet 扫描未完成，请查看技术日志';
    }

    const base = state.video.name.replace(/\.[^.]+$/, '');
    downloadBlob(result.blob, base + '_hardsub_' + state.selectedCodec + '.mkv');
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

function buildEncodePlan(codec) {
  const media = state.media;
  if (!media?.duration || !state.video || state.softwareEncoders[codec] === false) return null;
  const goal = $('encodeGoal')?.value || 'balanced';
  if (goal === 'balanced' || goal === 'quality' || goal === 'speed') {
    const p = profileFor(codec, goal);
    return { mode: 'crf', goal, codec, crf: p.crf, preset: p.preset, sizeCeiling: null, sourceVideoBitrate: getSourceVideoBitrate() };
  }
  const multiplier = goal === 'size20' ? 2.0 : 1.6;
  const sizeCeiling = Math.floor(state.video.size * multiplier);
  const safeBudgetBytes = Math.floor(sizeCeiling * 0.96);
  const containerReserveBytes = Math.max(256 * 1024, Math.floor(safeBudgetBytes * 0.01));
  const totalAverage = state.video.size * 8 / media.duration;
  const sourceVideoBitrate = getSourceVideoBitrate();
  let audioBitRate = media.audioBitRate || 0;
  if (!audioBitRate && totalAverage > sourceVideoBitrate) audioBitRate = Math.max(0, totalAverage - sourceVideoBitrate);
  if (!audioBitRate && media.audioTracks > 0) audioBitRate = 256000 * media.audioTracks;
  const ceilingVideoBitrate = Math.floor(((safeBudgetBytes - containerReserveBytes) * 8 / media.duration) - audioBitRate);
  if (!(ceilingVideoBitrate > 150000)) return null;
  const sourceCodec = normalizeCodec(media.videoCodec);
  const sourceEquivalent = sourceVideoBitrate > 0 ? sourceVideoBitrate * (codecEfficiency(sourceCodec) / codecEfficiency(codec)) * (multiplier === 2.0 ? 1.12 : 1.05) : ceilingVideoBitrate;
  const targetVideoBitrate = Math.floor(Math.max(150000, Math.min(ceilingVideoBitrate, sourceEquivalent)));
  const plannedBytes = Math.round(((targetVideoBitrate + audioBitRate) * media.duration / 8) + containerReserveBytes);
  const p = profileFor(codec, 'balanced');
  return { mode: 'budget-rate', goal, codec, crf: p.crf, preset: p.preset, multiplier, sizeCeiling, safeBudgetBytes, plannedBytes, targetVideoBitrate, ceilingVideoBitrate, sourceVideoBitrate, audioBitRate };
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
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
