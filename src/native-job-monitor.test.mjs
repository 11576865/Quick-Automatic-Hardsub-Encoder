import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('guided native monitor stops bounded status retries without abandoning job ownership', async () => {
  const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function monitorNativeJob(jobId)');
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
