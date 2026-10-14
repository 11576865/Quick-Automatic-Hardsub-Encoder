import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedTaskPresentation,executeGuidedTask} from './shared-task-presentation.js';
test('guided and professional modes expose one task workspace with different parameter visibility',()=>{
 const guided=sharedTaskPresentation({operation:'hardsub',strategy:'guided',sourceReady:true});
 const manual=sharedTaskPresentation({operation:'hardsub',strategy:'manual',sourceReady:true});
 assert.equal(guided.workspaceSuppressed,false);assert.equal(manual.workspaceSuppressed,false);
 assert.equal(guided.hideParameters,true);assert.equal(manual.hideParameters,false);
 assert.equal(guided.hideLegacyExecution,true);assert.equal(guided.hideGoalExplorer,false);
});
test('legacy recovered jobs retain their original save and monitor surface',()=>{
 const p=sharedTaskPresentation({operation:'hardsub',strategy:'guided',sourceReady:true,legacyJob:true});
 assert.equal(p.hideLegacyExecution,false);
});
test('guided execution delegates to the shared current task without reconstructing settings',async()=>{
 const task={encoder:'libx265',preset:'fast',audioPlan:[{sourceOrdinal:0,action:'copy'}]};
 const completed=await executeGuidedTask({legacyJob:false,shared:{runCurrent:async()=>({task,outputBytes:100})},runLegacy:()=>{throw Error('wrong executor');}});
 assert.equal(completed.task,task);assert.equal(completed.outputBytes,100);
});
test('recovered job execution exclusively uses legacy export route',async()=>{
 const r=await executeGuidedTask({legacyJob:true,shared:{runCurrent:()=>{throw Error('must not restart');}},runLegacy:async()=>({saved:true})});
 assert.equal(r.saved,true);
});
