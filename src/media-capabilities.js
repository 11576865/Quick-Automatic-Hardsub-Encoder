export function parseEncoderHelp(text) {
  return {
    available:/^Encoder\s+/m.test(String(text)),
    options:[...String(text).matchAll(/^\s*(-[A-Za-z0-9_:.-]+)(?:\s|$)/gm)].map(m=>m[1]),
    pixelFormats:(String(text).match(/Supported pixel formats:\s*([^\r\n]+)/)?.[1] || '').trim().split(/\s+/).filter(Boolean)
  };
}
export function validateEncoderSupport(task, encoder, globalOptions = []) {
  if(task.operation==='copy')return;
  const options=new Set([...globalOptions,...(encoder.options || encoder.Options || [])]);
  if(!options.size)throw Error('无法取得 FFmpeg 参数能力，请检查安装或更新核心');
  // Input/map/metadata codecs are generic options; check only the requested features.
  for(const flag of ['-fps_mode','-vsync','-multipass','-rc-lookahead','-spatial-aq','-temporal-aq','-aq-strength','-cq','-crf','-preset','-tune']){
    if(task.outputArgs.includes(flag) && !options.has(flag))throw Error(`当前 FFmpeg / ${task.encoder} 不支持 ${flag}，请更新核心或修改设置`);
  }
  const formats=encoder.pixelFormats || encoder.PixelFormats || [];
  if(formats.length && !formats.includes(task.pixelFormat))throw Error(`${task.encoder} 不支持像素格式 ${task.pixelFormat}，请修改位深 / 色度设置`);
}
