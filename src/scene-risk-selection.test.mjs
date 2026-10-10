import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneProbeStarts,normalizedSceneRisk,selectPairedSceneWindows,refinementOpportunity} from './scene-risk-selection.js';
test('short and unseekable sources provide bounded unique positions',()=>{
 assert.deepEqual(sceneProbeStarts(0),[]);
 assert.deepEqual(selectPairedSceneWindows({durationSeconds:1,seekable:false,maxWindows:3}).starts,[0]);
 const p=sceneProbeStarts(120,2);
 assert.ok(p.length<=6 && p.length>=3);
 assert.ok(p.every(x=>x>=0&&x<=118));
});
test('high motion, dark and busy subtitle windows displace uniform picks without unpaired branches',()=>{
 const starts=sceneProbeStarts(120,2);
 const dense=[{kind:'Dialogue',startSeconds:starts[3],endSeconds:starts[3]+1.8}];
 const probes=starts.map(start=>({start,meanLuma:160,meanYdif:2,peakScene:1,meanContrast:30}));
 probes[1]={start:starts[1],meanLuma:80,meanYdif:35,peakScene:23,meanContrast:150};
 probes[4]={start:starts[4],meanLuma:8,meanYdif:2,peakScene:2,meanContrast:90};
 const p=selectPairedSceneWindows({durationSeconds:120,probes,subtitleEvents:dense});
 assert.equal(p.ok,true);
 assert.equal(p.riskAware,true);
 assert.equal(p.starts.length,3);
 assert.ok(p.starts.includes(starts[1]));
 assert.ok(p.starts.includes(starts[4]));
 assert.equal(p.fingerprint.includes('paired-scene-strata-v1'),true);
 const again=selectPairedSceneWindows({durationSeconds:120,probes,subtitleEvents:dense});
 assert.deepEqual(again,p);
});
test('no measured visual signals is explicitly not called scene-aware',()=>{
 const p=selectPairedSceneWindows({durationSeconds:80});
 assert.equal(p.riskAware,false);
 assert.equal(p.probedWindows,0);
 assert.equal(normalizedSceneRisk({}),null);
 assert.equal(normalizedSceneRisk({meanLuma:false}),null);
});
test('observed decision ambiguity may justify another affordable paired probe',()=>{
 const candidate=[
  {id:'A',lowerQuality:.965,upperQuality:.980},
  {id:'B',lowerQuality:.970,upperQuality:.975}
 ];
 const result=refinementOpportunity({candidates:candidate,budgetRemainingSeconds:12,nextPairedCostSeconds:6});
 assert.equal(result.refine,true);
 assert.equal(result.leaderId,'B');
 assert.equal(refinementOpportunity({candidates:candidate,budgetRemainingSeconds:3,nextPairedCostSeconds:6}).reason,'budget-exhausted');
 assert.equal(refinementOpportunity({candidates:[
  {id:'A',lowerQuality:.990,upperQuality:.995},{id:'B',lowerQuality:.95,upperQuality:.96}
 ],budgetRemainingSeconds:12,nextPairedCostSeconds:6}).reason,'robust-dominance');
});
