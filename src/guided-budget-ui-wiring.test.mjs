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
