import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { detectWindowsNativeBridge } from './windows-native-client.js';

const response = (payload, ok = true) => ({
  ok,
  async json() { return payload; }
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    snapshot() { return new Map(map); }
  };
}

function snapshotGlobals() {
  return {
    window: globalThis.window,
    history: globalThis.history,
    fetch: globalThis.fetch,
    NativeHardsub: globalThis.NativeHardsub,
    inputProbe: globalThis.__onNativeInputProbe
  };
}

function restoreGlobals(old) {
  for (const [name, value] of Object.entries({
    window: old.window,
    history: old.history,
    fetch: old.fetch,
    NativeHardsub: old.NativeHardsub,
    __onNativeInputProbe: old.inputProbe
  })) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
}

test('Windows native bridge survives a page refresh through tab-scoped session state', async () => {
  const old = snapshotGlobals();
  const storage = memoryStorage();
  const replaced = [];
  const requests = [];
  globalThis.window = {
    location: {
      href: 'https://11576865.github.io/Quick-Automatic-Hardsub-Encoder/?windowsNative=http://127.0.0.1:9347&token=test-token'
    },
    sessionStorage: storage
  };
  globalThis.history = { replaceState(_state, _title, url) { replaced.push(url); } };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), token: options.headers?.['X-Quick-Hardsub-Token'] });
    if (String(url).endsWith('/api/health')) {
      return response({ backend: 'windows-native', available: true });
    }
    if (String(url).endsWith('/api/history')) {
      return response({ schemaVersion: 1, count: 1, records: [{ codec: 'av1', averageSpeed: 2 }] });
    }
    throw new Error('Unexpected request: ' + url);
  };

  try {
    assert.equal(await detectWindowsNativeBridge(), true);
    const saved = JSON.parse(storage.getItem('quick-hardsub-windows-bridge-v1'));
    assert.deepEqual(saved, { base: 'http://127.0.0.1:9347', token: 'test-token' });
    assert.equal(replaced.at(-1), '/Quick-Automatic-Hardsub-Encoder/');
    assert.equal(requests.at(-1).token, 'test-token');
    assert.equal(JSON.parse(globalThis.NativeHardsub.getLocalBenchmarkHistory()).records.length, 1);

    delete globalThis.NativeHardsub;
    globalThis.window.location.href = 'https://11576865.github.io/Quick-Automatic-Hardsub-Encoder/';
    assert.equal(await detectWindowsNativeBridge(), true);
    assert.equal(globalThis.NativeHardsub.__windowsNative, true);
    assert.equal(requests.at(-1).url, 'http://127.0.0.1:9347/api/history');
    assert.equal(requests.at(-1).token, 'test-token');
  } finally {
    restoreGlobals(old);
  }
});

test('stale Windows bridge session state is cleared when the local bridge is gone', async () => {
  const old = snapshotGlobals();
  const storage = memoryStorage();
  storage.setItem('quick-hardsub-windows-bridge-v1', JSON.stringify({
    base: 'http://127.0.0.1:9347',
    token: 'expired-token'
  }));
  globalThis.window = {
    location: { href: 'https://11576865.github.io/Quick-Automatic-Hardsub-Encoder/' },
    sessionStorage: storage
  };
  globalThis.history = { replaceState() {} };
  globalThis.fetch = async () => { throw new Error('connection refused'); };

  try {
    assert.equal(await detectWindowsNativeBridge(), false);
    assert.equal(storage.getItem('quick-hardsub-windows-bridge-v1'), null);
  } finally {
    restoreGlobals(old);
  }
});

test('Windows native input probe publishes only the newest selection result', async () => {
  const old = snapshotGlobals();
  const storage = memoryStorage();
  const pendingProbes = [];
  const callbacks = [];
  globalThis.window = {
    location: {
      href: 'http://localhost/?windowsNative=http://127.0.0.1:9347&token=test-token'
    },
    sessionStorage: storage
  };
  globalThis.history = { replaceState() {} };
  globalThis.fetch = async url => {
    const text = String(url);
    if (text.endsWith('/api/health')) {
      return response({ backend: 'windows-native', available: true });
    }
    if (text.endsWith('/api/history')) {
      return response({ schemaVersion: 1, count: 0, records: [] });
    }
    if (text.endsWith('/api/probe')) {
      return await new Promise(resolve => pendingProbes.push(resolve));
    }
    throw new Error('Unexpected request: ' + text);
  };
  globalThis.__onNativeInputProbe = payload => callbacks.push(JSON.parse(payload));

  try {
    assert.equal(await detectWindowsNativeBridge(), true);
    globalThis.NativeHardsub.probeSelectedVideo();
    globalThis.NativeHardsub.probeSelectedVideo();
    assert.equal(pendingProbes.length, 2);

    pendingProbes[1](response({ ok: true, width: 1920, height: 1080, videoCodec: 'h264' }));
    await new Promise(resolve => setTimeout(resolve, 0));
    pendingProbes[0](response({ ok: true, width: 640, height: 360, videoCodec: 'old' }));
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(callbacks.length, 1);
    assert.equal(callbacks[0].width, 1920);
    assert.equal(callbacks[0].probeGeneration, 2);
  } finally {
    restoreGlobals(old);
  }
});

test('Windows native bridge persists compression evidence into its cached history', async () => {
  const old = snapshotGlobals();
  const storage = memoryStorage();
  let records = [];
  globalThis.window = {
    location: {
      href: 'http://localhost/?windowsNative=http://127.0.0.1:9347&token=test-token'
    },
    sessionStorage: storage
  };
  globalThis.history = { replaceState() {} };
  globalThis.fetch = async (url, options = {}) => {
    const text = String(url);
    if (text.endsWith('/api/health')) {
      return response({ backend: 'windows-native', available: true });
    }
    if (text.endsWith('/api/history') && (options.method || 'GET') === 'GET') {
      return response({ schemaVersion: 1, count: records.length, records });
    }
    if (text.endsWith('/api/history') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      records = [...records, { ...body.record, recordedAt: 123 }];
      return response({ ok: true, schemaVersion: 1, count: records.length, records, recordedAt: 123 });
    }
    throw new Error('Unexpected request: ' + text);
  };

  try {
    assert.equal(await detectWindowsNativeBridge(), true);
    const payload = JSON.parse(await globalThis.NativeHardsub.recordCompressionEvidence(JSON.stringify({
      evidenceKind: 'quality-sample',
      sourceIdentity: 'src-1234abcd',
      codec: 'av1',
      preset: '6',
      ssim: 0.99,
      sampleBitrate: 800000
    })));
    assert.equal(payload.ok, true);
    const snapshot = JSON.parse(globalThis.NativeHardsub.getLocalBenchmarkHistory());
    assert.equal(snapshot.records.length, 1);
    assert.equal(snapshot.records[0].sourceIdentity, 'src-1234abcd');
  } finally {
    restoreGlobals(old);
  }
});


test('Windows Bink 2 adapter client uses owned localhost import endpoints', async () => {
  const old = snapshotGlobals();
  const storage = memoryStorage();
  const requests = [];
  globalThis.window = {
    location: {
      href: 'http://localhost/?windowsNative=http://127.0.0.1:9347&token=test-token'
    },
    sessionStorage: storage
  };
  globalThis.history = { replaceState() {} };
  globalThis.fetch = async (url, options = {}) => {
    const text = String(url);
    requests.push({ url: text, method: options.method || 'GET' });
    if (text.endsWith('/api/health')) {
      return response({ backend: 'windows-native', available: true, bink2ImportAvailable: true });
    }
    if (text.endsWith('/api/selection/video')) {
      return response({ ok: true, name: 'intro.bk2', size: 1234, lastModified: 77 });
    }
    if (text.endsWith('/api/import/bink2')) {
      return response({ ok: true, jobId: 'import-1', state: 'importing' });
    }
    if (text.endsWith('/api/import-jobs/import-1/cancel')) {
      return response({ ok: true, state: 'cancelling' });
    }
    if (text.endsWith('/api/import-jobs/import-1')) {
      return response({ ok: true, jobId: 'import-1', state: 'importing', elapsedSeconds: 1.25 });
    }
    throw new Error('Unexpected request: ' + text);
  };

  try {
    assert.equal(await detectWindowsNativeBridge(), true);
    const selected = JSON.parse(await globalThis.NativeHardsub.readSelectedVideoInfo());
    assert.equal(selected.name, 'intro.bk2');

    const started = JSON.parse(await globalThis.NativeHardsub.startBink2Import());
    assert.equal(started.jobId, 'import-1');

    const status = JSON.parse(await globalThis.NativeHardsub.getBink2ImportStatus('import-1'));
    assert.equal(status.state, 'importing');

    globalThis.NativeHardsub.cancelBink2Import('import-1');
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.ok(requests.some(x => x.url.endsWith('/api/import/bink2') && x.method === 'POST'));
    assert.ok(requests.some(x => x.url.endsWith('/api/import-jobs/import-1') && x.method === 'GET'));
    assert.ok(requests.some(x => x.url.endsWith('/api/import-jobs/import-1/cancel') && x.method === 'POST'));
  } finally {
    restoreGlobals(old);
  }
});

test('Android native input probe suppresses stale generations before callback', async () => {
  const kotlin = await readFile(
    new URL('../android-native/app/src/main/java/io/github/quickhardsub/NativeBridge.kt', import.meta.url),
    'utf8'
  );

  assert.match(kotlin, /inputProbeGeneration = AtomicInteger\(0\)/);
  assert.match(kotlin, /val generation = inputProbeGeneration\.incrementAndGet\(\)/);
  assert.match(kotlin, /if \(generation == inputProbeGeneration\.get\(\)\) \{\s*postJsonCallback\("__onNativeInputProbe", result\)/);
});
