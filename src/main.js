import './style.css';
import { parseAss, rewriteAssFonts, shiftAssForPreview } from './ass.js';
import { inspectFontFile, matchRequestedFonts } from './fonts.js';
import { detectCapabilities } from './capabilities.js';
import { EncoderEngine } from './engine.js';

const MAX_BYTES = 1024 ** 3;
const state = {
  video: null,
  ass: null,
  fonts: [],
  assInfo: null,
  assText: '',
  activeAssText: '',
  fontBindings: {},
  fontFaces: [],
  fontMatches: [],
  media: null,
  engine: null,
  capabilities: null,
  softwareEncoders: { h264: null, h265: null, av1: null },
  softwareDecoders: { av1Dav1d: null },
  inputDecodeOk: false,
  previewUrls: [],
  previewFontEvents: [],
  previewTimes: [],
  benchmarks: {},
  selectedCodec: null,
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
      <div class="file-row"><label>字体（可选，可多选）</label><input id="fonts" type="file" multiple accept=".ttf,.otf,.ttc,.otc"><small id="fontMeta">未选择；程序会先分析 ASS 使用的字体。</small></div>
      <div class="file-row"><label>空间策略</label>
        <select id="spacePolicy">
          <option value="1.6">均衡：硬上限 1.6×</option>
          <option value="2.0">质量优先：硬上限 2.0×</option>
          <option value="knee">效率曲线：寻找边际收益拐点</option>
        </select>
        <small>硬上限是围栏，不是目标大小；只有预测接近/超过上限时才启用两遍目标体积编码。</small>
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

  <section id="benchmarkCard" class="card hidden">
    <h2>5. 三编码器样本测试</h2>
    <p class="note">程序使用约 36 帧的快速样本实测当前设备上的编码速度、样本大小与 SSIM；AV1 使用 SVT-AV1。这里是编码器比较，不是字幕预览。</p>
    <div class="button-row"><button id="benchmarkBtn" class="primary" disabled>测试 H.264 / H.265 / AV1</button></div>
    <div id="codecGrid" class="grid three" style="margin-top:14px"></div>
  </section>

  <section id="encodeCard" class="card hidden">
    <h2>6. 正式压制</h2>
    <div id="chosenSummary" class="note">尚未选择编码器。</div>
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
$('fonts').addEventListener('change', e => {
  state.fonts = [...(e.target.files || [])];
  $('fontMeta').textContent = state.fonts.length ? `已选择 ${state.fonts.length} 个字体文件` : '未选择；程序会先分析 ASS 使用的字体。';
});
$('acceptWarnings').addEventListener('change', e => {
  state.acceptedWarnings = e.target.checked;
  refreshBenchmarkEnabled();
});

$('analyze').addEventListener('click', analyzeAll);
$('previewBtn').addEventListener('click', renderPreviews);
$('benchmarkBtn').addEventListener('click', runBenchmarks);
$('encodeBtn').addEventListener('click', runEncode);

bootstrap();

async function bootstrap() {
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

function refreshAnalyze() {
  $('analyze').disabled = !(state.video && state.ass && state.video.size <= MAX_BYTES);
}

async function analyzeAll() {
  try {
    $('analyze').disabled = true;
    state.acceptedWarnings = false;
    $('acceptWarnings').checked = false;
    state.previewUrls.filter(Boolean).forEach(URL.revokeObjectURL);
    state.previewUrls = [];
    state.previewFontEvents = [];
    state.previewTimes = [];
    state.inputDecodeOk = false;
    log('开始分析 ASS 和字体…');
    const assText = await state.ass.text();
    state.assText = assText;
    state.activeAssText = assText;
    state.fontBindings = {};
    state.assInfo = parseAss(assText);
    state.fontFaces = [];
    for (const file of state.fonts) {
      try { state.fontFaces.push(...await inspectFontFile(file)); }
      catch (e) { log(`字体 ${file.name} 解析失败：${e.message}`); }
    }
    state.fontMatches = matchRequestedFonts(state.assInfo.requestedFonts, state.fontFaces);

    if (state.engine.ready) {
      log('挂载媒体文件到浏览器 WebAssembly 文件系统…');
      await state.engine.stageFiles(state.video, state.ass, state.fonts);
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
    $('benchmarkCard').classList.remove('hidden');
    $('encodeCard').classList.remove('hidden');
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
    ['像素格式', `${state.media.pixelFormat || '未知'} · ${state.media.bitDepth}-bit`],
    ['色彩', [state.media.colorPrimaries, state.media.colorTransfer, state.media.colorSpace].filter(Boolean).join(' / ') || '未标记'],
    ['HDR/高位深', state.media.unsafeColorPipeline ? '检测到：当前版本禁止静默重编码' : '未检测到风险'],
    ['输入解码', state.inputDecodeOk ? '已通过 1 帧实测' : '未验证'],
    ['音频', state.media.audioCodec || '未检测到']
  ] : [];
  $('subtitleSummary').innerHTML = [
    ['ASS 对话', `${a.dialogueCount} 条`],
    ['ASS 请求字体', `${a.requestedFonts.length} 个`],
    ['已提供字体 face', `${state.fontFaces.length} 个`],
    ['预览采样点', `${a.previewTimes.length} 个`],
    ...mediaRows
  ].map(([k,v]) => `<div class="status-item"><span>${k}</span><span>${v}</span></div>`).join('');

  const details = state.fontMatches.map(m => {
    const forced = state.fontBindings[m.requested];
    if (forced) return `↪ ${escapeHtml(m.requested)} → 强制映射为 ${escapeHtml(forced)}`;
    if (m.status === 'matched') return `✓ ${escapeHtml(m.requested)} → ${escapeHtml(m.face.fullName || m.face.family || m.face.fileName)}`;
    if (m.status === 'probable') return `△ ${escapeHtml(m.requested)} → 可能匹配 ${escapeHtml(m.face.fullName || m.face.family || m.face.fileName)}`;
    return `✗ ${escapeHtml(m.requested)} → 未在用户提供字体中找到`;
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
        <div class="note">如果你确认放入的字体就是 ASS 想要的字体，可以把 ASS 中的字体名临时改写成该字体真实的内部 Family Name。原始 ASS 文件不会修改。</div>
        ${risky.map(({ m, index }) => {
          const current = state.fontBindings[m.requested] || '';
          const opts = state.fontFaces.map((face, faceIndex) => {
            const target = face.family || face.fullName || face.postScriptName || '';
            const label = [face.fileName, target].filter(Boolean).join(' → ');
            const selected = current && current === target ? ' selected' : '';
            return `<option value="${faceIndex}"${selected}>${escapeHtml(label)}</option>`;
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
        const target = face?.family || face?.fullName || face?.postScriptName || '';
        if (target) state.fontBindings[match.requested] = target;
      }

      state.activeAssText = rewriteAssFonts(state.assText, state.fontBindings);
      try {
        await state.engine.setAssText(state.activeAssText);
        log(`字体映射已更新：${match.requested} → ${state.fontBindings[match.requested] || '取消强制映射'}`);
      } catch (e) {
        log(`应用字体映射失败：${e.message}`);
      }

      state.previewUrls.filter(Boolean).forEach(URL.revokeObjectURL);
      state.previewUrls = [];
      state.previewFontEvents = [];
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
    state.previewFontEvents = new Array(state.previewTimes.length).fill(null);
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
    const previewAss = shiftAssForPreview(state.activeAssText || state.assText, times[safeIndex]);
    const previewResult = await state.engine.renderPreview(times[safeIndex], safeIndex, previewAss);
    state.previewUrls[safeIndex] = previewResult.url;
    state.previewFontEvents[safeIndex] = previewResult.fontEvents || [];
    if (state.previewFontEvents[safeIndex].length) {
      log(`libass 字体选择 @ ${times[safeIndex].toFixed(2)}s:\n${state.previewFontEvents[safeIndex].join('\n')}`);
    }
  }

  const fontInfo = state.previewFontEvents[safeIndex]?.length
    ? `<details class="note" style="padding:0 12px 12px"><summary>查看 libass 实际字体选择</summary><pre class="log" style="max-height:140px">${escapeHtml(state.previewFontEvents[safeIndex].join('\n'))}</pre></details>`
    : '<div class="note" style="text-align:center;padding:0 10px 10px">此帧未捕获到 fontselect 警告/记录。</div>';
  container.innerHTML = `<div style="width:100%"><img src="${state.previewUrls[safeIndex]}" alt="字幕预览"><div class="button-row" style="justify-content:center;padding:8px"><button id="prevP">上一张</button><span class="note" style="padding:10px">${safeIndex+1}/${times.length} · ${times[safeIndex].toFixed(2)}s</span><button id="nextP">下一张</button></div><div class="note" style="text-align:center;padding:0 10px 10px">只生成你实际查看的预览帧，避免一次等待全部采样点。</div>${fontInfo}</div>`;
  $('prevP').onclick = () => loadPreviewAt(safeIndex - 1);
  $('nextP').onclick = () => loadPreviewAt(safeIndex + 1);
}

function refreshBenchmarkEnabled(previewDone = state.previewUrls.length > 0) {
  const warnings = state.fontMatches.some(x => x.status !== 'matched');
  const unsafeColor = !!state.media?.unsafeColorPipeline;
  $('benchmarkBtn').disabled = !state.engine.ready || !state.inputDecodeOk || !previewDone || unsafeColor || (warnings && !state.acceptedWarnings);
}

async function runBenchmarks() {
  try {
    $('benchmarkBtn').disabled = true;
    state.benchmarks = {};
    renderCodecCards();
    // Mobile/WASM benchmark: target roughly 36 source frames rather than a fixed
    // multi-second clip. This keeps the comparison useful without making users
    // wait minutes before the real encode even starts.
    const fps = state.media?.fps || 30;
    const duration = Math.min(1.5, Math.max(0.6, 36 / fps));
    const totalDuration = state.media?.duration || 0;
    log(`快速样本长度：${duration.toFixed(2)} 秒（约 ${Math.round(duration * fps)} 帧 @ ${fps.toFixed(2)} fps）`);
    const start = totalDuration > duration * 2 ? Math.max(0, totalDuration * 0.45) : 0;
    const codecs = ['h264','h265','av1'];
    for (const codec of codecs) {
      if (state.softwareEncoders[codec] === false) {
        state.benchmarks[codec] = { codecKey: codec, error: '当前 FFmpeg WASM 核心未编入该编码器，已跳过测试。' };
        log(`${codec.toUpperCase()}：核心检测为不可用，跳过，不启动 FFmpeg。`);
        renderCodecCards();
        continue;
      }

      log(`开始 ${codec.toUpperCase()} 样本测试…`);
      try {
        const timeoutMs = codec === 'av1' ? 90000 : codec === 'h265' ? 60000 : 45000;
        const r = await state.engine.benchmarkCodec(codec, { start, duration, withSubtitles: false, timeoutMs });
        r.estimatedBytes = estimateFullBytes(r, duration, state.media);
        r.estimatedSeconds = state.media?.duration && r.encodeSpeed > 0
          ? state.media.duration / r.encodeSpeed
          : null;
        state.benchmarks[codec] = r;
      } catch (e) {
        state.benchmarks[codec] = { codecKey: codec, error: e.message };
        log(`${codec.toUpperCase()} 测试终止：${e.message}`);
      }
      renderCodecCards();
    }
    autoSelectCandidate();

    // Benchmark samples and SSIM intermediates live in the WASM runtime. Reboot once
    // after collecting results so the final encode starts from a clean heap.
    try {
      log('样本测试完成，正在重启 WASM runtime 释放临时样本与工作内存…');
      await state.engine.resetRuntime('样本测试完成后清理临时文件');
      log('WASM runtime 已清理并重新挂载输入。');
    } catch (e) {
      log(`WASM runtime 清理失败：${e.message}`);
    }
  } finally {
    $('benchmarkBtn').disabled = false;
  }
}

function estimateFullBytes(result, sampleDuration, media) {
  if (!media?.duration) return null;
  const videoBytes = result.sampleBytes / sampleDuration * media.duration;
  const audioBytes = media.audioBitRate ? media.audioBitRate / 8 * media.duration : 0;
  return Math.round(videoBytes + audioBytes);
}

function renderCodecCards() {
  const labels = {h264:'H.264 / x264', h265:'H.265 / x265', av1:'AV1 / SVT-AV1'};
  $('codecGrid').innerHTML = ['h264','h265','av1'].map(k => {
    const r = state.benchmarks[k];
    if (!r) return `<div class="codec-card"><h3>${labels[k]}</h3><div class="note">等待测试</div></div>`;
    if (r.error) return `<div class="codec-card"><h3>${labels[k]}</h3><div class="bad">当前核心不可用</div><div class="note">${escapeHtml(r.error.slice(0,180))}</div></div>`;
    const totalTime = r.estimatedSeconds || null;
    const speedLabel = r.speedEstimate === 'steady-state' ? '稳态速度' : '样本平均';
    return `<div class="codec-card ${state.selectedCodec===k?'selected':''}" data-codec="${k}">
      <h3>${labels[k]}</h3>
      <dl>
        <dt>预计体积</dt><dd>${r.estimatedBytes ? formatBytes(r.estimatedBytes) : '—'}</dd>
        <dt>预计时间</dt><dd>${totalTime ? formatDuration(totalTime) : '—'}</dd>
        <dt>${speedLabel}</dt><dd>${r.encodeSpeed.toFixed(2)}× realtime</dd>
        <dt>SSIM</dt><dd>${r.ssim ? r.ssim.toFixed(5) : '未取得'}</dd>
        <dt>CRF</dt><dd>${r.crf}</dd>
      </dl>
      <div class="button-row"><button class="choose" data-codec="${k}">选择</button></div>
    </div>`;
  }).join('');
  document.querySelectorAll('.choose').forEach(btn => btn.onclick = () => selectCodec(btn.dataset.codec));
}

function autoSelectCandidate() {
  const policy = $('spacePolicy').value;
  const good = Object.values(state.benchmarks).filter(r => !r.error && r.estimatedBytes && r.ssim);
  if (!good.length) return;
  const sourceSize = state.video.size;
  let allowed = good;
  if (policy !== 'knee') allowed = good.filter(r => r.estimatedBytes <= sourceSize * Number(policy));
  if (!allowed.length) allowed = good;

  // Conservative Pareto-like default: remove candidates that are both larger and slower
  // without a measurable SSIM advantage, then choose the smallest remaining candidate.
  const frontier = allowed.filter(a => !allowed.some(b => b !== a &&
    b.estimatedBytes <= a.estimatedBytes &&
    (b.estimatedSeconds ?? Infinity) <= (a.estimatedSeconds ?? Infinity) &&
    (b.ssim ?? 0) >= (a.ssim ?? 0) - 0.0002));
  const pick = [...frontier].sort((a,b) => a.estimatedBytes - b.estimatedBytes)[0] || allowed[0];
  selectCodec(pick.codecKey, true);
}

function selectCodec(codec, automatic = false) {
  state.selectedCodec = codec;
  renderCodecCards();
  const r = state.benchmarks[codec];
  const plan = buildEncodePlan(codec);
  const planText = plan?.mode === 'target-size'
    ? `预计接近/超过体积上限，将使用两遍目标体积编码；目标视频码率约 ${Math.round(plan.targetVideoBitrate / 1000)} kb/s。`
    : plan?.mode === 'crf'
      ? `预计有足够余量，保留 CRF 单遍编码，不会为了“用满上限”主动增大文件。`
      : '';
  $('chosenSummary').textContent = `${automatic ? '自动候选：' : '已选择：'} ${codec.toUpperCase()} · 样本估算 ${r?.estimatedBytes ? formatBytes(r.estimatedBytes) : '未知体积'}。 ${planText} 正式压制前仍由你确认。`;
  $('encodeBtn').disabled = !r || !!r.error || !plan;
}

async function runEncode() {
  if (!state.selectedCodec) return;
  if (state.media?.unsafeColorPipeline) {
    alert('检测到 HDR/高位深输入。当前版本不会冒险静默转换，正式压制已锁定。');
    return;
  }

  const plan = buildEncodePlan(state.selectedCodec);
  if (!plan) {
    alert('无法生成安全的压制方案；请重新分析文件。');
    return;
  }

  try {
    $('encodeBtn').disabled = true;
    $('progressBar').style.width = '5%';
    log(`正式压制：${state.selectedCodec.toUpperCase()} · 流式读取 FFmpeg 输出，减少 WASM 内部完整成品副本`);

    if (plan.sizeCeiling) {
      log(`硬上限：${formatBytes(plan.sizeCeiling)}（源文件 × ${plan.multiplier}）`);
      if (plan.mode === 'target-size') {
        log(`预测结果距离上限过近或已经超出；启用两遍目标体积编码，安全预算 ${formatBytes(plan.safeBudgetBytes)}，视频目标码率约 ${Math.round(plan.targetVideoBitrate / 1000)} kb/s。`);
      } else {
        log(`样本估算 ${formatBytes(plan.estimatedBytes)}，低于上限的 90%；保留 CRF 单遍，避免为了接近上限反而把文件压大。`);
      }
    } else {
      log('效率曲线模式：使用 CRF 单遍，不设置固定体积上限。');
    }

    const result = await state.engine.encodeFullStream(state.selectedCodec, {
      targetVideoBitrate: plan.mode === 'target-size' ? plan.targetVideoBitrate : 0,
      onPhase: phase => {
        if (phase === 'pass1') {
          $('progressBar').style.width = '8%';
          log('阶段 1/2：统计整片复杂度与码率分配。');
        } else if (phase === 'pass2') {
          $('progressBar').style.width = '50%';
          log('阶段 2/2：按目标码率正式生成成品。');
        }
      },
      onBytes: written => {
        const denominator = plan.mode === 'target-size'
          ? (plan.safeBudgetBytes || plan.estimatedBytes)
          : plan.estimatedBytes;
        if (denominator) {
          const base = plan.mode === 'target-size' ? 50 : 5;
          const span = plan.mode === 'target-size' ? 44 : 89;
          const p = Math.min(94, Math.max(base, base + written / denominator * span));
          $('progressBar').style.width = `${p.toFixed(1)}%`;
        }
      }
    });

    $('progressBar').style.width = '100%';
    const base = state.video.name.replace(/\.[^.]+$/, '');
    downloadBlob(result.blob, `${base}_hardsub_${state.selectedCodec}.mkv`);

    if (plan.sizeCeiling && result.byteLength > plan.sizeCeiling) {
      const over = (result.byteLength / plan.sizeCeiling - 1) * 100;
      log(`警告：实际成品 ${formatBytes(result.byteLength)}，比设定上限高 ${over.toFixed(2)}%。成品仍已保留并下载，没有在末尾丢弃。`);
      alert(`压制完成，但实际成品比设定上限高 ${over.toFixed(2)}%。成品不会被删除，已正常下载。后续可用更保守的安全余量重新压制。`);
    } else {
      log(`完成：${formatBytes(result.byteLength)}`);
    }

    try {
      await state.engine.resetRuntime('正式压制完成后释放 WASM heap');
      log('正式压制结束，WASM runtime 已重启并释放工作内存。');
    } catch (e) {
      log(`完成后的内存清理失败：${e.message}`);
    }
  } catch (e) {
    $('progressBar').style.width = '0%';
    log(`压制失败：${e.stack || e.message}`);
    alert(`压制失败：${e.message}`);
  } finally {
    $('encodeBtn').disabled = false;
  }
}

function buildEncodePlan(codec) {
  const benchmark = state.benchmarks[codec];
  const media = state.media;
  if (!benchmark || benchmark.error || !media?.duration) return null;

  const policy = $('spacePolicy').value;
  const estimatedBytes = benchmark.estimatedBytes || null;
  if (policy === 'knee') {
    return { mode: 'crf', estimatedBytes, sizeCeiling: null, multiplier: null };
  }

  const multiplier = Number(policy);
  const sizeCeiling = Math.floor(state.video.size * multiplier);

  // The ceiling is a fence, not a target. If the CRF estimate is comfortably below it,
  // keep CRF mode instead of deliberately inflating bitrate.
  if (estimatedBytes && estimatedBytes <= sizeCeiling * 0.90) {
    return { mode: 'crf', estimatedBytes, sizeCeiling, multiplier };
  }

  // Leave 4% headroom for bitrate-control error, container overhead and imperfect
  // audio bitrate metadata. Audio is stream-copied, so its budget must be reserved.
  const safeBudgetBytes = Math.floor(sizeCeiling * 0.96);
  const containerReserveBytes = Math.max(256 * 1024, Math.floor(safeBudgetBytes * 0.01));
  const totalBitRate = media.bitRate || 0;
  const videoBitRate = media.videoBitRate || 0;

  let audioBitRate = media.audioBitRate || 0;
  if (!audioBitRate && totalBitRate > videoBitRate && videoBitRate > 0) {
    audioBitRate = totalBitRate - videoBitRate;
  }
  if (!audioBitRate && media.audioTracks > 0) {
    // Conservative fallback for streams whose ffprobe metadata lacks bit_rate.
    audioBitRate = 1_000_000 * media.audioTracks;
  }

  const bitsAvailableForVideo =
    (safeBudgetBytes - containerReserveBytes) * 8 - audioBitRate * media.duration;
  const targetVideoBitrate = Math.floor(bitsAvailableForVideo / media.duration);

  if (!Number.isFinite(targetVideoBitrate) || targetVideoBitrate < 150_000) {
    return null;
  }

  return {
    mode: 'target-size',
    estimatedBytes,
    sizeCeiling,
    multiplier,
    safeBudgetBytes,
    targetVideoBitrate,
    audioBitRate
  };
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
function formatDuration(sec) {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.round(sec); const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const r = s%60;
  return h ? `${h}时${m}分${r}秒` : m ? `${m}分${r}秒` : `${r}秒`;
}
function escapeHtml(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
