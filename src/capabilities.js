export async function detectCapabilities() {
  const result = {
    webAssembly: typeof WebAssembly !== 'undefined',
    worker: typeof Worker !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    webCodecs: typeof VideoEncoder !== 'undefined',
    codecs: {}
  };

  if (result.webCodecs) {
    result.codecs.h264 = await supports({ codec: 'avc1.640028', width: 1280, height: 720, bitrate: 2_500_000, framerate: 30 });
    result.codecs.av1 = await supports({ codec: 'av01.0.08M.08', width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 });
    result.codecs.hevc = await supports({ codec: 'hvc1.1.6.L93.B0', width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 });
  }
  return result;
}

async function supports(config) {
  try {
    const r = await VideoEncoder.isConfigSupported({ ...config, hardwareAcceleration: 'prefer-hardware' });
    return !!r.supported;
  } catch {
    return false;
  }
}
