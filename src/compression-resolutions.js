// Candidate output sizes for guided Windows Native compression comparisons.
// Comparison is valid only when samples are scored against the same original,
// fully subtitle-rendered reference after a fixed bicubic re-upscale.
export const COMMON_REFERENCE_METRIC='original-source-bicubic-upscale-ssim-v1';
export function guidedResolutionCandidates(media={}) {
  const width=Number(media.width),height=Number(media.height);
  if(!Number.isInteger(width)||!Number.isInteger(height)||
    width<2||height<2||width>16384||height>16384||
    width%2||height%2)return [];
  const result=[{id:'source',width:0,height:0,label:'原尺寸',
    displayWidth:width,displayHeight:height,metric:COMMON_REFERENCE_METRIC}];
  for(const targetHeight of [1080,720]) {
    if(targetHeight>=height)continue;
    const targetWidth=Math.floor((width*targetHeight/height)/2)*2;
    if(targetWidth<2||targetWidth>width)continue;
    const id=String(targetHeight)+'p';
    result.push({id,width:targetWidth,height:targetHeight,
      displayWidth:targetWidth,displayHeight:targetHeight,
      label:targetWidth+'×'+targetHeight,metric:COMMON_REFERENCE_METRIC});
  }
  return result;
}
