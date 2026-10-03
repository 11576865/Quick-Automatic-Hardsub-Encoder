const WINDOWS_BRIDGE_PARAM = 'windowsNative';
const WINDOWS_TOKEN_PARAM = 'token';
const WINDOWS_SESSION_KEY = 'quick-hardsub-windows-bridge-v1';

function normalizeBridgeConfig(base, token, source = 'url') {
  if (!base || !token) return null;
  try {
    const parsed = new URL(base);
    const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (parsed.protocol !== 'http:' || !loopback) return null;
    return { base: parsed.origin, token: String(token), source };
  } catch {
    return null;
  }
}

function bridgeSessionStorage() {
  try {
    return window.sessionStorage || globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function readStoredBridgeConfig() {
  try {
    const raw = bridgeSessionStorage()?.getItem(WINDOWS_SESSION_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    return normalizeBridgeConfig(stored?.base, stored?.token, 'session');
  } catch {
    return null;
  }
}

function persistBridgeConfig(config) {
  if (!config?.base || !config?.token) return;
  try {
    bridgeSessionStorage()?.setItem(
      WINDOWS_SESSION_KEY,
      JSON.stringify({ base: config.base, token: config.token })
    );
  } catch {}
}

function clearStoredBridgeConfig() {
  try { bridgeSessionStorage()?.removeItem(WINDOWS_SESSION_KEY); } catch {}
}

function bridgeLaunchConfig() {
  const url = new URL(window.location.href);
  const base = url.searchParams.get(WINDOWS_BRIDGE_PARAM);
  const token = url.searchParams.get(WINDOWS_TOKEN_PARAM);
  if (base || token) return normalizeBridgeConfig(base, token, 'url');
  return readStoredBridgeConfig();
}

function stripLaunchSecrets() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(WINDOWS_TOKEN_PARAM)) return;
  url.searchParams.delete(WINDOWS_TOKEN_PARAM);
  url.searchParams.delete(WINDOWS_BRIDGE_PARAM);
  history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
}

async function makeRequest(config, method, path, body = null) {
  const response = await fetch(config.base + path, {
    method,
    cache: 'no-store',
    headers: {
      'X-Quick-Hardsub-Token': config.token,
      ...(body == null ? {} : { 'Content-Type': 'application/json' })
    },
    body: body == null ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || ('HTTP ' + response.status));
  return payload;
}

function postCallback(name, payload) {
  queueMicrotask(() => {
    try { globalThis[name]?.(JSON.stringify(payload)); } catch {}
  });
}

function installWindowsBridge(config, backendInfo) {
  let lastAssSelection = null;
  let inputProbeGeneration = 0;
  const bridge = {
    __windowsNative: true,
    getBackendInfo() {
      return JSON.stringify(backendInfo);
    },
    getLocalBenchmarkHistory() {
      return JSON.stringify({ records: [] });
    },
    preparePickerRole(role) {
      if (!['video', 'ass', 'fonts'].includes(role)) return;
      void makeRequest(config, 'POST', '/api/pick/' + role)
        .then(payload => {
          if (role === 'ass') lastAssSelection = payload?.files?.[0] || null;
          postCallback('__onNativePickerResult', payload);
        })
        .catch(error => postCallback('__onNativePickerResult', { role, count: 0, error: error.message }));
    },
    readSelectedAssFile() {
      if (!lastAssSelection?.base64) return JSON.stringify({ ok: false, error: 'No ASS selected.' });
      return JSON.stringify({ ok: true, ...lastAssSelection });
    },
    probeSelectedVideo() {
      const generation = ++inputProbeGeneration;
      void makeRequest(config, 'POST', '/api/probe')
        .then(payload => {
          if (generation !== inputProbeGeneration) return;
          postCallback('__onNativeInputProbe', { ...payload, probeGeneration: generation });
        })
        .catch(error => {
          if (generation !== inputProbeGeneration) return;
          postCallback('__onNativeInputProbe', { ok: false, probeGeneration: generation, error: error.message });
        });
    },
    async startBink2Import() {
      return JSON.stringify(await makeRequest(config, 'POST', '/api/import/bink2'));
    },
    async getBink2ImportStatus(jobId) {
      return JSON.stringify(await makeRequest(config, 'GET', '/api/import-jobs/' + encodeURIComponent(jobId)));
    },
    cancelBink2Import(jobId) {
      void makeRequest(config, 'POST', '/api/import-jobs/' + encodeURIComponent(jobId) + '/cancel').catch(() => {});
    },
    runSelfTest() {
      void makeRequest(config, 'GET', '/api/self-test')
        .then(payload => postCallback('__onNativeSelfTest', payload))
        .catch(error => postCallback('__onNativeSelfTest', { ok: false, error: error.message }));
    },
    renderNativePreview(requestId, timeSeconds, assText) {
      void makeRequest(config, 'POST', '/api/preview', { requestId, timeSeconds, assText })
        .then(payload => postCallback('__onNativePreview', payload))
        .catch(error => postCallback('__onNativePreview', { requestId, ok: false, error: error.message }));
    },
    renderNativeFrame(requestId, timeSeconds, width) {
      void makeRequest(config, 'POST', '/api/frame', { requestId, timeSeconds, width })
        .then(payload => postCallback('__onNativeFrame', payload))
        .catch(error => postCallback('__onNativeFrame', { requestId, ok: false, error: error.message }));
    },
    renderNativeWaveform(requestId, optionsJson) {
      let options = {};
      try { options = JSON.parse(optionsJson || '{}'); } catch {}
      void makeRequest(config, 'POST', '/api/waveform', { requestId, ...options })
        .then(payload => postCallback('__onNativeWaveform', payload))
        .catch(error => postCallback('__onNativeWaveform', { requestId, ok: false, error: error.message }));
    },
    runNativeSample(requestId, requestJson, assText) {
      let options = {};
      try { options = JSON.parse(requestJson || '{}'); } catch {}
      void makeRequest(config, 'POST', '/api/sample', { requestId, options, assText })
        .then(payload => postCallback('__onNativeSample', payload))
        .catch(error => postCallback('__onNativeSample', { requestId, ok: false, error: error.message }));
    },
    requestNativeSampleExport(sampleId, suggestedName) {
      void makeRequest(config, 'POST', '/api/sample/export', { sampleId, suggestedName })
        .then(payload => postCallback('__onNativeSampleExportResult', payload))
        .catch(error => postCallback('__onNativeSampleExportResult', { ok: false, error: error.message }));
    },
    async startNativeEncode(requestJson, assText) {
      let request = {};
      try { request = JSON.parse(requestJson || '{}'); } catch {}
      return JSON.stringify(await makeRequest(config, 'POST', '/api/encode', { request, assText }));
    },
    async getNativeJobStatus(jobId) {
      return JSON.stringify(await makeRequest(config, 'GET', '/api/jobs/' + encodeURIComponent(jobId)));
    },
    cancelNativeEncode(jobId) {
      void makeRequest(config, 'POST', '/api/jobs/' + encodeURIComponent(jobId) + '/cancel').catch(() => {});
    },
    requestNativeExport(jobId, suggestedName) {
      return makeRequest(config, 'POST', '/api/jobs/' + encodeURIComponent(jobId) + '/export', { suggestedName })
        .then(payload => {
          const result = { jobId, ...payload };
          postCallback('__onNativeExportResult', result);
          return result;
        })
        .catch(error => {
          const result = { ok: false, jobId, error: error.message };
          postCallback('__onNativeExportResult', result);
          return result;
        });
    }
  };

  globalThis.NativeHardsub = bridge;
  return bridge;
}

export async function detectWindowsNativeBridge() {
  if (globalThis.NativeHardsub?.getBackendInfo) return false;
  const config = bridgeLaunchConfig();
  if (!config) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  const failStoredSession = () => {
    if (config.source === 'session') clearStoredBridgeConfig();
    return false;
  };
  try {
    const response = await fetch(config.base + '/api/health', {
      cache: 'no-store',
      headers: { 'X-Quick-Hardsub-Token': config.token },
      signal: controller.signal
    });
    if (!response.ok) return failStoredSession();
    const backendInfo = await response.json();
    if (backendInfo?.backend !== 'windows-native' || backendInfo?.available !== true) return failStoredSession();
    installWindowsBridge(config, backendInfo);
    persistBridgeConfig(config);
    if (config.source === 'url') stripLaunchSecrets();
    return true;
  } catch {
    return failStoredSession();
  } finally {
    clearTimeout(timer);
  }
}
