const WINDOWS_BRIDGE_PARAM = 'windowsNative';
const WINDOWS_TOKEN_PARAM = 'token';

function bridgeLaunchConfig() {
  const url = new URL(window.location.href);
  const base = url.searchParams.get(WINDOWS_BRIDGE_PARAM);
  const token = url.searchParams.get(WINDOWS_TOKEN_PARAM);
  if (!base || !token) return null;

  try {
    const parsed = new URL(base);
    const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (parsed.protocol !== 'http:' || !loopback) return null;
    return { base: parsed.origin, token };
  } catch {
    return null;
  }
}

function stripLaunchSecrets() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(WINDOWS_TOKEN_PARAM)) return;
  url.searchParams.delete(WINDOWS_TOKEN_PARAM);
  url.searchParams.delete(WINDOWS_BRIDGE_PARAM);
  history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
}

function makeSyncRequest(config, method, path, body = null) {
  const xhr = new XMLHttpRequest();
  xhr.open(method, config.base + path, false);
  xhr.setRequestHeader('X-Quick-Hardsub-Token', config.token);
  if (body != null) xhr.setRequestHeader('Content-Type', 'application/json');
  try {
    xhr.send(body == null ? null : JSON.stringify(body));
  } catch (error) {
    throw new Error('Windows Native Bridge 请求失败：' + error.message);
  }
  if (xhr.status < 200 || xhr.status >= 300) {
    let message = 'HTTP ' + xhr.status;
    try {
      const parsed = JSON.parse(xhr.responseText || '{}');
      if (parsed.error) message = parsed.error;
    } catch {}
    throw new Error(message);
  }
  return xhr.responseText || '{}';
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
  const bridge = {
    __windowsNative: true,
    getBackendInfo() {
      return JSON.stringify(backendInfo);
    },
    getLocalBenchmarkHistory() {
      try { return makeSyncRequest(config, 'GET', '/api/history'); }
      catch { return JSON.stringify({ records: [] }); }
    },
    preparePickerRole(role) {
      if (!['video', 'ass', 'fonts'].includes(role)) return;
      void makeRequest(config, 'POST', '/api/pick/' + role)
        .then(payload => postCallback('__onNativePickerResult', payload))
        .catch(error => postCallback('__onNativePickerResult', { role, count: 0, error: error.message }));
    },
    readSelectedAssFile() {
      return makeSyncRequest(config, 'GET', '/api/selection/ass');
    },
    probeSelectedVideo() {
      void makeRequest(config, 'POST', '/api/probe')
        .then(payload => postCallback('__onNativeInputProbe', payload))
        .catch(error => postCallback('__onNativeInputProbe', { ok: false, error: error.message }));
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
    startNativeEncode(requestJson, assText) {
      let request = {};
      try { request = JSON.parse(requestJson || '{}'); } catch {}
      return makeSyncRequest(config, 'POST', '/api/encode', { request, assText });
    },
    getNativeJobStatus(jobId) {
      return makeSyncRequest(config, 'GET', '/api/jobs/' + encodeURIComponent(jobId));
    },
    cancelNativeEncode(jobId) {
      try { makeSyncRequest(config, 'POST', '/api/jobs/' + encodeURIComponent(jobId) + '/cancel'); }
      catch {}
    },
    requestNativeExport(jobId, suggestedName) {
      void makeRequest(config, 'POST', '/api/jobs/' + encodeURIComponent(jobId) + '/export', { suggestedName })
        .then(payload => postCallback('__onNativeExportResult', payload))
        .catch(error => postCallback('__onNativeExportResult', { ok: false, error: error.message }));
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
  try {
    const response = await fetch(config.base + '/api/health', {
      cache: 'no-store',
      headers: { 'X-Quick-Hardsub-Token': config.token },
      signal: controller.signal
    });
    if (!response.ok) return false;
    const backendInfo = await response.json();
    if (backendInfo?.backend !== 'windows-native' || backendInfo?.available !== true) return false;
    installWindowsBridge(config, backendInfo);
    stripLaunchSecrets();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
