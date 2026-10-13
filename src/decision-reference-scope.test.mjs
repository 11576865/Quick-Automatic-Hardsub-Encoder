import test from 'node:test';
import assert from 'node:assert/strict';
import {guidedAssDecisionScope,manualSourceDecisionScope,sameDecisionReference} from './decision-reference-scope.js';

const guided=overrides=>guidedAssDecisionScope({
  sourceKey:'source-stat-snapshot',runtimeKey:'runtime-ffmpeg-7',assText:'[Events]\nDialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,Hello',
  fonts:[{name:'FontA.ttf',size:4096,lastModified:172}, {name:'FontB.ttf',size:8192,lastModified:173}],
  fontBindings:{Original:'Replacement'},autoFontFallbacks:{Missing:'Fallback'},
  renderer:'libass-windows-native',...overrides
});
const protocol=()=>({
  method:'windows-native-exact-cq-v1',referenceMetric:'source-sdr-yuv420p-ssim-v1',
  sourceToken:'source-stat-snapshot',runtimeToken:'runtime-ffmpeg-7',
  referenceToken:'sdr-source-reference',filterToken:'no-filters',
  samplePlanVersion:'manual-risk-windows-v2',windows:[{start:3,duration:2},{start:36,duration:2}]
});
test('Guided and Manual never share SSIM scope, even for the same source/runtime',()=>{
 const a=guided(),b=manualSourceDecisionScope(protocol());
 assert.ok(a);assert.ok(b);assert.notEqual(a,b);
 assert.equal(sameDecisionReference(a,b),false);
 assert.equal(sameDecisionReference(a,a),true);
 assert.equal(sameDecisionReference(b,b),true);
});
test('rendered ASS text changes invalidate quality model, including same-length edits',()=>{
 const before=guided();
 assert.notEqual(guided({assText:'[Events]\nDialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,World'}),before);
 assert.notEqual(guided({assText:'[Events]\nDialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,HELLO'}),before);
});
test('font substitution or file metadata changes invalidate ASS evidence',()=>{
 const before=guided();
 assert.notEqual(guided({fontBindings:{Original:'Other'}}),before);
 assert.notEqual(guided({autoFontFallbacks:{Missing:'Other'}}),before);
 assert.notEqual(guided({fonts:[{name:'FontA.ttf',size:4097,lastModified:172},{name:'FontB.ttf',size:8192,lastModified:173}]}),before);
 assert.notEqual(guided({fonts:[{name:'FontA.ttf',size:4096,lastModified:174},{name:'FontB.ttf',size:8192,lastModified:173}]}),before);
 assert.notEqual(guided({renderer:'libass-different-build'}),before);
});
test('source/runtime changes invalidate both independent reference kinds',()=>{
 assert.notEqual(guided({sourceKey:'changed-source'}),guided());
 assert.notEqual(guided({runtimeKey:'changed-ffmpeg'}),guided());
 const p=protocol();p.sourceToken='changed-source';
 assert.notEqual(manualSourceDecisionScope(p),manualSourceDecisionScope(protocol()));
 p.sourceToken='source-stat-snapshot';p.runtimeToken='other-runtime';
 assert.notEqual(manualSourceDecisionScope(p),manualSourceDecisionScope(protocol()));
});
test('font order and mapping key insertion order do not fabricate changes',()=>{
 const reversed=guided({
  fonts:[{name:'FontB.ttf',size:8192,lastModified:173},{name:'FontA.ttf',size:4096,lastModified:172}],
  fontBindings:{Original:'Replacement'},autoFontFallbacks:{Missing:'Fallback'}
 });
 assert.equal(reversed,guided());
 const multiA=guided({fontBindings:{B:'2',A:'1'}});
 const multiB=guided({fontBindings:{A:'1',B:'2'}});
 assert.equal(multiA,multiB);
});
test('manual paired-window or metric drift changes its decision reference',()=>{
 const a=protocol(),base=manualSourceDecisionScope(a);
 const changed=protocol();changed.windows[1].start=38;
 assert.notEqual(manualSourceDecisionScope(changed),base);
 changed.windows[1].start=36;changed.referenceMetric='source-sdr-bicubic-upscale-ssim-v1';
 assert.notEqual(manualSourceDecisionScope(changed),base);
 changed.referenceMetric='source-sdr-yuv420p-ssim-v1';changed.referenceToken='different-reference';
 assert.notEqual(manualSourceDecisionScope(changed),base);
});
test('incomplete or wrong-kind identities are never comparable',()=>{
 assert.equal(guided({assText:''}),null);
 assert.equal(guided({sourceKey:''}),null);
 assert.equal(guided({fonts:[{name:'',size:1,lastModified:1}]}),null);
 assert.equal(manualSourceDecisionScope({...protocol(),method:'guideds-ass'}),null);
 assert.equal(manualSourceDecisionScope({...protocol(),referenceMetric:'ASS-sdr-ssim'}),null);
 assert.equal(sameDecisionReference(null,null),false);
 assert.equal(sameDecisionReference(null,guided()),false);
});
test('live Guided scope guards calibration, model reuse, and completed Native sample return',async()=>{
 const {readFile}=await import('node:fs/promises');
 const main=await readFile(new URL('./main.js',import.meta.url),'utf8');
 const manual=await readFile(new URL('./manual-transcode-comparison.js',import.meta.url),'utf8');
 assert.match(main,/guidedModelScopes:\s*\{\}/);
 assert.match(main,/function currentGuidedDecisionScope\(\)/);
 assert.match(main,/state\.guidedModelScopes\[id\]===sourceScope/);
 assert.match(main,/state\.guidedModelScopes\[selected\]===sourceScope/);
 assert.match(main,/calibration\.evidenceScope!==currentGuidedDecisionScope\(\)/);
 assert.match(main,/samplePlan\.decisionScope!==currentGuidedDecisionScope\(\)/);
 assert.match(main,/renderedReference=currentGuidedDecisionScope\(\)/);
 assert.match(main,/state\.guidedModelScopes\[codec\]=samplePlan\.decisionScope/);
 assert.match(manual,/manualSourceDecisionScope\(first\.protocol\)/);
 assert.match(manual,/referenceDomain:'pure-source-sdr-no-ass'/);
});
