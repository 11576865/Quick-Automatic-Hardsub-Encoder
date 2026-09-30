export async function inspectFontFile(file) {
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength < 12) throw new Error('文件过小，不是有效字体');
  const view = new DataView(buffer);
  const tag = readTag(view, 0);

  if (tag === 'ttcf') return inspectCollection(file, view);

  const signature = view.getUint32(0, false);
  const validSfnt =
    signature === 0x00010000 ||
    tag === 'OTTO' ||
    tag === 'true' ||
    tag === 'typ1';

  if (!validSfnt) {
    throw new Error('文件头不是 TTF/OTF/TTC/OTC 字体；可能误选了 ASS 或其他文件');
  }

  return [inspectSfntFace(file, view, 0, 0)];
}

function inspectCollection(file, view) {
  if (view.byteLength < 12) throw new Error('损坏的 TTC/OTC 文件');
  const count = view.getUint32(8, false);
  if (count > 128) throw new Error('字体集合 face 数量异常');
  const faces = [];
  for (let i = 0; i < count; i++) {
    const off = view.getUint32(12 + i * 4, false);
    faces.push(inspectSfntFace(file, view, off, i));
  }
  return faces;
}

function inspectSfntFace(file, view, baseOffset, faceIndex) {
  if (baseOffset + 12 > view.byteLength) throw new Error('字体表头越界');
  const numTables = view.getUint16(baseOffset + 4, false);
  let nameOffset = null;
  let nameLength = null;
  let cmapOffset = null;
  let cmapLength = null;

  for (let i = 0; i < numTables; i++) {
    const p = baseOffset + 12 + i * 16;
    if (p + 16 > view.byteLength) break;
    const tableTag = readTag(view, p);
    if (tableTag === 'name') {
      nameOffset = view.getUint32(p + 8, false);
      nameLength = view.getUint32(p + 12, false);
    } else if (tableTag === 'cmap') {
      cmapOffset = view.getUint32(p + 8, false);
      cmapLength = view.getUint32(p + 12, false);
    }
  }

  const names = nameOffset != null ? parseNameTable(view, nameOffset, nameLength) : {};
  const coverage = cmapOffset != null
    ? parseCmapCoverage(view, cmapOffset, cmapLength)
    : { known: false, ranges: [], formats: [] };
  const family = pickName(names, 16, 1);
  const subfamily = pickName(names, 17, 2);
  const fullName = pickName(names, 4);
  const postScriptName = pickName(names, 6);
  const aliases = unique([
    family,
    fullName,
    postScriptName,
    ...collectNames(names, [1, 4, 6, 16])
  ].filter(Boolean));

  return {
    fileName: file.name,
    faceIndex,
    family,
    subfamily,
    fullName,
    postScriptName,
    aliases,
    coverageKnown: coverage.known,
    coverageRanges: coverage.ranges,
    coverageFormats: coverage.formats,
    coverageCodePointCount: coverage.ranges.reduce((sum, range) => sum + range[1] - range[0] + 1, 0)
  };
}

function parseNameTable(view, offset, length) {
  if (offset + 6 > view.byteLength) return {};
  const count = view.getUint16(offset + 2, false);
  const stringOffset = view.getUint16(offset + 4, false);
  const records = {};

  for (let i = 0; i < count; i++) {
    const p = offset + 6 + i * 12;
    if (p + 12 > view.byteLength) break;
    const platformID = view.getUint16(p, false);
    const encodingID = view.getUint16(p + 2, false);
    const languageID = view.getUint16(p + 4, false);
    const nameID = view.getUint16(p + 6, false);
    const byteLength = view.getUint16(p + 8, false);
    const byteOffset = view.getUint16(p + 10, false);
    const start = offset + stringOffset + byteOffset;
    if (start + byteLength > view.byteLength) continue;
    const text = decodeName(view, start, byteLength, platformID, encodingID).trim();
    if (!text) continue;
    (records[nameID] ||= []).push({ text, platformID, languageID });
  }
  return records;
}

function pickName(records, ...ids) {
  for (const id of ids) {
    const list = records[id] || [];
    if (!list.length) continue;
    const preferred = list.find(x => x.platformID === 3 && (x.languageID === 0x0409 || x.languageID === 0x0804 || x.languageID === 0x0404))
      || list.find(x => x.platformID === 3)
      || list[0];
    if (preferred?.text) return preferred.text;
  }
  return '';
}

function decodeName(view, start, length, platformID) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + start, length);
  if (platformID === 0 || platformID === 3) {
    let out = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return out.replace(/\u0000/g, '');
  }
  try { return new TextDecoder('latin1').decode(bytes); }
  catch { return [...bytes].map(b => String.fromCharCode(b)).join(''); }
}

function collectNames(records, ids) {
  const out = [];
  for (const id of ids) {
    for (const item of records[id] || []) {
      if (item?.text) out.push(item.text);
    }
  }
  return unique(out);
}

function readTag(view, offset) {
  if (offset + 4 > view.byteLength) return '';
  return String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1),
    view.getUint8(offset + 2), view.getUint8(offset + 3)
  );
}

function unique(values) { return [...new Set(values)]; }

export function matchRequestedFonts(requestedNames, faces) {
  const normalized = new Map();
  for (const face of faces) {
    for (const alias of face.aliases || []) {
      const key = normalizeFontName(alias);
      if (key && !normalized.has(key)) normalized.set(key, face);
    }
  }

  return requestedNames.map(requested => {
    const exact = normalized.get(normalizeFontName(requested));
    if (exact) return { requested, status: 'matched', face: exact };

    const looseKey = normalizeLoose(requested);
    const candidates = faces.filter(face => (face.aliases || []).some(a => normalizeLoose(a) === looseKey));
    if (candidates.length === 1) return { requested, status: 'probable', face: candidates[0] };
    return { requested, status: 'missing', face: null };
  });
}


function parseCmapCoverage(view, offset, length) {
  if (!Number.isFinite(offset) || offset < 0 || offset + 4 > view.byteLength) {
    return { known: false, ranges: [], formats: [] };
  }
  const limit = Math.min(view.byteLength, offset + Math.max(0, Number(length) || (view.byteLength - offset)));
  const numTables = view.getUint16(offset + 2, false);
  const ranges = [];
  const formats = new Set();
  let known = false;

  for (let i = 0; i < numTables; i++) {
    const record = offset + 4 + i * 8;
    if (record + 8 > limit) break;
    const platformID = view.getUint16(record, false);
    const encodingID = view.getUint16(record + 2, false);
    if (!isUnicodeCmap(platformID, encodingID)) continue;

    const relative = view.getUint32(record + 4, false);
    const subtable = offset + relative;
    if (subtable + 2 > limit) continue;
    const format = view.getUint16(subtable, false);
    let parsed = null;

    if (format === 0) parsed = parseCmapFormat0(view, subtable, limit);
    else if (format === 4) parsed = parseCmapFormat4(view, subtable, limit);
    else if (format === 6) parsed = parseCmapFormat6(view, subtable, limit);
    else if (format === 10) parsed = parseCmapFormat10(view, subtable, limit);
    else if (format === 12 || format === 13) parsed = parseCmapFormat12or13(view, subtable, limit, format);

    if (parsed) {
      known = true;
      formats.add(format);
      ranges.push(...parsed);
    }
  }

  return {
    known,
    ranges: mergeCoverageRanges(ranges),
    formats: [...formats].sort((a, b) => a - b)
  };
}

function isUnicodeCmap(platformID, encodingID) {
  if (platformID === 0) return true;
  return platformID === 3 && (encodingID === 0 || encodingID === 1 || encodingID === 10);
}

function parseCmapFormat0(view, offset, outerLimit) {
  if (offset + 262 > outerLimit) return null;
  const length = view.getUint16(offset + 2, false);
  const limit = Math.min(outerLimit, offset + length);
  if (offset + 262 > limit) return null;
  const ranges = [];
  for (let cp = 0; cp < 256; cp++) {
    if (view.getUint8(offset + 6 + cp) !== 0) ranges.push([cp, cp]);
  }
  return ranges;
}

function parseCmapFormat6(view, offset, outerLimit) {
  if (offset + 10 > outerLimit) return null;
  const length = view.getUint16(offset + 2, false);
  const limit = Math.min(outerLimit, offset + length);
  const firstCode = view.getUint16(offset + 6, false);
  const entryCount = view.getUint16(offset + 8, false);
  const count = Math.min(entryCount, Math.floor(Math.max(0, limit - (offset + 10)) / 2));
  const ranges = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint16(offset + 10 + i * 2, false) !== 0) {
      ranges.push([firstCode + i, firstCode + i]);
    }
  }
  return ranges;
}

function parseCmapFormat10(view, offset, outerLimit) {
  if (offset + 20 > outerLimit) return null;
  const length = view.getUint32(offset + 4, false);
  const limit = Math.min(outerLimit, offset + length);
  const start = view.getUint32(offset + 12, false);
  const numChars = view.getUint32(offset + 16, false);
  const count = Math.min(numChars, Math.floor(Math.max(0, limit - (offset + 20)) / 2), 0x110000);
  const ranges = [];
  for (let i = 0; i < count; i++) {
    const cp = start + i;
    if (cp > 0x10FFFF) break;
    if (view.getUint16(offset + 20 + i * 2, false) !== 0) ranges.push([cp, cp]);
  }
  return ranges;
}

function parseCmapFormat4(view, offset, outerLimit) {
  if (offset + 14 > outerLimit) return null;
  const length = view.getUint16(offset + 2, false);
  const limit = Math.min(outerLimit, offset + length);
  const segCount = Math.min(view.getUint16(offset + 6, false) / 2, 8192);
  if (!Number.isInteger(segCount) || segCount <= 0) return null;

  const endCodeOffset = offset + 14;
  const startCodeOffset = endCodeOffset + segCount * 2 + 2;
  const idDeltaOffset = startCodeOffset + segCount * 2;
  const idRangeOffsetOffset = idDeltaOffset + segCount * 2;
  if (idRangeOffsetOffset + segCount * 2 > limit) return null;

  const ranges = [];
  for (let i = 0; i < segCount; i++) {
    const start = view.getUint16(startCodeOffset + i * 2, false);
    const end = view.getUint16(endCodeOffset + i * 2, false);
    if (start > end) continue;
    const delta = view.getInt16(idDeltaOffset + i * 2, false);
    const rangeOffset = view.getUint16(idRangeOffsetOffset + i * 2, false);

    for (let cp = start; cp <= end && cp <= 0xFFFF; cp++) {
      if (cp === 0xFFFF) continue;
      let glyph = 0;
      if (rangeOffset === 0) {
        glyph = (cp + delta) & 0xFFFF;
      } else {
        const glyphAddress = idRangeOffsetOffset + i * 2 + rangeOffset + (cp - start) * 2;
        if (glyphAddress + 2 > limit) continue;
        glyph = view.getUint16(glyphAddress, false);
        if (glyph !== 0) glyph = (glyph + delta) & 0xFFFF;
      }
      if (glyph !== 0) ranges.push([cp, cp]);
    }
  }
  return ranges;
}

function parseCmapFormat12or13(view, offset, outerLimit, format) {
  if (offset + 16 > outerLimit) return null;
  const length = view.getUint32(offset + 4, false);
  const limit = Math.min(outerLimit, offset + length);
  const groupCount = view.getUint32(offset + 12, false);
  const count = Math.min(groupCount, Math.floor(Math.max(0, limit - (offset + 16)) / 12), 100000);
  const ranges = [];

  for (let i = 0; i < count; i++) {
    const p = offset + 16 + i * 12;
    let start = view.getUint32(p, false);
    let end = view.getUint32(p + 4, false);
    const glyph = view.getUint32(p + 8, false);
    if (start > end || start > 0x10FFFF) continue;
    end = Math.min(end, 0x10FFFF);

    if (format === 13) {
      if (glyph !== 0) ranges.push([start, end]);
    } else {
      if (glyph === 0) start++;
      if (start <= end) ranges.push([start, end]);
    }
  }
  return ranges;
}

function mergeCoverageRanges(ranges) {
  const sorted = ranges
    .filter(range => Array.isArray(range) && Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[0] <= range[1])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range[0] > last[1] + 1) {
      merged.push([range[0], range[1]]);
    } else if (range[1] > last[1]) {
      last[1] = range[1];
    }
  }
  return merged;
}

export function fontSupportsCodePoint(face, codePoint) {
  if (!face?.coverageKnown || !Array.isArray(face.coverageRanges) || !Number.isInteger(codePoint)) return null;
  let low = 0;
  let high = face.coverageRanges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = face.coverageRanges[mid];
    if (codePoint < range[0]) high = mid - 1;
    else if (codePoint > range[1]) low = mid + 1;
    else return true;
  }
  return false;
}

export function analyzeFontUsageCoverage(fontUsage, faces, mappings = {}) {
  const usage = Array.isArray(fontUsage) ? fontUsage : [];
  const allFaces = Array.isArray(faces) ? faces : [];
  return usage.map(item => {
    const requested = String(item?.fontName || '').trim();
    const mapped = String(mappings?.[requested] || requested).trim();
    const codePoints = [...new Set((item?.codePoints || []).filter(Number.isInteger))].sort((a, b) => a - b);
    const match = matchRequestedFonts([mapped], allFaces)[0];

    if (!mapped || !match?.face) {
      return {
        requested,
        resolved: mapped,
        status: 'unresolved',
        matchStatus: match?.status || 'missing',
        face: null,
        codePointCount: codePoints.length,
        missingCodePoints: []
      };
    }

    if (!match.face.coverageKnown) {
      return {
        requested,
        resolved: mapped,
        status: 'unknown',
        matchStatus: match.status,
        face: match.face,
        codePointCount: codePoints.length,
        missingCodePoints: []
      };
    }

    const missingCodePoints = codePoints.filter(cp => fontSupportsCodePoint(match.face, cp) === false);
    return {
      requested,
      resolved: mapped,
      status: missingCodePoints.length ? 'partial' : 'covered',
      matchStatus: match.status,
      face: match.face,
      codePointCount: codePoints.length,
      missingCodePoints
    };
  });
}

function normalizeFontName(v = '') {
  return v.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}
function normalizeLoose(v = '') {
  return normalizeFontName(v).replace(/[\s_\-]+/g, '');
}
