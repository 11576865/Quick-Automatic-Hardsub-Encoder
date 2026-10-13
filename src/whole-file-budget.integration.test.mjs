import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileTask,taskSourceArgs} from './media-task.js';
import {outputReport} from './media-planning.js';
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',maxBuffer:16*1024*1024});
const enabled=process.env.FFMPEG_INTEGRATION==='1';
test('real whole-container gate includes copied audio, subtitle and attachment payload',{skip:!enabled},()=>{
 const dir=mkdtempSync(join(tmpdir(),'qhe-whole-budget-'));
 try{
  const source=join(dir,'source.mkv'),output=join(dir,'output.mkv');
  writeFileSync(join(dir,'subtitle.srt'),'1\n00:00:00,100 --> 00:00:01,500\nBudget subtitle\n\n2\n00:00:00,700 --> 00:00:01,100\nInside trim\n');
  const attached=Buffer.alloc(4000,42);writeFileSync(join(dir,'attachment.bin'),attached);
  run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=12:duration=2','-f','lavfi','-i','sine=sample_rate=48000:duration=2','-i',join(dir,'subtitle.srt'),'-map','0:v','-map','1:a','-map','2:s','-c:v','libx264','-preset','ultrafast','-c:a','flac','-c:s','srt','-attach',join(dir,'attachment.bin'),'-metadata:s:t','mimetype=application/octet-stream',source]);
  const info=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',source]));
  const packetCost=spec=>JSON.parse(run('ffprobe',['-v','error','-select_streams',spec,'-show_packets','-show_entries','packet=size','-of','json',source])).packets.reduce((sum,p)=>sum+Number(p.size),0);
  const evidence={version:1,scope:'full-source',audioPacketBytes:[packetCost('a')],subtitlePacketBytes:[packetCost('s')],attachmentBytes:[Number(info.streams.find(s=>s.codec_type==='attachment').extradata_size)]};
  assert.equal(evidence.attachmentBytes[0],attached.length);
  const task=compileTask({operation:'transcode',codec:'h264',encoder:'libx264',preset:'medium',rateMode:'size',targetSize:.3,sizeUnit:'MB',budgetPolicy:'strict-ceiling',start:0,end:'',audio:'copy',keepSubtitles:true,keepAttachments:true,keepMetadata:true,fpsMode:'auto',pixelFormat:'yuv420p',rotation:'none',deinterlace:'none'},{duration:2,fps:12,videoTracks:1,audioTracks:1,subtitleTracks:1,attachmentTracks:1,formatName:'matroska',audioCodecs:['flac'],budgetEvidence:evidence});
  assert.equal(task.sizePlan.fixedPayloadBytes,evidence.audioPacketBytes[0]+evidence.subtitlePacketBytes[0]+attached.length);
  run('ffmpeg',['-v','error','-y',...taskSourceArgs(task,source),...task.outputArgs,'-f',task.outputFormat,output]);
  run('ffmpeg',['-v','error','-xerror','-i',output,'-map','0:v','-map','0:a','-f','null','-']);
  const bytes=statSync(output).size;
  assert.equal(outputReport(task,{outputBytes:bytes,verified:true},1).deliveryAllowed,bytes<=task.sizeCeilingBytes);
  assert.equal(outputReport({...task,sizeCeilingBytes:bytes-1},{outputBytes:bytes,verified:true},1).deliveryAllowed,false);
  assert.equal(outputReport({...task,sizeCeilingBytes:bytes},{outputBytes:bytes,verified:true},1).deliveryAllowed,true);
  const trimmed=compileTask({...task,start:0.5,end:1.5},{duration:2,fps:12,videoTracks:1,audioTracks:1,subtitleTracks:1,attachmentTracks:1,formatName:'matroska',audioCodecs:['flac'],budgetEvidence:evidence});
  assert.equal(trimmed.sizePlan.copiedTrimReserveBytes,evidence.audioPacketBytes[0]+evidence.subtitlePacketBytes[0]);
  assert.equal(trimmed.sizePlan.fixedPayloadBytes,task.sizePlan.fixedPayloadBytes);
  const trimOutput=join(dir,'trim-output.mkv');
  run('ffmpeg',['-v','error','-y',...taskSourceArgs(trimmed,source),...trimmed.outputArgs,'-f',trimmed.outputFormat,trimOutput]);
  run('ffmpeg',['-v','error','-xerror','-i',trimOutput,'-map','0:v','-map','0:a','-f','null','-']);
  const trimPackets=spec=>JSON.parse(run('ffprobe',['-v','error','-select_streams',spec,'-show_packets','-show_entries','packet=size','-of','json',trimOutput])).packets.reduce((sum,p)=>sum+Number(p.size),0);
  assert.ok(trimPackets('a')>0 && trimPackets('a')<=evidence.audioPacketBytes[0]);
  assert.ok(trimPackets('s')>0 && trimPackets('s')<=evidence.subtitlePacketBytes[0]);
  const trimBytes=statSync(trimOutput).size;
  assert.equal(outputReport(trimmed,{outputBytes:trimBytes,verified:true},1).deliveryAllowed,trimBytes<=trimmed.sizeCeilingBytes);

 }finally{rmSync(dir,{recursive:true,force:true});}
});
