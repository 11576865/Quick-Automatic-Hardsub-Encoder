import { formatSize, outputReport, sampleSettings, sampleProjection } from './media-planning.js';
import { compileTask, commandPreview, SOFTWARE } from './media-task.js';
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
    '<button type="button" data-media-mode="hardsub" aria-pressed="true"><span class="media-mode-index">ASS</span><span><strong>硬字幕压制</strong><small>预检 / 真实预览 / 方案 / 重编码</small></span></button>' +
    '<button type="button" data-media-mode="transcode" aria-pressed="false"><span class="media-mode-index">VIDEO</span><span><strong>纯视频转码</strong><small>编码 / 画面 / 帧率 / 音频 / 封装</small></span></button>' +
    '<button type="button" data-media-mode="copy" aria-pressed="false"><span class="media-mode-index">COPY</span><span><strong>无损快速剪切</strong><small>时间范围 / 关键帧边界 / 直接复制</small></span></button>';
  section.innerHTML = `<div class="media-workspace-heading">
    <div>
      <span id="mediaWorkspaceEyebrow" class="media-workspace-eyebrow">HARDSUB</span>
      <h2 id="mediaWorkspaceTitle">硬字幕压制工作区</h2>
      <p id="mediaWorkspaceDescription">字幕预检与真实 libass 预览完成后，在这里控制最终视频编码、音频与封装。</p>
    </div>
    <div class="media-workspace-badges"><span>同一任务格式</span><span>Native / Web</span></div>
  </div>
  <form id="mediaTaskForm">
  <div class="task-grid media-mode-meta">${select('operation','工作模式',[['hardsub','硬字幕压制'],['transcode','纯视频转码'],['copy','无损快速剪切']])}${input('start','开始时间（秒）','0','0')}${input('end','结束时间（秒）','留空表示片尾')}</div>
  <p id="taskModeHint" class="note media-mode-hint"></p>
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
    <strong>无损快速剪切分支</strong><span>请求时间范围 → 关键帧边界 → 流复制。禁止视频重编码与音频转码。</span>
  </section>
  <div class="media-mode-explainer media-mode-explainer-hardsub">
    <strong>硬字幕链路</strong><span>视频 + ASS + 字体 → 预检 → libass 真实预览 → 视频重编码 → 输出验证</span>
  </div>
  <div class="media-mode-explainer media-mode-explainer-transcode">
    <strong>纯视频转码</strong><span>不要求 ASS。直接配置编码、尺寸、帧率、画面处理、音频与封装；不会静默更换你选择的编码器。</span>
  </div>
  <div class="media-mode-explainer media-mode-explainer-copy">
    <strong>无损快速剪切</strong><span>视频与音频压缩数据直接复制，不重新编码。起点受关键帧约束，输出边界以实际数据包为准。</span>
  </div>
  <section id="taskPlanSummary" class="task-plan-summary" aria-live="polite">
    <div class="task-plan-heading"><span>当前方案</span><strong id="taskPlanTitle">等待选择参数</strong></div>
    <div class="task-plan-facts">
      <div><span>编码</span><strong id="taskPlanEncoder">—</strong></div>
      <div><span>速度倾向</span><strong id="taskPlanSpeed">—</strong></div>
      <div><span>质量 / 体积</span><strong id="taskPlanRate">—</strong></div>
      <div><span>输出</span><strong id="taskPlanOutput">—</strong></div>
    </div>
    <p id="taskPlanNote">先确认这里是否符合你的目的；大多数任务不需要修改下面的详细参数。</p>
    <div class="button-row task-plan-actions"><button type="button" id="taskLoadPreset" class="secondary">恢复推荐方案</button><button type="button" id="taskInspect" class="secondary">验证当前方案</button></div>
  </section>
  <fieldset id="taskEncoding" class="media-encoding-panel"><legend>核心视频方案</legend><p class="note media-decision-hint">先决定编码格式、编码器、速度倾向和质量 / 体积目标。不确定时直接保留推荐方案；CRF / CQ 通常数值越低越保真、体积越大。帧率、尺寸、像素格式和编码细节默认沿用源视频或编码器安全默认值，需要时再展开。</p><div class="task-grid media-core-decision-grid">
  ${select('codec','编码格式',[['h264','H.264'],['h265','H.265 / HEVC'],['av1','AV1']])}${select('encoder','编码器',[['libx264','x264 · CPU']])}${select('preset','编码速度 preset',[['medium','medium']])}
  ${select('rateMode','码率控制',[['quality','固定质量 CRF / CQ'],['bitrate','目标码率'],['size','目标体积']])}${input('quality','质量值 CRF / CQ（通常越低越保真）','','23')}${input('bitrate','目标视频码率（bit/s）','4000000')}
  ${input('targetSize','目标成品体积','','500')}${select('sizeUnit','体积单位',[['MB','MB（十进制）'],['GB','GB（十进制）'],['MiB','MiB（二进制）'],['GiB','GiB（二进制）']])}${input('sizeReserve','体积余量（%）','','4')}${check('twoPass','整片两遍编码（x264 码率模式）')}
  </div><details class="media-advanced-panel media-video-details"><summary>帧率、尺寸、码率边界与像素格式</summary><div class="task-grid">
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
  <details class="media-advanced-panel media-track-panel"><summary>音频与轨道</summary><div class="task-grid">${select('audio','音频策略',[['copy','复制原音频'],['aac','转为 AAC'],['libopus','转为 Opus（需核心支持）'],['none','关闭音频']])}${input('audioTrack','保留音轨','all 或音频轨序号，从 0 开始','all')}${input('audioBitrate','每条输出音轨码率（bit/s）','','128000')}${select('audioChannels','输出声道',[['','保持源声道'],['1','单声道'],['2','双声道'],['6','5.1']])}${select('audioSampleRate','音频采样率',[['','编码器默认'],['48000','48000 Hz'],['44100','44100 Hz']])}${check('keepSubtitles','保留内封软字幕')}${check('keepAttachments','保留附件 / 字体')}${check('keepMetadata','保留元数据',true)}${check('keepChapters','保留章节')}</div><p>剪切默认移除旧章节，避免章节时间与成品不一致。软字幕复制后的边界与显示效果需自行核对。</p></details>
  <section id="taskOutputPolicy" class="media-output-policy">
    <div class="media-output-policy-heading"><span>共享出口</span><strong>输出与封装</strong><p>三条任务在这里重新汇合。容器不会通过改扩展名伪装；不兼容组合会明确要求调整，而不会静默转码音频。</p></div>
    <div class="task-grid">${select('outputContainer','成品容器',[['auto','Auto · 自动选择安全容器'],['keep','保持源容器（可用时）'],['mkv','MKV · Matroska'],['mp4','MP4 · MPEG-4']])}</div>
    <p id="taskContainerDecision" class="note">执行检查后显示实际容器选择及原因。</p>
  </section>
  <details class="media-sample-panel"><summary>配置保存与短片试压比较</summary><div class="task-grid">${input('configName','配置名称','我的配置')}${select('savedConfig','已保存配置',[])}${input('sampleStart','试压起点（秒）','','0')}${input('sampleLength','试压长度（秒）','2–60','15')}</div><div class="button-row"><button type="button" id="taskStore" class="secondary">保存当前配置</button><button type="button" id="taskRestore" class="secondary">加载配置</button><button type="button" id="taskDelete" class="secondary">删除配置</button><button type="button" id="taskExportConfig" class="secondary">导出配置 JSON</button><label>导入配置 JSON<input type="file" id="taskImportConfig" accept="application/json,.json"></label><button type="button" id="taskSamples" class="secondary">比较三组短片</button></div><p class="note">质量模式比较质量值 ±2；码率模式比较码率 ±20%。片段体积外推不保证整片大小，建议选择运动或细节复杂的片段。原生短片可保存到设备后比较。</p><div id="taskSampleResults" aria-live="polite"></div></details>
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
  <div class="button-row media-action-dock"><button type="submit" id="taskRun">开始硬字幕压制</button><button type="button" id="taskCancel" class="secondary" disabled>取消</button><button type="button" id="taskReport" class="secondary" disabled>导出任务报告</button><button type="button" id="taskSave" class="secondary" disabled>保存成品</button></div>
  <details class="task-technical-details"><summary>技术详情 · 实际 FFmpeg 命令</summary><pre id="taskCommand" class="task-command" aria-live="polite">等待检查设置。</pre></details>
  </form>`;
  document.querySelector('#inputCard').before(modeNav);
  document.querySelector('#inputCard').after(section);
  const form = section.querySelector('form'), get = name => form.elements.namedItem(name);
  const modeButtons = [...modeNav.querySelectorAll('[data-media-mode]')];
  const strategyButtons = [...document.querySelectorAll('[data-hardsub-strategy]')];
  const manualMount = document.querySelector('#hardsubManualMount');
  const sharedOutputMount = document.querySelector('#sharedMediaOutputMount');
  const inputCard = document.querySelector('#inputCard');
  const productionDeck = document.querySelector('#hardsubControlDeck');
  const outputPolicy = section.querySelector('#taskOutputPolicy');
  const outputPolicyAnchor = document.createComment('task-output-policy-home');
  outputPolicy?.before(outputPolicyAnchor);
  get('outputContainer')?.setAttribute('form','mediaTaskForm');
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
    qualityRange.max = get('codec').value === 'av1' ? '63' : '51';
    const value = Math.max(Number(qualityRange.min), Math.min(Number(qualityRange.max), Number(get('quality').value) || 1));
    get('quality').value = String(value);
    qualityRange.value = String(value);
    qualityRange.style.setProperty('--media-range-progress', ((value - Number(qualityRange.min)) / (Number(qualityRange.max) - Number(qualityRange.min)) * 100) + '%');
  };
  qualityRange.addEventListener('input', () => { get('quality').value = qualityRange.value; syncQualityRange(); });
  get('quality').addEventListener('input', syncQualityRange);
  let busy = false, completed = null, lastReport = null, sampleUrls=[], taskStartedAt=0, activeTask=null;
  const storageKey='media-workspace-configs-v2';
  const download=(data,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const configs=()=>{try{return JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{return {};}};
  const refreshConfigs=()=>{get('savedConfig').innerHTML=Object.keys(configs()).map(n=>`<option value="${escape(n)}">${escape(n)}</option>`).join('');};
  const applyConfig=raw=>{for(const key of ['operation','codec'])if(get(key)&&raw[key]!=null)get(key).value=raw[key];updateEncoder();if(raw.encoder){if(![...get('encoder').options].some(o=>o.value===raw.encoder))throw Error('当前平台不支持配置中的编码器 '+raw.encoder+'；请手动选择编码器');get('encoder').value=raw.encoder;}updatePreset();for(const [key,value] of Object.entries(raw)){const el=get(key);if(!el||['savedConfig','configName'].includes(key))continue;if(el.type==='checkbox')el.checked=value===true;else if(el.tagName==='SELECT'){if([...el.options].some(o=>o.value===String(value)))el.value=String(value);}else el.value=String(value??'');}updateMode();updateRate();};
  const status = text => { section.querySelector('#taskStatus').textContent = text; };
  const read = () => Object.fromEntries([...form.elements].filter(x=>x.name).map(x=>[x.name,x.type==='checkbox'?x.checked:x.value]));
  const windows = () => hooks.isWindows();
  const formatTaskClock = seconds => {
    const value=Math.max(0,Number(seconds)||0),whole=Math.floor(value),h=Math.floor(whole/3600),m=Math.floor((whole%3600)/60),s=whole%60;
    return h ? h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0') : m+':'+String(s).padStart(2,'0');
  };
  const runButtonLabel = () => get('operation').value==='hardsub'?'使用当前参数开始硬压':get('operation').value==='transcode'?'开始视频转码':'开始无损剪切';
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
    const raw=read(),operation=raw.operation,copy=operation==='copy';
    const operationLabel=operation==='hardsub'?'硬字幕压制':operation==='transcode'?'纯视频转码':'无损快速剪切';
    const codecLabel={h264:'H.264',h265:'H.265 / HEVC',av1:'AV1'}[raw.codec]||raw.codec||'—';
    const encoderLabel=get('encoder').selectedOptions?.[0]?.textContent||raw.encoder||'—';
    const speed=copy?'无需编码':presetIntent(raw.encoder,raw.preset);
    let rate='无损复制',note='不重新编码；实际切入点受关键帧约束。';
    if(!copy && raw.rateMode==='quality'){
      rate='质量优先 · '+(String(raw.encoder).endsWith('_nvenc')?'CQ ':'CRF ')+(raw.quality||'—');
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
    const audio=raw.audio==='copy'?'原音频复制':raw.audio==='none'?'无音频':String(raw.audio||'').toUpperCase();
    const container=task?.outputContainer ? task.outputContainer.toUpperCase() : ({auto:'AUTO',keep:'保持源容器',mkv:'MKV',mp4:'MP4'}[raw.outputContainer]||'AUTO');
    section.querySelector('#taskPlanTitle').textContent=operationLabel+(copy?'':' · '+codecLabel+' · '+speed);
    section.querySelector('#taskPlanEncoder').textContent=copy?'直接复制':codecLabel+' · '+encoderLabel;
    section.querySelector('#taskPlanSpeed').textContent=speed+(copy?'':' · preset '+raw.preset);
    section.querySelector('#taskPlanRate').textContent=rate;
    section.querySelector('#taskPlanOutput').textContent=size+' · '+audio+' · '+container;
    section.querySelector('#taskPlanNote').textContent=note+(task?.estimatedBytes>0?' 当前任务估计数据量 '+formatSize(task.estimatedBytes)+'。':'');
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
  const syncTaskActions = () => {
    const stateName=section.dataset.taskState||'idle',run=section.querySelector('#taskRun'),save=section.querySelector('#taskSave');
    const finished=['verified','save_failed','saved'].includes(stateName);
    run.textContent=finished?'重新压制':runButtonLabel();
    run.classList.toggle('task-secondary-action',finished);
    save.textContent=stateName==='saving'?'正在保存…':stateName==='save_failed'?'重试保存成品':stateName==='saved'?'再次保存成品':'保存成品';
    save.classList.toggle('task-primary-action',['verified','save_failed'].includes(stateName));
    save.disabled=busy||stateName==='saving'||!completed||!['verified','save_failed','saved'].includes(stateName);
    run.disabled=busy||stateName==='saving';
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
    }else if(String(data.error||'').toLowerCase().includes('cancel')){
      setTaskState('verified');
      status('已取消保存；成品仍已验证，可再次点击“保存成品”。');
    }else{
      setTaskState('save_failed');
      status('保存失败：'+(data.error||'未知错误')+'。已验证成品仍保留在当前 Native 会话，可直接重试保存，无需重新压制。');
      hooks.log?.('成品保存失败：'+(data.error||'未知错误'));
    }
  };
  window.addEventListener('quick-hardsub-native-export-result',nativeExportListener);
  function updateEncoder() {
    const c=get('codec').value,previousEncoder=get('encoder').value;
    const choices=[[SOFTWARE[c],{h264:'x264',h265:'x265',av1:'SVT-AV1'}[c]+' · CPU']];
    if(windows() && hooks.hasNvenc(c)) choices.push([{h264:'h264_nvenc',h265:'hevc_nvenc',av1:'av1_nvenc'}[c],'NVENC · GPU']);
    get('encoder').innerHTML=choices.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
    if(choices.some(([v])=>v===previousEncoder))get('encoder').value=previousEncoder;
    updatePreset();updateRate();
  }
  function updatePreset(reset=false) {
    const previous=get('preset').value;
    const nv=get('encoder').value.endsWith('_nvenc');
    const vals=nv?['p1','p2','p3','p4','p5','p6','p7']:get('codec').value==='av1'?Array.from({length:14},(_,i)=>String(i)):['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'];
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
    const title = hardsub ? '硬字幕压制工作区' : transcode ? '纯视频转码工作区' : '无损快速剪切工作区';
    const eyebrow = hardsub ? 'HARDSUB · PARAMETERS' : transcode ? 'TRANSCODE' : 'LOSSLESS CUT';
    const description = hardsub
      ? '直接控制编码器、质量、帧率、尺寸、滤镜、音轨与封装。执行前仍沿用同一字幕预检与真实 libass 预览门槛。'
      : transcode
        ? '只处理视频、音频与封装；字幕输入不会参与编码链路。所有编码器与画面参数由当前任务显式决定。'
        : '围绕时间范围和轨道保留直接复制压缩数据；不运行视频编码，也不做质量校准。';

    section.querySelector('#mediaWorkspaceTitle').textContent = title;
    section.querySelector('#mediaWorkspaceEyebrow').textContent = eyebrow;
    section.querySelector('#mediaWorkspaceDescription').textContent = description;
    syncTaskActions();
    renderPlanSummary(activeTask);

    const heroSubtitle = document.querySelector('#heroSubtitle');
    if (heroSubtitle) heroSubtitle.textContent = hardsub
      ? '预检 · 真实预览 · 选方案 · 正式压制'
      : transcode
        ? '媒体检查 · 参数配置 · 试压比较 · 输出验证'
        : '媒体检查 · 时间范围 · 关键帧边界 · 无损导出';

    const inputHeading = document.querySelector('#inputCard .card-heading h2');
    const inputDeck = document.querySelector('#inputCard .card-heading p');
    if (inputHeading) inputHeading.textContent = hardsub ? '准备硬字幕素材' : transcode ? '准备转码素材' : '准备剪切素材';
    if (inputDeck) inputDeck.textContent = hardsub
      ? '选择视频、ASS 与可选字体。'
      : transcode
        ? '选择视频；ASS 与字体不会进入转码链路。'
        : '选择视频；剪切直接复制压缩数据，不需要 ASS 或字体。';

    for (const id of ['preflightCard','subtitleCard','planCard','encodeCard','taskOverviewRail']) {
      document.querySelector('#'+id)?.classList.toggle('media-mode-suppressed', !hardsub);
    }
    const stageNav = document.querySelector('#mobileStageNav');
    if (stageNav) stageNav.classList.toggle('media-mode-suppressed', !hardsub);
    section.querySelector('#taskSamples').closest('.button-row')?.classList.toggle('media-copy-suppressed', copy);
    section.querySelector('#taskLoadPreset').classList.toggle('media-copy-suppressed', copy);
    syncWorkflowStrip(mode);
    syncHardsubStrategyChrome(mode);
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
      if (inputCard && section.previousElementSibling !== inputCard) inputCard.after(section);
      if (outputPolicy && outputPolicy.parentElement !== form) outputPolicyAnchor.after(outputPolicy);
    }

    section.classList.toggle('hardsub-strategy-suppressed', hardsub && (guided || !productionAvailable));
    document.querySelector('#planCard')?.classList.toggle('hardsub-strategy-suppressed', hardsub && !guided);
    document.querySelector('#encodeCard')?.classList.toggle('hardsub-strategy-suppressed', hardsub && !guided);
  }

  for (const button of strategyButtons) {
    button.addEventListener('click', () => {
      if (busy || hooks.busy()) return;
      hardsubStrategy = button.dataset.hardsubStrategy === 'manual' ? 'manual' : 'guided';
      localStorage.setItem('hardsub-control-strategy-v1', hardsubStrategy);
      syncHardsubStrategyChrome();
    });
  }

  const subtitleCardObserver = new MutationObserver(() => syncHardsubStrategyChrome());
  const observedSubtitleCard = document.querySelector('#subtitleCard');
  if (observedSubtitleCard) subtitleCardObserver.observe(observedSubtitleCard, { attributes:true, attributeFilter:['class'] });

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      get('operation').value = button.dataset.mediaMode;
      updateMode();
      updateRate();
    });
  }

  function updateMode() {
    const mode=get('operation').value;
    const copy=mode==='copy';
    syncModeChrome(mode);
    section.querySelector('#taskEncoding').disabled=copy;
    document.querySelectorAll('.input-ass,.input-font').forEach(el=>el.classList.toggle('hidden',get('operation').value!=='hardsub'));
    for(const o of get('audio').options)o.disabled=copy&&['aac','libopus'].includes(o.value);
    if(copy && ['aac','libopus'].includes(get('audio').value))get('audio').value='copy';
    section.querySelector('#taskModeHint').textContent=copy
      ? '无损快速剪切：起点向前定位到关键帧，不重新编码。实际起点会显示在任务状态中；终点仍受压缩数据包边界约束。'
      : mode==='hardsub'
        ? '硬字幕分支：字幕、字体与真实 libass 预览属于这一分支；编码完成后与其他任务共享封装、验证和保存出口。'
        : '纯视频转码分支：只处理媒体编码参数；不会要求 ASS，也不会静默替换你选择的编码器。';
    renderContainerDecision(null);
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
    setRateControl('quality', !copy && mode==='quality');
    setRateControl('bitrate', !copy && mode==='bitrate');
    for(const key of ['targetSize','sizeUnit','sizeReserve'])setRateControl(key, !copy && mode==='size');

    get('twoPass').disabled=copy||get('encoder').value!=='libx264'||mode==='quality';
    if(get('twoPass').disabled)get('twoPass').checked=false;

    const encoded=['aac','libopus'].includes(get('audio').value);
    for(const key of ['audioBitrate','audioChannels','audioSampleRate'])get(key).disabled=!encoded;
  }
  get('audio').onchange=updateRate;
  get('rateMode').onchange=updateRate;
  section.querySelector('#taskStore').onclick=()=>{try{const name=get('configName').value.trim();if(!name||name.length>80)throw Error('请输入 1–80 字的配置名称');const c=configs();Object.defineProperty(c,name,{value:read(),enumerable:true,configurable:true,writable:true});localStorage.setItem(storageKey,JSON.stringify(c));refreshConfigs();status('配置已保存');}catch(e){status(e.message);}};
  section.querySelector('#taskRestore').onclick=()=>{try{const raw=configs()[get('savedConfig').value];if(raw){applyConfig(raw);renderPlanSummary(activeTask);}}catch(e){status(e.message);}};
  section.querySelector('#taskDelete').onclick=()=>{const c=configs();delete c[get('savedConfig').value];localStorage.setItem(storageKey,JSON.stringify(c));refreshConfigs();};
  section.querySelector('#taskExportConfig').onclick=()=>download({version:2,settings:read()},'media-config.json');
  section.querySelector('#taskImportConfig').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>65536)throw Error('配置文件超过 64 KiB');const data=JSON.parse(await file.text());if(data.version!==2||!data.settings||typeof data.settings!=='object')throw Error('配置格式无效');applyConfig(data.settings);status('已导入配置，执行前仍会验证参数');}catch(err){status(err.message);}finally{e.target.value='';}};
  section.querySelector('#taskReport').onclick=()=>{if(lastReport)download(lastReport,'media-task-report.json');};
  get('codec').onchange=()=>{updateEncoder();get('quality').value=get('codec').value==='av1'?'32':'23';syncQualityRange();};
  get('encoder').onchange=()=>{updatePreset();updateRate();};
  get('operation').onchange=()=>{updateMode();updateRate();};
  section.querySelector('#taskLoadPreset').onclick=()=>{updatePreset(true);get('quality').value=get('codec').value==='av1'?'32':'23';get('rateMode').value='quality';updateRate();renderPlanSummary(activeTask);status('已恢复推荐方案；其他高级设置保持当前值。先确认“当前方案”，需要时再展开详细参数。');};
  let platformKey='';
  const platformTimer=setInterval(()=>{const key=JSON.stringify(hooks.platformKey());if(key!==platformKey&&!busy){platformKey=key;updateEncoder();}},1000);
  const prepare=async()=>{
    const raw=read(),media=await hooks.prepare(raw.operation);
    const task=compileTask(raw,media);
    await hooks.validate?.(task);
    renderContainerDecision(task);
    const compat = Array.isArray(task.compatibilityWarnings) && task.compatibilityWarnings.length
      ? ' 兼容性：'+task.compatibilityWarnings.join(' ')
      : '';
    section.querySelector('#taskEstimate').textContent=(task.sizePlan ? '目标 '+formatSize(task.sizePlan.targetBytes)+' · 视频 '+task.bitrate+' bit/s · 预留 '+task.sizePlan.reservePercent+'% · ' : '')+'预计音视频数据：'+formatSize(task.estimatedBytes)+'。质量模式需试压估计；封装、字幕与码率偏差仍影响实际大小。'+compat;
    section.querySelector('#taskCommand').textContent=commandPreview(task);
    renderPlanSummary(task);
    return {task,media};
  };
  section.querySelector('#taskInspect').onclick=async()=>{if(busy||hooks.busy())return;busy=true;hooks.setBusy(true);try{await prepare();status('当前方案验证通过，可以直接开始；原始 FFmpeg 命令仅用于技术核对。');}catch(e){status(e.message);}finally{busy=false;hooks.setBusy(false);syncTaskActions();}};
  section.querySelector('#taskCancel').onclick=()=>{setTaskState('cancelling');hooks.cancel();status('正在取消…');};
  section.querySelector('#taskSave').onclick=async()=>{
    if(!completed)return;
    setTaskState('saving');
    status('正在打开保存位置；取消选择不会丢失已验证成品。');
    try{
      const result=await Promise.resolve(hooks.save(completed));
      if(result?.pending)return;
      if(result?.ok===false)throw Error(result.error||'保存失败');
      setTaskState('saved');
      status(result?.kind==='browser-download'?'已交给浏览器保存。':'成品已保存。');
    }catch(e){
      setTaskState('save_failed');
      status('保存失败：'+e.message+'。已验证成品仍可直接重试保存，无需重新压制。');
      hooks.log?.(e.stack||e.message);
    }
  };
  form.onsubmit=async e=>{
    e.preventDefault();if(busy||hooks.busy()){status('已有任务正在运行，请等待或取消。');return;}
    busy=true;completed=null;lastReport=null;activeTask=null;taskStartedAt=performance.now();
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
      activeTask=task;
      renderPlanSummary(task);
      for(const control of form.elements)control.disabled=true;
      section.querySelector('#taskCancel').disabled=false;
      setTaskState('encoding');
      const started=performance.now();
      completed=await hooks.run(task,media,(p,message,meta)=>updateTaskProgress(p,message,meta));
      lastReport=outputReport(task,completed,(performance.now()-started)/1000);
      section.querySelector('#taskReport').disabled=false;
      section.querySelector('#taskProgress').value=1;
      section.querySelector('#taskPercent').textContent='100%';
      section.querySelector('#taskMediaTime').textContent=formatTaskClock(task.expectedDuration)+' / '+formatTaskClock(task.expectedDuration);
      section.querySelector('#taskElapsed').textContent=formatTaskClock((performance.now()-taskStartedAt)/1000);
      section.querySelector('#taskEta').textContent='处理完成';
      setTaskState('verified');
      status('成品已验证 · '+formatSize(lastReport.outputBytes)+(lastReport.withinBudget===false?' · 超出体积预算；建议视频码率 '+lastReport.suggestedVideoRate+' bit/s':lastReport.withinBudget===true?' · 在体积预算内':'')+' · 尚未保存到你的文件夹。下一步：保存成品。');
    }catch(e){
      if(String(e.message||'').includes('取消')){
        setTaskState('idle');
        status('任务已取消。');
      }else{
        setTaskState('failed');
        status('处理失败：'+e.message);
      }
      hooks.log(e.stack||e.message);
    }
    finally{
      busy=false;hooks.setBusy(false);for(const control of form.elements)control.disabled=false;
      updateMode();section.querySelector('#taskCancel').disabled=true;section.querySelector('#taskReport').disabled=!lastReport;updateRate();syncTaskActions();
    }
  };
  section.querySelector('#taskSamples').onclick=async()=>{
    if(busy||hooks.busy())return;
    busy=true;hooks.setBusy(true);const raw=read();const results=section.querySelector('#taskSampleResults');
    try{
      const media=await hooks.prepare(raw.operation),full=compileTask(raw,media),range=sampleSettings(raw,media);
      results.replaceChildren();for(const url of sampleUrls)URL.revokeObjectURL(url);sampleUrls=[];
      for(const control of form.elements)control.disabled=true;section.querySelector('#taskCancel').disabled=false;
      for(const adjustment of [-1,0,1]){
        const options={...raw,...range,frames:'',twoPass:false,keepAttachments:false,keepSubtitles:false,keepChapters:false};
        if(raw.rateMode==='quality')options.quality=Math.max(1,Math.min(full.encoder.endsWith('_nvenc')||full.codec!=='av1'?51:63,Number(full.quality)+adjustment*2));
        else {options.rateMode='bitrate';options.bitrate=Math.round(Number(full.bitrate)*(1+adjustment*.2));}
        const task=compileTask(options,media);await hooks.validate?.(task);const started=performance.now();
        const result=await hooks.run(task,media,(p,message)=>{section.querySelector('#taskProgress').value=(adjustment+1+p)/3;status('短片 '+(adjustment+2)+'/3 · '+message);});
        const report=outputReport(task,result,(performance.now()-started)/1000),row=document.createElement('div');row.className='task-sample';
        row.innerHTML=`<p>${escape(raw.rateMode==='quality'?'CRF / CQ '+options.quality:'视频码率 '+options.bitrate+' bit/s')} · ${escape(formatSize(report.outputBytes))} · ${report.elapsedSeconds.toFixed(1)} 秒；整片外推 ${escape(formatSize(sampleProjection(report.outputBytes,task.expectedDuration,full.expectedDuration)))}</p>`;
        if(result.blob){const video=document.createElement('video');video.controls=true;video.preload='metadata';const url=URL.createObjectURL(result.blob);sampleUrls.push(url);video.src=url;row.append(video);}
        const save=document.createElement('button');save.type='button';save.textContent='保存此短片';save.onclick=()=>hooks.save(result);row.append(save);
        const use=document.createElement('button');use.type='button';use.textContent='采用此参数';use.onclick=()=>{if(raw.rateMode==='quality')get('quality').value=options.quality;else{get('rateMode').value='bitrate';get('bitrate').value=options.bitrate;}updateRate();status('已采用此短片参数；请重新检查整片体积预算。');};row.append(use);results.append(row);
      }
      status('三组试压完成；浏览器播放受 AV1 / MKV 支持限制，可保存短片比较。');
    }catch(e){status('试压失败：'+e.message);}
    finally{busy=false;hooks.setBusy(false);for(const control of form.elements)control.disabled=false;updateMode();updateRate();section.querySelector('#taskCancel').disabled=true;section.querySelector('#taskReport').disabled=!lastReport;syncTaskActions();}
  };
  const invalidateCompiledPlan = () => {
    activeTask=null;
    renderContainerDecision(null);
    renderPlanSummary();
  };
  form.addEventListener('input',invalidateCompiledPlan);
  form.addEventListener('change',invalidateCompiledPlan);
  updateEncoder();updateMode();updateRate();refreshConfigs();syncQualityRange();renderPlanSummary();setTaskState('idle');
  return {section,dispose:()=>{clearInterval(platformTimer);subtitleCardObserver.disconnect();window.removeEventListener('quick-hardsub-native-export-result',nativeExportListener);for(const url of sampleUrls)URL.revokeObjectURL(url);modeNav.remove();outputPolicy?.remove();outputPolicyAnchor.remove();delete document.body.dataset.mediaOperation;delete document.body.dataset.hardsubStrategy;}};
}
