// CI-only deterministic rich Matroska fixture for the ACTUAL Manual formal
// v4 HEVC job. The tiny valid TrueType font below was generated specifically
// for this test (QHE Synthetic CI Font: .notdef, space and 'A' glyphs).
// No system/proprietary font, downloaded asset or package dependency is used.
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const dir=resolve(process.argv[2]||'native-full-rich-fixture');
mkdirSync(dir,{recursive:true});
const font=join(dir,'QHE-Synthetic-CI.ttf');
const ass=join(dir,'source.ass');
const meta=join(dir,'chapters.ffmeta');
const output=join(dir,'source.mkv');
const bytes=Buffer.from('AAEAAAAKAIAAAwAgT1MvMkUAQ9EAAAEoAAAAYGNtYXAAdABcAAABlAAAADxnbHlmPzhf6wAAAdgAAAAwaGVhZC8f2rQAAACsAAAANmhoZWEFegHGAAAA5AAAACRobXR4BdwAZAAAAYgAAAAMbG9jYQAMACQAAAHQAAAACG1heHAABQAGAAABCAAAACBuYW1l/PZTpgAAAggAAAG2cG9zdAAIACQAAAPAAAAAKAABAAAAAQAALTTv018PPPUAAQPoAAAAAObyy4wAAAAA5vLLjAAAAAACJgK8AAAAAwACAAAAAAAAAAEAAAMg/zgAAAJYADIAMgImAAEAAAAAAAAAAAAAAAAAAAADAAEAAAADAAQAAQAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwH0AZAABQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAPz8/PwAAACAAQQMg/zgAAAMgAMgAAAAAAAAAAAAAAAAAAAAgAAACWAAyASwAAAJYADIAAAACAAAAAwAAABQAAwABAAAAFAAEACgAAAAGAAQAAQACACAAQf//AAAAIABB////4f/BAAEAAAAAAAAAAAAMAAwAGAABAAAAAAH0ArwAAwAAMREhEQH0Arz9RAABADIAAAImArwAAgAAMxMTMvr6Arz9RAAAAAwAlgABAAAAAAABABUAAAABAAAAAAACAAcAFQABAAAAAAADAB0AHAABAAAAAAAEAB0AHAABAAAAAAAFAA0AOQABAAAAAAAGABoARgADAAEECQABACoAYAADAAEECQACAA4AigADAAEECQADADoAmAADAAEECQAEADoAmAADAAEECQAFABoA0gADAAEECQAGADQA7FFIRSBTeW50aGV0aWMgQ0kgRm9udFJlZ3VsYXJRSEUgU3ludGhldGljIENJIEZvbnQgUmVndWxhclZlcnNpb24gMS4wMDBRSEVTeW50aGV0aWNDSUZvbnQtUmVndWxhcgBRAEgARQAgAFMAeQBuAHQAaABlAHQAaQBjACAAQwBJACAARgBvAG4AdABSAGUAZwB1AGwAYQByAFEASABFACAAUwB5AG4AdABoAGUAdABpAGMAIABDAEkAIABGAG8AbgB0ACAAUgBlAGcAdQBsAGEAcgBWAGUAcgBzAGkAbwBuACAAMQAuADAAMAAwAFEASABFAFMAeQBuAHQAaABlAHQAaQBjAEMASQBGAG8AbgB0AC0AUgBlAGcAdQBsAGEAcgAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAMAJA==','base64');
if(bytes.length!==1000)throw Error('Synthetic TTF invariant changed');
writeFileSync(font,bytes);
writeFileSync(ass,[
 '[Script Info]','ScriptType: v4.00+','PlayResX: 320','PlayResY: 180','',
 '[V4+ Styles]',
 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
 'Style: Default,QHE Synthetic CI Font,22,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,8,10,10,12,1','',
 '[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
 'Dialogue: 0,0:00:00.50,0:00:01.50,Default,,0,0,0,,A',
 'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,A'
].join('\n')+'\n');
writeFileSync(meta,[
 ';FFMETADATA1','title=QHE MANUAL COMPLEX V4 CI',
 '[CHAPTER]','TIMEBASE=1/1000','START=0','END=2500','title=FIRST',
 '[CHAPTER]','TIMEBASE=1/1000','START=2500','END=5000','title=SECOND',''
].join('\n'));
const argumentsList=[
 '-hide_banner','-nostdin','-loglevel','error','-y',
 '-f','lavfi','-i','testsrc2=size=320x180:rate=12:duration=5',
 '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=5',
 '-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=5',
 '-i',ass,'-f','ffmetadata','-i',meta,
 '-map','0:v:0','-map','1:a:0','-map','2:a:0','-map','3:s:0',
 '-map_metadata','4','-map_chapters','4',
 '-c:v','ffv1','-c:a:0','flac','-c:a:1','aac','-b:a:1','96k',
 '-c:s','ass','-metadata:s:a:0','language=jpn',
 '-metadata:s:a:1','language=eng','-metadata:s:s:0','language=jpn',
 '-attach',font,'-metadata:s:t','mimetype=application/x-truetype-font',
 '-metadata:s:t','filename=QHE-Synthetic-CI.ttf',output
];
execFileSync(process.env.FFMPEG||'ffmpeg',argumentsList,{stdio:'inherit',timeout:120000});
const probe=JSON.parse(execFileSync(process.env.FFPROBE||'ffprobe',
 ['-v','error','-show_streams','-show_chapters','-show_format','-of','json',output],
 {encoding:'utf8',maxBuffer:2*1024*1024}));
const count=type=>probe.streams.filter(s=>s.codec_type===type);
if(count('video').length!==1||count('audio').length!==2||
 count('subtitle').length!==1||count('attachment').length!==1||
 probe.chapters.length!==2||
 count('audio')[0].codec_name!=='flac'||count('audio')[1].codec_name!=='aac'||
 count('subtitle')[0].codec_name!=='ass'||
 count('attachment')[0].codec_name!=='ttf')
 throw Error('Rich MKV fixture stream contract failed');
console.log(JSON.stringify({result:'PASS',file:output,
 streamCodecs:probe.streams.map(s=>s.codec_name),chapters:probe.chapters.length,
 fontFile:'self-generated valid TrueType, 1000 bytes',duration:+probe.format.duration}));
