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

  for (let i = 0; i < numTables; i++) {
    const p = baseOffset + 12 + i * 16;
    if (p + 16 > view.byteLength) break;
    const tableTag = readTag(view, p);
    if (tableTag === 'name') {
      nameOffset = view.getUint32(p + 8, false);
      nameLength = view.getUint32(p + 12, false);
      break;
    }
  }

  const names = nameOffset != null ? parseNameTable(view, nameOffset, nameLength) : {};
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
    aliases
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

function normalizeFontName(v = '') {
  return v.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}
function normalizeLoose(v = '') {
  return normalizeFontName(v).replace(/[\s_\-]+/g, '');
}
