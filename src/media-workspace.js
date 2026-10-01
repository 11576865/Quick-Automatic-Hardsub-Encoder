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
  ${select('rateMode','码率控制',[['quality','固定质量 CRF / CQ'],['bitrate','目标码率']])}${input('quality','质量值 CRF / CQ','','23')}${input('bitrate','目标视频码率（bit/s）','4000000')}
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
  </fieldset>
  <fieldset><legend>音频与轨道 · 输出 MKV</legend><div class="task-grid">${select('audio','音频策略',[['copy','复制原音频'],['aac','转为 AAC'],['none','关闭音频']])}${input('audioTrack','保留音轨','all 或音频轨序号，从 0 开始','all')}${input('audioBitrate','AAC 码率（bit/s）','','192000')}${check('keepSubtitles','保留内封软字幕')}${check('keepAttachments','保留附件 / 字体')}${check('keepMetadata','保留元数据',true)}${check('keepChapters','保留章节')}</div><p>剪切默认移除旧章节，避免章节时间与成品不一致。软字幕复制后的边界与显示效果需自行核对。</p></fieldset>
  <div class="button-row"><button type="button" id="taskLoadPreset" class="secondary">填入均衡预设</button><button type="button" id="taskInspect" class="secondary">检查设置与执行参数</button><button type="submit" id="taskRun">开始处理</button><button type="button" id="taskCancel" class="secondary" disabled>取消</button><button type="button" id="taskSave" class="secondary" disabled>保存成品</button></div>
  <pre id="taskCommand" class="task-command" aria-live="polite">等待检查设置。</pre><p id="taskStatus" role="status">未开始</p><progress id="taskProgress" max="1" value="0"></progress>
  </form>`;
  document.querySelector('#inputCard').after(section);
  const form = section.querySelector('form'), get = name => form.elements.namedItem(name);
  let busy = false, completed = null;
  const status = text => { section.querySelector('#taskStatus').textContent = text; };
  const read = () => Object.fromEntries([...form.elements].filter(x=>x.name).map(x=>[x.name,x.type==='checkbox'?x.checked:x.value]));
  const windows = () => hooks.isWindows();
  function updateEncoder() {
    const c=get('codec').value;
    const choices=[[SOFTWARE[c],{h264:'x264',h265:'x265',av1:'SVT-AV1'}[c]+' · CPU']];
    if(windows() && hooks.hasNvenc(c)) choices.push([{h264:'h264_nvenc',h265:'hevc_nvenc',av1:'av1_nvenc'}[c],'NVENC · GPU']);
    get('encoder').innerHTML=choices.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
    updatePreset();
  }
  function updatePreset() {
    const nv=get('encoder').value.endsWith('_nvenc');
    const vals=nv?['p1','p2','p3','p4','p5','p6','p7']:get('codec').value==='av1'?Array.from({length:14},(_,i)=>String(i)):['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'];
    get('preset').innerHTML=vals.map(v=>`<option>${v}</option>`).join('');
    get('preset').value=nv?'p5':get('codec').value==='av1'?'6':'medium';
    section.querySelector('#taskNvenc').hidden=!nv;
  }
  function updateMode() {
    const copy=get('operation').value==='copy';
    section.querySelector('#taskEncoding').disabled=copy;
    document.querySelectorAll('.input-ass,.input-font').forEach(el=>el.classList.toggle('hidden',get('operation').value!=='hardsub'));
    const aac=[...get('audio').options].find(o=>o.value==='aac'); aac.disabled=copy;
    if(copy && get('audio').value==='aac')get('audio').value='copy';
    section.querySelector('#taskModeHint').textContent=copy?'无损快速剪切：起点向前定位到关键帧，不重新编码。实际起点会显示在任务状态中；终点仍受压缩数据包边界约束。':'手动模式无需质量校准。硬字幕模式仍需确认真实字幕预览；纯视频转码无需字幕。';
  }
  get('codec').onchange=()=>{updateEncoder();get('quality').value=get('codec').value==='av1'?'32':'23';};
  get('encoder').onchange=updatePreset;
  get('operation').onchange=updateMode;
  section.querySelector('#taskLoadPreset').onclick=()=>{updatePreset();get('quality').value=get('codec').value==='av1'?'32':'23';get('rateMode').value='quality';status('已填入质量与编码速度预设；其他设置保持当前值，可继续修改。');};
  let platformKey='';
  const platformTimer=setInterval(()=>{const key=JSON.stringify(hooks.platformKey());if(key!==platformKey&&!busy){platformKey=key;updateEncoder();}},1000);
  const prepare=async()=>{
    const raw=read(),media=await hooks.prepare(raw.operation);
    const task=compileTask(raw,media);
    section.querySelector('#taskCommand').textContent=commandPreview(task);
    return {task,media};
  };
  section.querySelector('#taskInspect').onclick=async()=>{if(busy||hooks.busy())return;busy=true;hooks.setBusy(true);try{await prepare();status('设置有效；执行时将由当前 FFmpeg 验证具体编码器与滤镜组合。');}catch(e){status(e.message);}finally{busy=false;hooks.setBusy(false);}};
  section.querySelector('#taskCancel').onclick=()=>{hooks.cancel();status('正在取消…');};
  section.querySelector('#taskSave').onclick=()=>{if(completed)hooks.save(completed);};
  form.onsubmit=async e=>{
    e.preventDefault();if(busy||hooks.busy()){status('已有任务正在运行，请等待或取消。');return;}
    busy=true; completed=null; section.querySelector('#taskSave').disabled=true;
    hooks.setBusy(true);
    try {
      status('正在读取素材与检查设置…');
      const {task,media}=await prepare();
      for(const control of form.elements)control.disabled=true;
      section.querySelector('#taskCancel').disabled=false;
      completed=await hooks.run(task,media,(p,message)=>{section.querySelector('#taskProgress').value=p;status(message);});
      status('处理完成，成品已验证 · 实际起点 '+Number(completed.actualStart||0).toFixed(3)+' 秒。点击“保存成品”选择保存位置。');
      section.querySelector('#taskProgress').value=1;
    }catch(e){status('处理失败：'+e.message);hooks.log(e.stack||e.message);}
    finally{
      busy=false;hooks.setBusy(false);for(const control of form.elements)control.disabled=false;
      updateMode();section.querySelector('#taskCancel').disabled=true;section.querySelector('#taskSave').disabled=!completed;
    }
  };
  updateEncoder();updateMode();
  return {section,dispose:()=>clearInterval(platformTimer)};
}
