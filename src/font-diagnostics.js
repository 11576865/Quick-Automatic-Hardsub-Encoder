function cleanField(value = '') {
  return String(value).trim().replace(/^["']|["']$/g, '');
}

function parseTupleFamily(text = '') {
  const match = String(text).match(/\((.*?),\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\)/);
  return match ? cleanField(match[1]) : '';
}

function parseCodePoint(line = '') {
  const match = String(line).match(/Glyph\s+(?:(?:0x|U\+)\s*)?([0-9A-Fa-f]{2,6})\s+not found/i);
  if (!match) return null;
  const codePoint = Number.parseInt(match[1], 16);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF
    ? codePoint
    : null;
}

function parseSelectedFace(target = '') {
  const value = String(target).trim();
  if (!value) return { target: '', selected: '', path: '' };

  const parts = value.split(',').map(part => part.trim()).filter(Boolean);
  const path = cleanField(parts[0] || '');
  const selected = cleanField(parts.length >= 3 ? parts[parts.length - 1] : '');
  return { target: value, selected, path };
}

export function parseLibassFontDiagnostics(lines = []) {
  const source = Array.isArray(lines)
    ? lines.map(line => String(line || '').trim()).filter(Boolean)
    : String(lines || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  const selections = [];
  const missingGlyphs = [];
  const failures = [];
  const pending = [];

  for (const raw of source) {
    const glyphCodePoint = parseCodePoint(raw);
    if (glyphCodePoint != null) {
      const requested = parseTupleFamily(raw);
      const item = {
        codePoint: glyphCodePoint,
        requested,
        fallbackSelected: '',
        fallbackPath: '',
        status: 'unresolved',
        raw
      };
      missingGlyphs.push(item);
      pending.push(item);
      continue;
    }

    const selectMatch = raw.match(/fontselect:\s*(\([^)]*\))\s*->\s*(.+)$/i);
    if (selectMatch) {
      const requested = parseTupleFamily(selectMatch[1]);
      const selectedFace = parseSelectedFace(selectMatch[2]);
      const selection = {
        requested,
        selected: selectedFace.selected,
        path: selectedFace.path,
        target: selectedFace.target,
        fallback: false,
        raw
      };

      let pendingIndex = -1;
      if (requested) {
        pendingIndex = pending.findIndex(item =>
          item.status === 'unresolved' &&
          item.requested &&
          item.requested.localeCompare(requested, undefined, { sensitivity: 'accent' }) === 0
        );
      }
      if (pendingIndex < 0) {
        pendingIndex = pending.findIndex(item => item.status === 'unresolved');
      }

      if (pendingIndex >= 0) {
        const glyph = pending[pendingIndex];
        glyph.fallbackSelected = selectedFace.selected || selectedFace.path || selectedFace.target;
        glyph.fallbackPath = selectedFace.path;
        glyph.status = 'fallback-selected';
        selection.fallback = true;
        pending.splice(pendingIndex, 1);
      }

      selections.push(selection);
      continue;
    }

    if (/failed to find.*fallback|no fallback|font provider.*failed/i.test(raw)) {
      const requested = parseTupleFamily(raw);
      const failure = { requested, raw };
      failures.push(failure);

      const pendingIndex = requested
        ? pending.findIndex(item => item.requested === requested && item.status === 'unresolved')
        : pending.findIndex(item => item.status === 'unresolved');
      if (pendingIndex >= 0) {
        pending[pendingIndex].status = 'fallback-failed';
        pending.splice(pendingIndex, 1);
      }
    }
  }

  const normalSelections = selections.filter(item => !item.fallback);
  const fallbackSelections = selections.filter(item => item.fallback);
  const unresolvedGlyphs = missingGlyphs.filter(item => item.status !== 'fallback-selected');

  return {
    selections,
    normalSelections,
    fallbackSelections,
    missingGlyphs,
    unresolvedGlyphs,
    failures,
    hasFallback: fallbackSelections.length > 0,
    hasRisk: missingGlyphs.length > 0 || failures.length > 0,
    hasUnresolvedRisk: unresolvedGlyphs.length > 0 || failures.length > 0
  };
}

export function codePointDisplay(codePoint) {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) {
    return { char: '�', hex: 'U+????' };
  }
  let char = '';
  try { char = String.fromCodePoint(codePoint); } catch { char = '�'; }
  return {
    char,
    hex: 'U+' + codePoint.toString(16).toUpperCase().padStart(codePoint > 0xFFFF ? 6 : 4, '0')
  };
}
