import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileTask,taskSourceArgs} from './media-task.js';
import {assessGuidedWholeFileBudget} from './guided-whole-file-budget.js';
import {outputReport} from './media-planning.js';

const enabled=process.env.FFMPEG_INTEGRATION==='1';
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',maxBuffer:16*1024*1024});
const inspect=file=>JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));
const packetBytes=(file,selector)=>{
  const result=JSON.parse(run('ffprobe',['-v','error','-select_streams',selector,
    '-show_packets','-show_entries','packet=size','-of','json',file]));
  return (result.packets||[]).reduce((sum,p)=>sum+Number(p.size),0);
};
const frameMd5=file=>run('ffmpeg',['-v','error','-ss','1','-i',file,
  '-map','0:v:0','-frames:v','1','-f','md5','-']);

test('Guided ASS uses measured copied audio and the formal whole-file compiler on a real multi-stream MKV',
  {skip:!enabled},()=>{
  const dir=mkdtempSync(join(tmpdir(),'qhe-guided-real-budget-'));
  try{
    const source=join(dir,'source.mkv'),out=join(dir,'guided.mkv'),plain=join(dir,'plain.mkv');
    const subs=join(dir,'source.srt'),attachment=join(dir,'asset.txt'),ass=join(dir,'burn.ass');
    writeFileSync(subs,'1\n00:00:00,100 --> 00:00:02,900\nSOFT SOURCE SUBTITLE\n\n');
    writeFileSync(attachment,'source attachment, deliberately not carried into Guided ASS\n');
    writeFileSync(ass,'[Script Info]\nScriptType: v4.00+\nPlayResX: 160\nPlayResY: 90\n'+
      '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'+
      'Style: Default,DejaVu Sans,18,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,2,2,2,1\n'+
      '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'+
      'Dialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,BURNED GUIDED ASS\n');
    run('ffmpeg',['-v','error','-y',
      '-f','lavfi','-i','testsrc2=size=160x90:rate=12:duration=3',
      '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3',
      '-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=3',
      '-i',subs,'-map','0:v','-map','1:a','-map','2:a','-map','3:s',
      '-c:v','libx264','-preset','ultrafast','-c:a','aac','-b:a','64000',
      '-c:s','srt','-attach',attachment,'-metadata:s:t','mimetype=text/plain',source]);
    const sourceInfo=inspect(source);
    assert.equal(sourceInfo.streams.filter(s=>s.codec_type==='audio').length,2);
    assert.equal(sourceInfo.streams.filter(s=>s.codec_type==='subtitle').length,1);
    assert.equal(sourceInfo.streams.filter(s=>s.codec_type==='attachment').length,1);
    const evidence={version:1,scope:'full-source',
      audioPacketBytes:[packetBytes(source,'a:0'),packetBytes(source,'a:1')]};
    assert.ok(evidence.audioPacketBytes.every(n=>n>0));
    const duration=Number(sourceInfo.streams.find(s=>s.codec_type==='video').duration||
      sourceInfo.format.duration);
    const media={duration,fps:12,videoTracks:1,audioTracks:2,
      subtitleTracks:1,attachmentTracks:1,sourceName:'source.mkv',
      formatName:'matroska',videoCodec:'h264',audioCodecs:['aac','aac']};
    const raw={operation:'hardsub',codec:'h264',encoder:'libx264',preset:'medium',
      start:0,end:'',videoRange:'full',audioRange:'full',subtitleRange:'full',
      audio:'copy',audioTrack:'all',keepSubtitles:false,keepAttachments:false,
      keepMetadata:false,keepChapters:false,fpsMode:'auto',pixelFormat:'yuv420p',
      rotation:'none',deinterlace:'none',outputContainer:'mkv',
      rateMode:'size',targetSize:.35,sizeUnit:'MB',sizeReserve:4,
      budgetPolicy:'best-effort'};
    const targetBytes=350000;
    assert.equal(assessGuidedWholeFileBudget({targetBytes,media,audio:{audio:'copy'}}).status,'unknown');
    const bad=assessGuidedWholeFileBudget({targetBytes,media,audio:{audio:'copy'},
      evidence:{...evidence,audioPacketBytes:[evidence.audioPacketBytes[0]]}});
    assert.equal(bad.status,'unknown');
    const admission=assessGuidedWholeFileBudget({targetBytes,media,audio:{audio:'copy'},evidence});
    assert.equal(admission.status,'feasible',JSON.stringify(admission));
    const task=compileTask(raw,{...media,budgetEvidence:evidence});
    assert.equal(admission.availableVideoBitrate,task.bitrate);
    assert.equal(admission.fixedPayloadBytes,task.sizePlan.fixedPayloadBytes);
    assert.equal(admission.fixedPayloadBytes,evidence.audioPacketBytes.reduce((a,b)=>a+b,0));
    assert.equal(admission.containerReserveBytes,task.sizePlan.containerReserveBytes);
    const outputArgs=task.outputArgs.map(a=>a.replace('__ASS__',ass).replace('__FONTS__',dir));
    run('ffmpeg',['-v','error','-y',...taskSourceArgs(task,source),...outputArgs,
      '-f',task.outputFormat,out]);
    const result=inspect(out);
    assert.equal(result.streams.filter(s=>s.codec_type==='video').length,1);
    assert.equal(result.streams.filter(s=>s.codec_type==='audio').length,2);
    assert.equal(result.streams.filter(s=>s.codec_type==='subtitle').length,0);
    assert.equal(result.streams.filter(s=>s.codec_type==='attachment').length,0);
    assert.equal(packetBytes(out,'a:0'),evidence.audioPacketBytes[0]);
    assert.equal(packetBytes(out,'a:1'),evidence.audioPacketBytes[1]);
    run('ffmpeg',['-v','error','-xerror','-i',out,'-map','0:v:0','-map','0:a',
      '-f','null','-']);
    const plainTask=compileTask({...raw,operation:'transcode'}, {...media,budgetEvidence:evidence});
    run('ffmpeg',['-v','error','-y',...taskSourceArgs(plainTask,source),
      ...plainTask.outputArgs,'-f',plainTask.outputFormat,plain]);
    assert.notEqual(frameMd5(out),frameMd5(plain),'ASS pixels must visibly differ from the plain output');
    const bytes=statSync(out).size;
    assert.equal(outputReport(task,{outputBytes:bytes,verified:true},1).withinBudget,bytes<=targetBytes);
    assert.equal(outputReport({...task,budgetPolicy:'strict-ceiling',sizeCeilingBytes:bytes-1},
      {outputBytes:bytes,verified:true},1).deliveryAllowed,false);
    assert.equal(outputReport({...task,budgetPolicy:'strict-ceiling',sizeCeilingBytes:bytes},
      {outputBytes:bytes,verified:true},1).deliveryAllowed,true);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
