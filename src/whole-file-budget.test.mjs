import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sizeBudget,outputReport} from './media-planning.js';
import {compileTask} from './media-task.js';
const raw={audio:'copy',audioTrack:'all',targetSize:1,sizeUnit:'MB',sizeReserve:4,keepAttachments:true};
test('measured copied payload and attachments reduce the available video budget',()=>{
 const budget=sizeBudget({...raw,budgetEvidence:{version:1,scope:'full-source',audioPacketBytes:[100000,50000],subtitlePacketBytes:[1000],attachmentBytes:[20000]},keepSubtitles:true},10,2);
 assert.equal(budget.fixedPayloadBytes,171000);
 assert.equal(budget.videoRate,Math.floor((960000-171000)*8/10));
 assert.equal(budget.containerReserveBytes,40000);
});
test('unknown, missing or fractional packet costs cannot become zero-cost evidence',()=>{
 for(const audioPacketBytes of [[],[null],[1.5],[-1]])assert.throws(()=>sizeBudget({...raw,keepAttachments:false,budgetEvidence:{version:1,scope:'full-source',audioPacketBytes}},10,1));
 assert.throws(()=>sizeBudget({...raw,keepAttachments:false,hasTrimRange:true,budgetEvidence:{version:1,scope:'full-source',audioPacketBytes:[10]}},10,1));
});
test('strict budget acceptance rejects oversized artifacts and offers bounded recovery',()=>{
 const report=outputReport({operation:'transcode',bitrate:100000,audio:'none',expectedDuration:10,budgetPolicy:'strict-ceiling',sizePlan:{targetBytes:100000,fixedPayloadBytes:10000}}, {outputBytes:120000,verified:true},1);
 assert.equal(report.deliveryAllowed,false);
 assert.ok(report.recoveryOptions.includes('increase-budget'));
});
test('manual strict size policy becomes part of the compiled task',()=>{
 const task=compileTask({operation:'transcode',codec:'h264',encoder:'libx264',preset:'medium',rateMode:'size',targetSize:1,sizeUnit:'MB',audio:'none',start:0,end:'',fpsMode:'auto',pixelFormat:'yuv420p',rotation:'none',deinterlace:'none',budgetPolicy:'strict-ceiling'}, {duration:5,fps:24,videoTracks:1,audioTracks:0});
 assert.equal(task.sizeCeilingBytes,1000000);
 assert.throws(()=>compileTask({...task,budgetPolicy:'automatic-retry'}, {duration:5,fps:24,videoTracks:1,audioTracks:0}));
});
test('mixed audio plans count selected packets, encoded time and no dropped tracks',()=>{
 const b=sizeBudget({...raw,keepAttachments:false,hasTrimRange:true,sourceDuration:10,trimDuration:5,audioPlan:[{sourceOrdinal:0,action:'copy',range:'full'},{sourceOrdinal:1,action:'aac',bitrate:8000,range:'trim'},{sourceOrdinal:2,action:'drop'}],budgetEvidence:{version:1,scope:'full-source',audioPacketBytes:[10000,null,null]}},5,2);
 assert.equal(b.fixedPayloadBytes,10000);assert.equal(b.encodedAudioBytes,5000);
 assert.equal(b.videoRate,(960000-15000)*8/5);
 assert.throws(()=>sizeBudget({...raw,keepAttachments:false,audioPlan:[{sourceOrdinal:0,action:'flac',range:'full'}]},10,1));
});
test('strict acceptance fails closed on missing or invalid byte counts',()=>{
 const task={budgetPolicy:'strict-ceiling',sizeCeilingBytes:100,expectedDuration:1};
 for(const outputBytes of [undefined,0,-1,NaN,Infinity,1.5])assert.equal(outputReport(task,{outputBytes},1).deliveryAllowed,false);
 assert.equal(outputReport(task,{outputBytes:100},1).deliveryAllowed,true);
 assert.equal(outputReport({...task,budgetPolicy:'best-effort'},{outputBytes:101},1).deliveryAllowed,true);
});
test('imported settings cannot authorize source costs; active snapshot can',()=>{
 const settings={operation:'transcode',codec:'h264',encoder:'libx264',preset:'medium',rateMode:'size',targetSize:1,sizeUnit:'MB',start:0,end:'',audio:'copy',fpsMode:'auto',pixelFormat:'yuv420p',rotation:'none',deinterlace:'none',budgetEvidence:{version:1,scope:'full-source',audioPacketBytes:[10000]}};
 const media={duration:5,fps:24,videoTracks:1,audioTracks:1};
 assert.throws(()=>compileTask(settings,media));
 assert.equal(compileTask(settings,{...media,budgetEvidence:settings.budgetEvidence}).sizePlan.fixedPayloadBytes,10000);
 assert.throws(()=>compileTask({...settings,frames:20,fpsMode:'cfr',fps:24},{...media,budgetEvidence:settings.budgetEvidence}));
});
test('Windows task entry point has exactly one UTF-8 BOM before its comment',async()=>{
 const {readFile}=await import('node:fs/promises');
 const bytes=await readFile(new URL('../windows/media-task.ps1',import.meta.url));
 assert.equal(bytes.subarray(0,4).toString('hex'),'efbbbf23');
});
