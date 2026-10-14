export function parseEncoderHelp(text) {
  return {
    available:/^Encoder\s+/m.test(String(text)),
    options:[...String(text).matchAll(/^\s*(-[A-Za-z0-9_:.-]+)(?:\s|$)/gm)].map(m=>m[1]),
    pixelFormats:(String(text).match(/Supported pixel formats:\s*([^\r\n]+)/)?.[1] || '').trim().split(/\s+/).filter(Boolean)
  };
}
export function vvcCapability(backend={}) {
  const unavailable=reason=>({available:false,reason});
  if(backend.backend!=='windows-native' || backend.available!==true) return unavailable('H.266 不可用：需要连接 Windows Native');
  const profile=backend.encoders?.find(e=>(e.Key||e.key)==='libvvenc');
  if(!profile || (profile.Available??profile.available)!==true || (profile.Runtime??profile.runtime)!==true ||
      (profile.RuntimeValidation??profile.runtimeValidation)!=='encode-mkv-decode-v1') {
    return unavailable('H.266 不可用：'+(profile?.RuntimeError||profile?.runtimeError||'当前 FFmpeg 尚未通过 libvvenc 编码、MKV 封装及解码探测'));
  }
  if(!(profile.Options||profile.options||[]).includes('-qp') ||
      !(profile.PixelFormats||profile.pixelFormats||[]).includes('yuv420p10le'))return unavailable('H.266 不可用：libvvenc 参数或像素格式能力不足');
  return {available:true,reason:'H.266 实验输出 · 本机短样编码、MKV 封装及解码探测通过；外部播放器兼容性未验证。编码输入为 10-bit 4:2:0，仍不接受 HDR。'};
}
export function validateEncoderSupport(task, encoder, globalOptions = []) {
  if(task.operation==='copy')return;
  const options=new Set([...globalOptions,...(encoder.options || encoder.Options || [])]);
  if(!options.size)throw Error('无法取得 FFmpeg 参数能力，请检查安装或更新核心');
  // Input/map/metadata codecs are generic options; check only the requested features.
  for(const flag of ['-fps_mode','-vsync','-multipass','-rc-lookahead','-spatial-aq','-temporal-aq','-aq-strength','-cq','-crf','-qp','-preset','-tune']){
    if(task.outputArgs.includes(flag) && !options.has(flag))throw Error(`当前 FFmpeg / ${task.encoder} 不支持 ${flag}，请更新核心或修改设置`);
  }
  const formats=encoder.pixelFormats || encoder.PixelFormats || [];
  if(formats.length && !formats.includes(task.pixelFormat))throw Error(`${task.encoder} 不支持像素格式 ${task.pixelFormat}，请修改位深 / 色度设置`);
}
