import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileTask,taskInputArgs,taskDurationArgs} from './media-task.js';
const requireTimelineShift=ass=>readFileSync(ass,'utf8').replace('0:00:00.00,0:00:04.00','0:00:01.50,0:00:02.50');
const enabled=process.env.FFMPEG_INTEGRATION==='1';
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',maxBuffer:8*1024*1024});
test('real FFmpeg transcode, hardsub and packet-identical fast cut',{skip:!enabled},()=>{
 const dir=mkdtempSync(join(tmpdir(),'media-task-'));
 try {
  const source=join(dir,'source.mkv');
  run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','4','-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-preset','ultrafast','-g','30','-keyint_min','30','-sc_threshold','0','-bf','0','-c:a','aac',source]);
  const media={duration:4,fps:30,audioTracks:2};
  const base={operation:'transcode',codec:'h264',encoder:'libx264',preset:'ultrafast',rateMode:'quality',quality:23,start:0,end:'',audio:'copy',audioTrack:'all',fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'lanczos',rotation:'none',deinterlace:'none',multipass:'fullres',lookahead:'',aqStrength:''};
  const execute=(task,name,ass='')=>{
   const output=join(dir,name+'.mkv');
   const args=task.outputArgs.map(a=>a.replace('__ASS__',ass).replace('__FONTS__',dir));
   run('ffmpeg',['-v','error','-y',...taskInputArgs(task),'-i',source,...taskDurationArgs(task),...args,'-f','matroska',output]);
   return {output,info:JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output]))};
  };
  const transcode=execute(compileTask({...base,width:128,height:72,fpsMode:'cfr',fps:24,start:1,end:3,audioTrack:'1'},media),'transcode');
  const video=transcode.info.streams.find(s=>s.codec_type==='video');
  assert.equal(video.width,128);assert.equal(video.height,72);assert.equal(video.avg_frame_rate,'24/1');
  assert.equal(transcode.info.streams.filter(s=>s.codec_type==='audio').length,1);
  assert.ok(Math.abs(Number(transcode.info.format.duration)-2)<.1, JSON.stringify(transcode.info));
  const tenbit=execute(compileTask({...base,pixelFormat:'yuv420p10le',audio:'none'},media),'tenbit');
  assert.equal(tenbit.info.streams[0].pix_fmt,'yuv420p10le');
  const keyframes=run('ffprobe',['-v','error','-skip_frame','nokey','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','csv=p=0',source]).split('\n').map(l=>parseFloat(l)).filter(n=>Number.isFinite(n)&&n<=1.4);
  const actual=Math.max(...keyframes);
  assert.ok(actual<=1.4&&actual>.9);
  const copy=execute(compileTask({...base,operation:'copy',start:actual,end:3},media),'copy');
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
  // Cropping a hardsub must retain the subtitle's position on the source timeline.
  writeFileSync(ass, requireTimelineShift(ass));
  const clippedHard=execute(compileTask({...base,operation:'hardsub',start:1,end:3,audio:'none'},media),'clipped-hard',ass);
  const clippedPlain=execute(compileTask({...base,start:1,end:3,audio:'none'},media),'clipped-plain');
  assert.notEqual(frame(clippedHard.output),frame(clippedPlain.output));
  run('ffmpeg',['-v','error','-i',copy.output,'-f','null','-']);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
