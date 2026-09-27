export async function decodeAssFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let encoding = 'UTF-8';
  let offset = 0;
  let text = '';

  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    encoding = 'UTF-8 BOM';
    offset = 3;
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset));
  } else if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    encoding = 'UTF-16 LE BOM';
    offset = 2;
    text = new TextDecoder('utf-16le').decode(bytes.subarray(offset));
  } else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    encoding = 'UTF-16 BE BOM';
    offset = 2;
    try {
      text = new TextDecoder('utf-16be').decode(bytes.subarray(offset));
    } catch {
      const le = new Uint8Array(bytes.length - offset);
      for (let i = offset, j = 0; i + 1 < bytes.length; i += 2, j += 2) {
        le[j] = bytes[i + 1];
        le[j + 1] = bytes[i];
      }
      text = new TextDecoder('utf-16le').decode(le);
    }
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('ASS 含无效 UTF-8 字节。请确认原始编码并转换为 UTF-8 或带 BOM 的 UTF-16 后重试。');
    }
  }

  const nulMatches = text.match(/\u0000/g);
  const removedNulls = nulMatches ? nulMatches.length : 0;
  if (removedNulls) text = text.replaceAll('\u0000', '');

  if (!/\[Events\]/i.test(text) || !/Dialogue\s*:/i.test(text)) {
    throw new Error(
      'ASS 文本解析前检查失败：按 ' + encoding + ' 解码后没有找到 [Events]/Dialogue。' +
      '如果这是旧式 ANSI/GBK/Shift-JIS 字幕，需要先确认原始字符编码，不能静默猜测。'
    );
  }

  return { text, encoding, removedNulls };
}
