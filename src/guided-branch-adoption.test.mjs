import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuidedBranchProposal,currentGuidedBranchProposal,commitVerifiedGuidedBranch} from './guided-branch-adoption.js';

const scope=JSON.stringify(['decision-reference-v1','guided-ass-rendered','src','runtime','fingerprint']);
const proposal=(x={})=>createGuidedBranchProposal({
 branchId:'h265',codec:'h265',sourceScope:scope,
 selectedBytes:9000000,videoBitrate:350000,preset:'medium',
 priorCodec:'h264',priorOutputSize:null,...x
});
const observed=(p)=>({
 result:{ok:true,passed:true,referenceScope:p.sourceScope,
  requestedVideoBitrate:p.videoBitrate,budgetBytes:p.selectedBytes,
  canAutoAdopt:false},
 proposalIdentity:p.identity,confirmed:false
});
const plan=(p)=>({mode:'budget-rate',goal:'sizeBudget',codec:p.codec,
 preset:p.preset,targetVideoBitrate:p.videoBitrate,
 sizeBudgetPolicy:'best-effort',sizeCeiling:p.selectedBytes,
 outputWidth:p.outputSize?.width||0,outputHeight:p.outputSize?.height||0,
 safeBudgetBytes:8500000,plannedBytes:8990000,containerReserveBytes:180000,
 audioPayloadBytes:1500000,fixedPayloadBytes:500,encodedAudioBytes:100000,
 budgetCostBasis:'planned-audio',frontierPrediction:{estimated:.98}});
function fixture(p=proposal()){
 let selected={codec:p.priorCodec,outputSize:p.priorOutputSize},writes=[];
 const options={
  proposal:p,verification:observed(p),
  isCurrent:()=>true,
  readSelection:()=>({...selected}),
  writeSelection:s=>{writes.push(s);selected={...s}},
  preview:()=>plan(p),
  compile:()=>plan({...p,codec:selected.codec,outputSize:selected.outputSize})
 };
 return {options,selected:()=>selected,writes};
}
test('Guided branch recommendation is only staged, not adopted automatically',()=>{
 const p=proposal();
 assert.equal(p.ok,true);assert.equal(p.automaticAdoption,false);
 assert.equal(p.wholeMovieVerified,false);
 assert.equal(p.priorCodec,'h264');assert.equal(p.codec,'h265');
 assert.equal(proposal({priorCodec:'h265'}).ok,false);
 assert.equal(proposal({branchId:'h264'}).ok,false);
});
test('valid current frontier coordinates are needed before using any receipt',()=>{
 const p=proposal();
 const current={
  referenceScope:scope,budgetBytes:9000000,selectedCodec:'h264',
  selectedOutputSize:null,approvedPreset:'medium',
  evaluation:{status:'within-evidence',branchId:'h265',videoBitrate:350000}
 };
 assert.equal(currentGuidedBranchProposal(p,current),true);
 for(const invalid of [
  {referenceScope:'other'},
  {budgetBytes:8900000},
  {selectedCodec:'av1'},
  {approvedPreset:'fast'},
  {evaluation:{status:'above-evidence',branchId:'h265',videoBitrate:350000}},
  {evaluation:{status:'within-evidence',branchId:'h265',videoBitrate:350001}},
  {evaluation:{status:'within-evidence',branchId:'h264',videoBitrate:350000}}
 ])assert.equal(currentGuidedBranchProposal(p,{...current,...invalid}),false,JSON.stringify(invalid));
});
test('explicit passing receipt atomically applies codec and formal size plan',()=>{
 const f=fixture();
 const out=commitVerifiedGuidedBranch(f.options);
 assert.equal(out.ok,true);
 assert.equal(out.plan.codec,'h265');
 assert.deepEqual(f.selected(),{codec:'h265',outputSize:null});
 assert.equal(f.writes.length,1);
});
test('changed plan before confirmation cannot make state mutate',()=>{
 const f=fixture();
 f.options.isCurrent=()=>false;
 assert.equal(commitVerifiedGuidedBranch(f.options).reason,'stale-guided-branch-proposal');
 assert.equal(f.writes.length,0);
 const g=fixture();
 g.options.verification.result.passed=false;
 assert.equal(commitVerifiedGuidedBranch(g.options).reason,'invalid-guided-branch-adoption');
 assert.equal(g.writes.length,0);
 const h=fixture();
 h.options.verification.proposalIdentity='other';
 assert.equal(commitVerifiedGuidedBranch(h.options).reason,'invalid-guided-branch-adoption');
 assert.equal(h.writes.length,0);
});
test('hypothetical preview mismatch refuses mutation before state write',()=>{
 const f=fixture();
 f.options.preview=()=>({...plan(f.options.proposal),targetVideoBitrate:450000});
 const r=commitVerifiedGuidedBranch(f.options);
 assert.equal(r.reason,'adoption-rejected');
 assert.equal(f.writes.length,0);
 assert.equal(f.selected().codec,'h264');
});
test('post-adoption formal drift rolls selected codec back',()=>{
 const f=fixture();
 f.options.compile=()=>({...plan(f.options.proposal),plannedBytes:123});
 const r=commitVerifiedGuidedBranch(f.options);
 assert.equal(r.reason,'adoption-rejected');
 assert.equal(f.writes.length,2);
 assert.equal(f.selected().codec,'h264');
});
test('different nonexecuting frontier prediction does not invalidate same formal task',()=>{
 const f=fixture();
 f.options.compile=()=>({...plan(f.options.proposal),frontierPrediction:{estimated:.973}});
 const r=commitVerifiedGuidedBranch(f.options);
 assert.equal(r.ok,true);
 assert.equal(f.selected().codec,'h265');
});
test('resized candidate and source resolution have distinct immutable identities',()=>{
 const outputSize={id:'720p',width:1280,height:720};
 const p=proposal({branchId:'h265@720p',outputSize});
 assert.equal(p.ok,true);
 outputSize.width=777;
 assert.equal(p.outputSize.width,1280);
 const f=fixture(p);
 assert.equal(commitVerifiedGuidedBranch(f.options).ok,true);
 assert.equal(f.selected().outputSize.width,1280);
 const stale=proposal({branchId:'h265@720p',outputSize:{id:'720p',width:1280,height:720},
  priorOutputSize:{id:'1080p',width:1920,height:1080}});
 assert.equal(currentGuidedBranchProposal(stale,{
  referenceScope:scope,budgetBytes:9000000,selectedCodec:'h264',
  selectedOutputSize:null,approvedPreset:'medium',
  evaluation:{status:'within-evidence',branchId:'h265@720p',videoBitrate:350000}
 }),false);
});
test('rollback failure is explicitly observable and must not report committed',()=>{
 const f=fixture();
 let calls=0;f.options.writeSelection=x=>{
  calls++;
  if(calls===2)throw Error('rollback failed');
 };
 f.options.compile=()=>null;
 const r=commitVerifiedGuidedBranch(f.options);
 assert.equal(r.ok,false);
 assert.equal(r.reason,'adoption-rollback-failed');
});
test('Guided main UI stages recommendation and verifies it before explicit transaction',async()=>{
 const {readFile}=await import('node:fs/promises');
 const main=await readFile(new URL('./main.js',import.meta.url),'utf8');
 assert.match(main,/state\.guidedPendingBranch=proposed/);
 assert.match(main,/createGuidedBranchProposal\(/);
 assert.match(main,/currentGuidedPendingBranch\(/);
 assert.match(main,/guidedVbrTargetPlan\(/);
 assert.match(main,/commitVerifiedGuidedBranch\(/);
 assert.match(main,/verifyGuidedNativeVbr\(/);
 assert.match(main,/buildEncodePlan\(p\.codec,p\.outputSize\)/);
 assert.match(main,/state\.guidedPendingBranch=null/);
});
