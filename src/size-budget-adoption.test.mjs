import test from 'node:test';
import assert from 'node:assert/strict';
import {commitVerifiedSizeBudget} from './size-budget-adoption.js';
import {compileTask} from './media-task.js';
function fixture(){
 const raw={operation:'transcode',codec:'av1',encoder:'libsvtav1',preset:'6',rateMode:'quality',quality:'32',bitrate:'1000000',twoPass:false,start:'0',end:'',audio:'none',videoRange:'full',fpsMode:'auto',pixelFormat:'yuv420p',rotation:'none',deinterlace:'none',outputContainer:'mkv',targetSize:'5',sizeUnit:'MB',sizeReserve:'4',budgetPolicy:'best-effort'};
 const controls=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,{value:String(v),checked:v===true}]));
 const read=()=>Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,k==='twoPass'?v.checked:v.value]));
 const before=read(),media={duration:6,fps:24,videoTracks:1,videoCodec:'h264',audioTracks:0};
 const run=(overrides={})=>commitVerifiedSizeBudget({budget:{targetBytes:1000000,bitrate:1280000,reservePercent:4,budgetPolicy:'strict-ceiling'},expectedSettings:before,expectedSourceIdentity:'source',read,sourceIdentity:()=> 'source',get:k=>controls[k],updateRate:()=>{},compile:compileTask,media,...overrides});
 return {run,read,before};
}
test('size selection preserves current encoder while atomically compiling exact rate and strict byte ceiling',()=>{
 const x=fixture(),r=x.run();assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(r.task.encoder,'libsvtav1');assert.equal(r.task.preset,'6');assert.equal(r.task.rateMode,'size');assert.equal(r.task.bitrate,1280000);assert.equal(r.task.sizeCeilingBytes,1000000);
});
test('stale source and divergent compiler cannot write budget or change earlier controls',()=>{
 const x=fixture();assert.equal(x.run({sourceIdentity:()=> 'other'}).ok,false);assert.deepEqual(x.read(),x.before);
 const r=x.run({compile:raw=>({...compileTask(raw,{duration:6,fps:24,videoTracks:1,videoCodec:'h264',audioTracks:0}),bitrate:5})});assert.equal(r.ok,false);assert.deepEqual(x.read(),x.before);
});
