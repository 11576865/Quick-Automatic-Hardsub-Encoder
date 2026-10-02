import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sizeBudget, outputReport, sampleSettings, sampleProjection} from './media-planning.js';
import {compileTask, firstPassArgs, commandPreview} from './media-task.js';
import {parseEncoderHelp, validateEncoderSupport} from './media-capabilities.js';
const defaults={operation:'transcode',codec:'h264',encoder:'libx264',preset:'medium',rateMode:'quality',quality:23,start:0,end:'',audio:'copy',audioTrack:'all',fpsMode:'auto',pixelFormat:'yuv420p',scaleAlgorithm:'lanczos',rotation:'none',deinterlace:'none',multipass:'fullres',lookahead:'',aqStrength:''};
const media={duration:2181.384,fps:60,audioTracks:2};
test('500 MB budget includes every encoded audio track, reserve and unit conversion',()=>{
 const raw={targetSize:500,sizeUnit:'MB',sizeReserve:4,audio:'aac',audioBitrate:96000};
 const one=sizeBudget(raw,media.duration,1),two=sizeBudget(raw,media.duration,2);
 assert.equal(one.targetBytes,500000000);assert.equal(one.audioRate,96000);
 assert.equal(one.videoRate-two.videoRate,96000);
 assert.ok(one.estimatedBytes<=480000000);
 assert.equal(sizeBudget({...raw,sizeUnit:'MiB'},media.duration,1).targetBytes,524288000);
 assert.throws(()=>sizeBudget({...raw,audio:'copy'},media.duration,1));
 assert.throws(()=>sizeBudget({...raw,keepAttachments:true},media.duration,1));
 assert.throws(()=>sizeBudget({...raw,targetSize:.01},media.duration,1));
 assert.throws(()=>sizeBudget({...raw,sizeUnit:'bogus'},media.duration,1));
});
test('budget compilation never truncates video and validates CFR frame caps',()=>{
 const task=compileTask({...defaults,rateMode:'size',targetSize:500,sizeUnit:'MB',sizeReserve:4,audio:'aac',audioBitrate:96000,audioTrack:'0',fpsMode:'cfr',fps:60,width:1280,height:720,twoPass:true},media);
 assert.ok(!task.outputArgs.includes('-fs'));assert.ok(!task.outputArgs.includes('-crf'));
 assert.equal(task.expectedFps,60);assert.equal(task.expectedWidth,1280);
 assert.equal(task.bitrate,1664350);assert.ok(task.estimatedBytes<480000000);
 assert.throws(()=>compileTask({...defaults,audio:'none',frames:30},media));
 assert.throws(()=>compileTask({...defaults,twoPass:true},media));
 const preview=commandPreview(task);assert.match(preview,/"-pass" "1"/);assert.match(preview,/"-pass" "2"/);
 const first=firstPassArgs(task.outputArgs);assert.ok(!first.includes('-c:a'));assert.ok(!first.includes('0:a:0'));assert.ok(first.includes('-an'));
});
test('NVENC uses P010 for 10-bit, selects legacy sync when needed, and rejects AQ conflict',()=>{
 const raw={...defaults,codec:'av1',encoder:'av1_nvenc',preset:'p6',pixelFormat:'yuv420p10le',fpsMode:'cfr',fps:60};
 const task=compileTask(raw,{...media,fpsModeSupported:false});
 assert.equal(task.pixelFormat,'p010le');assert.ok(task.outputArgs.includes('-vsync'));assert.ok(!task.outputArgs.includes('-fps_mode'));
 assert.throws(()=>compileTask({...raw,spatialAq:true,temporalAq:true},media));
 const support=parseEncoderHelp('Encoder av1_nvenc\n Supported pixel formats: yuv420p p010le\n -preset <int>\n -cq <float>\n -multipass <int>\n -spatial-aq <boolean>\n -temporal-aq <boolean>');
 assert.doesNotThrow(()=>validateEncoderSupport(task,support,['-vsync','-rc']));
 assert.throws(()=>validateEncoderSupport(task,{...support,pixelFormats:['yuv420p']},['-vsync']));
 assert.throws(()=>validateEncoderSupport(task,support,['-fps_mode']));
});
test('report retains oversized outputs and suggests a lower video rate',()=>{
 const task={...defaults,bitrate:1650000,expectedDuration:media.duration,estimatedAudioRate:96000,sizePlan:{targetBytes:500000000}};
 const report=outputReport(task,{outputBytes:530000000,verified:true},120);
 assert.equal(report.withinBudget,false);assert.ok(report.suggestedVideoRate<1650000);assert.equal(report.outputBytes,530000000);
 assert.equal(outputReport(task,{},1).withinBudget,null);
});
test('sample range respects trimmed span and accepts clock-form sample starts',()=>{
 const raw={operation:'transcode',start:100,end:200,sampleStart:195,sampleLength:15};
 assert.deepEqual(sampleSettings(raw,media),{start:195,end:200,length:5});
 assert.deepEqual(sampleSettings({operation:'transcode',start:'3:00',end:'4:00',sampleStart:'3:15',sampleLength:15},media),{start:195,end:210,length:15});
 assert.throws(()=>sampleSettings({...raw,sampleStart:50},media));
 assert.throws(()=>sampleSettings({...raw,sampleStart:199},media));
 assert.equal(sampleProjection(1000000,5,100),20000000);
});
