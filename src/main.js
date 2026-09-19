import './style.css';
import { parseAss } from './ass.js';
import { inspectFontFile, matchRequestedFonts } from './fonts.js';
import { detectCapabilities } from './capabilities.js';
import { EncoderEngine } from './engine.js';

const MAX_BYTES = 1024 ** 3;
const state = {
  video: null,
  ass: null,
  fonts: [],
  assInfo: null,
  fontFaces: [],
  fontMatches: [],
  media: null,
  engine: null,
  capabilities: null,
  softwareEncoders: { h264: null, h265: null, av1: null },
  softwareDecoders: { av1Dav1d: null },
  inputDecodeOk: false,
  previewUrls: [],
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
        <small>硬上限是围栏，不是目标大小。</small>
      </div>
    </div>
    <div class="button-row"><button id="analyze" class="primary" disabled>分析字幕与设备</button></div>
  </section>

  <section class="card">
    <h2>2. 运行环境</h2>
    <div id="capabilities" class="status-list"><div class="status-item"><span>状态</span><span>检测中…</span></div></div>
    <p id="engineHint" class="note"></p>
  </section>

  <section id="subtitleCard" class="card hidden">
    <h2>3. 字幕与字体预检</h2>
    <div id="subtitleSummary" class="status-list"></div>
    <div id="fontWarnings"></div>
    <div class="button-row">
      <button id="previewBtn" disabled>生成真实字幕预览</button>
    </div>
    <div id="preview" class="preview-wrap"><div class="preview-placeholder">分析后可用 FFmpeg + libass 生成真实预览帧。</div></div>
    <div id="warningAccept" class="hidden" style="margin-top:12px"><label><input type="checkbox" id="acceptWarnings"> 已查看预览，接受当前字体回退/缺失警告并继续。</label></div>
  </section>

  <section id="benchmarkCard" class="card hidden">
    <h2>4. 三编码器样本测试</h2>
    <p class="note">程序使用同一段短样本实测当前设备上的编码时间、样本大小与 SSIM；AV1 使用 SVT-AV1。字幕正确性已在上一阶段单独验证。</p>
    <div class="button-row"><button id="benchmarkBtn" class="primary" disabled>测试 H.264 / H.265 / AV1</button></div>
    <div id="codecGrid" class="grid three" style="margin-top:14px"></div>
  </section>

  <section id="encodeCard" class="card hidden">
    <h2>5. 正式压制</h2>
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
    $('engineHint').innerHTML = '<span class="ok">FFmpegKitNext Web 核心已加载。</span> 上面的 WebCodecs 项只是浏览器/硬件通道检测，不影响 FFmpeg WASM 软件编码。';
  } else {
    $('engineHint').innerHTML = '<span class="warn">FFmpegKitNext Web 核心尚未放入 vendor。</span> 当前可使用文件/ASS/字体分析和浏览器能力检测；真实预览与压制按钮会保持关闭。';
  }
  refreshAnalyze();
}

function renderCapabilities() {
  const c = state.capabilities;
  const sw = state.softwareEncoders;
  const rows = [
    ['WebAssembly', c.webAssembly, c.webAssembly ? '支持' : '不可用'],
    ['Web Worker', c.worker, c.worker ? '支持' : '不可用'],
    ['SharedArrayBuffer', c.sharedArrayBuffer, c.sharedArrayBuffer ? '支持' : '不可用'],
    ['跨源隔离', c.crossOriginIsolated, c.crossOriginIsolated ? '支持' : '未启用'],
    ['FFmpeg WASM · H.264 / x264', sw.h264, sw.h264 === null ? '检测中' : sw.h264 ? '可编码' : '未编入核心'],
    ['FFmpeg WASM · H.265 / x265', sw.h265, sw.h265 === null ? '检测中' : sw.h265 ? '可编码' : '未编入核心'],
    ['FFmpeg WASM · AV1 / SVT-AV1', sw.av1, sw.av1 === null ? '检测中' : sw.av1 ? '可编码' : '未编入核心'],
    ['FFmpeg WASM · AV1 / dav1d', state.softwareDecoders.av1Dav1d, state.softwareDecoders.av1Dav1d === null ? '检测中' : state.softwareDecoders.av1Dav1d ? '可解码' : '未编入核心'],
    ['WebCodecs 硬件通道 · H.264', c.codecs.h264, c.codecs.h264 ? '浏览器已暴露' : '浏览器未暴露'],
    ['WebCodecs 硬件通道 · H.265', c.codecs.hevc, c.codecs.hevc ? '浏览器已暴露' : '浏览器未暴露'],
    ['WebCodecs 硬件通道 · AV1', c.codecs.av1, c.codecs.av1 ? '浏览器已暴露' : '浏览器未暴露']
  ];
  $('capabilities').innerHTML = rows.map(([k,v,label]) => `<div class="status-item"><span>${k}</span><span class="${v ? 'ok' : 'warn'}">${label}</span></div>`).join('');
}

function refreshAnalyze() {
  $('analyze').disabled = !(state.video && state.ass && state.video.size <= MAX_BYTES);
}

async function analyzeAll() {
  try {
    $('analyze').disabled = true;
    log('开始分析 ASS 和字体…');
    const assText = await state.ass.text();
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

      if (state.media.videoCodec === 'av1' && state.softwareDecoders.av1Dav1d === false) {
        throw new Error('这是 AV1 源视频，但当前 Web core 没有 dav1d 软件解码器。请等待/使用带 dav1d 的新核心。');
      }

      log('执行输入解码 smoke test（只解码 1 帧）…');
      await state.engine.testInputDecode(Math.max(0, Math.min(state.media.duration * 0.1, 1)));
      state.inputDecodeOk = true;
      log('输入视频解码测试通过。');
    }
    renderSubtitleSummary();
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
    if (m.status === 'matched') return `✓ ${escapeHtml(m.requested)} → ${escapeHtml(m.face.fullName || m.face.family || m.face.fileName)}`;
    if (m.status === 'probable') return `△ ${escapeHtml(m.requested)} → 可能匹配 ${escapeHtml(m.face.fullName || m.face.family || m.face.fileName)}`;
    return `✗ ${escapeHtml(m.requested)} → 未在用户提供字体中找到`;
  }).join('<br>');

  if (state.media?.unsafeColorPipeline) {
    $('fontWarnings').innerHTML += `<div class="error-box" style="margin-top:12px">检测到 ${state.media.bitDepth}-bit / HDR 或高位深视频。当前版本尚未实现可靠的 10-bit/HDR 色彩保持，因此允许生成字幕预览，但会锁定编码测试与正式压制，避免静默转换成 8-bit/SDR。</div>`;
  }

  if (missing.length || probable.length) {
    $('fontWarnings').innerHTML = `<div class="warning-box" style="margin-top:12px">${details || '检测到字体风险。'}<br><br>注意：这只是静态字体名分析；最终是否回退以真实 libass 预览和日志为准。</div>`;
    $('warningAccept').classList.remove('hidden');
  } else {
    $('fontWarnings').innerHTML = `<div class="note" style="margin-top:12px">${details || 'ASS 未声明特定字体。'}<br>仍建议生成真实预览，确认 libass 实际渲染结果。</div>`;
    $('warningAccept').classList.add('hidden');
    state.acceptedWarnings = true;
  }
}

async function renderPreviews() {
  try {
    $('previewBtn').disabled = true;
    state.previewTimes = state.assInfo.previewTimes.slice(0, 6);
    state.previewUrls.filter(Boolean).forEach(URL.revokeObjectURL);
    state.previewUrls = new Array(state.previewTimes.length).fill(null);
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
    state.previewUrls[safeIndex] = await state.engine.renderPreview(times[safeIndex], safeIndex);
  }

  container.innerHTML = `<div style="width:100%"><img src="${state.previewUrls[safeIndex]}" alt="字幕预览"><div class="button-row" style="justify-content:center;padding:8px"><button id="prevP">上一张</button><span class="note" style="padding:10px">${safeIndex+1}/${times.length} · ${times[safeIndex].toFixed(2)}s</span><button id="nextP">下一张</button></div><div class="note" style="text-align:center;padding:0 10px 10px">只生成你实际查看的预览帧，避免一次等待全部采样点。</div></div>`;
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
    const duration = Math.min(6, Math.max(3, (state.media?.duration || 12) / 10));
    const totalDuration = state.media?.duration || 0;
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
        const timeoutMs = codec === 'av1' ? 180000 : codec === 'h265' ? 120000 : 90000;
        const r = await state.engine.benchmarkCodec(codec, { start, duration, withSubtitles: false, timeoutMs });
        r.estimatedBytes = estimateFullBytes(r, duration, state.media);
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
    const totalTime = state.media?.duration ? r.elapsedSeconds / (Math.min(6, Math.max(3, state.media.duration / 10))) * state.media.duration : null;
    return `<div class="codec-card ${state.selectedCodec===k?'selected':''}" data-codec="${k}">
      <h3>${labels[k]}</h3>
      <dl>
        <dt>预计体积</dt><dd>${r.estimatedBytes ? formatBytes(r.estimatedBytes) : '—'}</dd>
        <dt>预计时间</dt><dd>${totalTime ? formatDuration(totalTime) : '—'}</dd>
        <dt>样本速度</dt><dd>${r.encodeSpeed.toFixed(2)}× realtime</dd>
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
    b.elapsedSeconds <= a.elapsedSeconds &&
    (b.ssim ?? 0) >= (a.ssim ?? 0) - 0.0002));
  const pick = [...frontier].sort((a,b) => a.estimatedBytes - b.estimatedBytes)[0] || allowed[0];
  selectCodec(pick.codecKey, true);
}

function selectCodec(codec, automatic = false) {
  state.selectedCodec = codec;
  renderCodecCards();
  const r = state.benchmarks[codec];
  $('chosenSummary').textContent = `${automatic ? '自动候选：' : '已选择：'} ${codec.toUpperCase()} · 预计 ${r?.estimatedBytes ? formatBytes(r.estimatedBytes) : '未知体积'}。正式压制前仍由你确认。`;
  $('encodeBtn').disabled = !r || !!r.error;
}

async function runEncode() {
  if (!state.selectedCodec) return;
  if (state.media?.unsafeColorPipeline) {
    alert('检测到 HDR/高位深输入。当前版本不会冒险静默转换，正式压制已锁定。');
    return;
  }

  try {
    $('encodeBtn').disabled = true;
    $('progressBar').style.width = '5%';
    log(`正式压制：${state.selectedCodec.toUpperCase()} · 使用流式输出，避免完整成品先堆在 WASM 文件系统中`);

    const policy = $('spacePolicy').value;
    const sizeCeiling = policy === 'knee' ? null : Math.floor(state.video.size * Number(policy));
    if (sizeCeiling) log(`体积约束目标：≤ ${formatBytes(sizeCeiling)}（源文件 × ${policy}）。当前版本只会在开始前依据样本估算筛选，不会在编码末期粗暴取消。`);

    const estimated = state.benchmarks[state.selectedCodec]?.estimatedBytes || null;
    if (sizeCeiling && estimated && estimated > sizeCeiling) {
      throw new Error(`当前方案预计输出 ${formatBytes(estimated)}，超过所选上限 ${formatBytes(sizeCeiling)}。请重新测试或选择更高压缩效率的方案；程序不会先编码到末尾再强制取消。`);
    }

    const result = await state.engine.encodeFullStream(state.selectedCodec, {
      onBytes: written => {
        if (estimated) {
          const p = Math.min(94, Math.max(5, written / estimated * 90));
          $('progressBar').style.width = `${p.toFixed(1)}%`;
        }
      }
    });

    $('progressBar').style.width = '100%';
    const base = state.video.name.replace(/\.[^.]+$/, '');
    downloadBlob(result.blob, `${base}_hardsub_${state.selectedCodec}.mkv`);
    log(`完成：${formatBytes(result.byteLength)}`);
  } catch (e) {
    $('progressBar').style.width = '0%';
    log(`压制失败：${e.stack || e.message}`);
    alert(`压制失败：${e.message}`);
  } finally {
    $('encodeBtn').disabled = false;
  }
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
