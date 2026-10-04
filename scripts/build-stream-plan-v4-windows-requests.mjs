import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { compileTask } from '../src/media-task.js';

const packDir=resolve(process.argv[2]||'device-acceptance/stream-plan-v4-pack');
const output=resolve(process.argv[3]||'device-acceptance/windows-task-requests.json');

const manifest=JSON.parse(readFileSync(join(packDir,'device-acceptance-cases.json'),'utf8'));
const burn=readFileSync(join(packDir,manifest.subtitle),'utf8');
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

const cases=manifest.cases.map(testCase=>{
  const task=compileTask({...defaults,...testCase.settings},media);
  const primary=Number(task.videoStreams?.[0]??0);
  const v=media.videoStreams[primary]||media.videoStreams[0];
  return {
    id:testCase.id,
    output:testCase.output,
    body:{
      request:{
        task,
        suggestedName:testCase.output,
        sourceIdentity:'stream-plan-v4-device-fixture|video='+task.videoStreams.join(','),
        sourceCodec:v.codec,
        sourcePixelFormat:v.pixelFormat,
        sourceVideoBitrate:0,
        sourceWidth:v.width,
        sourceHeight:v.height,
        sourceFps:v.fps,
        expectedAudioTracks:task.expectedAudioTracks
      },
      assText:task.operation==='hardsub'?burn:''
    }
  };
});

writeFileSync(output,JSON.stringify({
  schema:'quick-hardsub-windows-runtime-requests/1',
  taskSchemaVersion:4,
  source:manifest.source,
  cases
},null,2)+'\n');
process.stdout.write('Built '+cases.length+' Windows Native runtime requests at '+output+'\n');
