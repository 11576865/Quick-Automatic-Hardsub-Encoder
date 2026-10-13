import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('source-owned measured budget refreshes the guided frontier without replacing CQ evidence',async()=>{
  const [main,workspace]=await Promise.all([
    readFile(new URL('./main.js',import.meta.url),'utf8'),
    readFile(new URL('./media-workspace.js',import.meta.url),'utf8')
  ]);
  assert.match(main,/onBudgetEvidenceChange: \(\) => \{/);
  assert.match(main,/onBudgetEvidenceChange: \(\) => \{[\s\S]*?updateSizeBudgetPreview\(\);[\s\S]*?renderPlanOptions\(\);/);
  assert.match(workspace,/transcodeCurves\.invalidate\(\);hooks\.onBudgetEvidenceChange\?\.\(\);syncTaskActions\(\);/);
  assert.match(workspace,/const mediaInfoListener = \(\) => \{[^\n]*hooks\.onBudgetEvidenceChange\?\.\(\);/);
  assert.match(workspace,/getActiveBudgetEvidence:\(\)=>budgetSourceIdentity===hooks\.videoIdentity\?\.\(\)\?budgetEvidence:null/);
});

test('Guided size feasibility and output bitrate use the same measured ledger as the shared compiler',async()=>{
  const main=await readFile(new URL('./main.js',import.meta.url),'utf8');
  assert.match(main,/assessGuidedWholeFileBudget\(\{/);
  assert.match(main,/evidence:mediaWorkspace\?\.getActiveBudgetEvidence\?\.\(\)\|\|null/);
  assert.match(main,/const ceilingVideoBitrate = feasibility\.availableVideoBitrate;/);
  assert.match(main,/const targetVideoBitrate = ceilingVideoBitrate;/);
  assert.match(main,/const containerReserveBytes = feasibility\.containerReserveBytes;/);
  assert.match(main,/capacity\?\.status === 'unknown'/);
  assert.match(main,/复制音轨的完整源文件包字节尚未测量/);
  const start=main.indexOf('function buildEncodePlan(codec)');
  const end=main.indexOf('function downloadBlob(',start);
  const builder=main.slice(start,end);
  assert.doesNotMatch(builder,/Math\.floor\(sizeCeiling \* 0\.96\)/);
  assert.doesNotMatch(builder,/const sourceEquivalent =/);
  assert.doesNotMatch(builder,/estimatedSizeBudgetAudioBitrate\(\)/);
});

test('audio setting mutations and restored configurations invalidate the Guided whole-file projection',async()=>{
  const workspace=await readFile(new URL('./media-workspace.js',import.meta.url),'utf8');
  assert.match(workspace,/const applyConfig=raw=>\{[^\n]*audioStreamPlan\.refresh\(\);hooks\.onBudgetEvidenceChange\?\.\(\);\};/);
  const start=workspace.indexOf('const invalidateCompiledPlan = event =>');
  const end=workspace.indexOf("outputPolicy?.addEventListener('input'",start);
  assert.ok(start>=0&&end>start);
  const invalidation=workspace.slice(start,end);
  for(const field of ['audio','audioTrack','audioRange','audioBitrate',
    'audioChannels','audioSampleRate','audioPlan']){
    assert.match(invalidation,new RegExp("'"+field+"'"));
  }
  assert.match(invalidation,/hooks\.onBudgetEvidenceChange\?\.\(\);/);
  assert.match(workspace,/form\.addEventListener\('input',invalidateCompiledPlan\)/);
  assert.match(workspace,/form\.addEventListener\('change',invalidateCompiledPlan\)/);
});
