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
  '-v','error','-show_format','-show_streams','-of','json',file
]));
const hashes=(file)=>JSON.parse(run('ffprobe',[
  '-v','error','-select_streams','a:0','-show_packets','-show_data_hash','sha256',
  '-show_entries','packet=data_hash','-of','json',file
])).packets.map(p=>p.data_hash);
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
assert.equal(sv.length,1);assert.equal(sa.length,1);
assert.equal(ov.length,1);assert.equal(oa.length,1);
assert.equal(sv[0].codec_name,'ffv1');
assert.equal(ov[0].codec_name,'hevc');
assert.equal(sa[0].codec_name,'flac');
assert.equal(oa[0].codec_name,'flac');
assert.equal(ov[0].width,320);assert.equal(ov[0].height,180);
assert.equal(ov[0].pix_fmt,'yuv420p');
const sourceHashes=hashes(source),outputHashes=hashes(output);
assert.ok(sourceHashes.length>=20,'Too few source audio packets to establish copy');
assert.deepEqual(outputHashes,sourceHashes,
  'Copied FLAC payload packets must be byte-identical and in order');
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
  copiedAudioCodec:oa[0].codec_name,audioPackets:outputHashes.length,
  copiedAudioPacketSha256AllMatch:true,
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
