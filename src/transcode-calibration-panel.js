import { compileTask } from './media-task.js';
import { exploreQuality, calibrationSampleStarts, createMeasuredSizeFrontier, buildExplorationPlot, CALIBRATION_PROFILES, summarizeCalibrationEvidence } from './transcode-curves.js';
import { buildSizeFrontierPlot, targetBytesAtEvidenceFraction, evidenceFractionForTargetBytes } from './size-frontier-ui.js';

// Measured curves for manual video-only transcode. This is intentionally
// separate from subtitle calibration: sample identity must match the manual
// encoder, preset and selected timeline, or no curve is published.
export function mountTranscodeCurves(section, hooks) {
  const panel = document.createElement('section');
  panel.id = 'taskCompressionCurves';
  panel.className = 'media-compression-curves';
  panel.setAttribute('aria-label', '压制前实测效率与探索曲线');
  panel.innerHTML = [
    '<div class="media-curves-header"><div><strong>压制前 · 实测效率与探索曲线</strong>',
    '<p>在选定的视频区间上抽取分散的短片，逐步测量质量与码率。不会先重压整段母片。</p></div>',
    '<div class="media-curve-actions"><button type="button" id="taskExploreCurve" class="secondary">探索当前编码器</button>',
    '<button type="button" id="taskStopCurve" class="secondary" disabled>停止探索</button></div></div>',
    '<div class="media-curve-options"><label class="media-curve-target">最低样本 SSIM 目标 <input type="number" id="taskExploreTarget" min="0.80" max="0.9999" step="0.001" value="0.980"></label>',
    '<label class="media-curve-target">采样力度 <select id="taskCurveProfile"><option value="quick">快速 · 3 处 × 2 秒</option><option value="balanced" selected>均衡 · 5 处 × 4 秒</option><option value="thorough">深入 · 7 处 × 6 秒</option></select></label></div>',
    '<p id="taskCurveStatus" class="note" role="status">尚无当前素材的实测结果。曲线要求 Windows Native 的编码器一致性检查。</p>',
    '<div class="media-curve-grid">',
    '<div><strong>探索曲线</strong><small>横轴为真实试压次序；点旁为 CQ/CRF，虚线为目标 SSIM。</small>',
    '<svg id="taskExplorationChart" viewBox="0 0 720 220" role="img" aria-label="实测 CQ 或 CRF 探索次序与质量"></svg>',
    '<div id="taskExplorationPoints" class="media-curve-points"></div></div>',
    '<div><strong>效率曲线</strong><small>横轴为预算体积（对数），纵轴为短片 SSIM。仅在实测码率范围内插值。</small>',
    '<svg id="taskEfficiencyChart" viewBox="0 0 720 220" role="slider" tabindex="0" aria-label="选择实测范围内的目标视频码率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></svg>',
    '<div id="taskCurveReadout" class="media-curve-readout">至少完成两个不同码率的有效测试后显示曲线。</div>',
    '<button type="button" id="taskAdoptCurveRate" class="secondary" disabled>采用所选码率（需复核）</button></div></div>',
    '<p class="note">SSIM 和局部效率拐点只是样本证据，不等于视觉无损或七小时整片质量保证。选择码率采用 VBR，不代表能复现 CQ 模式下的相同 SSIM。源音频复制时，图中估计体积不包含音频。</p>'
  ].join('');
  section.querySelector('#taskEncoding').before(panel);
  const get = id => panel.querySelector('#' + id);
  const btn = get('taskExploreCurve'), plot = get('taskExplorationChart');
  const efficiency = get('taskEfficiencyChart'), readout = get('taskCurveReadout');
  const targetControl = get('taskExploreTarget'), profileControl = get('taskCurveProfile'), stop = get('taskStopCurve');
  let points = [], frontier = null, selectedBytes = null, running = false, cancelRequested = false, sourceKey = '';
  let fullDuration = 0, sourceDuration = 0, calculatedAudioRate = 0, audioUncertain = false;
  const evidenceIsCurrent = () => !!sourceKey &&
    sourceKey === calibrationKey(hooks.settings(), {duration:sourceDuration});
  const label = text => { get('taskCurveStatus').textContent = text; };
  const measuredVideoSize = bytes => (bytes / 1e9).toFixed(2) + ' GB';
  const useQuality = q => {
    hooks.applyQuality(q);
    label('已采用实际测试过的 CQ/CRF ' + q + '。改变参数后应再次检查输出。');
  };
  const audioPlan = (raw, task) => {
    const tracks = Number(task.expectedAudioTracks || 0);
    if (raw.audio === 'none' || tracks === 0) return { rate: 0, uncertain: false };
    if (raw.audio === 'copy') return { rate: 0, uncertain: true };
    // Account for audio kept full when the video timeline is trimmed.
    const videoSeconds = Number(task.expectedVideoDuration || 0);
    const audioSeconds = Number(task.expectedAudioDuration || 0);
    if (!(videoSeconds > 0) || !(audioSeconds >= 0)) return { rate: 0, uncertain: true };
    return { rate: Number(raw.audioBitrate || 128000) * tracks * audioSeconds/videoSeconds, uncertain: false };
  };
  const render = () => {
    btn.disabled = running;
    stop.disabled = !running || cancelRequested;
    btn.textContent = running ? '正在实测…' : '探索当前编码器';
    const exploration = buildExplorationPlot(points, Number(targetControl.value));
    if (exploration.ok) {
      plot.innerHTML =
        '<line x1="32" x2="688" y1="' + exploration.targetY.toFixed(2) + '" y2="' + exploration.targetY.toFixed(2) + '" stroke="currentColor" stroke-dasharray="5 5" opacity=".5"></line>' +
        '<path d="' + exploration.line + '" fill="none" stroke="currentColor" stroke-width="2.5"></path>' +
        exploration.measured.map(p =>
          '<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) + '" r="5" fill="' +
          (p.meetsTarget ? '#31bc89' : '#df9876') + '"></circle>' +
          '<text x="' + p.x.toFixed(2) + '" y="' + Math.max(12,p.y-10).toFixed(2) +
          '" text-anchor="middle" fill="currentColor" font-size="12">CQ ' + p.qualitySetting + '</text>'
        ).join('');
    } else plot.replaceChildren();
    const rows = get('taskExplorationPoints');
    rows.replaceChildren();
    for (const point of points) {
      const row = document.createElement('div');
      row.className = 'media-curve-measurement';
      const details = document.createElement('span');
      details.textContent = '#' + point.iteration + ' · CQ/CRF ' + point.qualitySetting +
        ' · 最低 SSIM ' + point.ssim.toFixed(5) +
        ' · ' + (point.sampleBitrate / 1e6).toFixed(2) + ' Mbps';
      const adopt = document.createElement('button');
      adopt.type='button';adopt.className='secondary';adopt.textContent='采用此质量值';
      adopt.disabled = running;
      adopt.addEventListener('click', () => useQuality(point.qualitySetting));
      row.append(details,adopt);rows.append(row);
    }

    if (!frontier?.ok || !evidenceIsCurrent()) {
      efficiency.replaceChildren();
      readout.textContent = '至少需要两个不同码率的有效测量点。';
      get('taskAdoptCurveRate').disabled = true;
      return;
    }
    if (!(selectedBytes > 0)) selectedBytes = frontier.knee?.targetBytes || frontier.minimumEvidenceTargetBytes;
    const plotted = buildSizeFrontierPlot(frontier, { selectedTargetBytes: selectedBytes });
    if (!plotted.ok) {
      efficiency.replaceChildren();
      readout.textContent = '无法构建有证据约束的体积—质量图。';
      get('taskAdoptCurveRate').disabled = true;
      return;
    }
    const dot = plotted.selected;
    efficiency.innerHTML =
      '<path d="' + plotted.bandPath + '" fill="currentColor" opacity=".10"></path>' +
      '<path d="' + plotted.curvePath + '" fill="none" stroke="currentColor" stroke-width="2.5"></path>' +
      plotted.evidencePoints.map(p => '<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) +
        '" r="4" fill="#46abda"></circle>').join('') +
      (plotted.knee ? '<circle cx="' + plotted.knee.x.toFixed(2) + '" cy="' + plotted.knee.y.toFixed(2) +
        '" r="6" fill="#dfb260"><title>局部效率拐点</title></circle>' : '') +
      (dot ? '<circle cx="' + dot.x.toFixed(2) + '" cy="' + dot.y.toFixed(2) +
        '" r="7" fill="#31bc89"></circle>' : '');
    const frac = evidenceFractionForTargetBytes(frontier, selectedBytes);
    efficiency.setAttribute('aria-valuenow',String(Math.round(100 * (frac ?? 0))));
    efficiency.setAttribute('aria-valuetext',dot
      ? ((dot.videoBitrate/1e6).toFixed(2) + ' Mbps，预计 '+measuredVideoSize(selectedBytes))
      : '未选择有证据的码率');
    const dispersion = summarizeCalibrationEvidence(points);
    readout.textContent = dot ?
      '选择 ' + (dot.videoBitrate/1e6).toFixed(2) + ' Mbps · ' +
      (audioUncertain ? '仅视频预算约 ' : '音视频预算约 ') + measuredVideoSize(selectedBytes) +
      ' · 已测点插值 SSIM ' + dot.quality.toFixed(5) +
      '（跨位置观察范围 ' + dot.lowerQuality.toFixed(5) + '–' + dot.upperQuality.toFixed(5) + '）' +
      (dispersion ? ' · 最近一次 CQ 的样本码率范围 ' +
        (dispersion.minBitrate/1e6).toFixed(1) + '–' + (dispersion.maxBitrate/1e6).toFixed(1) + ' Mbps' : '') +
      (dispersion?.widelyDivergent ? ' · 样本波动大，整片体积与画质预测风险较高' : '') :
      '请选择已测量的体积范围';
    get('taskAdoptCurveRate').disabled = !dot || running || !evidenceIsCurrent();
  };

  const updateEvidence = (newPoints, raw, task) => {
    points = newPoints;
    const audio = audioPlan(raw,task);
    calculatedAudioRate = audio.rate;
    audioUncertain = audio.uncertain;
    frontier = createMeasuredSizeFrontier(points, {
      durationSeconds: fullDuration,
      audioBitrate: calculatedAudioRate,
      reservePercent: 4
    });
    selectedBytes = null;
    render();
  };
  const pointerSelect = event => {
    if (!frontier?.ok || running || !evidenceIsCurrent()) return;
    const rect = efficiency.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const x = (Number(event.clientX) - rect.left) * 720 / rect.width;
    selectedBytes = targetBytesAtEvidenceFraction(frontier, clamp((x-34)/652,0,1));
    render();
  };
  function clamp(value, lo, hi){return Math.max(lo,Math.min(hi,value));}
  efficiency.addEventListener('pointerdown',pointerSelect);
  efficiency.addEventListener('pointermove',event=>{if(event.buttons===1)pointerSelect(event);});
  efficiency.addEventListener('keydown',event=>{
    if (!frontier?.ok || running || !evidenceIsCurrent()) return;
    const existing = evidenceFractionForTargetBytes(frontier,selectedBytes) ?? 0.5;
    let next=existing;
    if(event.key==='ArrowLeft'||event.key==='ArrowDown')next-=0.02;
    else if(event.key==='ArrowRight'||event.key==='ArrowUp')next+=0.02;
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=1;
    else return;
    event.preventDefault();
    selectedBytes=targetBytesAtEvidenceFraction(frontier,clamp(next,0,1));
    render();
  });
  get('taskAdoptCurveRate').addEventListener('click',()=>{
    const evaluation = frontier?.evaluateTargetBytes(selectedBytes);
    if (!evidenceIsCurrent() || evaluation?.status !== 'within-evidence')return;
    hooks.applyBitrate(Math.round(evaluation.videoBitrate));
    label('已采用 ' + (evaluation.videoBitrate/1e6).toFixed(2) +
      ' Mbps 的目标平均码率。VBR 与实测 CQ 不同；正式输出的体积/画质仍需验证。');
  });
  const calibrationKey=(raw,media) => JSON.stringify([
    hooks.sourceIdentity(),media.duration,raw.operation,raw.codec,raw.encoder,raw.preset,
    raw.start,raw.end,raw.videoRange,raw.videoStreams,raw.pixelFormat,raw.fpsMode,raw.fps,raw.frames,
    raw.crop,raw.rotation,raw.deinterlace,raw.width,raw.height,raw.squarePixels,
    raw.denoise,raw.deband,raw.sharpen,raw.gop,raw.bf,raw.refs,raw.threads,
    raw.codecParams,raw.profile,raw.level,raw.tune,raw.maxrate,raw.bufsize,
    raw.spatialAq,raw.temporalAq,raw.lookahead,raw.aqStrength,raw.multipass,
    raw.audio,raw.audioBitrate,raw.audioTrack,raw.audioRange,targetControl.value,profileControl.value
  ]);
  const invalidate=()=>{
    if (running)return;
    points=[];frontier=null;selectedBytes=null;sourceKey='';
    label('素材或编码方案已改变；请重新运行实测。');
    render();
  };
  targetControl.addEventListener('change',invalidate);
  btn.addEventListener('click',async()=>{
    if (running || hooks.busy())return;
    running=true;render();hooks.setBusy(true);
    try {
      const raw=hooks.settings();
      if(raw.operation!=='transcode')throw Error('请切换至纯视频转码模式');
      if(!hooks.isWindows())throw Error('当前曲线需要 Windows Native；其他端尚未验证样本编码器一致性');
      const media=await hooks.prepare('transcode');
      const task=compileTask({...raw,rateMode:'quality',twoPass:false},media);
      await hooks.validate?.(task);
      if(task.expectedVideoTracks!==1 || task.videoStreams[0]!==0)throw Error('曲线当前只支持主视频流 v:0');
      const unsupported=['fps','frames','width','height','crop','gop','bf','refs','threads','codecParams','profile','level','tune','maxrate','bufsize','lookahead','aqStrength'];
      if(unsupported.some(k=>String(raw[k]??'').trim()))throw Error('当前使用了样本接口未等价支持的高级参数，请先恢复默认再校准');
      if((raw.fpsMode!=='auto'&&raw.fpsMode!=='passthrough')||raw.pixelFormat!=='yuv420p'||
        raw.rotation!=='none'||raw.deinterlace!=='none'||
        raw.squarePixels||raw.denoise||raw.deband||raw.sharpen||raw.spatialAq||raw.temporalAq||
        (raw.encoder.endsWith('_nvenc') && raw.multipass!=='fullres'))
        throw Error('样本当前仅支持 SDR 8-bit 无滤镜、默认 NVENC 分析策略与原尺寸/帧率；请恢复相应设置');
      const v=Array.isArray(media.videoStreams)?media.videoStreams[0]:media;
      if(v?.hdr||v?.isHdr||/10|12|p010|p016/.test(String(v?.pixelFormat||media.pixelFormat||'')))
        throw Error('HDR/高位深输入尚无经过验证的等价样本链路，拒绝绘制曲线');
      const from=task.videoRange==='full'?0:Number(task.start),to=task.videoRange==='full'?Number(media.duration):Number(task.end);
      const starts=calibrationSampleStarts(from,to,2);
      if(!starts.length)throw Error('所选片段不足 2 秒');
      fullDuration=Number(task.expectedVideoDuration);
      const target=Number(targetControl.value);
      if(!(target>=.8&&target<=.9999))throw Error('目标 SSIM 须在 0.80–0.9999 之间');
      sourceKey=calibrationKey(raw,media);
      updateEvidence([],raw,task);
      const limits=raw.encoder.endsWith('_nvenc')?{min:14,max:45}:raw.codec==='av1'?{min:18,max:50}:{min:12,max:40};
      const result=await exploreQuality({
        minQuality:limits.min,maxQuality:limits.max,targetSsim:target,
        maxEvaluations:7,
        evaluate:async q=>{
          const samples=[];
          for(const start of starts){
            label('探索中：CQ/CRF '+q+' · 样本 '+(samples.length+1)+'/'+starts.length+' · 位置 '+Math.round(start)+' 秒');
            const sample=await hooks.calibrationSample({
              codec:raw.codec,encoder:raw.encoder,preset:raw.preset,
              quality:q,start,duration:2
            });
            if(!sample || sample.ssim==null || sample.totalVideoBytes==null)throw Error('真实样本未返回 SSIM 或视频字节数');
            const seconds=Number(sample.duration||2);
            samples.push({
              start,ssim:Number(sample.ssim),duration:seconds,
              bitrate:Number(sample.totalVideoBytes)*8/seconds,
              elapsedSeconds:Number(sample.elapsedSeconds||0)
            });
          }
          const rates=samples.map(s=>s.bitrate),qualities=samples.map(s=>s.ssim);
          return {
            sampleBitrate:rates.reduce((a,b)=>a+b,0)/rates.length,
            ssim:Math.min(...qualities),
            averageSsim:qualities.reduce((a,b)=>a+b,0)/qualities.length,
            sampleCount:samples.length,
            sampleMeasurements:samples
          };
        },
        onPoint:(point,current)=>{
          updateEvidence(current,raw,task);
          label('已实测 '+current.length+' 个质量设置；最新 CQ/CRF '+point.qualitySetting+
            '，最低 SSIM '+point.ssim.toFixed(5)+'，样本码率 '+(point.sampleBitrate/1e6).toFixed(2)+' Mbps');
        }
      });
      updateEvidence(result.points,raw,task);
      label('实测完成：'+result.evaluatedCount+' 个 CQ/CRF，'+starts.length+
        ' 个分散位置/设置；'+(result.best?'满足最低样本 SSIM 的最高已测质量值 '+result.best.qualitySetting:'所测设置均未达到目标')+
        '。曲线不对未测区间做外推。');
    } catch(error){
      label('无法生成可信实测曲线：'+error.message);
      hooks.log?.('转码曲线校准失败：'+(error.stack||error.message));
    } finally {
      running=false;hooks.setBusy(false);render();
    }
  });
  const refresh=()=>{panel.hidden=hooks.settings().operation!=='transcode';};
  refresh();render();
  return {panel,refresh,invalidate,dispose:()=>panel.remove()};
}
