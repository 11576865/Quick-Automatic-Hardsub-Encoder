import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { detectWindowsNativeBridge } from './windows-native-client.js';

const response = payload => ({
  ok: true,
  async json() { return payload; }
});

test('Windows native input probe publishes only the newest selection result', async () => {
  const oldWindow = globalThis.window;
  const oldHistory = globalThis.history;
  const oldFetch = globalThis.fetch;
  const oldBridge = globalThis.NativeHardsub;
  const oldCallback = globalThis.__onNativeInputProbe;

  const pendingProbes = [];
  const callbacks = [];

  globalThis.window = {
    location: {
      href: 'http://localhost/?windowsNative=http://127.0.0.1:9347&token=test-token'
    }
  };
  globalThis.history = { replaceState() {} };
  globalThis.fetch = async url => {
    const text = String(url);
    if (text.endsWith('/api/health')) {
      return response({ backend: 'windows-native', available: true });
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
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldHistory === undefined) delete globalThis.history; else globalThis.history = oldHistory;
    if (oldFetch === undefined) delete globalThis.fetch; else globalThis.fetch = oldFetch;
    if (oldBridge === undefined) delete globalThis.NativeHardsub; else globalThis.NativeHardsub = oldBridge;
    if (oldCallback === undefined) delete globalThis.__onNativeInputProbe; else globalThis.__onNativeInputProbe = oldCallback;
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
