import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { compileTask, taskSourceArgs, firstPassArgs } from '../src/media-task.js';

const packDir=resolve(process.argv[2]||'device-acceptance/stream-plan-v4-pack');
const outputDir=resolve(process.argv[3]||'device-acceptance/reference-outputs');
const ffmpeg=process.env.FFMPEG||'ffmpeg';

const manifest=JSON.parse(readFileSync(join(packDir,'device-acceptance-cases.json'),'utf8'));
const source=join(packDir,manifest.source);
const burn=join(packDir,manifest.subtitle);

rmSync(outputDir,{recursive:true,force:true});
mkdirSync(outputDir,{recursive:true});

const facts=manifest.sourceFacts;
const parseRate=text=>{
  const [n,d='1']=String(text||'0/1').split('/');
  const value=Number(n)/Number(d);
  return Number.isFinite(value)&&value>0?value:30;
};
const media={
  duration:Number(facts.duration||6),
  fps:parseRate(facts.videoStreams?.[0]?.avgFrameRate),
  videoTracks:facts.videoStreams.length,
  videoStreams:facts.videoStreams.map(v=>({
    ordinal:v.ordinal,codec:v.codec,width:v.width,height:v.height,
    fps:parseRate(v.avgFrameRate),pixelFormat:'yuv420p',bitDepth:8,unsafeColorPipeline:false
  })),
  audioTracks:facts.audioStreams.length,
  audioCodec:facts.audioStreams?.[0]?.codec||'',
  audioCodecs:facts.audioStreams.map(a=>a.codec),
  audioStreams:facts.audioStreams.map(a=>({ordinal:a.ordinal,codec:a.codec,bitRate:96000})),
  formatName:'matroska,webm',
  sourceName:manifest.source,
  videoCodec:facts.videoStreams?.[0]?.codec||'h264'
};

const defaults={
  operation:'transcode',codec:'h264',encoder:'libx264',preset:'ultrafast',
  rateMode:'quality',quality:30,start:0,end:'',videoStreams:'0',videoRange:'full',
  audio:'none',audioTrack:'all',audioRange:'full',subtitleRange:'full',
  keepSubtitles:false,keepAttachments:false,keepMetadata:false,keepChapters:false,
  fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'lanczos',
  rotation:'none',deinterlace:'none',multipass:'fullres',lookahead:'',aqStrength:'',
  outputContainer:'mkv'
};

const run=(args,cwd)=>execFileSync(ffmpeg,args,{cwd,stdio:'inherit',maxBuffer:32*1024*1024});

for(const testCase of manifest.cases){
  const task=compileTask({...defaults,...testCase.settings},media);
  const output=join(outputDir,testCase.output);
  const args=task.outputArgs.map(value=>String(value).replace('__ASS__',burn).replace('__FONTS__',packDir));
  if(task.twoPass){
    run(['-v','error','-y',...taskSourceArgs(task,source),...firstPassArgs(args),'-pass','1','-passlogfile',join(outputDir,testCase.id+'-pass'),'-f','null','-'],outputDir);
    args.push('-pass','2','-passlogfile',join(outputDir,testCase.id+'-pass'));
  }
  run(['-v','error','-y',...taskSourceArgs(task,source),...args,'-f',task.outputFormat,output],outputDir);
  process.stdout.write('Built reference '+testCase.id+' -> '+testCase.output+'\n');
}
