import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileTask,taskSourceArgs,firstPassArgs} from './media-task.js';

const requireTimelineShift=ass=>readFileSync(ass,'utf8').replace('0:00:00.00,0:00:04.00','0:00:01.50,0:00:02.50');
const enabled=process.env.FFMPEG_INTEGRATION==='1';
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',maxBuffer:16*1024*1024});
const packetEnd=(file,spec)=>{
  const json=JSON.parse(run('ffprobe',['-v','error','-select_streams',spec,'-show_packets','-show_entries','packet=pts_time,duration_time','-of','json',file]));
  return Math.max(0,...(json.packets||[]).map(p=>Number(p.pts_time||0)+Number(p.duration_time||0)));
};

test('real FFmpeg preserves legacy transcode, hardsub, two-pass and packet-identical fast cut under schema v4',{skip:!enabled},()=>{
 const dir=mkdtempSync(join(tmpdir(),'media-task-legacy-v4-'));
 try {
  const source=join(dir,'source.mkv');
  run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','4','-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-preset','ultrafast','-g','30','-keyint_min','30','-sc_threshold','0','-bf','0','-c:a','aac',source]);
  const media={
    duration:4,fps:30,videoTracks:1,
    videoStreams:[{ordinal:0,codec:'h264',width:160,height:90,fps:30,pixelFormat:'yuv420p',bitDepth:8,unsafeColorPipeline:false}],
    audioTracks:2,formatName:'matroska,webm',sourceName:'source.mkv',videoCodec:'h264',audioCodec:'aac',audioCodecs:['aac','aac'],
    audioStreams:[{ordinal:0,codec:'aac'},{ordinal:1,codec:'aac'}]
  };
  const base={
    operation:'transcode',codec:'h264',encoder:'libx264',preset:'ultrafast',rateMode:'quality',quality:23,
    start:0,end:'',videoStreams:'0',videoRange:'trim',audio:'copy',audioTrack:'all',audioRange:'trim',subtitleRange:'trim',
    fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'lanczos',rotation:'none',deinterlace:'none',
    multipass:'fullres',lookahead:'',aqStrength:''
  };
  const execute=(task,name,ass='')=>{
    const output=join(dir,name+'.'+task.outputExtension);
    const args=task.outputArgs.map(a=>a.replace('__ASS__',ass).replace('__FONTS__',dir));
    if(task.twoPass){
      run('ffmpeg',['-v','error','-y',...taskSourceArgs(task,source),...firstPassArgs(args),'-pass','1','-passlogfile',join(dir,'stats'),'-f','null','-']);
      args.push('-pass','2','-passlogfile',join(dir,'stats'));
    }
    run('ffmpeg',['-v','error','-y',...taskSourceArgs(task,source),...args,'-f',task.outputFormat,output]);
    return {output,info:JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output]))};
  };

  const transcodeTask=compileTask({...base,width:128,height:72,fpsMode:'cfr',fps:24,start:1,end:3,audioTrack:'1'},media);
  assert.equal(transcodeTask.outputContainer,'mp4');
  const transcode=execute(transcodeTask,'transcode');
  const video=transcode.info.streams.find(s=>s.codec_type==='video');
  assert.equal(video.width,128);assert.equal(video.height,72);assert.equal(video.avg_frame_rate,'24/1');
  assert.equal(transcode.info.streams.filter(s=>s.codec_type==='audio').length,1);
  assert.ok(Math.abs(Number(transcode.info.format.duration)-2)<.1, JSON.stringify(transcode.info));

  const tenbit=execute(compileTask({...base,pixelFormat:'yuv420p10le',audio:'none'},media),'tenbit');
  assert.equal(tenbit.info.streams[0].pix_fmt,'yuv420p10le');

  const budget=execute(compileTask({...base,preset:'medium',rateMode:'size',targetSize:1,sizeUnit:'MB',sizeReserve:4,twoPass:true,audio:'aac',audioBitrate:96000,audioTrack:'0',audioChannels:2,width:128,height:72,fpsMode:'cfr',fps:60},media),'two-pass');
  assert.equal(budget.info.streams[0].avg_frame_rate,'60/1');assert.equal(budget.info.streams[0].width,128);
  assert.equal(budget.info.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
  assert.ok(Number(budget.info.format.size)<1000000);assert.ok(Math.abs(Number(budget.info.format.duration)-4)<.1);

  const legacy=execute(compileTask({...base,legacyFps:true,fpsMode:'cfr',fps:60,audio:'none'},media),'legacy');
  assert.equal(legacy.info.streams[0].avg_frame_rate,'60/1');

  const opus=execute(compileTask({...base,audio:'libopus',audioBitrate:96000,audioTrack:'0',audioChannels:2,audioSampleRate:48000},media),'opus');
  assert.equal(opus.info.streams.find(s=>s.codec_type==='audio').codec_name,'opus');

  const scrubFrame=time=>run('ffmpeg',['-v','error','-ss',String(time),'-i',source,'-map','0:v:0','-an','-sn','-frames:v','1','-vf','scale=72:-2:force_original_aspect_ratio=decrease','-f','md5','-']);
  const scrubA=scrubFrame(.5),scrubB=scrubFrame(2.5);
  assert.match(scrubA,/MD5=/);assert.match(scrubB,/MD5=/);assert.notEqual(scrubA,scrubB);

  const keyframes=run('ffprobe',['-v','error','-skip_frame','nokey','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','csv=p=0',source]).split('\n').map(l=>parseFloat(l)).filter(n=>Number.isFinite(n)&&n<=1.4);
  const actual=Math.max(...keyframes);
  assert.ok(actual<=1.4&&actual>.9);
  const copyTask=compileTask({...base,operation:'copy',start:actual,end:3,outputContainer:'keep'},media);
  assert.equal(copyTask.outputContainer,'mkv');
  const copy=execute(copyTask,'copy');
  const hashes=file=>JSON.parse(run('ffprobe',['-v','error','-select_streams','v:0','-show_packets','-show_data_hash','sha256','-show_entries','packet=data_hash','-of','json',file])).packets.map(p=>p.data_hash);
  const original=hashes(source),copied=hashes(copy.output);
  assert.ok(copied.length>0);assert.ok(original.includes(copied[0]));
  const offset=original.indexOf(copied[0]);assert.deepEqual(copied,original.slice(offset,offset+copied.length));

  const ass=join(dir,'subtitle.ass');
  writeFileSync(ass,'[Script Info]\nScriptType: v4.00+\nPlayResX: 160\nPlayResY: 90\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,18,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,2,2,2,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:04.00,Default,,0,0,0,,VISIBLE SUBTITLE\n');
  const hard=execute(compileTask({...base,operation:'hardsub',audio:'none'},media),'hardsub',ass);
  const plain=execute(compileTask({...base,audio:'none'},media),'plain');
  const frame=file=>run('ffmpeg',['-v','error','-ss','1','-i',file,'-frames:v','1','-f','md5','-']);
  assert.notEqual(frame(hard.output),frame(plain.output));

  writeFileSync(ass, requireTimelineShift(ass));
  const clippedHard=execute(compileTask({...base,operation:'hardsub',start:1,end:3,audio:'none'},media),'clipped-hard',ass);
  const clippedPlain=execute(compileTask({...base,start:1,end:3,audio:'none'},media),'clipped-plain');
  assert.notEqual(frame(clippedHard.output),frame(clippedPlain.output));
  run('ffmpeg',['-v','error','-i',copy.output,'-map','0','-f','null','-']);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('real FFmpeg executes schema-v4 multi-stream selection, remux+transcode and independent timelines',{skip:!enabled},()=>{
 const dir=mkdtempSync(join(tmpdir(),'media-task-v4-'));
 try {
  const source=join(dir,'source.mkv');
  run('ffmpeg',[
    '-v','error','-y',
    '-f','lavfi','-i','testsrc2=size=160x90:rate=30:duration=4',
    '-f','lavfi','-i','testsrc=size=120x68:rate=24:duration=4',
    '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=4',
    '-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=4',
    '-map','0:v','-map','1:v','-map','2:a','-map','3:a',
    '-c:v','libx264','-preset','ultrafast','-g','30','-keyint_min','24','-sc_threshold','0','-bf','0',
    '-c:a','aac','-b:a','64k','-t','4',source
  ]);

  const media={
    duration:4,fps:30,videoTracks:2,
    videoStreams:[
      {ordinal:0,codec:'h264',width:160,height:90,fps:30,pixelFormat:'yuv420p',bitDepth:8,unsafeColorPipeline:false},
      {ordinal:1,codec:'h264',width:120,height:68,fps:24,pixelFormat:'yuv420p',bitDepth:8,unsafeColorPipeline:false}
    ],
    audioTracks:2,audioCodec:'aac',audioCodecs:['aac','aac'],
    audioStreams:[{ordinal:0,codec:'aac',bitRate:64000},{ordinal:1,codec:'aac',bitRate:64000}],
    formatName:'matroska,webm',sourceName:'source.mkv',videoCodec:'h264'
  };
  const base={
    operation:'transcode',codec:'h264',encoder:'libx264',preset:'ultrafast',rateMode:'quality',quality:30,
    start:0,end:'',videoStreams:'0',videoRange:'trim',
    audio:'copy',audioTrack:'all',audioRange:'trim',subtitleRange:'trim',
    fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'lanczos',rotation:'none',deinterlace:'none',
    multipass:'fullres',lookahead:'',aqStrength:'',outputContainer:'mkv'
  };

  const execute=(task,name,ass='')=>{
    const output=join(dir,name+'.'+task.outputExtension);
    const args=task.outputArgs.map(a=>a.replace('__ASS__',ass).replace('__FONTS__',dir));
    if(task.twoPass){
      run('ffmpeg',['-v','error','-y',...taskSourceArgs(task,source),...firstPassArgs(args),'-pass','1','-passlogfile',join(dir,'stats'),'-f','null','-']);
      args.push('-pass','2','-passlogfile',join(dir,'stats'));
    }
    run('ffmpeg',['-v','error','-y',...taskSourceArgs(task,source),...args,'-f',task.outputFormat,output]);
    return {output,info:JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output]))};
  };

  // Select exactly the second video stream and transcode only that stream.
  const second=execute(compileTask({...base,videoStreams:'1',audio:'none'},media),'second-only');
  assert.equal(second.info.streams.filter(s=>s.codec_type==='video').length,1);
  assert.equal(second.info.streams.find(s=>s.codec_type==='video').width,120);
  assert.equal(second.info.streams.find(s=>s.codec_type==='video').height,68);

  // Select both video streams; the same explicit transcode plan applies to both outputs.
  const both=execute(compileTask({...base,videoStreams:'0,1',audio:'none'},media),'both-video');
  assert.equal(both.info.streams.filter(s=>s.codec_type==='video').length,2);
  assert.deepEqual(
    both.info.streams.filter(s=>s.codec_type==='video').map(s=>[s.width,s.height]),
    [[160,90],[120,68]]
  );

  // Multi-video editing can also preserve the selected video bitstreams.
  const copiedBoth=execute(compileTask({
    ...base,operation:'copy',videoStreams:'0,1',start:1,end:3,audio:'none',outputContainer:'mkv'
  },media),'copy-both-video');
  assert.equal(copiedBoth.info.streams.filter(s=>s.codec_type==='video').length,2);
  assert.ok(Number(copiedBoth.info.format.duration)<3.2, JSON.stringify(copiedBoth.info.format));

  // Remux + Transcode: Matroska input -> MP4, selected video is re-encoded while AAC is Stream Copied.
  const remuxTranscode=execute(compileTask({
    ...base,videoStreams:'1',audio:'copy',audioTrack:'0',outputContainer:'mp4'
  },media),'remux-transcode');
  assert.match(remuxTranscode.info.format.format_name,/mp4|mov/);
  assert.equal(remuxTranscode.info.streams.filter(s=>s.codec_type==='video').length,1);
  assert.equal(remuxTranscode.info.streams.filter(s=>s.codec_type==='audio').length,1);
  assert.equal(remuxTranscode.info.streams.find(s=>s.codec_type==='audio').codec_name,'aac');

  // Video-only trim: video receives [1,3], audio remains the full four seconds.
  const videoTrim=execute(compileTask({
    ...base,videoStreams:'0',start:1,end:3,videoRange:'trim',audioRange:'full',audio:'copy',outputContainer:'mkv'
  },media),'video-trim-audio-full');
  const videoTrimEnd=packetEnd(videoTrim.output,'v:0');
  const fullAudioEnd=packetEnd(videoTrim.output,'a:0');
  assert.ok(videoTrimEnd>1.7 && videoTrimEnd<2.3, String(videoTrimEnd));
  assert.ok(fullAudioEnd>3.7 && fullAudioEnd<4.3, String(fullAudioEnd));
  assert.ok(Number(videoTrim.info.format.duration)>3.7);

  // The inverse combination is also legal: full video with trimmed audio.
  const audioTrim=execute(compileTask({
    ...base,videoStreams:'0',start:1,end:3,videoRange:'full',audioRange:'trim',audio:'copy',outputContainer:'mkv'
  },media),'video-full-audio-trim');
  assert.ok(packetEnd(audioTrim.output,'v:0')>3.7);
  const audioTrimEnd=packetEnd(audioTrim.output,'a:0');
  assert.ok(audioTrimEnd>1.7 && audioTrimEnd<2.3, String(audioTrimEnd));

  // Video Stream Copy + audio transcode is a supported hybrid task.
  const hybrid=execute(compileTask({
    ...base,operation:'copy',videoStreams:'0',audio:'aac',audioTrack:'1',audioBitrate:96000,outputContainer:'mkv'
  },media),'copy-video-transcode-audio');
  assert.equal(hybrid.info.streams.find(s=>s.codec_type==='video').codec_name,'h264');
  assert.equal(hybrid.info.streams.find(s=>s.codec_type==='audio').codec_name,'aac');

  const ass=join(dir,'subtitle.ass');
  writeFileSync(ass,'[Script Info]\nScriptType: v4.00+\nPlayResX: 160\nPlayResY: 90\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,18,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,2,2,2,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:04.00,Default,,0,0,0,,VISIBLE SUBTITLE\n');

  // Hard-sub can target multiple concrete video streams in one container task.
  const hardBoth=execute(compileTask({...base,operation:'hardsub',videoStreams:'0,1',audio:'none'},media),'hardsub-both',ass);
  assert.equal(hardBoth.info.streams.filter(s=>s.codec_type==='video').length,2);
  const frameMd5=(file,ordinal)=>run('ffmpeg',['-v','error','-ss','1','-i',file,'-map','0:v:'+ordinal,'-frames:v','1','-f','md5','-']);
  assert.notEqual(frameMd5(hardBoth.output,0),frameMd5(both.output,0));
  assert.notEqual(frameMd5(hardBoth.output,1),frameMd5(both.output,1));

  // Sanity: final outputs are actually decodable.
  for(const file of [second.output,both.output,copiedBoth.output,remuxTranscode.output,videoTrim.output,audioTrim.output,hybrid.output,hardBoth.output]){
    run('ffmpeg',['-v','error','-i',file,'-map','0','-f','null','-']);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
