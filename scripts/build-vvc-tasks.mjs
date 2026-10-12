import {writeFileSync} from 'node:fs';
import {compileTask} from '../src/media-task.js';
const media={duration:1,fps:24,videoTracks:1,audioTracks:1,audioCodec:'flac',formatName:'matroska'};
const raw={operation:'transcode',codec:'h266',encoder:'libvvenc',preset:'faster',
  rateMode:'quality',quality:32,start:0,end:'',audio:'copy',audioTrack:'all',
  fpsMode:'cfr',fps:'24',pixelFormat:'yuv420p10le',deinterlace:'none',rotation:'none',
  scaleAlgorithm:'lanczos',outputContainer:'mkv',keepMetadata:true};
writeFileSync(process.argv[2],JSON.stringify([
  compileTask(raw,media),
  compileTask({...raw,rateMode:'bitrate',bitrate:300000},media)
],null,2));
