import test from 'node:test';
import assert from 'node:assert/strict';
import {compileTask} from './media-task.js';
import {guidedTaskSettings} from './guided-task-handoff.js';
import {hardsubReferenceFilter} from './media-verification.js';
import {compileGuidedCpuHandoff,commitGuidedCpuHandoff}
  from './guided-cpu-compiler-contract.js';

const media=()=>({duration:5,fps:24,videoTracks:1,audioTracks:0});
const defaults=()=>({operation:'hardsub',fpsMode:'auto',pixelFormat:'yuv420p',
  rotation:'none',deinterlace:'none',audio:'none',
  crop:'',codecParams:'',lookahead:'',maxrate:'',bufsize:'',gop:'',bf:'',refs:'',
  sampleLength:'15',squarePixels:false});
const plan=(overrides={})=>({
 codec:'h264',mode:'budget-rate',goal:'sizeBudget',
 preset:'medium',sizeBudgetPolicy:'best-effort',
 sizeCeiling:1000000,targetVideoBitrate:1536000,
 containerReserveBytes:40000,fixedPayloadBytes:0,encodedAudioBytes:0,
 outputWidth:0,outputHeight:0,...overrides
});
const snapshot=(p=plan(),audio={audio:'none'},container='mkv')=>({plan:p,audio,container});
const preview=(o={})=>compileGuidedCpuHandoff({
 snapshot:snapshot(),defaults:defaults(),media:media(),
 sourceKey:'video-stamp',...o
});
test('CPU handoff and Manual compileTask preserve exact Guided bitrate, budget and no-ASS-evidence claims',()=>{
 const c=preview();
 assert.equal(c.ok,true,c.detail||c.reason);
 assert.equal(c.task.version,4);
 assert.equal(c.task.operation,'hardsub');
 assert.equal(c.task.bitrate,1536000);
 assert.equal(c.task.sizePlan.targetBytes,1000000);
 assert.equal(c.task.sizePlan.reservePercent,4);
 assert.equal(c.task.sizePlan.containerReserveBytes,40000);
 assert.equal(c.task.outputContainer,'mkv');
 assert.equal(c.settings.subtitleRenderOrder,'before-scale');
 assert.equal(c.task.subtitleRenderOrder,'before-scale');
 assert.equal(c.nativeVbrCertificateTransferAllowed,false);
 assert.equal(c.requiresFreshExecutionValidation,true);
 assert.equal(c.fullMovieQualityVerified,false);
});
test('scaled Guided handoff renders ASS before bicubic and never inherits Lanczos',()=>{
 const p=plan({outputWidth:640,outputHeight:360});
 const c=preview({snapshot:snapshot(p)});
 assert.equal(c.ok,true,c.detail||c.reason);
 assert.equal(c.task.expectedWidth,640);
 assert.equal(c.task.expectedHeight,360);
 const vf=c.task.outputArgs[c.task.outputArgs.indexOf('-vf')+1];
 assert.equal(vf,'ass=__ASS__:fontsdir=__FONTS__,scale=640:360:flags=bicubic,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0');
 const observedReference=hardsubReferenceFilter(c.task,2.5);
 assert.ok(observedReference.indexOf('ass=__ASS__:fontsdir=__FONTS__')<
   observedReference.indexOf('scale=640:360:flags=bicubic'));
 assert.match(observedReference,/setpts=PTS-STARTPTS\+2\.5\/TB,ass=__ASS__/);
 const manual=compileTask({...defaults(),...c.settings,subtitleRenderOrder:'after-scale'},media());
 const legacy=manual.outputArgs[manual.outputArgs.indexOf('-vf')+1];
 assert.ok(legacy.indexOf('scale=640:360')<legacy.indexOf('ass=__ASS__'));
});
test('strict software H264 keeps explicit two-pass and byte ceiling',()=>{
 const p=plan({sizeBudgetPolicy:'strict-ceiling'});
 const c=preview({snapshot:snapshot(p)});
 assert.equal(c.ok,true,c.detail||c.reason);
 assert.equal(c.task.twoPass,true);
 assert.equal(c.task.sizeCeilingBytes,1000000);
 assert.equal(c.task.budgetPolicy,'strict-ceiling');
});
test('real measured copied audio payload belongs to same source and cannot be invented',()=>{
 const m={...media(),audioTracks:1};
 const evidence={version:1,scope:'full-source',audioPacketBytes:[200000],subtitlePacketBytes:[],attachmentBytes:[]};
 const p=plan({targetVideoBitrate:1216000,fixedPayloadBytes:200000});
 const opts={snapshot:snapshot(p,{audio:'copy'}),media:m,sourceKey:'vid-a'};
 assert.equal(preview(opts).reason,'missing-copied-audio-cost-evidence');
 assert.equal(preview({...opts,evidence,evidenceSourceKey:'vid-other'}).reason,
   'stale-source-budget-evidence');
 const c=preview({...opts,evidence,evidenceSourceKey:'vid-a'});
 assert.equal(c.ok,true,c.detail||c.reason);
 assert.equal(c.task.sizePlan.fixedPayloadBytes,200000);
 assert.equal(c.task.bitrate,1216000);
 assert.equal(c.task.expectedAudioTracks,1);
});
test('wrong video bitrate, fixed cost, reserve or target fails the common compiler contract',()=>{
 for(const wrong of [
  {targetVideoBitrate:1536001},
  {containerReserveBytes:40001},
  {encodedAudioBytes:1000},
  {fixedPayloadBytes:42},
  {sizeCeiling:1000001}
 ]){
  const c=preview({snapshot:snapshot(plan(wrong))});
  assert.equal(c.ok,false,JSON.stringify(wrong));
 }
});
test('inherited Manual filters or fps policy cannot sneak into nominal Guided plan',()=>{
 for(const changes of [{crop:'100:100:0:0'},{fpsMode:'cfr',fps:'30'},
  {sharpen:true},{gop:'96'},{pixelFormat:'yuv444p'}]){
  const c=preview({defaults:{...defaults(),...changes}});
  assert.equal(c.ok,false,JSON.stringify(changes));
 }
});
test('av1 incompatible preset and absent source fail closed, not coerced',()=>{
 const a=preview({snapshot:snapshot(plan({codec:'av1',preset:'medium'}))});
 assert.equal(a.ok,false);
 assert.equal(preview({sourceKey:''}).reason,'missing-guided-source-or-plan');
});
function fixture(){
 const contract=preview();assert.equal(contract.ok,true,contract.detail||contract.reason);
 let current={...defaults(),codec:'h265',encoder:'libx265',preset:'medium',rateMode:'quality'};
 let source='video-stamp',applyCount=0;
 const props={contract,media:media(),evidence:null,expectedSourceIdentity:source,
  sourceIdentity:()=>source,read:()=>({...current}),
  apply:s=>{applyCount++;current={...s};}};
 return {props,read:()=>current,source:x=>source=x,count:()=>applyCount};
}
test('Guided→Manual form import recompiles identical executable task once',()=>{
 const f=fixture();
 const r=commitGuidedCpuHandoff(f.props);
 assert.equal(r.ok,true,r.reason||r.detail);
 assert.equal(r.task.codec,'h264');
 assert.equal(r.task.sizePlan.targetBytes,1000000);
 assert.equal(f.count(),1);
});
test('changed source before any form mutation rejects without writes',()=>{
 const f=fixture();f.source('another');
 assert.equal(commitGuidedCpuHandoff(f.props).reason,'invalid-or-stale-guided-cpu-handoff');
 assert.equal(f.count(),0);
});
test('form silently rewriting actual target size after apply triggers exact rollback',()=>{
 const f=fixture(),previous=f.read();
 let current={...previous};
 f.props.read=()=>({...current});
 f.props.apply=s=>{current={...s,targetSize:'2'};if(s.codec==='h265')current={...s};};
 const r=commitGuidedCpuHandoff(f.props);
 assert.equal(r.ok,false);
 assert.equal(r.reason,'guided-cpu-handoff-rejected');
 assert.deepEqual(current,previous);
});
test('failing rollback is surfaced as error not success',()=>{
 const f=fixture();
 let count=0;
 f.props.apply=()=>{count++;if(count>1)throw Error('form no longer writable');};
 f.props.read=()=>({...f.read(),crop:'100:100:0:0'});
 const r=commitGuidedCpuHandoff(f.props);
 assert.equal(r.reason,'guided-cpu-handoff-rollback-failed');
});
test('actual Guided UI handler obtains current source evidence and never transfers SSIM certificate',async()=>{
 const {readFile}=await import('node:fs/promises');
 const workspace=await readFile(new URL('./media-workspace.js',import.meta.url),'utf8');
 assert.match(workspace,/compileGuidedCpuHandoff\(/);
 assert.match(workspace,/commitGuidedCpuHandoff\(/);
 assert.match(workspace,/expectedSourceIdentity:sourceKey/);
 assert.match(workspace,/hardsubStrategy='manual'/);
 assert.match(workspace,/name="subtitleRenderOrder" value="after-scale"/);
});

test('a contract compiled for the old source is never adopted for a new source',()=>{
 const f=fixture();
 f.source('new-source');
 f.props.expectedSourceIdentity='new-source';
 const r=commitGuidedCpuHandoff(f.props);
 assert.equal(r.ok,false);
 assert.equal(r.reason,'invalid-or-stale-guided-cpu-handoff');
 assert.equal(f.count(),0);
});
test('source change during authoritative recompile cannot commit success',()=>{
 const f=fixture();
 const originalRead=f.props.read;
 let calls=0;
 f.props.read=()=>{
   calls++;
   if(calls===2)f.source('changed-mid-transaction');
   return originalRead();
 };
 const r=commitGuidedCpuHandoff(f.props);
 assert.equal(r.ok,false);
 assert.match(r.detail,/source-changed-during-recompile/);
 assert.equal(f.count(),2);
});

test('WU11 mixed FLAC Copy + AAC encode uses only explicitly source-locked Guided intent and actual budget',()=>{
 const source='sha256:source-v4-fixture';
 const m={...media(),audioTracks:2,sourceIdentity:source};
 const evidence={version:1,scope:'full-source',measurementId:'cost-now',
  audioPacketBytes:[200000,80000],subtitlePacketBytes:[],attachmentBytes:[]};
 const audio={audio:'copy',intent:'explicit-per-stream-v1',sourceIdentity:source,
  mustCopyAudioOrdinals:[0],
  audioPlan:[{sourceOrdinal:0,action:'copy',range:'full'},
   {sourceOrdinal:1,action:'aac',range:'full',bitrate:96000}]};
 const p=plan({targetVideoBitrate:1120000,fixedPayloadBytes:200000,encodedAudioBytes:60000});
 const params={snapshot:snapshot(p,audio),defaults:defaults(),media:m,
  sourceKey:source,evidence,evidenceSourceKey:source};
 const c=compileGuidedCpuHandoff(params);
 assert.equal(c.ok,true,c.detail||c.reason);
 assert.deepEqual(c.task.audioPlan.map(x=>x.action),['copy','aac']);
 assert.deepEqual(c.task.mustCopyAudioOrdinals,[0]);
 assert.equal(c.task.bitrate,1120000);
 assert.equal(c.task.sizePlan.encodedAudioBytes,60000);
 assert.equal(c.task.sizePlan.fixedPayloadBytes,200000);
 assert.equal(c.nativeVbrCertificateTransferAllowed,false);
 let form=defaults();
 const handoff=commitGuidedCpuHandoff({contract:c,media:m,evidence,
  expectedSourceIdentity:source,sourceIdentity:()=>source,
  read:()=>({...form}),apply:x=>{form={...x};}});
 assert.equal(handoff.ok,true,handoff.detail||handoff.reason);
 assert.deepEqual(handoff.task.mustCopyAudioOrdinals,[0]);
 assert.deepEqual(handoff.task.outputPlan.audio.map(x=>x.action),['copy','aac']);
 assert.equal(handoff.task.bitrate,1120000);
 const fail=({a=audio,p2=p,e=evidence,key=source}={})=>
  compileGuidedCpuHandoff({...params,snapshot:snapshot(p2,a),
   evidence:e,evidenceSourceKey:key});
 assert.equal(fail({a:{...audio,intent:undefined}}).reason,'unapproved-guided-mixed-audio-intent');
 assert.equal(fail({a:{...audio,sourceIdentity:'another'}}).reason,
  'invalid-or-stale-guided-mixed-audio-intent');
 assert.equal(fail({a:{...audio,mustCopyAudioOrdinals:[]}}).reason,
  'invalid-or-stale-guided-mixed-audio-intent');
 assert.equal(fail({key:'stale-source'}).reason,'stale-source-budget-evidence');
 assert.equal(fail({e:null}).reason,'missing-copied-audio-cost-evidence');
 assert.equal(fail({p2:{...p,targetVideoBitrate:p.targetVideoBitrate+100}}).reason,
  'compiled-guided-whole-file-budget-divergence');
 const wrongAudio={...audio,audioPlan:[{sourceOrdinal:0,action:'aac',bitrate:96000},
  {sourceOrdinal:1,action:'copy',range:'full'}]};
 assert.equal(fail({a:wrongAudio}).reason,'invalid-or-stale-guided-mixed-audio-intent');
 form={...defaults(),codec:'h265',rateMode:'quality'};
 const previous={...form};
 const changed=commitGuidedCpuHandoff({contract:c,media:m,evidence,
  expectedSourceIdentity:source,sourceIdentity:()=>source,
  read:()=>({...form}),
  apply:x=>{form=x.codec==='h265'?{...x}:{...x,audioPlan:[]};}});
 assert.equal(changed.ok,false);
 assert.deepEqual(form,previous,'rejected form drift must restore prior settings');
});
