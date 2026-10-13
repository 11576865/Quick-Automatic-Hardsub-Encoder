import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {manualCandidateSet} from './manual-candidate-set.js';
import {compileTask,taskSourceArgs} from './media-task.js';
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',maxBuffer:16*1024*1024});
test('real FFmpeg encodes and fully decodes all four codec/preset task candidates',{skip:process.env.FFMPEG_INTEGRATION!=='1'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'qhe-preset-candidates-'));
 try{
  const source=join(dir,'source.mkv');
  run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=12:duration=2','-c:v','ffv1',source]);
  for(const c of manualCandidateSet('codecs-presets',{width:160,height:90}).candidates){
   const task=compileTask({operation:'transcode',start:0,end:'',rateMode:'quality',quality:28,audio:'none',fpsMode:'auto',rotation:'none',deinterlace:'none',...c},{duration:2,fps:12,videoTracks:1,audioTracks:0});
   const output=join(dir,c.id+'.mkv');
   run('ffmpeg',['-v','error','-y',...taskSourceArgs(task,source),...task.outputArgs,'-f',task.outputFormat,output]);
   const p=JSON.parse(run('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=codec_name,width,height,nb_read_frames','-of','json',output])).streams[0];
   assert.equal(p.codec_name,c.codec==='h264'?'h264':'hevc');assert.equal(p.width,160);assert.equal(p.height,90);assert.equal(p.nb_read_frames,'24');assert.ok(statSync(output).size>0);
   run('ffmpeg',['-v','error','-xerror','-i',output,'-f','null','-']);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
