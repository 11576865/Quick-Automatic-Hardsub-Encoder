// B21 bounded product slice: one source, multiple frozen independently saved
// output recipes. This is not a full multi-source batch scheduler.
export function mediaRecipeSignature(media){
  if(!media||!(Number(media.duration)>0))throw Error('方案矩阵需要已探测的视频来源');
  const signature={
    duration:Math.round(Number(media.duration)*1000),
    video:(media.videoStreams||[]).map(s=>[
      s.codec||s.codec_name||'',Number(s.width||0),Number(s.height||0),
      String(s.fps??s.avg_frame_rate??''),String(s.pixelFormat||s.pix_fmt||'')
    ]),
    videoCount:Number(media.videoTracks??media.videoStreams?.length??0),
    audio:(media.audioStreams||[]).map(s=>[
      s.codec||s.codec_name||'',Number(s.channels||0),Number(s.sampleRate||s.sample_rate||0)
    ]),
    audioCount:Number(media.audioTracks??media.audioStreams?.length??0),
    subtitles:Number(media.subtitleTracks??media.subtitleStreams?.length??0),
    attachments:Number(media.attachmentTracks??media.attachmentStreams?.length??0)
  };
  return JSON.stringify(signature);
}
export function createOutputRecipe({task,media,sourceKey,assetKey,name,index}){
  if(!String(sourceKey||''))throw Error('先选择来源并完成媒体探测');
  if(!task||task.version!==4||!Array.isArray(task.outputArgs)||!task.outputArgs.length)
    throw Error('只能加入由权威编译器生成的正式 v4 任务');
  if(!['hardsub','transcode','copy'].includes(task.operation))
    throw Error('未知的输出工作流');
  if(task.operation==='hardsub'&&!String(assetKey||''))
    throw Error('硬压配方必须绑定 ASS 和字体状态');
  if(!Number.isInteger(index)||index<1||index>12)
    throw Error('单来源方案矩阵最多 12 项');
  const frozen=structuredClone(task);
  const freeze=value=>{
    if(value&&typeof value==='object'&&!Object.isFrozen(value)){
      for(const sub of Object.values(value))freeze(sub);
      Object.freeze(value);
    }
    return value;
  };
  freeze(frozen);
  return Object.freeze({
    id:'recipe-'+index,
    label:String(name||'方案 '+index).slice(0,90),
    sourceKey:String(sourceKey),
    assetKey:String(assetKey||''),
    mediaSignature:mediaRecipeSignature(media),
    task:frozen
  });
}
export function validateOutputRecipe(recipe,{media,sourceKey,assetKey}){
  if(!recipe?.task||recipe.task.version!==4)throw Error('配方合同无效');
  if(recipe.sourceKey!==String(sourceKey||''))throw Error('来源已更换；拒绝旧视频的输出方案');
  if(recipe.mediaSignature!==mediaRecipeSignature(media))throw Error('媒体流信息已变化；重新添加方案');
  if(recipe.task.operation==='hardsub'&&recipe.assetKey!==String(assetKey||''))
    throw Error('ASS 或字体已变化；拒绝沿用旧字幕资源');
  return recipe.task;
}
export function outputRecipeFilename(filename,index){
  if(!Number.isInteger(index)||index<1||index>99)throw Error('输出编号无效');
  const raw=String(filename||'output.mkv');
  const dot=raw.lastIndexOf('.');
  const stem=dot>0?raw.slice(0,dot):raw;
  const ext=dot>0?raw.slice(dot):'';
  return stem+'-variant-'+String(index).padStart(2,'0')+ext;
}
