import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {taskSourceArgs} from '../src/media-task.js';
// Independent completed artifact verifier for real Windows Native WU02.
const [source,output,importPath,requestPath,fontPath,work]=process.argv.slice(2);
if(!source||!output||!importPath||!requestPath||!fontPath||!work)
 throw Error('Usage: verifier source output import.json request.json font.ttf work');
const imported=JSON.parse(readFileSync(importPath,'utf8'));
const task=JSON.parse(readFileSync(requestPath,'utf8')).request.task;
const run=(exe,args)=>execFileSync(exe,args,{
 cwd:work,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:90000,maxBuffer:16*1024*1024
});
const probe=file=>JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));
const original=probe(source),actual=probe(output);
const streams=(data,kind)=>data.streams.filter(s=>s.codec_type===kind);
assert.equal(streams(original,'video').length,1);
assert.equal(streams(original,'audio').length,2);
assert.equal(streams(original,'subtitle').length,1);
assert.equal(streams(original,'attachment').length,1);
assert.equal(streams(actual,'video').length,1);
assert.equal(streams(actual,'audio').length,2);
assert.equal(streams(actual,'subtitle').length,0);
assert.equal(streams(actual,'attachment').length,0);
assert.equal(streams(actual,'video')[0].codec_name,'h264');
assert.deepEqual(streams(actual,'audio').map(x=>x.codec_name),['flac','aac']);
assert.equal(imported.sourceBound,true);
assert.equal(imported.fontCount,1);
const fontBytes=Buffer.from(imported.fonts[0].base64,'base64');
const originalFont=readFileSync(fontPath);
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
assert.equal(hash(fontBytes),hash(originalFont),'Imported embedded font bytes differ');
const ass=Buffer.from(imported.ass.base64,'base64').toString('utf8');
assert.match(ass,/QHE Synthetic CI Font/);
assert.match(ass,/Dialogue:/);
const packetHashes=(file,select)=>JSON.parse(run('ffprobe',[
 '-v','error','-select_streams',select,'-show_packets','-show_data_hash','sha256',
 '-show_entries','packet=data_hash,size','-of','json',file
])).packets.map(p=>p.data_hash);
const flacIn=packetHashes(source,'a:0'),flacOut=packetHashes(output,'a:0');
assert.ok(flacIn.length>=10);
assert.deepEqual(flacOut,flacIn,'FLAC copy packet payloads changed');
const aacIn=packetHashes(source,'a:1'),aacOut=packetHashes(output,'a:1');
assert.ok(aacIn.length>=10);
assert.notDeepEqual(aacOut,aacIn,'Second AAC track was not re-encoded');
assert.equal(Number(actual.format.size),statSync(output).size);
run('ffmpeg',['-v','error','-i',output,'-map','0:v:0','-f','null','-']);
const fontdir=join(work,'embedded-fonts');mkdirSync(fontdir,{recursive:true});
writeFileSync(join(fontdir,imported.fonts[0].name),fontBytes);
const emptyAss=join(work,'empty-events.ass');
writeFileSync(emptyAss,ass.replace(/^Dialogue:.*$/gm,''));
const noEvents=join(work,'no-events.mkv');
// FFmpeg filtergraph values are not ordinary Windows filenames: a D: drive
// letter and backslashes must not be injected directly into ass=filename.
// Execute from a controlled private workdir and use relative staged paths.
const args=task.outputArgs.map(a=>String(a)
 .replace('__ASS__','empty-events.ass').replace('__FONTS__','embedded-fonts'));
run('ffmpeg',['-hide_banner','-v','error','-nostdin','-y',
 ...taskSourceArgs(task,source),...args,'-f',task.outputFormat,noEvents]);
const frame=file=>run('ffmpeg',[
 '-v','error','-ss','0.9','-i',file,'-map','0:v:0',
 '-frames:v','1','-f','md5','-'
]).trim();
assert.notEqual(frame(output),frame(noEvents),
 'Actual output does not differ from no-event ASS encode');
console.log(JSON.stringify({
 result:'PASS',kind:'WU02 Native real embedded ASS+font burn-in',
 sourceFlacPackets:flacIn.length,outputFlacPackets:flacOut.length,
 attachedFontSha256:hash(fontBytes),outputBytes:statSync(output).size,
 audio:['FLAC-copy','AAC-transcode'],burnedEventPixelDifference:true
}));
