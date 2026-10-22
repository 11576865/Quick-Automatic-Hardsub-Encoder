export function previewAspect(media) {
  const width=Number(media?.width),height=Number(media?.height);
  if(!(width>0&&height>0))return null;
  const parts=String(media.sar||media.sampleAspectRatio||'1:1').split(/[:/]/).map(Number);
  const sar=parts.length===2&&parts[0]>0&&parts[1]>0?parts[0]/parts[1]:1;
  return width/height*sar;
}
export function toolbarDensity(preference,width) {
  return preference==='compact'||preference==='auto'&&width<1280?'compact':'standard';
}
export function sourceObjects(media) {
  const objects=[];
  for(const [key,glyph,label] of [['videoStreams','video','视频'],['audioStreams','music','音轨'],['subtitleStreams','type','字幕'],['attachmentStreams','paperclip','附件']]){
    for(const [i,stream] of (Array.isArray(media?.[key])?media[key]:[]).entries()){
      objects.push({glyph,name:stream.title||stream.filename||stream.name||stream.tags?.title||stream.tags?.filename||`${label} ${i+1}`,properties:[stream.codec||stream.codec_name,stream.language||stream.tags?.language,stream.width&&stream.height?`${stream.width}×${stream.height}`:''].filter(Boolean).join(' · ')||'属性未提供'});
    }
  }
  return objects;
}

// The old frame may still be present in the underlying timeline when a source
// changes. A new source cannot inherit that decoded-image evidence.
export function previewFrameReady(src,hidden,previousSourceSrc=null) {
  return Boolean(src&&!hidden&&(previousSourceSrc===null||src!==previousSourceSrc));
}
