// Independent verifier for ONE clicked Guided -> Manual -> production Native
// Bridge -> FFmpeg job. Strictly not a field-device or full-movie quality test.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {taskSourceArgs} from '../src/media-task.js';
const [source,output,receiptPath,importPath,formalPath,work]=process.argv.slice(2);
assert([source,output,receiptPath,importPath,formalPath,work].every(Boolean),
 'Usage: verify-wu11-browser-native-output.mjs source output receipt import formal work');
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const srcSha='sha256:'+sha(readFileSync(source));
const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
const imported=JSON.parse(readFileSync(importPath,'utf8'));
const formal=JSON.parse(readFileSync(formalPath,'utf8'));
const task=receipt.task;
const fullProductionApp=receipt.kind==='wu12-production-main-to-windows-native-v1';
assert.ok(fullProductionApp||receipt.kind==='wu11-real-chromium-to-windows-native-v1');
if(fullProductionApp){
  assert.equal(receipt.productionMainLoaded,true);
  assert.equal(receipt.sourceRecoveredFromNative,true);
  assert.equal(receipt.fullAppSourceImportClicked,true);
  assert.equal(receipt.preflightAndNativePreviewCompleted,true);
  assert.equal(receipt.displayedTaskState,'verified');
  assert.equal(receipt.sourceImport?.sourceBound,true);
  assert.equal(receipt.sourceImport?.fontCount,1);
  assert.equal(receipt.request?.task?.version,4);
  assert.equal(receipt.request?.goal,'manual');
}
assert.equal(receipt.browserExplicitClicksObserved,true);
assert.equal(receipt.bridgeTransport,'production-windows-native-client');
assert.equal(receipt.sourceKey,srcSha);
assert.equal(formal.sourceSha256,srcSha);
assert.match(receipt.jobId,/^[a-z0-9]+$/i);
assert.equal(receipt.nativeResult.state,'completed');
assert.equal(receipt.importedSourceBound,true);
assert.equal(receipt.task.version,4);
assert.equal(task.operation,'hardsub');
assert.equal(task.rateMode,'size');
assert.equal(task.outputContainer,'mkv');
assert.equal(task.codec,'h264');
assert.equal(task.encoder,'libx264');
assert.equal(task.bitrate,formal.plan.targetVideoBitrate);
assert.equal(task.sizePlan.targetBytes,1000000);
assert.equal(task.sizePlan.fixedPayloadBytes,formal.fixedPayloadBytes);
assert.equal(task.sizePlan.encodedAudioBytes,formal.encodedAudioBytes);
assert.equal(task.budgetEvidence.measurementId,receipt.browserBudgetMeasurementId);
if(!fullProductionApp)assert.notEqual(receipt.oldGuidedCopyRate,task.bitrate,
 'Guided copied-bitrate evidence must not be reused after an audio policy change');
assert.deepEqual(task.audioPlan.map(a=>a.action),['copy','aac']);
assert.deepEqual(task.mustCopyAudioOrdinals,[0]);
assert.equal(task.outputArgs[task.outputArgs.indexOf('-c:a:0')+1],'copy');
assert.equal(task.outputArgs[task.outputArgs.indexOf('-c:a:1')+1],'aac');
assert.equal(task.outputArgs[task.outputArgs.indexOf('-b:v')+1],String(task.bitrate));
assert.equal(task.subtitleRenderOrder,'before-scale');
assert.equal(task.nativeVbrCertificate,undefined);
assert.ok(task.outputArgs[task.outputArgs.indexOf('-vf')+1].startsWith('ass=__ASS__:fontsdir=__FONTS__'));
assert.equal(imported.sourceBound,true);
assert.equal(imported.fontCount,1);
const assBytes=Buffer.from(imported.ass.base64,'base64');
const fontBytes=Buffer.from(imported.fonts[0].base64,'base64');
assert.equal(sha(Buffer.from(receipt.importedAssBase64,'base64')),sha(assBytes),
 'The real Chromium bridge imported a different ASS payload');
if(fullProductionApp){
 assert.equal(sha(Buffer.from(receipt.assText,'utf8')),sha(assBytes),
   'The actual shipping main.js encoded different ASS text than it imported');
 assert.equal(receipt.browserBudget.scope,'full-source');
 assert.deepEqual(receipt.browserBudget.audioPacketBytes.length,2);
}
assert.equal(sha(Buffer.from(receipt.importedFontBase64,'base64')),sha(fontBytes),
 'The real Chromium bridge imported a different font attachment');
assert.match(assBytes.toString('utf8'),/Dialogue:/);
const run=(exe,args)=>execFileSync(exe,args,{cwd:work,encoding:'utf8',
 stdio:['ignore','pipe','pipe'],timeout:90000,maxBuffer:20*1024*1024});
const probe=file=>JSON.parse(run('ffprobe',['-hide_banner','-v','error',
 '-show_streams','-show_format','-of','json',file]));
const before=probe(source),after=probe(output);
const tracks=(x,type)=>x.streams.filter(t=>t.codec_type===type);
assert.equal(tracks(before,'video').length,1);
assert.equal(tracks(after,'video').length,1);
assert.equal(tracks(after,'video')[0].codec_name,'h264');
assert.deepEqual(tracks(before,'audio').map(x=>x.codec_name),['flac','aac']);
assert.deepEqual(tracks(after,'audio').map(x=>x.codec_name),['flac','aac']);
assert.equal(tracks(after,'subtitle').length,0);
assert.equal(tracks(after,'attachment').length,0);
assert.equal(Number(after.format.size),statSync(output).size);
const packetHashes=(path,a)=>{
 const list=JSON.parse(run('ffprobe',['-v','error','-select_streams',a,
 '-show_packets','-show_data_hash','sha256','-show_entries','packet=data_hash','-of','json',path]));
 return list.packets.map(x=>x.data_hash);
};
const flacSrc=packetHashes(source,'a:0'),flacDst=packetHashes(output,'a:0');
assert.ok(flacSrc.length>10);
assert.deepEqual(flacDst,flacSrc,'Real browser-submitted Native job modified a locked FLAC packet');
const aacSrc=packetHashes(source,'a:1'),aacDst=packetHashes(output,'a:1');
assert.ok(aacSrc.length>10&&aacDst.length>10);
assert.notDeepEqual(aacDst,aacSrc,'Real browser-submitted Native job simply copied AAC');
run('ffmpeg',['-hide_banner','-v','error','-i',output,'-map','0:v:0','-f','null','-']);
const fontDir=join(work,'wu11-browser-fonts');
mkdirSync(fontDir,{recursive:true});
writeFileSync(join(fontDir,'QHE-Synthetic-CI.ttf'),fontBytes);
const noAss=join(work,'wu11-browser-no-events.ass');
writeFileSync(noAss,assBytes.toString('utf8').replace(/^Dialogue:.*$/gm,''));
const blank=join(work,'wu11-browser-no-events.mkv');
const args=task.outputArgs.map(x=>String(x)
 .replace('__ASS__','wu11-browser-no-events.ass')
 .replace('__FONTS__','wu11-browser-fonts'));
run('ffmpeg',['-hide_banner','-v','error','-nostdin','-y',
 ...taskSourceArgs(task,source),...args,'-f',task.outputFormat,blank]);
const frame=file=>run('ffmpeg',['-v','error','-ss','0.9','-i',file,
 '-map','0:v:0','-frames:v','1','-f','md5','-']).trim();
assert.notEqual(frame(output),frame(blank),
 'Real Windows Native output has no independently detectable ASS pixels');
console.log(JSON.stringify({
 kind:fullProductionApp?'wu12-production-main-native-audited-artifact':'wu11-single-real-browser-native-final-artifact',
 result:'PASS',sourceSha256:srcSha,outputSha256:'sha256:'+sha(readFileSync(output)),
 browserExplicitClicksObserved:true,productionMainLoaded:fullProductionApp,
 bridgeTransport:'production-windows-native-client',
 jobId:receipt.jobId,taskVersion:task.version,
 fullSourceBudgetMeasurementId:receipt.browserBudgetMeasurementId,
 videoBitrate:task.bitrate,actualOutputBytes:statSync(output).size,
 flacBitExactPackets:flacSrc.length,aacReencodedPackets:aacDst.length,
 actualAssPixelDifference:true,strictSizeCeilingVerified:false,
 longMovieQualityVerified:false,physicalUserDeviceVerified:false
}));
