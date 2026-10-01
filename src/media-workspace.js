import { formatSize, outputReport, sampleSettings, sampleProjection } from './media-planning.js';
import { compileTask, commandPreview, SOFTWARE } from './media-task.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const select = (key,label,options) => `<label>${label}<select name="${key}">${options.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>`;
const input = (key,label,placeholder='',value='') => `<label>${label}<input name="${key}" value="${value}" placeholder="${placeholder}" autocomplete="off"></label>`;
const check = (key,label,on=false) => `<label class="task-check"><input type="checkbox" name="${key}" ${on?'checked':''}>${label}</label>`;
export function mountMediaWorkspace(hooks) {
  const section = document.createElement('section');
  section.className = 'card media-workspace';
  section.id = 'mediaWorkspace';
  section.dataset.mobileStageSection = 'prepare';
  section.innerHTML = `<h2>视频处理工作区</h2><p>先在上方选择视频；硬字幕模式另需字幕和字体。设置由你决定，自动方案可在下方另行使用。</p>
  <form id="mediaTaskForm">
  <div class="task-grid">${select('operation','工作模式',[['hardsub','硬字幕压制'],['transcode','纯视频转码'],['copy','无损快速剪切']])}${input('start','开始时间（秒）','0','0')}${input('end','结束时间（秒）','留空表示片尾')}</div>
  <p id="taskModeHint" class="note"></p>
  <fieldset id="taskEncoding"><legend>视频编码 · 所有参数可独立修改</legend><div class="task-grid">
  ${select('codec','编码格式',[['h264','H.264'],['h265','H.265 / HEVC'],['av1','AV1']])}${select('encoder','编码器',[['libx264','x264 · CPU']])}${select('preset','编码速度 preset',[['medium','medium']])}
  ${select('rateMode','码率控制',[['quality','固定质量 CRF / CQ'],['bitrate','目标码率'],['size','目标体积']])}${input('quality','质量值 CRF / CQ','','23')}${input('bitrate','目标视频码率（bit/s）','4000000')}
  ${input('targetSize','目标成品体积','','500')}${select('sizeUnit','体积单位',[['MB','MB（十进制）'],['GB','GB（十进制）'],['MiB','MiB（二进制）'],['GiB','GiB（二进制）']])}${input('sizeReserve','体积余量（%）','','4')}${check('twoPass','整片两遍编码（x264 码率模式）')}${check('legacyFps','兼容旧 FFmpeg（使用 -vsync）')}
  ${input('maxrate','最大码率（bit/s）','编码器默认')}${input('bufsize','码率缓冲区（bit）','编码器默认')}
  ${select('fpsMode','帧率策略',[['auto','编码器自动'],['passthrough','保持源时间戳'],['cfr','恒定帧率 CFR'],['vfr','可变帧率 VFR']])}${input('fps','目标帧率','例如 24 或 24000/1001；留空保持')}${input('frames','输出总帧数上限','留空表示不限；设置后需关闭音频')}
  ${input('width','输出宽度','留空按比例计算')}${input('height','输出高度','留空按比例计算')}${select('scaleAlgorithm','缩放算法',[['lanczos','Lanczos'],['bicubic','Bicubic'],['bilinear','Bilinear'],['spline','Spline'],['neighbor','Nearest neighbor']])}
  ${select('pixelFormat','像素格式 / 位深',[['yuv420p','8-bit · 4:2:0'],['yuv420p10le','10-bit · 4:2:0'],['yuv444p','8-bit · 4:4:4'],['yuv444p10le','10-bit · 4:4:4']])}
  </div><details><summary>画面处理、编码细节</summary><div class="task-grid">
  ${input('crop','裁切 宽:高:x:y','例如 1920:800:0:140')}${select('rotation','旋转',[['none','保持'],['clock','顺时针 90°'],['cclock','逆时针 90°'],['flip','180°']])}${select('deinterlace','去隔行',[['none','关闭'],['bwdif','BWDIF'],['yadif','YADIF']])}
  ${input('gop','关键帧间隔（帧）','编码器默认')}${input('bf','B 帧数量','编码器默认')}${input('refs','参考帧数量','编码器默认')}${input('threads','编码线程数','编码器默认')}
  ${input('codecParams','软件编码器专用参数','例如 aq-mode=2:rc-lookahead=20')}${input('profile','profile','编码器默认')}${input('level','level','编码器默认')}${input('tune','tune','编码器默认')}
  ${check('squarePixels','设为方形像素')}${check('denoise','降噪 hqdn3d')}${check('deband','去色带 deband')}${check('sharpen','锐化 unsharp')}
  </div><p>处理顺序：裁切 → 去隔行 → 缩放 → 旋转 → 画面滤镜 → 字幕 → 补齐偶数尺寸。编码器不支持的组合会明确报错。</p></details>
  <fieldset id="taskNvenc" hidden><legend>NVENC</legend><div class="task-grid">${select('multipass','多阶段分析',[['fullres','全分辨率'],['qres','低分辨率'],['disabled','关闭']])}${input('lookahead','前瞻帧数 0–32','编码器默认')}${input('aqStrength','空间 AQ 强度 1–15','编码器默认')}${check('spatialAq','空间自适应量化')}${check('temporalAq','时间自适应量化')}</div></fieldset>
  <p class="note">NVENC 多阶段分析属于逐帧码率控制，与整片两遍编码不同；空间 AQ 与时间 AQ 选择一种。目标体积不会通过截断视频来满足。</p></fieldset>
  <fieldset><legend>音频与轨道 · 输出 MKV</legend><div class="task-grid">${select('audio','音频策略',[['copy','复制原音频'],['aac','转为 AAC'],['libopus','转为 Opus（需核心支持）'],['none','关闭音频']])}${input('audioTrack','保留音轨','all 或音频轨序号，从 0 开始','all')}${input('audioBitrate','每条输出音轨码率（bit/s）','','128000')}${select('audioChannels','输出声道',[['','保持源声道'],['1','单声道'],['2','双声道'],['6','5.1']])}${select('audioSampleRate','音频采样率',[['','编码器默认'],['48000','48000 Hz'],['44100','44100 Hz']])}${check('keepSubtitles','保留内封软字幕')}${check('keepAttachments','保留附件 / 字体')}${check('keepMetadata','保留元数据',true)}${check('keepChapters','保留章节')}</div><p>剪切默认移除旧章节，避免章节时间与成品不一致。软字幕复制后的边界与显示效果需自行核对。</p></fieldset>
  <details><summary>配置保存与短片试压比较</summary><div class="task-grid">${input('configName','配置名称','我的配置')}${select('savedConfig','已保存配置',[])}${input('sampleStart','试压起点（秒）','','0')}${input('sampleLength','试压长度（秒）','2–60','15')}</div><div class="button-row"><button type="button" id="taskStore" class="secondary">保存当前配置</button><button type="button" id="taskRestore" class="secondary">加载配置</button><button type="button" id="taskDelete" class="secondary">删除配置</button><button type="button" id="taskExportConfig" class="secondary">导出配置 JSON</button><label>导入配置 JSON<input type="file" id="taskImportConfig" accept="application/json,.json"></label><button type="button" id="taskSamples" class="secondary">比较三组短片</button></div><p class="note">质量模式比较质量值 ±2；码率模式比较码率 ±20%。片段体积外推不保证整片大小，建议选择运动或细节复杂的片段。原生短片可保存到设备后比较。</p><div id="taskSampleResults" aria-live="polite"></div></details>
  <p id="taskEstimate" class="note" aria-live="polite"></p>
  <div class="button-row"><button type="button" id="taskLoadPreset" class="secondary">填入均衡预设</button><button type="button" id="taskInspect" class="secondary">检查设置与执行参数</button><button type="submit" id="taskRun">开始处理</button><button type="button" id="taskCancel" class="secondary" disabled>取消</button><button type="button" id="taskReport" class="secondary" disabled>导出任务报告</button><button type="button" id="taskSave" class="secondary" disabled>保存成品</button></div>
  <pre id="taskCommand" class="task-command" aria-live="polite">等待检查设置。</pre><p id="taskStatus" role="status">未开始</p><progress id="taskProgress" max="1" value="0"></progress>
  </form>`;
  document.querySelector('#inputCard').after(section);
  const form = section.querySelector('form'), get = name => form.elements.namedItem(name);
  let busy = false, completed = null, lastReport = null, sampleUrls=[];
  const storageKey='media-workspace-configs-v2';
  const download=(data,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const configs=()=>{try{return JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{return {};}};
  const refreshConfigs=()=>{get('savedConfig').innerHTML=Object.keys(configs()).map(n=>`<option value="${escape(n)}">${escape(n)}</option>`).join('');};
  const applyConfig=raw=>{for(const key of ['operation','codec'])if(get(key)&&raw[key]!=null)get(key).value=raw[key];updateEncoder();if(raw.encoder){if(![...get('encoder').options].some(o=>o.value===raw.encoder))throw Error('当前平台不支持配置中的编码器 '+raw.encoder+'；请手动选择编码器');get('encoder').value=raw.encoder;}updatePreset();for(const [key,value] of Object.entries(raw)){const el=get(key);if(!el||['savedConfig','configName'].includes(key))continue;if(el.type==='checkbox')el.checked=value===true;else if(el.tagName==='SELECT'){if([...el.options].some(o=>o.value===String(value)))el.value=String(value);}else el.value=String(value??'');}updateMode();updateRate();};
  const status = text => { section.querySelector('#taskStatus').textContent = text; };
  const read = () => Object.fromEntries([...form.elements].filter(x=>x.name).map(x=>[x.name,x.type==='checkbox'?x.checked:x.value]));
  const windows = () => hooks.isWindows();
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
    get('preset').innerHTML=vals.map(v=>`<option>${v}</option>`).join('');
    get('preset').value=!reset&&vals.includes(previous)?previous:nv?'p5':get('codec').value==='av1'?'6':'medium';
    section.querySelector('#taskNvenc').hidden=!nv;
  }
  function updateMode() {
    const copy=get('operation').value==='copy';
    section.querySelector('#taskEncoding').disabled=copy;
    document.querySelectorAll('.input-ass,.input-font').forEach(el=>el.classList.toggle('hidden',get('operation').value!=='hardsub'));
    for(const o of get('audio').options)o.disabled=copy&&['aac','libopus'].includes(o.value);
    if(copy && ['aac','libopus'].includes(get('audio').value))get('audio').value='copy';
    section.querySelector('#taskModeHint').textContent=copy?'无损快速剪切：起点向前定位到关键帧，不重新编码。实际起点会显示在任务状态中；终点仍受压缩数据包边界约束。':'手动模式无需质量校准。硬字幕模式仍需确认真实字幕预览；纯视频转码无需字幕。';
  }
  function updateRate(){const mode=get('rateMode').value;for(const key of ['targetSize','sizeUnit','sizeReserve'])get(key).disabled=mode!=='size'||get('operation').value==='copy';get('quality').disabled=mode!=='quality';get('bitrate').disabled=mode!=='bitrate';get('twoPass').disabled=get('operation').value==='copy'||get('encoder').value!=='libx264'||mode==='quality';if(get('twoPass').disabled)get('twoPass').checked=false;const encoded=['aac','libopus'].includes(get('audio').value);for(const key of ['audioBitrate','audioChannels','audioSampleRate'])get(key).disabled=!encoded;}
  get('audio').onchange=updateRate;
  get('rateMode').onchange=updateRate;
  section.querySelector('#taskStore').onclick=()=>{try{const name=get('configName').value.trim();if(!name||name.length>80)throw Error('请输入 1–80 字的配置名称');const c=configs();Object.defineProperty(c,name,{value:read(),enumerable:true,configurable:true,writable:true});localStorage.setItem(storageKey,JSON.stringify(c));refreshConfigs();status('配置已保存');}catch(e){status(e.message);}};
  section.querySelector('#taskRestore').onclick=()=>{try{const raw=configs()[get('savedConfig').value];if(raw)applyConfig(raw);}catch(e){status(e.message);}};
  section.querySelector('#taskDelete').onclick=()=>{const c=configs();delete c[get('savedConfig').value];localStorage.setItem(storageKey,JSON.stringify(c));refreshConfigs();};
  section.querySelector('#taskExportConfig').onclick=()=>download({version:2,settings:read()},'media-config.json');
  section.querySelector('#taskImportConfig').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>65536)throw Error('配置文件超过 64 KiB');const data=JSON.parse(await file.text());if(data.version!==2||!data.settings||typeof data.settings!=='object')throw Error('配置格式无效');applyConfig(data.settings);status('已导入配置，执行前仍会验证参数');}catch(err){status(err.message);}finally{e.target.value='';}};
  section.querySelector('#taskReport').onclick=()=>{if(lastReport)download(lastReport,'media-task-report.json');};
  get('codec').onchange=()=>{updateEncoder();get('quality').value=get('codec').value==='av1'?'32':'23';};
  get('encoder').onchange=()=>{updatePreset();updateRate();};
  get('operation').onchange=()=>{updateMode();updateRate();};
  section.querySelector('#taskLoadPreset').onclick=()=>{updatePreset(true);get('quality').value=get('codec').value==='av1'?'32':'23';get('rateMode').value='quality';updateRate();status('已填入质量与编码速度预设；其他设置保持当前值，可继续修改。');};
  let platformKey='';
  const platformTimer=setInterval(()=>{const key=JSON.stringify(hooks.platformKey());if(key!==platformKey&&!busy){platformKey=key;updateEncoder();}},1000);
  const prepare=async()=>{
    const raw=read(),media=await hooks.prepare(raw.operation);
    const task=compileTask(raw,media);
    await hooks.validate?.(task);
    const compat = Array.isArray(task.compatibilityWarnings) && task.compatibilityWarnings.length
      ? ' 兼容性：'+task.compatibilityWarnings.join(' ')
      : '';
    section.querySelector('#taskEstimate').textContent=(task.sizePlan ? '目标 '+formatSize(task.sizePlan.targetBytes)+' · 视频 '+task.bitrate+' bit/s · 预留 '+task.sizePlan.reservePercent+'% · ' : '')+'预计音视频数据：'+formatSize(task.estimatedBytes)+'。质量模式需试压估计；封装、字幕与码率偏差仍影响实际大小。'+compat;
    section.querySelector('#taskCommand').textContent=commandPreview(task);
    return {task,media};
  };
  section.querySelector('#taskInspect').onclick=async()=>{if(busy||hooks.busy())return;busy=true;hooks.setBusy(true);try{await prepare();status('设置有效，已检查可用参数与像素格式；执行时仍会验证具体编码器与滤镜组合。');}catch(e){status(e.message);}finally{busy=false;hooks.setBusy(false);}};
  section.querySelector('#taskCancel').onclick=()=>{hooks.cancel();status('正在取消…');};
  section.querySelector('#taskSave').onclick=()=>{if(completed)hooks.save(completed);};
  form.onsubmit=async e=>{
    e.preventDefault();if(busy||hooks.busy()){status('已有任务正在运行，请等待或取消。');return;}
    busy=true; completed=null;lastReport=null;section.querySelector('#taskReport').disabled=true; section.querySelector('#taskSave').disabled=true;
    hooks.setBusy(true);
    try {
      status('正在读取素材与检查设置…');
      const {task,media}=await prepare();
      for(const control of form.elements)control.disabled=true;
      section.querySelector('#taskCancel').disabled=false;
      const started=performance.now();
      completed=await hooks.run(task,media,(p,message)=>{section.querySelector('#taskProgress').value=p;status(message);});
      lastReport=outputReport(task,completed,(performance.now()-started)/1000);
      section.querySelector('#taskReport').disabled=false;
      status('处理完成 · '+formatSize(lastReport.outputBytes)+(lastReport.withinBudget===false?' · 超出体积预算，完整成品已保留；建议视频码率 '+lastReport.suggestedVideoRate+' bit/s':lastReport.withinBudget===true?' · 在体积预算内':'')+' · 成品已验证 · 实际起点 '+Number(completed.actualStart||0).toFixed(3)+' 秒。点击“保存成品”选择保存位置。');
      section.querySelector('#taskProgress').value=1;
    }catch(e){status('处理失败：'+e.message);hooks.log(e.stack||e.message);}
    finally{
      busy=false;hooks.setBusy(false);for(const control of form.elements)control.disabled=false;
      updateMode();section.querySelector('#taskCancel').disabled=true;section.querySelector('#taskSave').disabled=!completed;section.querySelector('#taskReport').disabled=!lastReport;updateRate();
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
    finally{busy=false;hooks.setBusy(false);for(const control of form.elements)control.disabled=false;updateMode();updateRate();section.querySelector('#taskCancel').disabled=true;section.querySelector('#taskSave').disabled=!completed;section.querySelector('#taskReport').disabled=!lastReport;}
  };
  updateEncoder();updateMode();updateRate();refreshConfigs();
  return {section,dispose:()=>{clearInterval(platformTimer);for(const url of sampleUrls)URL.revokeObjectURL(url);}};
}
