import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';

const packDir=resolve(process.argv[2]||'device-acceptance/stream-plan-v4-pack');
const outputDir=resolve(process.argv[3]||'device-acceptance/device-outputs');
const ffmpeg=process.env.FFMPEG||'ffmpeg';
const ffprobe=process.env.FFPROBE||'ffprobe';

const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',maxBuffer:64*1024*1024});
const probe=file=>JSON.parse(run(ffprobe,['-v','error','-show_streams','-show_chapters','-show_format','-of','json',file]));
const packetEnd=(file,spec)=>{
  const json=JSON.parse(run(ffprobe,['-v','error','-select_streams',spec,'-show_packets','-show_entries','packet=pts_time,duration_time','-of','json',file]));
  return Math.max(0,...(json.packets||[]).map(p=>Number(p.pts_time||0)+Number(p.duration_time||0)));
};
const packetHashes=(file,spec)=>{
  const json=JSON.parse(run(ffprobe,['-v','error','-select_streams',spec,'-show_packets','-show_data_hash','sha256','-show_entries','packet=data_hash','-of','json',file]));
  return (json.packets||[]).map(p=>p.data_hash).filter(Boolean);
};
const frameMd5=(file,spec,time='2.0')=>run(ffmpeg,['-v','error','-ss',time,'-i',file,'-map',spec,'-frames:v','1','-f','md5','-']).trim();
const within=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const assert=(condition,message)=>{if(!condition)throw new Error(message);};

const manifest=JSON.parse(readFileSync(join(packDir,'device-acceptance-cases.json'),'utf8'));
const source=join(packDir,manifest.source);
assert(existsSync(source),'source fixture missing: '+source);
assert(existsSync(outputDir),'device output directory missing: '+outputDir);

const files=readdirSync(outputDir).filter(name=>!name.startsWith('.'));
const findCaseFile=expected=>{
  const exact=join(outputDir,expected);
  if(existsSync(exact))return exact;
  const id=expected.split('-').slice(0,2).join('-');
  const candidates=files.filter(name=>name.startsWith(id+'-')||name.startsWith(id+'.'));
  if(candidates.length===1)return join(outputDir,candidates[0]);
  if(!candidates.length)throw new Error(id+': output file missing; expected '+expected);
  throw new Error(id+': multiple candidate outputs found: '+candidates.join(', '));
};

const results=[];
const sourceInfo=probe(source);
const sourceVideoHashes=packetHashes(source,'v:0');

for(const testCase of manifest.cases){
  const file=findCaseFile(testCase.output);
  const info=probe(file);
  const streams=info.streams||[];
  const videos=streams.filter(s=>s.codec_type==='video');
  const audios=streams.filter(s=>s.codec_type==='audio');
  const subtitles=streams.filter(s=>s.codec_type==='subtitle');
  const attachments=streams.filter(s=>s.codec_type==='attachment');
  const fail=message=>{throw new Error(testCase.id+': '+message);};

  switch(testCase.id){
    case 'V4D-01':
      if(videos.length!==1)fail('expected exactly one video stream, got '+videos.length);
      if(audios.length!==0)fail('expected no audio streams, got '+audios.length);
      if(videos[0].codec_name!=='h264')fail('expected H.264 output');
      if(Number(videos[0].width)!==240||Number(videos[0].height)!==136)fail('expected selected v:1 dimensions 240x136');
      break;

    case 'V4D-02':
      if(videos.length!==2)fail('expected two video streams, got '+videos.length);
      if(audios.length!==0)fail('expected no audio');
      if(videos.some(v=>v.codec_name!=='h264'))fail('both videos must be H.264');
      if(Number(videos[0].width)!==320||Number(videos[0].height)!==180)fail('v:0 dimensions changed');
      if(Number(videos[1].width)!==240||Number(videos[1].height)!==136)fail('v:1 dimensions changed');
      break;

    case 'V4D-03': {
      if(videos.length!==2)fail('expected two hard-subbed video streams');
      if(audios.length!==0)fail('expected no audio');
      const src0=frameMd5(source,'0:v:0');
      const src1=frameMd5(source,'0:v:1');
      const out0=frameMd5(file,'0:v:0');
      const out1=frameMd5(file,'0:v:1');
      if(src0===out0)fail('v:0 frame matches source while burn.ass is active');
      if(src1===out1)fail('v:1 frame matches source while burn.ass is active');
      break;
    }

    case 'V4D-04':
      if(!/mp4|mov/.test(String(info.format?.format_name||'')))fail('output is not an MP4-family container');
      if(videos.length!==1||audios.length!==1)fail('expected exactly one video and one audio stream');
      if(videos[0].codec_name!=='h264')fail('expected H.264 video');
      if(Number(videos[0].width)!==240||Number(videos[0].height)!==136)fail('expected selected v:1 dimensions 240x136');
      if(audios[0].codec_name!=='aac')fail('expected copied AAC audio');
      break;

    case 'V4D-05': {
      if(videos.length!==1||audios.length!==2)fail('expected one video and two full audio tracks');
      const ve=packetEnd(file,'v:0');
      const ae0=packetEnd(file,'a:0');
      const ae1=packetEnd(file,'a:1');
      if(!within(ve,1.7,2.3))fail('trimmed video end should be about 2 s, got '+ve);
      if(!within(ae0,5.6,6.4)||!within(ae1,5.6,6.4))fail('audio tracks were not preserved at full length: '+ae0+', '+ae1);
      break;
    }

    case 'V4D-06': {
      if(videos.length!==1||audios.length!==2)fail('expected one video and two trimmed audio tracks');
      const ve=packetEnd(file,'v:0');
      const ae0=packetEnd(file,'a:0');
      const ae1=packetEnd(file,'a:1');
      if(!within(ve,5.6,6.4))fail('video was not preserved at full length: '+ve);
      if(!within(ae0,1.7,2.3)||!within(ae1,1.7,2.3))fail('audio tracks were not trimmed to about 2 s: '+ae0+', '+ae1);
      break;
    }

    case 'V4D-07': {
      if(videos.length!==1||audios.length!==1)fail('expected one copied video and one transcoded audio track');
      if(videos[0].codec_name!=='h264'||audios[0].codec_name!=='aac')fail('unexpected output codecs');
      const copied=packetHashes(file,'v:0');
      if(!copied.length)fail('no video packet hashes found');
      if(copied.length!==sourceVideoHashes.length)fail('full-range Stream Copy changed video packet count');
      for(let i=0;i<copied.length;i++)if(copied[i]!==sourceVideoHashes[i])fail('video packet hash mismatch at packet '+i);
      break;
    }

    case 'V4D-08': {
      if(videos.length!==1)fail('expected one trimmed video');
      if(audios.length!==0)fail('expected no audio');
      if(subtitles.length!==1)fail('expected one preserved soft-subtitle stream');
      if(attachments.length!==1)fail('expected one preserved attachment');
      const ve=packetEnd(file,'v:0');
      const se=packetEnd(file,'s:0');
      if(!within(ve,1.7,2.3))fail('video should be trimmed to about 2 s, got '+ve);
      if(se<5.5)fail('soft subtitles did not remain on the full source timeline: '+se);
      if((info.chapters||[]).length!==2)fail('expected two preserved chapters');
      if(String(info.format?.tags?.title||'')!=='STREAM PLAN V4 DEVICE FIXTURE')fail('source metadata title was not preserved');
      if(String(attachments[0].tags?.filename||'')!=='attachment.txt')fail('attachment filename was not preserved');
      break;
    }

    default:
      fail('unknown verifier case');
  }

  // Decode all timed A/V streams. Structural streams are validated above.
  run(ffmpeg,['-v','error','-i',file,'-map','0:v','-map','0:a?','-f','null','-']);
  results.push({id:testCase.id,file:basename(file),ok:true});
}

process.stdout.write(JSON.stringify({
  schema:'quick-hardsub-device-acceptance-result/1',
  source:basename(source),
  outputDir,
  passed:results.length,
  total:manifest.cases.length,
  results
},null,2)+'\n');
