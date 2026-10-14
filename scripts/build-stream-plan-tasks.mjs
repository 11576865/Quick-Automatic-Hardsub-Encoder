import {writeFileSync} from 'node:fs';
import {compileTask} from '../src/media-task.js';
const media={duration:5,fps:24,videoTracks:1,audioTracks:3,subtitleTracks:2,attachmentTracks:2,audioStreams:[{codec:'flac'},{codec:'aac'},{codec:'flac'}]};
writeFileSync(process.argv[2],JSON.stringify(compileTask({operation:'copy',start:0,end:'',audio:'copy',audioTrack:'all',
 outputContainer:'mkv',keepSubtitles:true,subtitleStreams:'1',keepAttachments:true,attachmentStreams:'0',
 audioPlan:[{sourceOrdinal:0,action:'copy'},{sourceOrdinal:2,action:'aac',bitrate:64000,channels:1,sampleRate:48000}]},media)));
