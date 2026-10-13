import test from 'node:test';
import assert from 'node:assert/strict';
import {completedGuidedNativeBudget,formatCompletedGuidedNativeBudget} from './native-guided-budget-recovery.js';

const formatBytes = value=>value+'B';
const base={ok:true,state:'completed',outputBytes:1100000,
  budgetProjection:{plannedBytes:1050000,budgetBytes:1200000,policy:'best-effort',
    costBasis:'measured-source-packets',withinBudget:true,strictVerified:false}};

test('Native completed snapshot recovers measured byte budget without trusting a client cache',()=>{
  const result=completedGuidedNativeBudget(base,'recovered-1');
  assert.equal(result.provenance,'native-status');
  assert.equal(result.actualBytes,1100000);
  assert.equal(result.plannedBytes,1050000);
  assert.equal(result.errorPercent,(1100000-1050000)/1050000*100);
  assert.equal(result.withinBudget,true);
  assert.equal(result.strictVerified,false);
  const summary=formatCompletedGuidedNativeBudget(result,formatBytes);
  assert.match(summary,/规划 1050000B/);
  assert.match(summary,/目标上限 1200000B/);
  assert.doesNotMatch(summary,/严格字节上限已由 Native 核验/);
});
test('only completed Native strict output can attest a byte-ceiling verification',()=>{
  const success={...base,budgetProjection:{...base.budgetProjection,policy:'strict-ceiling',
    strictVerified:true}};
  const verified=completedGuidedNativeBudget(success,'strict-1');
  assert.equal(verified.strictVerified,true);
  assert.match(formatCompletedGuidedNativeBudget(verified,formatBytes),/严格字节上限已由 Native 核验/);
  const unverified=completedGuidedNativeBudget({...success,
    budgetProjection:{...success.budgetProjection,strictVerified:false}},'strict-1');
  assert.equal(unverified.strictVerified,false);
  assert.match(formatCompletedGuidedNativeBudget(unverified,formatBytes),/验收凭据不完整/);
  const over=completedGuidedNativeBudget({...success,outputBytes:1400000},'strict-1');
  assert.equal(over.strictVerified,false);
  assert.equal(over.withinBudget,false);
  assert.match(formatCompletedGuidedNativeBudget(over,formatBytes),/已超出目标/);
});
test('recovery never invents Native strict proof from ephemeral plan or other job',()=>{
  const ephemeral={jobId:'old',plannedBytes:1000000,budgetBytes:1200000,policy:'strict-ceiling'};
  assert.equal(completedGuidedNativeBudget({...base,budgetProjection:null},'new',ephemeral),null);
  const transient=completedGuidedNativeBudget({...base,budgetProjection:null},'old',ephemeral);
  assert.equal(transient.provenance,'transient-plan');
  assert.equal(transient.strictVerified,false);
  assert.equal(completedGuidedNativeBudget({...base,state:'encoding'},'old',ephemeral),null);
  assert.equal(completedGuidedNativeBudget({...base,outputBytes:0},'old',ephemeral),null);
  assert.equal(completedGuidedNativeBudget({...base,budgetProjection:{...base.budgetProjection,plannedBytes:NaN}},'new'),null);
});
test('recoverable Native budget is wired to both normal completion and page refresh',async()=>{
  const {readFile}=await import('node:fs/promises');
  const [main,bridge]=await Promise.all([
    readFile(new URL('./main.js',import.meta.url),'utf8'),
    readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8')
  ]);
  assert.match(main,/plannedWholeFileBytes:plan\.mode==='budget-rate'\?plan\.plannedBytes:0/);
  assert.match(main,/budgetCostBasis:plan\.mode==='budget-rate'\?plan\.budgetCostBasis:''/);
  const recovery=main.slice(main.indexOf('async function recoverNativeJob()'),
    main.indexOf('function sleepMs(',main.indexOf('async function recoverNativeJob()')));
  assert.match(recovery,/completedGuidedNativeBudget\(status,jobId\)/);
  assert.match(recovery,/formatCompletedGuidedNativeBudget\(comparison,formatBytes\)/);
  const monitor=main.slice(main.indexOf('async function monitorNativeJob('),
    main.indexOf('async function recoverNativeJob()'));
  assert.match(monitor,/completedGuidedNativeBudget\(/);
  const getStatus=bridge.slice(bridge.indexOf('function Get-JobStatus('),
    bridge.indexOf('function Export-Job(',bridge.indexOf('function Get-JobStatus(')));
  assert.equal((getStatus.match(/Get-GuidedCompletedBudgetProjection \$j \$actualBytes/g)||[]).length,2);
});

test('a page reload reads the completed Native receipt rather than losing size comparison',async()=>{
  const {readFile}=await import('node:fs/promises');
  const vm=await import('node:vm');
  const main=await readFile(new URL('./main.js',import.meta.url),'utf8');
  const start=main.indexOf('async function recoverNativeJob()');
  const end=main.indexOf('function sleepMs(',start);
  assert.ok(start>=0&&end>start);
  const elements=new Map();
  const $=id=>{
    if(!elements.has(id))elements.set(id,{
      textContent:'',disabled:false,style:{width:''},
      classList:{add(){},remove(){}}
    });
    return elements.get(id);
  };
  const state={nativeCompletedJob:null,nativeJobProjection:null};
  const snapshot={...base,budgetProjection:{
    ...base.budgetProjection,policy:'strict-ceiling',strictVerified:true
  }};
  let queries=0;
  const context=vm.createContext({
    state,$,JSON,Number,
    completedGuidedNativeBudget,formatCompletedGuidedNativeBudget,formatBytes,
    syncMobileStageNav(){},setMobileStage(){},log(){},
    document:{body:{classList:{contains:()=>false}}},
    localStorage:{getItem:key=>key==='nativeEncodeJobId'?'recovered-strict':null,
      removeItem(){throw Error('Completed job must remain recoverable');}},
    NativeHardsub:{async getNativeJobStatus(id){
      queries++;assert.equal(id,'recovered-strict');return JSON.stringify(snapshot);
    }}
  });
  vm.runInContext(main.slice(start,end),context);
  await context.recoverNativeJob();
  assert.equal(queries,1);
  assert.equal(state.nativeCompletedJob.jobId,'recovered-strict');
  assert.equal(state.nativeCompletedJob.sizeComparison.strictVerified,true);
  assert.match($('liveEta').textContent,/规划 1050000B/);
  assert.match($('liveEta').textContent,/严格字节上限已由 Native 核验/);
  assert.equal($('encodeBtn').disabled,false);
  assert.equal($('progressBar').style.width,'100%');
});
