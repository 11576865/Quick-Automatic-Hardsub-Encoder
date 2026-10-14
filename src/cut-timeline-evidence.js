// A04: an observed output-clock first presentation is NOT the source
// trim boundary, packet identity, last decoded frame or audio synchronization.
const observed=v=>Number.isFinite(v)&&v>=-60&&v<1e8;
export function normalizeCompletedCutTimeline(task,completed,receipt){
 if(task?.operation!=='copy'||!task.hasTrimRange)
   throw Error('Cut timeline is only available for a completed Stream Copy trim');
 if(!receipt?.ok||receipt.version!==1||
   receipt.scope!=='completed-artifact-first-boundary'||receipt.jobId!==completed?.jobId)
   throw Error('Timeline receipt is not bound to this completed job');
 if(!Number.isSafeInteger(receipt.artifactBytes)||receipt.artifactBytes<=0||
   receipt.artifactBytes!==Number(completed.outputBytes))
   throw Error('Completed cut artifact identity differs from recorded output');
 if(!observed(receipt.actualFirstPresentation)||!observed(receipt.firstVideoPacketPts)||
   !observed(receipt.firstVideoPacketDts))
   throw Error('FFprobe did not observe a valid decoded first video frame and packet');
 if(!Number.isFinite(receipt.executionSeekIn)||Math.abs(receipt.executionSeekIn-completed.actualStart)>.005)
   throw Error('Execution seek hint does not match this Native completion');
 if(!Array.isArray(receipt.audioTimeMapping)||receipt.audioTimeMapping.length>16)
   throw Error('Invalid bounded audio clock observation');
 const audio=receipt.audioTimeMapping.map((a,i)=>{
  if(a.outputOrdinal!==i||!observed(a.outputFirstPts)||!observed(a.outputFirstDts))
   throw Error('Incomplete or inconsistent output audio clock at ordinal '+i);
  return {
   outputOrdinal:i,outputFirstPts:a.outputFirstPts,outputFirstDts:a.outputFirstDts,
   sourceFirstPts:null,sourceMappingVerified:false
  };
 });
 return {
  version:1,scope:'completed-artifact-first-boundary',jobId:receipt.jobId,
  artifactBytes:receipt.artifactBytes,artifactWriteTicks:String(receipt.artifactWriteTicks||''),
  requestedIn:task.start,requestedOut:task.end,
  executionSeekIn:receipt.executionSeekIn,
  actualFirstPresentation:receipt.actualFirstPresentation,
  presentationClock:'output-video-decoded-frame-PTS-seconds',
  firstVideoPacketPts:receipt.firstVideoPacketPts,
  firstVideoPacketDts:receipt.firstVideoPacketDts,
  audioTimeMapping:audio,copiedPacketRange:null,
  verificationStatus:'output-first-boundary-observed-source-packet-and-sync-unverified',
  note:'观察值来自本次已完成成品的 FFprobe，时间为输出时钟。关键帧 seek hint 不等于源首个实际呈现帧；源包映射、尾帧、VFR/B帧整段同步尚未验收。'
 };
}
