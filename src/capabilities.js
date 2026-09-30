export function detectBasicCapabilities() {
  const video = document.createElement('video');
  const canPlay = types => types.some(type => {
    try { return video.canPlayType(type) !== ''; }
    catch { return false; }
  });

  return {
    webAssembly: typeof WebAssembly !== 'undefined',
    worker: typeof Worker !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    webCodecsEncoder: typeof VideoEncoder !== 'undefined',
    webCodecsDecoder: typeof VideoDecoder !== 'undefined',
    nativePlayback: {
      h264: canPlay(['video/mp4; codecs="avc1.640028"', 'video/mp4; codecs="avc1.4D401F"']),
      hevc: canPlay(['video/mp4; codecs="hvc1.1.6.L93.B0"', 'video/mp4; codecs="hev1.1.6.L93.B0"']),
      av1: canPlay(['video/mp4; codecs="av01.0.08M.08"', 'video/mp4; codecs="av01.0.05M.08"', 'video/webm; codecs="av01.0.08M.08"'])
    },
    codecs: {
      encode: { h264: null, hevc: null, av1: null },
      decode: { h264: null, hevc: null, av1: null }
    },
    detailed: false
  };
}

export async function detectCapabilities() {
  const result = detectBasicCapabilities();

  const playbackJobs = [
    supportsNativePlayback([
      'video/mp4; codecs="avc1.640028"',
      'video/mp4; codecs="avc1.4D401F"'
    ]),
    supportsNativePlayback([
      'video/mp4; codecs="hvc1.1.6.L93.B0"',
      'video/mp4; codecs="hev1.1.6.L93.B0"'
    ]),
    supportsNativePlayback([
      'video/mp4; codecs="av01.0.08M.08"',
      'video/mp4; codecs="av01.0.05M.08"',
      'video/webm; codecs="av01.0.08M.08"'
    ])
  ];

  const encoderJobs = result.webCodecsEncoder ? [
    supportsAnyEncoder([
      { codec: 'avc1.640028', width: 1280, height: 720, bitrate: 2_500_000, framerate: 30 },
      { codec: 'avc1.4D401F', width: 1280, height: 720, bitrate: 2_500_000, framerate: 30 }
    ]),
    supportsAnyEncoder([
      { codec: 'hvc1.1.6.L93.B0', width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 },
      { codec: 'hev1.1.6.L93.B0', width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 }
    ]),
    supportsAnyEncoder([
      { codec: 'av01.0.08M.08', width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 },
      { codec: 'av01.0.05M.08', width: 640, height: 360, bitrate: 800_000, framerate: 30 }
    ])
  ] : [false, false, false];

  const decoderJobs = result.webCodecsDecoder ? [
    supportsAnyDecoder([
      { codec: 'avc1.640028', codedWidth: 1280, codedHeight: 720 },
      { codec: 'avc1.4D401F', codedWidth: 1280, codedHeight: 720 }
    ]),
    supportsAnyDecoder([
      { codec: 'hvc1.1.6.L93.B0', codedWidth: 1280, codedHeight: 720 },
      { codec: 'hev1.1.6.L93.B0', codedWidth: 1280, codedHeight: 720 }
    ]),
    supportsAnyDecoder([
      { codec: 'av01.0.08M.08', codedWidth: 1280, codedHeight: 720 },
      { codec: 'av01.0.05M.08', codedWidth: 640, codedHeight: 360 }
    ])
  ] : [false, false, false];

  const [playback, encode, decode] = await Promise.all([
    Promise.all(playbackJobs),
    Promise.all(encoderJobs),
    Promise.all(decoderJobs)
  ]);

  [result.nativePlayback.h264, result.nativePlayback.hevc, result.nativePlayback.av1] = playback;
  [result.codecs.encode.h264, result.codecs.encode.hevc, result.codecs.encode.av1] = encode;
  [result.codecs.decode.h264, result.codecs.decode.hevc, result.codecs.decode.av1] = decode;
  result.detailed = true;
  return result;
}

async function supportsNativePlayback(contentTypes) {
  const video = document.createElement('video');
  const canPlay = contentTypes.some(type => {
    try { return video.canPlayType(type) !== ''; }
    catch { return false; }
  });

  if (!navigator.mediaCapabilities?.decodingInfo) return canPlay;

  const checks = contentTypes.map(async contentType => {
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
      return !!info.supported;
    } catch {
      return false;
    }
  });
  return (await Promise.all(checks)).some(Boolean) || canPlay;
}

async function supportsAnyEncoder(configs) {
  const results = await Promise.all(configs.map(supportsEncoder));
  return results.some(Boolean);
}

async function supportsAnyDecoder(configs) {
  const results = await Promise.all(configs.map(supportsDecoder));
  return results.some(Boolean);
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
