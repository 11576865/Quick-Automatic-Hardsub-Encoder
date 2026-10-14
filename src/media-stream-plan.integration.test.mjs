import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileTask,taskSourceArgs} from './media-task.js';
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',maxBuffer:8e6});
const probe=file=>JSON.parse(run('ffprobe',['-v','error','-show_streams','-of','json',file]));
test('real heterogeneous audio preserves copied packet hashes and executes AAC/Opus/FLAC/drop',{skip:process.env.FFMPEG_INTEGRATION!=='1'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'qhe-stream-plan-'));
 try{
  const source=join(dir,'source.mkv');
  run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=64x64:rate=24',
   '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-f','lavfi','-i','sine=frequency=880:sample_rate=48000',
   '-f','lavfi','-i','sine=frequency=1320:sample_rate=48000','-t','1','-map','0:v','-map','1:a','-map','2:a','-map','3:a',
   '-c:v','ffv1','-c:a','flac',source]);
  const media={duration:1,fps:24,videoTracks:1,audioTracks:3,audioStreams:[{codec:'flac'},{codec:'flac'},{codec:'flac'}]};
  const base={operation:'copy',start:0,end:'',audio:'copy',audioTrack:'all',outputContainer:'mkv'};
  const plans=[
   [{sourceOrdinal:0,action:'copy'},{sourceOrdinal:1,action:'aac',bitrate:64000},{sourceOrdinal:2,action:'drop'}],
   [{sourceOrdinal:0,action:'libopus',bitrate:64000},{sourceOrdinal:2,action:'flac',channels:1}]
  ];
  const hashes=(file,index)=>JSON.parse(run('ffprobe',['-v','error','-select_streams','a:'+index,'-show_packets','-show_data_hash','sha256','-show_entries','packet=data_hash','-of','json',file])).packets.map(p=>p.data_hash);
  plans.forEach((audioPlan,index)=>{
   const task=compileTask({...base,audioPlan},media),output=join(dir,'out'+index+'.mkv');
   run('ffmpeg',['-v','error','-y',...taskSourceArgs(task,source),...task.outputArgs,'-f',task.outputFormat,output]);
   assert.deepEqual(probe(output).streams.filter(s=>s.codec_type==='audio').map(s=>s.codec_name),index===0?['flac','aac']:['opus','flac']);
   run('ffmpeg',['-v','error','-xerror','-i',output,'-map','0','-fps_mode','passthrough','-f','null','-']);
   if(index===0)assert.deepEqual(hashes(output,0),hashes(source,0));
  });
 }finally{rmSync(dir,{recursive:true,force:true});}
});
