export async function detectCapabilities() {
  const result = {
    webAssembly: typeof WebAssembly !== 'undefined',
    worker: typeof Worker !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    webCodecsEncoder: typeof VideoEncoder !== 'undefined',
    webCodecsDecoder: typeof VideoDecoder !== 'undefined',
    codecs: {
      encode: { h264: false, hevc: false, av1: false },
      decode: { h264: false, hevc: false, av1: false }
    }
  };

  if (result.webCodecsEncoder) {
    result.codecs.encode.h264 = await supportsEncoder({
      codec: 'avc1.640028',
      width: 1280,
      height: 720,
      bitrate: 2_500_000,
      framerate: 30
    });
    result.codecs.encode.hevc = await supportsEncoder({
      codec: 'hvc1.1.6.L93.B0',
      width: 1280,
      height: 720,
      bitrate: 2_000_000,
      framerate: 30
    });
    result.codecs.encode.av1 = await supportsEncoder({
      codec: 'av01.0.08M.08',
      width: 1280,
      height: 720,
      bitrate: 2_000_000,
      framerate: 30
    });
  }

  if (result.webCodecsDecoder) {
    result.codecs.decode.h264 = await supportsDecoder({
      codec: 'avc1.640028',
      codedWidth: 1280,
      codedHeight: 720
    });
    result.codecs.decode.hevc = await supportsDecoder({
      codec: 'hvc1.1.6.L93.B0',
      codedWidth: 1280,
      codedHeight: 720
    });
    result.codecs.decode.av1 = await supportsDecoder({
      codec: 'av01.0.08M.08',
      codedWidth: 1280,
      codedHeight: 720
    });
  }

  return result;
}

async function supportsEncoder(config) {
  try {
    const r = await VideoEncoder.isConfigSupported({
      ...config,
      hardwareAcceleration: 'prefer-hardware'
    });
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
    return !!r.supported;
  } catch {
    // Some browsers reject hardwareAcceleration even though the codec itself is usable.
    try {
      const r = await VideoDecoder.isConfigSupported(config);
      return !!r.supported;
    } catch {
      return false;
    }
  }
}
