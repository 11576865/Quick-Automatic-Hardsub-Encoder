// Independent WU11 same-source Native completed-artifact oracle.
// Native SSIM windows, automated fixture adoption and actual full-file
// FFmpeg output share one source/ASS/font/budget; no browser click is claimed.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {taskSourceArgs} from '../src/media-task.js';

const [source,output,importPath,taskPath,formalPlanPath,adoptionPath,work]=process.argv.slice(2);
assert([source,output,importPath,taskPath,formalPlanPath,adoptionPath,work].every(Boolean),
 'Usage: verify-wu11-native-vbr-output.mjs source output import task formalPlan adopted work');
const hash=x=>createHash('sha256').update(x).digest('hex');
const sourceSha='sha256:'+hash(readFileSync(source));
const imported=JSON.parse(readFileSync(importPath,'utf8'));
const job=JSON.parse(readFileSync(taskPath,'utf8'));
const task=job.request.task;
const formal=JSON.parse(readFileSync(formalPlanPath,'utf8'));
const accepted=JSON.parse(readFileSync(adoptionPath,'utf8'));
assert.equal(formal.sourceSha256,sourceSha);
assert.equal(accepted.sourceSha256,sourceSha);
assert.equal(accepted.kind,'wu11-bounded-guided-native-adoption-v1');
assert.equal(accepted.explicitApproval,'automated-fixture-only');
assert.equal(accepted.nativeVbrCertificateTransferAllowed,false);
assert.equal(accepted.outputBytesVerified,false);
assert.equal(accepted.fullMovieQualityVerified,false);
assert.equal(accepted.measuredWindows,2);
assert.equal(accepted.measurementId,formal.measurementId);
assert.equal(accepted.plan.targetVideoBitrate,formal.plan.targetVideoBitrate);
assert.equal(accepted.plan.sizeCeiling,formal.plan.sizeCeiling);
assert.equal(task.version,4);
assert.equal(task.operation,'hardsub');
assert.equal(task.rateMode,'size');
assert.equal(task.audio,'copy');
assert.equal(task.expectedAudioTracks,2);
assert.equal(task.audioPlan,null);
assert.equal(task.bitrate,formal.plan.targetVideoBitrate);
assert.equal(task.sizePlan.targetBytes,formal.plan.sizeCeiling);
assert.equal(task.sizePlan.fixedPayloadBytes,formal.plan.fixedPayloadBytes);
assert.equal(task.budgetEvidence.measurementId,formal.measurementId);
assert.equal(task.subtitleRenderOrder,'before-scale');
const vf=task.outputArgs[task.outputArgs.indexOf('-vf')+1];
assert.equal(vf,'ass=__ASS__:fontsdir=__FONTS__,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0');
assert.equal(task.outputArgs[task.outputArgs.indexOf('-b:v')+1],
 String(accepted.plan.targetVideoBitrate));
assert.ok(!task.outputArgs.includes('-crf'));
const assBytes=Buffer.from(imported.ass.base64,'base64');
const fontBytes=Buffer.from(imported.fonts[0].base64,'base64');
const assText=assBytes.toString('utf8');
assert.equal(imported.sourceBound,true);
assert.equal(imported.fontCount,1);
assert.equal(hash(Buffer.from(assText,'utf8')),accepted.assTextSha256);
assert.equal(hash(Buffer.from('font1.ttf:'+hash(fontBytes),'utf8')),
 accepted.fontContentSha256);
assert.match(assText,/Dialogue:/);
const run=(cmd,args)=>execFileSync(cmd,args,{
 cwd:work,encoding:'utf8',stdio:['ignore','pipe','pipe'],
 timeout:90000,maxBuffer:16*1024*1024
});
const probe=file=>JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));
const initial=probe(source),final=probe(output);
const streams=(x,type)=>x.streams.filter(z=>z.codec_type===type);
assert.equal(streams(initial,'video').length,1);
assert.equal(streams(final,'video').length,1);
assert.equal(streams(final,'video')[0].codec_name,'h264');
assert.deepEqual(streams(initial,'audio').map(x=>x.codec_name),['flac','aac']);
assert.deepEqual(streams(final,'audio').map(x=>x.codec_name),['flac','aac']);
assert.equal(streams(final,'subtitle').length,0);
assert.equal(streams(final,'attachment').length,0);
assert.equal(Number(final.format.size),statSync(output).size);
const packetHashes=(file,select)=>{
 const scan=JSON.parse(run('ffprobe',['-v','error',
  '-select_streams',select,'-show_packets','-show_data_hash','sha256',
  '-show_entries','packet=data_hash','-of','json',file]));
 return scan.packets.map(x=>x.data_hash);
};
const copies=[];
for(const track of ['a:0','a:1']){
 const from=packetHashes(source,track),to=packetHashes(output,track);
 assert.ok(from.length>=10);
 assert.deepEqual(to,from,track+' source payload must remain byte-for-byte identical');
 copies.push(from.length);
}
run('ffmpeg',['-v','error','-i',output,'-map','0:v:0','-f','null','-']);
const fonts=join(work,'wu11-fonts');mkdirSync(fonts,{recursive:true});
writeFileSync(join(fonts,'QHE-Synthetic-CI.ttf'),fontBytes);
const blank=join(work,'wu11-blank.ass');
writeFileSync(blank,assText.replace(/^Dialogue:.*$/gm,''));
const plain=join(work,'wu11-no-events.mkv');
const args=task.outputArgs.map(x=>String(x)
 .replace('__ASS__','wu11-blank.ass').replace('__FONTS__','wu11-fonts'));
run('ffmpeg',['-hide_banner','-v','error','-nostdin','-y',
 ...taskSourceArgs(task,source),...args,'-f',task.outputFormat,plain]);
const frame=file=>run('ffmpeg',['-v','error','-ss','0.9','-i',file,
 '-map','0:v:0','-frames:v','1','-f','md5','-']).trim();
assert.notEqual(frame(output),frame(plain),
 'Native final artifact must contain real rendered ASS pixels');
console.log(JSON.stringify({
 kind:'wu11-bounded-real-vbr-manual-artifact',
 result:'PASS',sourceSha256:sourceSha,outputSha256:'sha256:'+hash(readFileSync(output)),
 measuredWindows:2,requestedVideoBitrate:task.bitrate,
 targetBytes:formal.plan.sizeCeiling,actualBytes:statSync(output).size,
 flacCopyPackets:copies[0],aacCopyPackets:copies[1],
 actualAssPixelDifference:true,
 nativeVbrCertificateTransferAllowed:false,
 explicitUserClickObserved:false,fullMovieQualityVerified:false
}));
