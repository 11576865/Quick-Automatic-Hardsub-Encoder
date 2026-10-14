import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {taskSourceArgs} from './media-task.js';
import {hardsubReferenceFilter} from './media-verification.js';
import {compileGuidedCpuHandoff,commitGuidedCpuHandoff} from './guided-cpu-compiler-contract.js';

const enabled=process.env.QHE_WU01_REAL_FFMPEG==='1';
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',maxBuffer:16*1024*1024,timeout:90000});
const ASS=[
 '[Script Info]','ScriptType: v4.00+','PlayResX: 320','PlayResY: 180',
 '[V4+ Styles]',
 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
 'Style: Default,DejaVu Sans,38,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,12,1',
 '[Events]',
 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
 'Dialogue: 0,0:00:00.50,0:00:02.50,Default,,0,0,0,,WU-01 SOURCE-BOUND ASS'
].join('\n')+'\n';

test('real FFmpeg Guided-to-Manual CPU hardsub output and libass render order',{
 skip:!enabled,timeout:180000
},()=>{
 const dir=mkdtempSync(join(tmpdir(),'qhe-wu01-'));
 try{
  const source=join(dir,'source.mkv'),ass=join(dir,'reference.ass'),
    blank=join(dir,'blank.ass'),output=join(dir,'output.mkv'),
    plain=join(dir,'no-events.mkv');
  run('ffmpeg',['-hide_banner','-v','error','-nostdin','-y',
    '-f','lavfi','-i','testsrc2=size=320x180:rate=12:duration=3',
    '-c:v','ffv1','-pix_fmt','yuv420p',source]);
  writeFileSync(ass,ASS);writeFileSync(blank,ASS.replace(/^Dialogue:.*\n/m,''));
  const media={duration:3,fps:12,videoTracks:1,audioTracks:0};
  const defaults={operation:'hardsub',fpsMode:'auto',pixelFormat:'yuv420p',
    rotation:'none',deinterlace:'none',audio:'none',crop:'',codecParams:'',
    lookahead:'',maxrate:'',bufsize:'',gop:'',bf:'',refs:'',
    sampleLength:'15',squarePixels:false};
  const plan={codec:'h264',mode:'budget-rate',goal:'sizeBudget',preset:'medium',
    sizeBudgetPolicy:'best-effort',sizeCeiling:300000,targetVideoBitrate:768000,
    containerReserveBytes:12000,fixedPayloadBytes:0,encodedAudioBytes:0,
    outputWidth:160,outputHeight:90};
  const contract=compileGuidedCpuHandoff({
    snapshot:{plan,audio:{audio:'none'},container:'mkv'},
    defaults,media,sourceKey:'wu01-same-source'
  });
  assert.equal(contract.ok,true,contract.detail||contract.reason);
  let form={...defaults,codec:'h265',encoder:'libx265'};
  const applied=commitGuidedCpuHandoff({
    contract,media,expectedSourceIdentity:'wu01-same-source',
    sourceIdentity:()=> 'wu01-same-source',
    read:()=>({...form}),apply:s=>{form={...s};}
  });
  assert.equal(applied.ok,true,applied.detail||applied.reason);
  const task=applied.task;
  assert.equal(task.version,4);
  assert.equal(task.encoder,'libx264');
  assert.equal(task.expectedWidth,160);assert.equal(task.expectedHeight,90);
  assert.equal(task.bitrate,768000);
  assert.equal(task.sizePlan.targetBytes,300000);
  assert.equal(task.subtitleRenderOrder,'before-scale');
  assert.equal(applied.requiresFreshExecutionValidation,true);
  const vf=task.outputArgs[task.outputArgs.indexOf('-vf')+1];
  assert.equal(vf,'ass=__ASS__:fontsdir=__FONTS__,scale=160:90:flags=bicubic,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0');
  const encode=(sub,filename)=>{
    const args=task.outputArgs.map(arg=>arg.replace('__ASS__',sub).replace('__FONTS__',dir));
    run('ffmpeg',['-hide_banner','-v','error','-nostdin','-y',
      ...taskSourceArgs(task,source),...args,'-f',task.outputFormat,filename]);
  };
  encode(ass,output);encode(blank,plain);
  const video=JSON.parse(run('ffprobe',['-v','error',
    '-select_streams','v:0','-show_entries','stream=codec_name,width,height,pix_fmt',
    '-of','json',output])).streams[0];
  assert.equal(video.codec_name,'h264');assert.equal(video.width,160);
  assert.equal(video.height,90);assert.equal(video.pix_fmt,'yuv420p');
  run('ffmpeg',['-v','error','-i',output,'-map','0:v:0','-f','null','-']);
  const md5=file=>run('ffmpeg',['-v','error','-ss','1','-i',file,
    '-map','0:v:0','-frames:v','1','-f','md5','-']).trim();
  assert.notEqual(md5(output),md5(plain),
    'Actual output must differ when the same job lacks all subtitle events');
  const ref=hardsubReferenceFilter(task,1,ass,dir);
  assert.ok(ref.indexOf('ass=')<ref.indexOf('scale=160:90'));
  const rendered=vf=>run('ffmpeg',['-v','error','-ss','1','-i',source,
    '-vf',vf,'-frames:v','1','-pix_fmt','yuv420p','-f','md5','-']).trim();
  const expectedFrame=rendered(ref);
  const wrongFrame=rendered('scale=160:90:flags=bicubic,ass='+ass+
    ':fontsdir='+dir+',pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0');
  assert.notEqual(expectedFrame,wrongFrame,
    'Fixture must distinguish source-space ASS from output-space ASS');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
