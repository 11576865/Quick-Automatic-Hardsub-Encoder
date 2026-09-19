export async function detectCapabilities() {
  const result = {
    webAssembly: typeof WebAssembly !== 'undefined',
    worker: typeof Worker !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    webCodecsEncoder: typeof VideoEncoder !== 'undefined',
    webCodecsDecoder: typeof VideoDecoder !== 'undefined',
    nativePlayback: { h264: false, hevc: false, av1: false },
    codecs: {
      encode: { h264: false, hevc: false, av1: false },
      decode: { h264: false, hevc: false, av1: false }
    }
  };

  result.nativePlayback.h264 = await supportsNativePlayback([
    'video/mp4; codecs="avc1.640028"',
    'video/mp4; codecs="avc1.4D401F"'
  ]);
  result.nativePlayback.hevc = await supportsNativePlayback([
    'video/mp4; codecs="hvc1.1.6.L93.B0"',
    'video/mp4; codecs="hev1.1.6.L93.B0"'
  ]);
  result.nativePlayback.av1 = await supportsNativePlayback([
    'video/mp4; codecs="av01.0.08M.08"',
    'video/mp4; codecs="av01.0.05M.08"',
    'video/webm; codecs="av01.0.08M.08"'
  ]);

  if (result.webCodecsEncoder) {
    result.codecs.encode.h264 = await supportsAnyEncoder([
      { codec: 'avc1.640028', width: 1280, height: 720, bitrate: 2_500_000, framerate: 30 },
      { codec: 'avc1.4D401F', width: 1280, height: 720, bitrate: 2_500_000, framerate: 30 }
    ]);
    result.codecs.encode.hevc = await supportsAnyEncoder([
      { codec: 'hvc1.1.6.L93.B0', width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 },
      { codec: 'hev1.1.6.L93.B0', width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 }
    ]);
    result.codecs.encode.av1 = await supportsAnyEncoder([
      { codec: 'av01.0.08M.08', width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 },
      { codec: 'av01.0.05M.08', width: 640, height: 360, bitrate: 800_000, framerate: 30 }
    ]);
  }

  if (result.webCodecsDecoder) {
    result.codecs.decode.h264 = await supportsAnyDecoder([
      { codec: 'avc1.640028', codedWidth: 1280, codedHeight: 720 },
      { codec: 'avc1.4D401F', codedWidth: 1280, codedHeight: 720 }
    ]);
    result.codecs.decode.hevc = await supportsAnyDecoder([
      { codec: 'hvc1.1.6.L93.B0', codedWidth: 1280, codedHeight: 720 },
      { codec: 'hev1.1.6.L93.B0', codedWidth: 1280, codedHeight: 720 }
    ]);
    result.codecs.decode.av1 = await supportsAnyDecoder([
      { codec: 'av01.0.08M.08', codedWidth: 1280, codedHeight: 720 },
      { codec: 'av01.0.05M.08', codedWidth: 640, codedHeight: 360 }
    ]);
  }

  return result;
}

async function supportsNativePlayback(contentTypes) {
  const video = document.createElement('video');
  const canPlay = contentTypes.some(type => {
    try { return video.canPlayType(type) !== ''; }
    catch { return false; }
  });

  if (!navigator.mediaCapabilities?.decodingInfo) return canPlay;

  for (const contentType of contentTypes) {
    try {
      const info = await navigator.mediaCapabilities.decodingInfo({
        type: 'file',
        video: {
          contentType,
          width: 1280,
          height: 720,
          bitrate: 2_500_000,
          framerate: 30
        }
      });
      if (info.supported) return true;
    } catch {}
  }
  return canPlay;
}

async function supportsAnyEncoder(configs) {
  for (const config of configs) {
    if (await supportsEncoder(config)) return true;
  }
  return false;
}

async function supportsAnyDecoder(configs) {
  for (const config of configs) {
    if (await supportsDecoder(config)) return true;
  }
  return false;
}

async function supportsEncoder(config) {
  try {
    const r = await VideoEncoder.isConfigSupported({
      ...config,
      hardwareAcceleration: 'prefer-hardware'
    });
    if (r.supported) return true;
  } catch {}
  try {
    const r = await VideoEncoder.isConfigSupported(config);
    return !!r.supported;
  } catch {
    return false;
  }
}

async function supportsDecoder(config) {
  try {
    const r = await VideoDecoder.isConfigSupported({
      ...config,
      hardwareAcceleration: 'prefer-hardware'
    });
    if (r.supported) return true;
  } catch {}
  try {
    const r = await VideoDecoder.isConfigSupported(config);
    return !!r.supported;
  } catch {
    return false;
  }
}
