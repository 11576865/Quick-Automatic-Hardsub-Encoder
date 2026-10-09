import { compileTask } from './media-task.js';
import { exploreQuality, calibrationSampleStarts, createMeasuredSizeFrontier, CALIBRATION_PROFILES, summarizeCalibrationEvidence, parseMeasuredQuality, parseMeasuredNumber } from './transcode-curves.js';
import { buildSizeFrontierPlot, targetBytesAtEvidenceFraction, evidenceFractionForTargetBytes } from './size-frontier-ui.js';
import { renderRateDistortionSvg, plotFractionAtX, plotXFromClientX } from './curve-chart-svg.js';
import { calibrationTimeBudget } from './compression-decision.js';

// One measured size-quality curve for manual video-only transcode. This is intentionally
// separate from subtitle calibration: sample identity must match the manual
// encoder, preset and selected timeline, or no curve is published.
export function mountTranscodeCurves(section, hooks) {
  const panel = document.createElement('section');
  panel.id = 'taskCompressionCurves';
  panel.className = 'media-compression-curves';
  panel.setAttribute('aria-label', '压制前体积—质量曲线');
  panel.innerHTML = [
    '<div class="media-curves-header"><div><strong>压制前 · 体积—质量曲线</strong>',
    '<p>在选定的视频区间上抽取分散的短片，逐步测量质量与码率。不会先重压整段母片。</p></div>',
    '<div class="media-curve-actions"><button type="button" id="taskExploreCurve" class="secondary">开始实测</button>',
    '<button type="button" id="taskStopCurve" class="secondary" disabled>停止实测</button></div></div>',
    '<div class="media-curve-options"><label class="media-curve-target">最低样本 SSIM 目标 <input type="number" id="taskExploreTarget" min="0.80" max="0.9999" step="0.001" value="0.980"></label>',
    '<label class="media-curve-target">采样力度 <select id="taskCurveProfile"><option value="quick">快速 · 3 处 × 2 秒</option><option value="balanced" selected>均衡 · 5 处 × 4 秒</option><option value="thorough">深入 · 7 处 × 6 秒</option></select></label></div>',
    '<p id="taskCurveStatus" class="note" role="status">尚无当前素材的实测结果。曲线要求 Windows Native 的编码器一致性检查。</p>',
    '<div class="media-curve-grid">',
    '<div><strong>体积—质量曲线</strong><small>横轴为预算体积（对数），纵轴为短片 SSIM。圆点为实测，连线为有证据约束的插值。</small>',
    '<div class="media-curve-viewport"><svg id="taskEfficiencyChart" viewBox="0 0 720 300" role="slider" tabindex="0" aria-label="选择实测范围内的目标视频码率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></svg></div>',
    '<div class="media-curve-legend"><span class="legend-fit">保序拟合</span><span class="legend-observed">原始观测</span><span class="legend-band">范围插值</span><span class="legend-whisker">场景范围</span><span class="legend-knee">局部拐点</span></div>',
    '<div id="taskCurveReadout" class="media-curve-readout">至少完成两个不同码率的有效测试后显示曲线。</div>',
    '<button type="button" id="taskVerifyCurveRate" class="secondary" disabled>实测验证当前 VBR 码率</button>',
    '<button type="button" id="taskAdoptCurveRate" class="secondary" disabled>采用所选码率（需先验证）</button>',
    '<details class="media-curve-observations"><summary id="taskMeasuredQualitySummary">实测 CQ/CRF 参数（可采用）</summary>',
    '<div id="taskMeasuredQualityPoints" class="media-curve-points"></div></details></div></div>',
    '<p class="note">SSIM 和局部效率拐点只是样本证据，不等于视觉无损或七小时整片质量保证。选择码率采用 VBR，不代表能复现 CQ 模式下的相同 SSIM。源音频复制时，图中估计体积不包含音频。</p>'
  ].join('');
  section.querySelector('#taskEncoding').before(panel);
  const get = id => panel.querySelector('#' + id);
  const btn = get('taskExploreCurve');
  const efficiency = get('taskEfficiencyChart'), readout = get('taskCurveReadout');
  const targetControl = get('taskExploreTarget'), profileControl = get('taskCurveProfile'), stop = get('taskStopCurve');
  let points = [], frontier = null, selectedBytes = null, running = false, cancelRequested = false, disposed = false, sourceKey = '';
  let evidenceMedia = null, evidenceTask = null, verifiedSelection = null;
  let fullDuration = 0, sourceDuration = 0, calculatedAudioRate = 0, audioUncertain = false;
  // Measurements depend on the video encode and sample positions, not on the
  // user's SSIM acceptance threshold or on the final audio size budget.
  const evidenceIsCurrent = () => !!sourceKey &&
    sourceKey === measurementKey(hooks.settings(), {duration:sourceDuration});
  const targetIsValid = () => {
    const value = parseMeasuredQuality(targetControl.value);
    return value !== null && value >= .8 && value <= .9999;
  };
  const label = text => { get('taskCurveStatus').textContent = text; };
  const measuredVideoSize = bytes => (bytes / 1e9).toFixed(2) + ' GB';
  const useQuality = q => {
    if (running || hooks.busy() || !evidenceIsCurrent() || !targetIsValid()) return;
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
    btn.textContent = running ? '正在实测…' : '开始实测';
    get('taskMeasuredQualitySummary').textContent =
      '实测 CQ/CRF 参数（' + points.length + ' 项，可采用）';
    const rows = get('taskMeasuredQualityPoints');
    rows.replaceChildren();
    for (const point of points) {
      const row = document.createElement('div');
      row.className = 'media-curve-measurement';
      const details = document.createElement('span');
      details.textContent = '#' + point.iteration + ' · CQ/CRF ' + point.qualitySetting +
        ' · 最低 SSIM ' + point.ssim.toFixed(5) +
        ' · ' + (point.sampleBitrate / 1e6).toFixed(2) + ' Mbps' +
        (point.meetsTarget ? ' · 达标' : ' · 未达标');
      const adopt = document.createElement('button');
      adopt.type='button';adopt.className='secondary';adopt.textContent='采用此质量值';
      adopt.disabled = running || hooks.busy() || !evidenceIsCurrent() || !targetIsValid();
      adopt.addEventListener('click', () => useQuality(point.qualitySetting));
      row.append(details,adopt);rows.append(row);
    }

    if (!frontier?.ok || !evidenceIsCurrent()) {
      efficiency.replaceChildren();
      readout.textContent = '至少需要两个不同码率的有效测量点。';
      get('taskAdoptCurveRate').disabled = true;
      get('taskVerifyCurveRate').disabled = true;
      return;
    }
    if (!(selectedBytes > 0)) selectedBytes = frontier.knee?.targetBytes || frontier.minimumEvidenceTargetBytes;
    const plotted = buildSizeFrontierPlot(frontier, { selectedTargetBytes: selectedBytes });
    if (!plotted.ok) {
      efficiency.replaceChildren();
      readout.textContent = '无法构建有证据约束的体积—质量图。';
      get('taskAdoptCurveRate').disabled = true;
      get('taskVerifyCurveRate').disabled = true;
      return;
    }
    const dot = plotted.selected;
    efficiency.innerHTML = renderRateDistortionSvg(plotted);
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
    const target=parseMeasuredQuality(targetControl.value);
    const bitrate=dot?Math.round(dot.videoBitrate):null;
    const verified=!!dot && !!verifiedSelection &&
      verifiedSelection.sourceKey===sourceKey && verifiedSelection.bitrate===bitrate &&
      verifiedSelection.target===target;
    get('taskVerifyCurveRate').disabled = !dot || running || hooks.busy() ||
      !evidenceIsCurrent() || !targetIsValid();
    get('taskAdoptCurveRate').disabled = !verified || running || hooks.busy() ||
      !evidenceIsCurrent() || !targetIsValid();
    get('taskAdoptCurveRate').textContent=verified
      ? '采用所选码率（短样已验证）' : '采用所选码率（需先验证）';
  };

  const updateEvidence = (newPoints, raw, task, { preserveSelection = false } = {}) => {
    points = newPoints;
    const audio = audioPlan(raw,task);
    calculatedAudioRate = audio.rate;
    audioUncertain = audio.uncertain;
    frontier = createMeasuredSizeFrontier(points, {
      durationSeconds: fullDuration,
      audioBitrate: calculatedAudioRate,
      reservePercent: 4
    });
    if (!preserveSelection) selectedBytes = null;
    verifiedSelection = null;
    render();
  };
  const pointerSelect = event => {
    if (!frontier?.ok || running || !evidenceIsCurrent()) return;
    const plotted = buildSizeFrontierPlot(frontier);
    if (!plotted.ok) return;
    const x = plotXFromClientX(event.clientX, efficiency.getBoundingClientRect(), plotted.width);
    const fraction = plotFractionAtX(plotted, x);
    if (fraction === null) return;
    selectedBytes = targetBytesAtEvidenceFraction(frontier, fraction);
    verifiedSelection = null;
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
    verifiedSelection=null;
    render();
  });
  get('taskAdoptCurveRate').addEventListener('click',()=>{
    const evaluation = frontier?.evaluateTargetBytes(selectedBytes);
    if (running || hooks.busy() || !evidenceIsCurrent() || !targetIsValid() ||
      evaluation?.status !== 'within-evidence' || !verifiedSelection ||
      verifiedSelection.sourceKey!==sourceKey ||
      verifiedSelection.target!==parseMeasuredQuality(targetControl.value) ||
      verifiedSelection.bitrate!==Math.round(evaluation.videoBitrate))return;
    hooks.applyBitrate(Math.round(evaluation.videoBitrate));
    label('已采用 '+(evaluation.videoBitrate/1e6).toFixed(2)+
      ' Mbps 的目标平均码率；同配置 VBR 短样质量已达标，正式整片仍需体积/画质验证。');
  });
  // CQ interpolation is never accepted as a VBR measurement. Execute the
  // selected encoder and preset in bitrate mode on the same sample positions.
  get('taskVerifyCurveRate').addEventListener('click',async()=>{
    const choice=frontier?.evaluateTargetBytes(selectedBytes);
    if(disposed || running || hooks.busy() || !evidenceIsCurrent() || !targetIsValid() ||
      choice?.status!=='within-evidence'||!evidenceTask||!evidenceMedia)return;
    const bitrate=Math.round(choice.videoBitrate),raw=hooks.settings(),task=evidenceTask;
    const runKey=calibrationKey(raw,{});
    const profile=CALIBRATION_PROFILES[profileControl.value];
    const from=task.videoRange==='full'?0:Number(task.start);
    const to=task.videoRange==='full'?Number(evidenceMedia.duration):Number(task.end);
    const starts=calibrationSampleStarts(from,to,profile.seconds,profile.count);
    if(!starts.length){label('无法取得有效 VBR 采样位置。');return;}
    running=true;cancelRequested=false;verifiedSelection=null;
    render();hooks.setBusy(true);
    const current=()=>!cancelRequested && !disposed && evidenceIsCurrent() &&
      runKey===calibrationKey(hooks.settings(),{}) &&
      Math.round(frontier?.evaluateTargetBytes(selectedBytes)?.videoBitrate||0)===bitrate;
    try{
      const observations=[];
      for(const start of starts){
        if(!current())throw Error('验证配置已变化，旧结果不可使用');
        label('实际 VBR 验证 '+(observations.length+1)+'/'+starts.length+
          ' · '+(bitrate/1e6).toFixed(2)+' Mbps');
        const sample=await hooks.calibrationSample({
          codec:raw.codec,encoder:raw.encoder,preset:raw.preset,multipass:task.multipass,
          mode:'bitrate',bitrate,start,duration:profile.seconds
        });
        if(!current())throw Error('验证配置已变化，旧结果不可使用');
        const ssim=parseMeasuredQuality(sample?.ssim),seconds=parseMeasuredNumber(sample?.duration),
          bytes=parseMeasuredNumber(sample?.totalVideoBytes);
        if(ssim===null||!(seconds>0)||!(bytes>0))
          throw Error('原生 VBR 样本缺少有效 SSIM、时长或视频字节数');
        observations.push({ssim,bitrate:bytes*8/seconds});
      }
      const min=Math.min(...observations.map(o=>o.ssim));
      const observed=observations.reduce((sum,o)=>sum+o.bitrate,0)/observations.length;
      const target=parseMeasuredQuality(targetControl.value);
      if(min<target){
        label('VBR 短样质量未达标：最低 SSIM '+min.toFixed(5)+
          ' < 目标 '+target.toFixed(5)+'；CQ 插值不能保证 VBR 质量。');
      }else{
        verifiedSelection={sourceKey,bitrate,target};
        label('VBR 短样达标：最低 SSIM '+min.toFixed(5)+
          ' · 实际平均 '+(observed/1e6).toFixed(2)+
          ' Mbps。允许采用此码率；整片质量与大小仍需验证。');
      }
    }catch(error){
      verifiedSelection=null;
      label('VBR 样本验证失败：'+error.message);
    }finally{running=false;hooks.setBusy(false);if(!disposed)render();}
  });
  const measurementKey=(raw,media) => JSON.stringify([
    hooks.sourceIdentity(),media.duration,raw.operation,raw.codec,raw.encoder,raw.preset,
    raw.start,raw.end,raw.videoRange,raw.videoStreams,raw.pixelFormat,raw.fpsMode,raw.fps,raw.frames,
    raw.crop,raw.rotation,raw.deinterlace,raw.width,raw.height,raw.squarePixels,
    raw.denoise,raw.deband,raw.sharpen,raw.gop,raw.bf,raw.refs,raw.threads,
    raw.codecParams,raw.profile,raw.level,raw.tune,raw.maxrate,raw.bufsize,
    raw.spatialAq,raw.temporalAq,raw.lookahead,raw.aqStrength,raw.multipass,
    profileControl.value
  ]);
  // An in-flight search must still reject threshold/audio changes. Only completed
  // observations can be re-evaluated under a different decision or audio budget.
  const calibrationKey=(raw,media) => JSON.stringify([
    measurementKey(raw,media), raw.audio,raw.audioBitrate,raw.audioTrack,raw.audioRange,
    targetControl.value
  ]);
  const clearEvidence=()=>{
    points=[];frontier=null;selectedBytes=null;sourceKey='';sourceDuration=0;
    evidenceMedia=null;evidenceTask=null;verifiedSelection=null;
  };
  const invalidate=()=>{
    if (running) {
      cancelRequested=true;
      clearEvidence();
      label('输入或编码参数发生变化，已停止继续采样；当前试压结束后将作废证据。');
      render();
      return;
    }
    const raw=hooks.settings();
    if (evidenceMedia && evidenceIsCurrent()) {
      if (!targetIsValid()) {
        label('目标 SSIM 无效。现有视频试压结果已保留，输入有效目标后重新评估。');
        render();
        return;
      }
      try {
        const task=compileTask({...raw,rateMode:'quality',twoPass:false},evidenceMedia);
        if(Number(task.expectedVideoDuration)!==fullDuration)
          throw Error('视频输出时长发生变化');
        const target=parseMeasuredQuality(targetControl.value);
        const reevaluated=points.map(point=>({...point,meetsTarget:point.ssim>=target}));
        evidenceTask=task;
        updateEvidence(reevaluated,raw,task,{preserveSelection:true});
        label('已按当前目标和音频预算重新计算；保留 '+points.length+
          ' 组视频实测证据，无需重新试压。必要时可继续追加校准。');
        return;
      } catch(error) {
        hooks.log?.('校准预算重算不可用：'+error.message);
      }
    }
    clearEvidence();
    label('素材或编码方案已改变；请重新运行实测。');
    render();
  };
  targetControl.addEventListener('change',invalidate);
  targetControl.addEventListener('input',invalidate);
  profileControl.addEventListener('change',invalidate);
  stop.addEventListener('click',()=>{
    if(!running)return;
    cancelRequested=true;
    label('已请求停止；当前原生短片试压结束后中断，不会采纳不完整曲线。');
    render();
  });
  btn.addEventListener('click',async()=>{
    if (disposed || running || hooks.busy())return;
    clearEvidence();
    running=true;cancelRequested=false;render();hooks.setBusy(true);
    try {
      const raw=hooks.settings();
      // Capture the entire input identity before the first await. Do not stamp
      // old settings with a new source/target after prepare or validation.
      const runKey=calibrationKey(raw,{});
      const assertRunCurrent=()=>{
        if(cancelRequested || disposed)throw Error('用户已停止校准');
        if(runKey!==calibrationKey(hooks.settings(),{})) {
          cancelRequested=true;
          throw Error('素材或编码参数已改变，请重新运行实测');
        }
      };
      if(raw.operation!=='transcode')throw Error('请切换至纯视频转码模式');
      if(!hooks.isWindows())throw Error('当前曲线需要 Windows Native；其他端尚未验证样本编码器一致性');
      const media=await hooks.prepare('transcode');
      assertRunCurrent();
      const task=compileTask({...raw,rateMode:'quality',twoPass:false},media);
      await hooks.validate?.(task);
      assertRunCurrent();
      if(task.expectedVideoTracks!==1 || task.videoStreams[0]!==0)throw Error('曲线当前只支持主视频流 v:0');
      const unsupported=['fps','frames','width','height','crop','gop','bf','refs','threads','codecParams','profile','level','tune','maxrate','bufsize','lookahead','aqStrength'];
      if(unsupported.some(k=>String(raw[k]??'').trim()))throw Error('当前使用了样本接口未等价支持的高级参数，请先恢复默认再校准');
      if(raw.fpsMode!=='auto'||raw.pixelFormat!=='yuv420p'||
        raw.rotation!=='none'||raw.deinterlace!=='none'||
        raw.squarePixels||raw.denoise||raw.deband||raw.sharpen||raw.spatialAq||raw.temporalAq||
        (raw.encoder.endsWith('_nvenc') && raw.multipass!=='fullres'))
        throw Error('样本当前仅支持 SDR 8-bit 无滤镜、默认 NVENC 分析策略与原尺寸/帧率；请恢复相应设置');
      const v=Array.isArray(media.videoStreams)?media.videoStreams[0]:media;
      if(v?.hdr||v?.isHdr||/10|12|p010|p016/.test(String(v?.pixelFormat||media.pixelFormat||'')))
        throw Error('HDR/高位深输入尚无经过验证的等价样本链路，拒绝绘制曲线');
      const from=task.videoRange==='full'?0:Number(task.start),to=task.videoRange==='full'?Number(media.duration):Number(task.end);
      const profile=CALIBRATION_PROFILES[profileControl.value];
      if(!profile)throw Error('未知校准采样方案');
      const starts=calibrationSampleStarts(from,to,profile.seconds,profile.count);
      if(!starts.length)throw Error('所选片段不足 '+profile.seconds+' 秒');
      fullDuration=Number(task.expectedVideoDuration);
      sourceDuration=Number(media.duration);
      const target=Number(targetControl.value);
      if(!(target>=.8&&target<=.9999))throw Error('目标 SSIM 须在 0.80–0.9999 之间');
      sourceKey=measurementKey(raw,media);
      evidenceMedia=media;evidenceTask=task;
      updateEvidence([],raw,task);
      const limits=raw.encoder.endsWith('_nvenc')?{min:14,max:45}:raw.codec==='av1'?{min:18,max:50}:{min:12,max:40};
      const budgetSeconds=calibrationTimeBudget(fullDuration);
      label('本次校准预计软预算约 '+Math.round(budgetSeconds)+' 秒；单个不可中断的原生样本仍可能超时。');
      const result=await exploreQuality({
        minQuality:limits.min,maxQuality:limits.max,targetSsim:target,
        maxEvaluations:7,
        budgetSeconds,
        evaluate:async q=>{
          const samples=[];
          for(const start of starts){
            assertRunCurrent();
            label('探索中：CQ/CRF '+q+' · 样本 '+(samples.length+1)+'/'+starts.length+
              ' · 位置 '+Math.round(start)+' 秒 · '+profile.seconds+' 秒/处');
            const sample=await hooks.calibrationSample({
              codec:raw.codec,encoder:raw.encoder,preset:raw.preset,
              multipass:task.multipass,
              quality:q,start,duration:profile.seconds
            });
            assertRunCurrent();
            // Validate the *raw* bridge payload before Number() can turn
            // false, whitespace or missing evidence into a measured zero.
            const ssim=parseMeasuredQuality(sample?.ssim);
            const bytes=parseMeasuredNumber(sample?.totalVideoBytes);
            const seconds=parseMeasuredNumber(sample?.duration);
            if(ssim===null || !(bytes>0) || !(seconds>0))
              throw Error('真实样本缺少有效 SSIM、时长或视频字节数，拒绝生成实测曲线');
            samples.push({
              start,ssim,duration:seconds,
              bitrate:bytes*8/seconds,
              elapsedSeconds:parseMeasuredNumber(sample.elapsedSeconds) ?? 0
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
          assertRunCurrent();
          updateEvidence(current,raw,task);
          label('已实测 '+current.length+' 个质量设置；最新 CQ/CRF '+point.qualitySetting+
            '，最低 SSIM '+point.ssim.toFixed(5)+'，样本码率 '+(point.sampleBitrate/1e6).toFixed(2)+' Mbps');
        }
      });
      assertRunCurrent();
      updateEvidence(result.points,raw,task);
      label('实测完成：'+result.evaluatedCount+' 个 CQ/CRF，'+starts.length+
        ' 个分散位置，每处 '+profile.seconds+' 秒；'+(result.best?'满足最低样本 SSIM 的最高已测质量值 '+result.best.qualitySetting:'所测设置均未达到目标')+
        '；实测编码耗时 '+result.encodeSeconds.toFixed(1)+' 秒'+
        (result.partial?'，提前停止原因 '+result.stopReason+'（当前证据可能不足）':'')+
        '。曲线仅代表短片观测，不保证七小时整片。');
    } catch(error){
      clearEvidence();
      label((cancelRequested ? '已作废未完成曲线：' : '无法生成可信实测曲线：') + error.message);
      hooks.log?.('转码曲线校准结束：'+(error.stack||error.message));
    } finally {
      running=false;hooks.setBusy(false);if(!disposed)render();
    }
  });
  const refresh=()=>{panel.hidden=hooks.settings().operation!=='transcode';};
  refresh();render();
  return {panel,refresh,invalidate,dispose:()=>{
    disposed=true;cancelRequested=true;clearEvidence();panel.remove();
  }};
}
