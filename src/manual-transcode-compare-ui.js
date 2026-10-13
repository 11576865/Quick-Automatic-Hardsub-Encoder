import {wholeFileLedger,projectWholeFileFrontier} from './whole-file-frontier.js';
import {SIZE_UNITS} from './media-planning.js';
import {manualCandidateSet} from './manual-candidate-set.js';
// Optional Manual pure-transcode two-codec comparison. One shared chart,
// one authoritative media-task state; no implicit encoder or rate adoption.
import {compileTask} from './media-task.js';
import {calibrationSampleStarts} from './transcode-curves.js';
import {calibrationTimeBudget} from './compression-decision.js';
import {createManualTranscodeSession,runManualPairedSweep} from './manual-transcode-session.js';
import {buildSizeFrontierPlot,targetBytesAtEvidenceFraction,evidenceFractionForTargetBytes} from './size-frontier-ui.js';
import {renderRateDistortionSvg,plotXFromClientX,plotFractionAtX} from './curve-chart-svg.js';
import {verifyManualNativeVbrCandidate} from './manual-transcode-vbr-verification.js';
import {summarizeManualEncodeCost} from './manual-time-tradeoff.js';

const QUALITY_SETTINGS=[18,28,40];
const reasonLabel={
  'insufficient-complete-branches':'至少两个编码器都需要两组完整的质量档位。',
  'no-common-evidence-domain':'两种编码器的实测体积范围不重叠；不能生成对比曲线。',
  'incompatible-native-receipt':'原生采样来源或测量协议不一致，全部旧证据已作废。',
  'encode-time-budget-exceeded':'已达到本次已报告的编码耗时预算。',
  'native-sample-failed':'原生样本执行失败。',
  'stopped-after-native-response':'已停止；晚到样本未被采用。',
  'stopped-between-samples':'已停止；未完成档位没有进入曲线。'
};
const percent=(frontier,bytes)=>evidenceFractionForTargetBytes(frontier,bytes)??0;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

export function mountManualTranscodeComparison({panel,hooks,chart,readout,
  getSourceKey,getTargetSsim,onRenderSingle}){
  const area=document.createElement('div');
  area.className='media-compare-controls';
  area.innerHTML=[
    '<div class="media-compare-heading"><div><strong>多编码器试压（实验性）</strong>',
    '<small id="taskCompareScope">Windows · x264 / x265 · 原尺寸 · 2 个时间窗口 × 3 档 CRF，共最多 12 次短片试压</small></div>',
    '<div class="media-curve-actions"><button type="button" class="secondary" id="taskCompareStart">比较两个编码器</button>',
    '<button type="button" class="secondary" id="taskCompareStop" disabled>停止对比</button>',
    '<button type="button" class="secondary" id="taskCompareSingle" hidden>返回单编码器曲线</button></div></div>',
    '<label>候选集合 <select id="taskComparePolicy"><option value="codecs">x264 / x265 · medium · 最多 12 次</option><option value="codecs-presets">x264 / x265 × medium / fast · 最多 24 次</option><option value="codecs-presets-resolutions">编码器 × preset × 原尺寸 / 1080p / 720p · 最多 72 次</option></select></label>',
    '<label>预算坐标 <select id="taskCompareBudgetBasis"><option value="whole">成品目标体积 · 完整预算</option><option value="video">仅视频负载 · 诊断</option></select></label>',
    '<p class="note" id="taskCompareStatus" role="status">对比结果仅供查看，不能自动切换编码器。需要正式采用时仍应使用当前编码器的 VBR 短样验证。</p>',
    '<details id="taskCompareDetails" hidden><summary>查看同预算候选及采样覆盖</summary>',
    '<div id="taskCompareCandidates"></div><div id="taskCompareCostEvidence"></div></details>',
    '<button type="button" class="secondary" id="taskCompareVerify" disabled hidden>实测验证当前推荐编码器的 VBR</button>',
    '<button type="button" class="secondary" id="taskCompareAdopt" disabled hidden>确认写入已验证的编码方案</button>',
    '<p class="note">成品预算包含已测复制流、附件、计划音频和封装余量；成本未知时拒绝推荐。仅视频坐标只供诊断。拟合不证明整片质量或实际成品大小。停止会等待当前原生调用结束；编码耗时配额不是严格墙钟时间上限。</p>'
  ].join('');
  const insertBefore=panel.querySelector('.media-curve-grid');
  insertBefore.before(area);
  const get=id=>area.querySelector('#'+id);
  const start=get('taskCompareStart'),stop=get('taskCompareStop'),back=get('taskCompareSingle'),verify=get('taskCompareVerify'),adopt=get('taskCompareAdopt');
  const policy=get('taskComparePolicy'),basis=get('taskCompareBudgetBasis');
  const budgetContext=()=>JSON.stringify([basis.value,hooks.budgetEvidence?.()||null]);
  function currentFrontier(){
    if(!comparison?.frontier?.ok)return comparison?.frontier;
    if(basis.value==='video')return comparison.frontier;
    try{const raw=hooks.settings();const t=compileTask({...raw,rateMode:'quality',budgetPolicy:'best-effort',twoPass:false},media);return projectWholeFileFrontier(comparison.frontier,wholeFileLedger(t,hooks.budgetEvidence?.()));}
    catch(e){return {ok:false,reason:'unknown-whole-file-budget',detail:e.message};}
  }
  const wholeBudgetForSelection=()=>basis.value==='whole'?{targetBytes:Math.round(selectedBytes),reservePercent:Number(hooks.settings().sizeReserve??4),budgetPolicy:hooks.settings().budgetPolicy||'best-effort'}:null;
  const mediaForBudget=()=>({...media,budgetEvidence:hooks.budgetEvidence?.()});
  const selectionSettings=()=>{const b=wholeBudgetForSelection();return b?{rateMode:'size',targetSize:b.targetBytes/1e6,sizeUnit:'MB',sizeReserve:b.reservePercent,budgetPolicy:b.budgetPolicy}:{rateMode:'bitrate',budgetPolicy:'best-effort'};};
  let activePolicy='codecs',sessionCandidates=[],lastGoalKey='';
  const goalKey=()=>JSON.stringify([hooks.settings().rateMode,hooks.settings().targetSize,hooks.settings().sizeUnit]);
  const currentGoalBytes=()=>Number(hooks.settings().targetSize)*SIZE_UNITS[hooks.settings().sizeUnit||'MB'];
  const status=get('taskCompareStatus'),details=get('taskCompareDetails'),rows=get('taskCompareCandidates'),costRows=get('taskCompareCostEvidence');
  let active=false,running=false,aborted=false,disposed=false,session=null;
  let sourceKey='',sourceDuration=0,comparison=null,selectedBytes=null;
  let task=null,media=null,verifiedVbr=null;
  const isCurrent=()=>!!sourceKey &&
    sourceKey===getSourceKey(hooks.settings(),{duration:sourceDuration}) && activePolicy===policy.value;
  const message=text=>{if(!disposed)status.textContent=text;};
  const invalidate=()=>{
    // The SSIM target is a decision threshold, not a new video measurement.
    // Keep complete Native evidence when source, encoder policy and reference
    // geometry have not changed; do not unnecessarily repeat 12 encodes.
    if(active&&isCurrent()){
      verifiedVbr=null;
      if(basis.value==='whole'&&hooks.settings().rateMode==='size'&&lastGoalKey!==goalKey())selectedBytes=currentGoalBytes();
      lastGoalKey=goalKey();
      message('目标、输出策略或成本已变化：保留同源 CQ 配对测量；此前 VBR 通过状态不再适用。');
      if(!running)onRenderSingle();
      return;
    }
    aborted=true;
    session?.invalidate('current-source-or-task-changed');
    session=null;sessionCandidates=[];comparison=null;selectedBytes=null;sourceKey='';sourceDuration=0;
    task=null;media=null;active=false;verifiedVbr=null;
    if(!disposed){
      back.hidden=true;details.hidden=true;rows.replaceChildren();
      message('来源或任务参数已改变；原多编码器证据已经作废。');
      renderControls();onRenderSingle();
    }
  };
  const renderControls=()=>{
    start.disabled=running||hooks.busy()||disposed;
    policy.disabled=start.disabled;basis.disabled=start.disabled;
    verify.hidden=!active;
    verify.disabled=running||hooks.busy()||!eligible()||currentFrontier()?.evaluateTargetBytes(selectedBytes)?.status!=='within-evidence';
    adopt.hidden=!hasCurrentVbr();
    adopt.disabled=running||hooks.busy()||!hasCurrentVbr();
    stop.disabled=!running||aborted;
    back.disabled=running;
    back.hidden=!active;
    start.textContent=running?'候选实测中…':policy.value==='codecs-presets-resolutions'?'比较编码器、preset 与分辨率':policy.value==='codecs-presets'?'比较编码器与 preset':'比较两个编码器';
    get('taskCompareScope').textContent='Windows · '+(policy.value==='codecs-presets-resolutions'?'公共原尺寸参考 · ':'原尺寸 · ')+'2 个窗口 × 3 档 CRF · 最多 '+(policy.value==='codecs-presets-resolutions'?72:policy.value==='codecs-presets'?24:12)+' 次短样；编码耗时预算不增加';
  };
  const eligible=()=>comparison?.ok && comparison.frontier?.ok &&
    session?.snapshot().ok && isCurrent() && !disposed && currentFrontier()?.ok;
  const hasCurrentVbr=()=>{
    if(!verifiedVbr?.passed || !eligible())return false;
    if(basis.value==='video'&&hooks.settings().budgetPolicy==='strict-ceiling')return false;
    const chosen=currentFrontier().evaluateTargetBytes(selectedBytes);
    return chosen?.status==='within-evidence' &&
      verifiedVbr.sourceKey===sourceKey && verifiedVbr.selectedBytes===selectedBytes &&
      verifiedVbr.candidateId===chosen.branchId &&
      verifiedVbr.requestedVideoBitrate===Math.round(chosen.videoBitrate) &&
      verifiedVbr.targetSsim===getTargetSsim?.() && verifiedVbr.budgetContext===budgetContext() &&
      JSON.stringify(hooks.settings())===JSON.stringify(verifiedVbr.expectedSettings) &&
      hooks.sourceIdentity?.()===verifiedVbr.expectedSourceIdentity;
  };
  function showResult(){
    if(!active)return false;
    if(!eligible()){
      chart.replaceChildren();chart.removeAttribute('aria-valuenow');
      chart.setAttribute('aria-valuetext','暂无可比较的两个完整候选');
      chart.setAttribute('aria-label','多编码器比较暂时没有有效的共同实测范围');
      readout.textContent=currentFrontier()?.detail?('完整预算不可用：'+currentFrontier().detail):'尚无两个完整且可比较的编码器；已完成的样本不会被当成正式质量承诺。';
      const partial=session?.snapshot();
      if(partial?.ok&&partial.candidates?.length){
        const list=document.createElement('ul');
        for(const branch of partial.candidates){
          const li=document.createElement('li');
          li.textContent=String(branch.id).toUpperCase()+' · 完整 CRF 档位 '+
            branch.completeSettings+' · 未完成档位 '+branch.pendingSettings+
            '（不足以作最终推荐）';
          list.append(li);
        }
        rows.replaceChildren(list);
        if(details.hidden)details.open=true;
        details.hidden=false;
      }else details.hidden=true;
      costRows.replaceChildren();
      verify.disabled=true;adopt.hidden=true;adopt.disabled=true;
      return true;
    }
    const f=currentFrontier();
    if(!(selectedBytes>0))
      selectedBytes=Math.sqrt(f.minimumEvidenceTargetBytes*f.maximumEvidenceTargetBytes);
    if(basis.value==='whole')selectedBytes=Math.round(selectedBytes);
    const plotted=buildSizeFrontierPlot(f,{selectedTargetBytes:selectedBytes});
    if(!plotted.ok){chart.replaceChildren();costRows.replaceChildren();readout.textContent='无法在共同实测体积范围绘制曲线。';return true;}
    chart.innerHTML=renderRateDistortionSvg(plotted);
    const evalResult=f.evaluateTargetBytes(selectedBytes);
    if(evalResult.status!=='within-evidence'){costRows.replaceChildren();readout.textContent='当前目标不在共同实测预算范围：'+evalResult.status+'；不会外推推荐或替换目标。';verify.disabled=true;adopt.hidden=true;adopt.disabled=true;return true;}
    chart.setAttribute('role','slider');
    chart.setAttribute('aria-label',basis.value==='whole'?'同一成品目标体积下选择多编码器估算对比位置':'同一视频预算下选择多编码器估算对比位置');
    chart.setAttribute('aria-valuenow',String(Math.round(100*percent(f,selectedBytes))));
    chart.setAttribute('aria-valuetext',(basis.value==='whole'?'成品目标约 ':'视频预算约 ')+(selectedBytes/1e6).toFixed(2)+' MB');
    const budgetText=(basis.value==='whole'?'成品目标体积 ':'视频估算预算 ')+(selectedBytes/1e6).toFixed(2)+' MB'+(evalResult.budget?' · 固定流/附件 '+(evalResult.budget.fixedPayloadBytes/1e6).toFixed(3)+' MB · 编码音频 '+(evalResult.budget.encodedAudioBytes/1e6).toFixed(3)+' MB · 封装余量 '+(evalResult.budget.containerReserveBytes/1e6).toFixed(3)+' MB':'');
    const currentVbr=verifiedVbr && verifiedVbr.passed &&
      verifiedVbr.sourceKey===sourceKey &&
      verifiedVbr.selectedBytes===selectedBytes &&
      verifiedVbr.candidateId===evalResult.branchId &&
      verifiedVbr.requestedVideoBitrate===Math.round(evalResult.videoBitrate) &&
      verifiedVbr.targetSsim===getTargetSsim?.() && verifiedVbr.budgetContext===budgetContext();
    readout.textContent=budgetText+' · 择优上包络 SSIM '+Number(evalResult.prediction?.quality??0).toFixed(5)+
      ' · 当前建议 '+String(evalResult.branchId||'未知').toUpperCase()+
      (currentVbr ? ' · VBR 短样已通过（最低 SSIM '+
        verifiedVbr.minimumSsim.toFixed(5)+'；正式方案未改变）。':
        '。仅限同源短样的拟合；未执行目标码率验证，未验证实际成品体积。');
    const list=document.createElement('ul');
    for(const item of evalResult.alternatives||[]){
      const li=document.createElement('li');
      li.textContent=String(item.id).toUpperCase()+
        ' · 拟合 SSIM '+Number(item.quality).toFixed(5)+
        ' · 场景保守下界 '+Number(item.lowerQuality).toFixed(5)+
        (item.id===evalResult.branchId?' · 当前推荐':'');
      list.append(li);
    }
    rows.replaceChildren(list);
    const observations=summarizeManualEncodeCost(session.trials(),{
      referenceVideoBitrate:Number(evalResult.videoBitrate)>0?Number(evalResult.videoBitrate):null
    });
    const costHeading=document.createElement('h4');
    costHeading.textContent='质量 · 视频负载 · 编码耗时（同源短片实测）';
    const costNote=document.createElement('p');
    costNote.className='note';
    costNote.textContent='仅展示当前采样档位真实 FFmpeg 编码秒数与速度；不预测整片耗时，不能把最近档位当作目标码率验证。';
    if(observations.ok){
      const costList=document.createElement('ul');
      for(const item of observations.candidates){
        const li=document.createElement('li'),point=item.nearestObserved;
        li.textContent=point?
          String(item.candidateId).toUpperCase()+
          ' · 最近实测 CRF '+point.qualitySetting+
          ' · 视频 '+(point.measuredVideoBitrate/1e6).toFixed(2)+' Mbps'+
          (item.referenceRateDeltaPercent===null?'':'（距所选目标 '+(item.referenceRateDeltaPercent>0?'+':'')+item.referenceRateDeltaPercent.toFixed(1)+'%）')+
          ' · 最低 SSIM '+point.minimumSsim.toFixed(5)+
          ' · '+point.measuredMediaSeconds.toFixed(2)+' 秒样本编码 '+point.measuredEncodeSeconds.toFixed(2)+' 秒'+
          '（'+point.speedFactor.toFixed(2)+'× 实时）'
          :String(item.candidateId).toUpperCase()+' · 编码耗时证据不足，拒绝性能排名';
        costList.append(li);
      }
      if(observations.candidatesOmitted){
        const li=document.createElement('li');
        li.textContent='其余 '+observations.candidatesOmitted+' 个候选请缩小比较集合。';
        costList.append(li);
      }
      const near=observations.matchedQualityPairs[0];
      const paired=document.createElement('p');
      paired.className='note';
      paired.textContent=near?
        '近似同画质实测档位（最低/平均 SSIM 差均不大于 0.003）：'+
        near.candidateA+' CRF '+near.qualitySettingA+' / '+
        near.candidateB+' CRF '+near.qualitySettingB+
        '；时间比 A/B '+near.timeRatioAOverB.toFixed(2)+
        '，视频码率比 A/B '+near.videoRateRatioAOverB.toFixed(2)+
        '。不是严格等画质证明，也不是整片预测。'
        :'当前短样没有足够接近画质的跨候选实测档位；拒绝推断同画质编码时间赢家。';
      costRows.replaceChildren(costHeading,costNote,costList,paired);
    }else{
      const missing=document.createElement('p');
      missing.className='note';
      missing.textContent='编码时间证据不足：'+observations.reason+'；SSIM 曲线不因此获得时间维度的推荐权。';
      costRows.replaceChildren(costHeading,missing);
    }
    if(details.hidden)details.open=true;
    details.hidden=false;
    verify.disabled=running||hooks.busy();
    adopt.hidden=!hasCurrentVbr();
    adopt.disabled=running||hooks.busy()||!hasCurrentVbr();
    return true;
  }
  const selectPointer=event=>{
    if(!active||!eligible()||running)return false;
    const f=currentFrontier(),plot=buildSizeFrontierPlot(f);
    if(!plot.ok)return true;
    const x=plotXFromClientX(event.clientX,chart.getBoundingClientRect(),plot.width);
    const fraction=plotFractionAtX(plot,x);
    if(fraction===null)return true;
    selectedBytes=targetBytesAtEvidenceFraction(f,fraction);
    if(verifiedVbr)message('预算已改变：当前位置需要重新执行 VBR 短样验证。');
    verifiedVbr=null;showResult();
    return true;
  };
  const selectKeyboard=event=>{
    if(!active||!eligible()||running)return false;
    const f=currentFrontier();let x=percent(f,selectedBytes);
    if(['ArrowLeft','ArrowDown'].includes(event.key))x-=.02;
    else if(['ArrowRight','ArrowUp'].includes(event.key))x+=.02;
    else if(event.key==='Home')x=0;
    else if(event.key==='End')x=1;
    else return false;
    event.preventDefault();
    selectedBytes=targetBytesAtEvidenceFraction(f,clamp(x,0,1));
    if(verifiedVbr)message('预算已改变：当前位置需要重新执行 VBR 短样验证。');
    verifiedVbr=null;showResult();return true;
  };
  function geometrySettings(c){return c.scaleAlgorithm==='bicubic'?{width:c.outputWidth,height:c.outputHeight,scaleAlgorithm:'bicubic'}:{};}
  function sampleGeometry(c,g=session?.snapshot().protocol){return c.scaleAlgorithm==='bicubic'?{commonReference:true,outputWidth:c.outputWidth,outputHeight:c.outputHeight,referenceWidth:g.width??g.referenceWidth,referenceHeight:g.height??g.referenceHeight}:{};}
  function preflight(raw,originalMedia){
    if(raw.operation!=='transcode'||!hooks.isWindows())
      throw Error('双编码器对比仅支持 Windows Native 纯视频转码');
    const unsupported=['fps','frames','width','height','crop','gop','bf','refs','threads',
      'codecParams','profile','level','tune','maxrate','bufsize','lookahead','aqStrength'];
    if(unsupported.some(k=>String(raw[k]??'').trim()))
      throw Error('当前设置包含尚不能复现到 Native 试压的高级视频参数');
    if(raw.fpsMode!=='auto'||raw.pixelFormat!=='yuv420p'||
       raw.rotation!=='none'||raw.deinterlace!=='none'||
       raw.squarePixels||raw.denoise||raw.deband||raw.sharpen||
       raw.spatialAq||raw.temporalAq)
      throw Error('双编码器试压仅支持 SDR 8-bit 原尺寸、无额外滤镜和原帧率');
    const v=originalMedia.videoStreams?.[0]||originalMedia;
    if(v?.hdr||v?.highBitDepth||v?.unsafeColorPipeline ||
       Number(v?.bitDepth||8)>8||String(v?.pixelFormat||'')!=='yuv420p')
      throw Error('当前来源不是经过验证的 SDR 8-bit yuv420p 输入');
    if(!(Number(v?.width)>0&&Number(v?.height)>0))
      throw Error('缺少可靠的视频尺寸证据');
    return {width:Number(v.width),height:Number(v.height)};
  }
  verify.addEventListener('click',async()=>{
    if(running||hooks.busy()||!eligible())return;
    const frontier=currentFrontier();
    const evaluation=frontier.evaluateTargetBytes(selectedBytes);
    if(evaluation?.status!=='within-evidence')return;
    const selected=sessionCandidates.find(c=>c.id===evaluation.branchId);
    const plannedBitrate=Math.round(evaluation.videoBitrate);
    const threshold=getTargetSsim?.();
    if(!selected||!(plannedBitrate>0)||!Number.isFinite(threshold)||
       threshold<.8||threshold>.9999){
      message('选择的候选、码率或目标 SSIM 无效；拒绝 VBR 验证。');
      return;
    }
    const candidate={...selected};
    const chosenBytes=selectedBytes,chosenKey=sourceKey,chosenContext=budgetContext(),verifySettings=JSON.stringify(hooks.settings());
    verifiedVbr=null;running=true;aborted=false;renderControls();
    hooks.setBusy(true);
    const current=()=>!disposed&&!aborted&&isCurrent()&&
      sourceKey===chosenKey&&selectedBytes===chosenBytes&&
      getTargetSsim?.()===threshold && budgetContext()===chosenContext && JSON.stringify(hooks.settings())===verifySettings;
    try{
      const raw=hooks.settings();
      const formal=compileTask({...raw,codec:selected.codec,encoder:selected.encoder,
        preset:selected.preset,...geometrySettings(selected),multipass:'disabled',...selectionSettings(),
        bitrate:plannedBitrate,twoPass:false},mediaForBudget());
      if(formal.bitrate!==plannedBitrate)throw Error('完整预算与已选视频码率不一致');
      await hooks.validate?.(formal);
      if(!current())throw Error('参数或来源已改变，验证结果作废。');
      const outcomes=[];
      for(const window of session.snapshot().protocol.windows){
        if(!current())throw Error('已停止或校准参数发生变化。');
        message('验证 '+selected.id.toUpperCase()+' VBR · '+(outcomes.length+1)+
          '/'+session.snapshot().protocol.windows.length+
          ' · 目标 '+(plannedBitrate/1e6).toFixed(2)+' Mbps');
        const sample=await hooks.calibrationSample({
          codec:selected.codec,encoder:selected.encoder,preset:selected.preset,
          multipass:'disabled',...sampleGeometry(selected),mode:'bitrate',bitrate:plannedBitrate,
          start:window.start,duration:window.duration,timeoutSeconds:45
        });
        if(!current())throw Error('原生调用返回后参数已改变，拒绝迟到证据。');
        outcomes.push({window,sample});
      }
      const result=verifyManualNativeVbrCandidate({
        protocol:session.snapshot().protocol,candidate,
        bitrate:plannedBitrate,targetSsim:threshold,samples:outcomes
      });
      if(!result.ok){
        if(result.reason==='incompatible-native-vbr-receipt'){
          session.invalidate('native-vbr-provenance-drift');
          comparison=null;
        }
        throw Error('原生 VBR 证据未通过校验：'+result.reason);
      }
      if(!result.passed){
        message('VBR 短样未达到 SSIM 目标：最低 '+result.minimumSsim.toFixed(5)+
          '，目标 '+threshold.toFixed(5)+'。不能采用该推算码率。');
      }else{
        verifiedVbr={...result,sourceKey:chosenKey,selectedBytes:chosenBytes,
          budgetContext:chosenContext,wholeBudget:wholeBudgetForSelection(),expectedSettings:JSON.parse(JSON.stringify(raw)),
          expectedSourceIdentity:hooks.sourceIdentity?.()};
        message('VBR 短样已验证：'+selected.id.toUpperCase()+
          ' · 最低 SSIM '+result.minimumSsim.toFixed(5)+
          ' · 实际均值 '+(result.measuredMeanVideoBitrate/1e6).toFixed(2)+
          ' Mbps。仅验证短样；正式编码方案仍未改变。');
      }
    }catch(error){
      verifiedVbr=null;
      message('VBR 验证失败：'+(error?.message||error));
    }finally{
      running=false;hooks.setBusy(false);
      if(!disposed){renderControls();onRenderSingle();}
    }
  });
  adopt.addEventListener('click',async()=>{
    // Explicit user action only. Any source/option/target/budget change
    // invalidates the short-window certificate; no curve may auto-commit.
    if(disposed||running||hooks.busy()||!hasCurrentVbr())return;
    const certificate=verifiedVbr;
    const candidate=sessionCandidates.find(x=>x.id===certificate.candidateId);
    if(!candidate)return;
    running=true;aborted=false;renderControls();hooks.setBusy(true);
    try{
      const raw=hooks.settings(),bitrate=certificate.requestedVideoBitrate;
      if(!hasCurrentVbr())throw Error('来源、预算或已验证配置发生变化');
      const formal=compileTask({...raw,codec:candidate.codec,
        encoder:candidate.encoder,preset:candidate.preset,...geometrySettings(candidate),
        ...selectionSettings(),bitrate,multipass:'disabled',twoPass:false},mediaForBudget());
      if(formal.bitrate!==bitrate)throw Error('当前预算与已验证视频码率不一致');
      await hooks.validate?.(formal);
      if(aborted||disposed||!hasCurrentVbr())
        throw Error('预检期间配置变化，已阻止旧证据写入');
      const outcome=hooks.adoptCandidate?.({
        candidate,bitrate,wholeBudget:certificate.wholeBudget,
        expectedSettings:certificate.expectedSettings,
        expectedSourceIdentity:certificate.expectedSourceIdentity,media
      });
      if(!outcome?.ok)throw Error('表单事务拒绝提交：'+(outcome?.reason||'missing-bridge'));
      // Formal task form is now authoritative. Discard CQ/VBR certificates
      // from the old candidate context; do not certify the output artifact.
      session?.invalidate('candidate-applied');
      comparison=null;verifiedVbr=null;active=false;
      back.hidden=true;details.hidden=true;
      message('已按明确确认写入 '+candidate.encoder+' · '+
        (bitrate/1e6).toFixed(2)+' Mbps。正式任务须重新检查和编码；VBR 短样不证明整片质量或成品体积。');
    }catch(error){
      message('未写入编码方案：'+(error?.message||error));
      hooks.log?.('纯转码正式参数交接：'+(error?.stack||error));
    }finally{
      running=false;hooks.setBusy(false);
      if(!disposed){renderControls();onRenderSingle();}
    }
  });
  stop.addEventListener('click',()=>{
    if(!running)return;
    aborted=true;stop.disabled=true;
    message('已请求停止：当前不可中断的 Native 样本结束后拒收晚到结果。');
  });
  back.addEventListener('click',()=>{
    if(running)return;
    active=false;back.hidden=true;details.hidden=true;verifiedVbr=null;
    chart.setAttribute('aria-label','选择实测范围内的目标视频码率');
    onRenderSingle();renderControls();
  });
  policy.addEventListener('change',()=>{invalidate();renderControls();});
  basis.addEventListener('change',()=>{verifiedVbr=null;selectedBytes=basis.value==='whole'&&hooks.settings().rateMode==='size'?currentGoalBytes():null;message('预算坐标已改变，保留CQ测量；VBR需重新验证。');showResult();renderControls();});
  start.addEventListener('click',async()=>{
    if(disposed||running||hooks.busy())return;
    activePolicy=policy.value;
    aborted=false;running=true;active=true;
    session?.invalidate('new-comparison');session=null;comparison=null;verifiedVbr=null;
    selectedBytes=null;renderControls();onRenderSingle();
    let originalKey='';
    hooks.setBusy(true);
    try{
      const raw=hooks.settings();
      if(raw.operation!=='transcode')throw Error('请选择纯视频转码模式');
      if(!hooks.isWindows())throw Error('当前需要 Windows Native 试压');
      originalKey=getSourceKey(raw,{duration:hooks.mediaSnapshot()?.duration||0});
      const prepared=await hooks.prepare('transcode');
      if(aborted||disposed)throw Error('已停止');
      if(originalKey!==getSourceKey(hooks.settings(),{duration:prepared.duration}))
        throw Error('准备来源期间发生更改，拒绝旧试压参数');
      const geometry=preflight(raw,prepared);
      const taskOptions={...raw,rateMode:'quality',budgetPolicy:'best-effort',twoPass:false};
      const sourceTask=compileTask(taskOptions,prepared);
      if(basis.value==='whole')wholeFileLedger(sourceTask,hooks.budgetEvidence?.());
      if(sourceTask.expectedVideoTracks!==1||sourceTask.videoStreams[0]!==0)
        throw Error('当前仅支持主视频流 v:0');
      const duration=Number(sourceTask.expectedVideoDuration);
      if(!(duration>0))throw Error('无有效输出视频时长');
      const from=sourceTask.videoRange==='full'?0:Number(sourceTask.start);
      const to=sourceTask.videoRange==='full'?Number(prepared.duration):Number(sourceTask.end);
      const windows=calibrationSampleStarts(from,to,2,2).map(start=>({start,duration:2}));
      if(windows.length!==2)throw Error('需要至少 4 秒可用视频以取得两个互不重叠的采样窗口');
      const {candidates,maxRequests}=manualCandidateSet(activePolicy,geometry);
      sessionCandidates=candidates;
      for(const candidate of candidates){
        const taskForCandidate=compileTask({...taskOptions,codec:candidate.codec,
          encoder:candidate.encoder,preset:candidate.preset,...geometrySettings(candidate),multipass:'disabled'},prepared);
        await hooks.validate?.(taskForCandidate);
      }
      if(aborted||disposed)throw Error('已停止');
      sourceKey=getSourceKey(raw,{duration:prepared.duration});sourceDuration=Number(prepared.duration);
      task=sourceTask;media=prepared;
      const unchanged=()=>!aborted&&!disposed&&isCurrent();
      if(!unchanged())throw Error('来源或当前转码参数已改变');
      const maxEncodeSeconds=Math.min(180,Math.max(20,calibrationTimeBudget(duration)||90));
      const first=candidates[0],firstQuality=QUALITY_SETTINGS[0],firstWindow=windows[0];
      message('建立真实原生来源和运行时身份；随后将执行 '+maxRequests+' 次短片采样。');
      const firstSample=await hooks.calibrationSample({
        codec:first.codec,encoder:first.encoder,preset:first.preset,
        multipass:'disabled',...sampleGeometry(first,geometry),quality:firstQuality,start:firstWindow.start,
        duration:firstWindow.duration,timeoutSeconds:30
      });
      if(!unchanged())throw Error('来源或设置变化，晚到的首次采样已作废');
      const receipt=firstSample?.nativeEvidence;
      if(!receipt||receipt.method!=='windows-native-exact-cq-v1'||
         receipt.mode!=='quality')throw Error('Native Bridge 未提供可校验的 CQ 采样回执');
      const protocol={
        method:receipt.method,referenceMetric:receipt.referenceMetric,
        sourceToken:receipt.sourceToken,runtimeToken:receipt.runtimeToken,
        referenceToken:receipt.referenceToken,filterToken:receipt.filterToken,
        samplePlanVersion:'manual-ui-paired-windows-2x2-v1',
        mediaDuration:Number(prepared.duration),rangeStart:from,rangeEnd:to,
        videoStream:0,referenceWidth:geometry.width,referenceHeight:geometry.height,
        windows
      };
      session=createManualTranscodeSession({
        protocol,candidates,maxCandidates:candidates.length,maxQualitySettings:3,
        maxTotalSamples:maxRequests,maxEncodeSeconds
      });
      if(!session.ok)throw Error('创建配对证据会话失败：'+session.reason);
      const sweep=await runManualPairedSweep({
        session,branches:candidates,qualitySettings:QUALITY_SETTINGS,maxRequests,
        shouldStop:()=>!unchanged(),
        sampleNative:async({candidate,qualitySetting,window})=>{
          if(candidate.id===first.id&&qualitySetting===firstQuality&&
             window.start===firstWindow.start)return firstSample;
          return hooks.calibrationSample({
            codec:candidate.codec,encoder:candidate.encoder,preset:candidate.preset,
            multipass:'disabled',...sampleGeometry(candidate,geometry),quality:qualitySetting,
            start:window.start,duration:window.duration,timeoutSeconds:30
          });
        },
        onProgress:info=>message('真实试压 '+info.completedRequests+'/'+info.maxRequests+
          ' · '+info.candidateId+' · CQ '+info.qualitySetting)
      });
      if(!sweep.ok)throw Error(reasonLabel[sweep.reason]||sweep.reason);
      if(!unchanged())throw Error('源或参数已经改变，比较无效');
      // Video-only budget: audio copy is unknown, so do not add fictitious bytes.
      comparison=session.compare({
        durationSeconds:duration,audioBitrate:0,audioEvidence:'estimated',reservePercent:0
      });
      if(!comparison.ok)throw Error(reasonLabel[comparison.reason]||comparison.reason);
      const f=currentFrontier();if(!f?.ok)throw Error(f?.detail||f?.reason||'预算未知');
      selectedBytes=basis.value==='whole'&&raw.rateMode==='size'?currentGoalBytes():Math.sqrt(f.minimumEvidenceTargetBytes*f.maximumEvidenceTargetBytes);lastGoalKey=goalKey();
      message((candidates.length===2?'双编码器实测完成':'编码器与 preset 实测完成')+' · '+maxRequests+' 次配对样本。曲线仅给出当前预算坐标下的候选比较；不会自动采用推荐参数。');
    }catch(error){
      comparison=null;
      message('本次对比不可用于推荐：'+(error?.message||String(error)));
      hooks.log?.('纯转码双编码器比较：'+(error?.stack||error));
    }finally{
      running=false;hooks.setBusy(false);
      if(!disposed){renderControls();onRenderSingle();}
    }
  });
  renderControls();
  return {get active(){return active;},get running(){return running;},
    showResult,selectPointer,selectKeyboard,invalidate,
    dispose:()=>{disposed=true;aborted=true;session?.invalidate('disposed');area.remove();}};
}
