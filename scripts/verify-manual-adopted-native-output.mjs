// Independent full-file artifact verifier. It inspects source/output bytes,
// decodes every video frame, compares every copied-audio packet hash and runs
// full-duration source-reference SSIM. Short-window VBR and actual whole-file
// observations are deliberately reported as separate evidence layers.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const [source,output,requestFile,statusFile,reportPath]=process.argv.slice(2);
if(!source||!output||!requestFile||!statusFile)throw Error(
  'Usage: verify-manual-adopted-native-output.mjs source output request.json status.json');
const run=(exe,args)=>{
  try{return execFileSync(exe,args,{encoding:'utf8',maxBuffer:16*1024*1024,
    stdio:['ignore','pipe','pipe'],timeout:45000});}
  catch(e){throw Error(exe+' failed: '+String(e.stderr||e.message).slice(-2300));}
};
const probe=(file)=>JSON.parse(run('ffprobe',[
  '-v','error','-show_format','-show_streams','-show_chapters','-show_data_hash','sha256','-of','json',file
]));
const packets=(file,selector)=>JSON.parse(run('ffprobe',[
  '-v','error','-select_streams',selector,'-show_packets','-show_data_hash','sha256',
  '-show_entries','packet=data_hash,size,pts_time,dts_time,flags:packet_side_data=side_data_type,skip_samples,discard_padding','-of','json',file
])).packets;
const input=probe(source),actual=probe(output);
const task=JSON.parse(readFileSync(requestFile,'utf8')).request.task;
const bridge=JSON.parse(readFileSync(statusFile,'utf8'));
assert.equal(bridge.ok,true);
assert.equal(bridge.state,'completed');
assert.equal(bridge.encoder,'libx265');
assert.equal(task.version,4);
assert.equal(task.operation,'transcode');
assert.equal(task.encoder,'libx265');
assert.equal(task.audio,'copy');
const sv=input.streams.filter(s=>s.codec_type==='video');
const sa=input.streams.filter(s=>s.codec_type==='audio');
const ov=actual.streams.filter(s=>s.codec_type==='video');
const oa=actual.streams.filter(s=>s.codec_type==='audio');
const ss=input.streams.filter(s=>s.codec_type==='subtitle');
const os=actual.streams.filter(s=>s.codec_type==='subtitle');
const st=input.streams.filter(s=>s.codec_type==='attachment');
const ot=actual.streams.filter(s=>s.codec_type==='attachment');
assert.equal(sv.length,1);assert.equal(sa.length,2);
assert.equal(ov.length,1);assert.equal(oa.length,2);
assert.equal(ss.length,1);assert.equal(os.length,1);
assert.equal(st.length,1);assert.equal(ot.length,1);
assert.equal(sv[0].codec_name,'ffv1');
assert.equal(ov[0].codec_name,'hevc');
assert.deepEqual(sa.map(x=>x.codec_name),['flac','aac']);
assert.deepEqual(oa.map(x=>x.codec_name),['flac','aac']);
assert.equal(task.expectedAudioTracks,2);
assert.equal(task.keepSubtitles,true);
assert.equal(task.keepAttachments,true);
assert.equal(task.keepMetadata,true);
assert.equal(task.keepChapters,true);
assert.deepEqual(sa.map(x=>x.tags?.language),['jpn','eng']);
assert.deepEqual(oa.map(x=>x.tags?.language),['jpn','eng']);
assert.equal(ss[0].codec_name,'ass');assert.equal(os[0].codec_name,'ass');
assert.equal(ss[0].tags?.language,'jpn');assert.equal(os[0].tags?.language,'jpn');
assert.equal(ss[0].extradata_hash,os[0].extradata_hash);
assert.equal(st[0].codec_name,'ttf');assert.equal(ot[0].codec_name,'ttf');
assert.equal(st[0].tags?.filename,'QHE-Synthetic-CI.ttf');
assert.equal(ot[0].tags?.filename,st[0].tags?.filename);
assert.equal(ot[0].tags?.mimetype,st[0].tags?.mimetype);
assert.ok(st[0].extradata_hash?.startsWith('SHA256:'));
assert.equal(ot[0].extradata_hash,st[0].extradata_hash,
  'Embedded self-generated TrueType font data must be unchanged');
assert.equal(input.format.tags?.title,'QHE MANUAL COMPLEX V4 CI');
assert.equal(actual.format.tags?.title,input.format.tags?.title);
assert.equal(input.chapters.length,2);
assert.equal(actual.chapters.length,2);
for(let i=0;i<2;i++){
  const x=input.chapters[i],y=actual.chapters[i];
  assert.equal(y.tags?.title,x.tags?.title);
  assert.ok(Math.abs(Number(y.start_time)-Number(x.start_time))<.01);
  assert.ok(Math.abs(Number(y.end_time)-Number(x.end_time))<.01);
}
assert.equal(ov[0].width,320);assert.equal(ov[0].height,180);
assert.equal(ov[0].pix_fmt,'yuv420p');
const streamCopyProof=[];
for(const [selector,minimum] of [['a:0',20],['a:1',20],['s:0',2]]){
  const inputPackets=packets(source,selector),outputPackets=packets(output,selector);
  const sourceHashes=inputPackets.map(x=>x.data_hash),
    outputHashes=outputPackets.map(x=>x.data_hash);
  assert.ok(sourceHashes.length>=minimum,
    'Source contains too few packets for '+selector);
  if(outputHashes.length!==sourceHashes.length ||
     outputHashes.some((value,i)=>value!==sourceHashes[i])){
    const peek=items=>items.slice(0,4).map(p=>({
      pts:p.pts_time,dts:p.dts_time,hash:p.data_hash,
      size:p.size,sideData:p.side_data_list
    }));
    throw Error('Stream-copy payload difference '+selector+
      ': '+JSON.stringify({sourceCount:sourceHashes.length,
        outputCount:outputHashes.length,
        sourceLeading:peek(inputPackets),outputLeading:peek(outputPackets)}));
  }
  streamCopyProof.push({selector,count:outputPackets.length,
    payloadBytes:outputPackets.reduce((n,p)=>n+Number(p.size||0),0)});
}
const outputVideoPacketBytes=packets(output,'v:0')
  .reduce((n,p)=>n+Number(p.size||0),0);
const totalBytes=statSync(output).size;
assert.ok(totalBytes>0);
assert.equal(totalBytes,Number(actual.format.size));
assert.equal(totalBytes,Number(bridge.outputBytes));
const length=Number(actual.format.duration);
const srcDuration=Number(input.format.duration);
assert.ok(Math.abs(srcDuration-5)<.1);
assert.ok(Math.abs(length-srcDuration)<.18,
  'Actual full output timeline deviates from input');
assert.ok(Math.abs(bridge.outputDuration-length)<.18);
const countFrames=(file)=> {
  const data=JSON.parse(run('ffprobe',[
    '-v','error','-select_streams','v:0','-count_frames','-show_entries',
    'stream=nb_read_frames','-of','json',file
  ]));
  return Number(data.streams?.[0]?.nb_read_frames);
};
const inputFrames=countFrames(source),outputFrames=countFrames(output);
assert.ok(inputFrames>=50);
assert.equal(outputFrames,inputFrames,'Full output frame count must match source');
const args=[
  '-hide_banner','-nostdin','-i',source,'-i',output,
  '-filter_complex',
  '[0:v:0]format=yuv420p,setpts=PTS-STARTPTS[src];'+
  '[1:v:0]format=yuv420p,setpts=PTS-STARTPTS[dst];[src][dst]ssim',
  '-an','-f','null','NUL'
];
// This is an independent reference comparison over the *entire* encoded
// source timeline, not a reuse of the two sampled VBR windows.
const {spawnSync}=await import('node:child_process');
const measured=spawnSync('ffmpeg',args,{encoding:'utf8',maxBuffer:4*1024*1024,
  timeout:45000});
if(measured.status!==0)throw Error('Whole-file SSIM failed: '+String(measured.stderr).slice(-1700));
const trace=String(measured.stderr);
const captures=[...trace.matchAll(/SSIM[^\n]*All:([0-9.]+)/g)];
assert.ok(captures.length>0,'No independent whole-file SSIM evidence');
const wholeSsim=Number(captures.at(-1)[1]);
assert.ok(Number.isFinite(wholeSsim)&&wholeSsim>=.90&&wholeSsim<=1,
  'Whole synthetic output quality below acceptance threshold');
const totalRequestedVideoBytes=task.bitrate*srcDuration/8;
const report={
  result:'PASS',evidence:'actual full formal v4 Windows Native HEVC encode',
  sourceVideoCodec:sv[0].codec_name,outputVideoCodec:ov[0].codec_name,
  copiedAudioCodecs:oa.map(x=>x.codec_name),
  perStreamPacketProof:streamCopyProof,
  copiedAudioPacketSha256AllMatch:true,
  copiedAssPacketSha256AllMatch:true,
  assCodecPrivateSha256Matched:true,
  syntheticTtfAttachmentSha256Matched:true,
  copiedChapters:actual.chapters.length,
  outputVideoPacketBytes,
  copiedAudioAndSubtitlePacketBytes:streamCopyProof.reduce((n,x)=>n+x.payloadBytes,0),
  otherBytesIncludingFontAndMux:totalBytes-outputVideoPacketBytes-
    streamCopyProof.reduce((n,x)=>n+x.payloadBytes,0),
  framesInput:inputFrames,framesOutput:outputFrames,
  sourceDuration:+srcDuration.toFixed(3),outputDuration:+length.toFixed(3),
  requestedVideoBitrate:task.bitrate,
  requestedVideoBytesProjection:Math.round(totalRequestedVideoBytes),
  actualWholeContainerBytes:totalBytes,
  wholeFileDecodedSsim:+wholeSsim.toFixed(6),
  targetWholeFileContainerBytesGuaranteed:false,
  playbackOnExternalPlayerVerified:false,
  userDeviceVerified:false
};
if(reportPath)writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify(report,null,2));
