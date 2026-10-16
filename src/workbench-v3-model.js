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
