// WU11 bounded real-evidence admission: exercise production Guided VBR
// validator + explicit selection transaction using the exact Windows Native
// samples already encoded by check-guided-budget-native.ps1.
// This is NOT a browser click, whole-file outcome or a model recommendation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyGuidedNativeVbr} from '../src/guided-native-vbr-verification.js';
import {createGuidedBranchProposal,commitVerifiedGuidedBranch}
  from '../src/guided-branch-adoption.js';

const [file,richImportPath,expectedSourceSha]=process.argv.slice(2);
assert(file,'Usage: check-wu11-guided-vbr-explicit-adoption.mjs paired-native.json');
const data=JSON.parse(readFileSync(file,'utf8'));
assert.equal(data.samples?.length,2);
assert.match(data.assTextSha256,/^[a-f0-9]{64}$/);
const windows=data.samples.map(x=>x.window);
assert.deepEqual(windows,[{start:0,duration:0.8},{start:1,duration:0.8}]);
const receipts=data.samples.map(x=>x.sample.nativeEvidence);
assert.ok(receipts.every(r=>r?.method==='windows-native-exact-guided-ass-vbr-v1'));
const first=receipts[0];
// When invoked by WU02, independently bind both Native sample windows to
// the embedded ASS and attachment-font bytes imported from the *same* MKV.
// A Native sourceToken is only a stat/runtime snapshot, never the file SHA.
if(richImportPath){
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.match(expectedSourceSha||'',/^sha256:[a-f0-9]{64}$/);
  assert.equal(data.sourceSha256Before,expectedSourceSha);
  assert.equal(data.sourceSha256After,expectedSourceSha,
    'The rich MKV changed between sampling and the formal task');
  const imported=JSON.parse(readFileSync(richImportPath,'utf8'));
  assert.equal(imported.sourceBound,true);
  assert.equal(imported.fontCount,1);
  const ass=Buffer.from(imported.ass.base64,'base64').toString('utf8');
  const importedAssHash=hash(Buffer.from(ass,'utf8'));
  const font=Buffer.from(imported.fonts[0].base64,'base64');
  const stagedFontHash=hash(Buffer.from('font1.ttf:'+hash(font),'utf8'));
  assert.equal(data.assTextSha256,importedAssHash);
  for(const receipt of receipts){
    assert.equal(receipt.assTextSha256,importedAssHash,
      'Native VBR used different ASS text from imported MKV');
    assert.equal(receipt.fontContentSha256,stagedFontHash,
      'Native VBR used different font bytes from imported MKV');
    assert.equal(receipt.fontCount,1,'Native VBR did not stage the imported font');
  }
}
const referenceScope=JSON.stringify(['decision-reference-v1','guided-ass-rendered',
  first.sourceToken,first.runtimeToken,first.assTextSha256,first.fontContentSha256]);
const plan={
  mode:'budget-rate',goal:'sizeBudget',sizeBudgetPolicy:'best-effort',
  codec:'h264',preset:'medium',targetVideoBitrate:650000,
  // This is an opt-in transaction fixture, NOT a computed full-file budget.
  sizeCeiling:5000000,outputWidth:0,outputHeight:0
};
const check=(samples=data.samples,targetSsim=0.8)=>verifyGuidedNativeVbr({
  plan,referenceScope,windows,samples,targetSsim,expectedEncoder:'libx264'
});
const real=check();
assert.equal(real.ok,true,JSON.stringify(real));
assert.equal(real.passed,true);
assert.equal(real.measuredWindows,2);
assert.equal(real.canAutoAdopt,false);
assert.equal(real.outputBytesVerified,false);
assert.equal(real.wholeMovieQualityVerified,false);
assert.ok(real.sourceRuntimeStamp&&real.fontContentSha256);
const tampered=structuredClone(data.samples);
tampered[1].sample.nativeEvidence.sourceToken='foreign-file';
assert.equal(check(tampered).reason,'guided-origin-drift');
const manualScope=check(data.samples,0.9999);
assert.equal(manualScope.ok,true);
assert.equal(manualScope.passed,false);

const proposal=createGuidedBranchProposal({
  branchId:'h264',codec:'h264',sourceScope:referenceScope,
  selectedBytes:plan.sizeCeiling,videoBitrate:plan.targetVideoBitrate,
  preset:'medium',priorCodec:'h265',priorOutputSize:null
});
assert.equal(proposal.ok,true);
assert.equal(proposal.automaticAdoption,false);
let selected={codec:'h265',outputSize:null},writes=0;
const opts={
 proposal,verification:{proposalIdentity:proposal.identity,confirmed:false,result:real},
 readSelection:()=>({...selected}),
 writeSelection:next=>{selected={...next};writes++;},
 isCurrent:()=>first.sourceToken===receipts[1].sourceToken,
 preview:()=>({...plan}),
 compile:()=>({...plan,codec:selected.codec})
};
assert.equal(selected.codec,'h265','no implicit adoption');
assert.equal(writes,0);
const bad={...opts,verification:{...opts.verification,proposalIdentity:'stale'}};
assert.equal(commitVerifiedGuidedBranch(bad).ok,false);
assert.equal(writes,0);
const notPassed={...opts,verification:{...opts.verification,
 result:{...real,passed:false}}};
assert.equal(commitVerifiedGuidedBranch(notPassed).ok,false);
assert.equal(writes,0);
// A caller emulating the explicit user confirmation invokes this transaction;
// staging a proposal or measuring Native samples alone cannot invoke it.
const approvedByUser=true;
assert.equal(approvedByUser,true);
const accepted=commitVerifiedGuidedBranch(opts);
assert.equal(accepted.ok,true,JSON.stringify(accepted));
assert.equal(accepted.plan.codec,'h264');
assert.equal(selected.codec,'h264');
assert.equal(writes,1);
assert.equal(real.outputBytesVerified,false);
console.log(JSON.stringify({
 result:'PASS',kind:'WU11 bounded native Guided VBR -> explicit transaction',
 measuredWindows:real.measuredWindows,
 assSha:real.fontContentSha256,sourceRuntimeStamp:real.sourceRuntimeStamp,
 manualTaskExecuted:false,fullMovieVerified:false,uiClickSimulated:false,
 sameRichMkvAssetsVerified:Boolean(richImportPath)
}));
