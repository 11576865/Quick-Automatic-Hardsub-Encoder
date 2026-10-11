import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('guided native monitor stops bounded status retries without abandoning job ownership', async () => {
  const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function monitorNativeJob(jobId');
  const end = source.indexOf('async function recoverNativeJob()', start);
  assert(start > 0 && end > start);

  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        textContent: '',
        disabled: false,
        classList: { add() {}, remove() {} },
        style: { width: '' }
      });
    }
    return elements.get(id);
  };

  const logs = [];
  let lockSyncs = 0;
  let statusReads = 0;
  const state = {
    nativeJobId: 'job-1',
    selectedCodec: null,
    media: null
  };
  const storage = new Map([['nativeEncodeJobId', 'job-1']]);

  const context = vm.createContext({
    state,
    $: element,
    log: message => logs.push(message),
    sleepMs: async () => {},
    syncTaskInputMutationLocks: () => { lockSyncs++; },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    NativeHardsub: {
      async getNativeJobStatus() {
        statusReads++;
        return JSON.stringify({ ok: false, error: 'bridge unavailable' });
      }
    },
    JSON,
    Number,
    Math,
    Promise
  });

  vm.runInContext(source.slice(start, end), context);
  await context.monitorNativeJob('job-1');

  assert.equal(statusReads, 5);
  assert.equal(state.nativeJobId, 'job-1');
  assert.equal(storage.get('nativeEncodeJobId'), 'job-1');
  assert.equal(lockSyncs, 1);
  assert.match(element('liveEta').textContent, /任务 ID 已保留/);
  assert.equal(logs.length, 5);
  assert.match(logs.at(-1), /5\/5/);
});

test('page refresh paints the recovered two-pass snapshot without a second Bridge request', async () => {
  const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function monitorNativeJob(jobId');
  const end = source.indexOf('function sleepMs(', start);
  assert.ok(start > 0 && end > start);

  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', disabled: false, style: {width: ''},
      classList: {add() {},remove() {}}
    });
    return elements.get(id);
  };
  const state = {nativeJobId: null, nativeCompletedJob: null, nativeJobProjection: null,
    selectedCodec: null, media: null};
  const storage = new Map([['nativeEncodeJobId','long-film-1']]);
  let reads = 0;
  let releasePoll;
  const bridge = {
    async getNativeJobStatus(id) {
      assert.equal(id,'long-film-1');
      reads++;
      return JSON.stringify({
        ok:true,state:'encoding',progress:.618,pass:2,totalPasses:2,
        timeMs:118000,duration:3600,speed:.25
      });
    }
  };
  const context = vm.createContext({
    state, $: element, log() {}, nativePlatformName:()=> 'Windows Native',
    formatDuration:seconds => Math.round(seconds)+'秒',
    localPredictionForPlan:()=>null,
    syncTaskInputMutationLocks() {}, syncMobileStageNav() {}, setMobileStage() {},
    document:{body:{classList:{contains:()=>false}}},
    sleepMs:()=>new Promise(resolve=>{releasePoll=resolve}),
    localStorage:{
      getItem:key=>storage.get(key)||null,
      setItem:(key,value)=>storage.set(key,String(value)),
      removeItem:key=>storage.delete(key)
    },
    NativeHardsub:bridge,
    JSON,Number,Math,Promise
  });
  vm.runInContext(source.slice(start,end),context);
  await context.recoverNativeJob();
  assert.equal(reads,1,'do not wait for a second status request to restore the bar');
  assert.equal(state.nativeJobId,'long-film-1');
  assert.equal(element('progressBar').style.width,'61.8%');
  assert.match(element('liveEta').textContent,/第 2\/2 遍.*61\.8%/);
  assert.equal(element('encodeBtn').disabled,true);
  assert.ok(typeof releasePoll==='function','normal polling continues after initial paint');
});

test('incomplete or stale recovered progress cannot roll an active task backwards', async () => {
  const source=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8');
  const start=source.indexOf('async function monitorNativeJob(jobId');
  const end=source.indexOf('async function recoverNativeJob()',start);
  assert.ok(start>0&&end>start);
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{
      textContent:'',disabled:false,style:{width:''},
      classList:{add(){},remove(){}}
    });
    return elements.get(id);
  };
  const state={nativeJobId:'movie',selectedCodec:null,media:null};
  let reads=0;
  const observations=[];
  const bridge={async getNativeJobStatus(){
    reads++;
    if(reads===1)return JSON.stringify({ok:true,state:'encoding',progress:0,pass:2,totalPasses:2,
      duration:3600,timeMs:0,speed:0});
    if(reads===2)return JSON.stringify({ok:true,state:'validating'});
    return JSON.stringify({ok:true,state:'cancelled'});
  }};
  const context=vm.createContext({
    state,$:element,log(){},nativePlatformName:()=> 'Windows Native',
    localPredictionForPlan:()=>null,
    formatDuration:seconds => Math.round(seconds)+'秒',
    syncTaskInputMutationLocks(){},refreshBenchmarkEnabled(){},
    localStorage:{removeItem(){}},
    sleepMs:async()=>observations.push(element('progressBar').style.width),
    NativeHardsub:bridge,JSON,Math,Number,Promise
  });
  vm.runInContext(source.slice(start,end),context);
  await context.monitorNativeJob('movie',{ok:true,state:'encoding',progress:.75,pass:2,
    totalPasses:2,duration:3600,timeMs:1800000,speed:1});
  assert.deepEqual(observations,['75.0%','75.0%','99.0%']);
  assert.equal(element('progressBar').style.width,'0%','terminal cancellation may reset');
});

test('preflight guidance cannot overwrite a restored active encode status', () => {
  const source=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8');
  assert.match(source,/if \(!state\.nativeJobId && !state\.nativeCompletedJob && state\.selectedCodec && status\.backendReady && !status\.previewOk\)/);
});
