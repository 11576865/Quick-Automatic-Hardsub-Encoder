export function parseAss(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const styles = new Map();
  const events = [];
  let section = '';
  let styleFormat = [];
  let eventFormat = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    const sec = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sec) { section = sec[1].toLowerCase(); continue; }

    if (section === 'v4+ styles' || section === 'v4 styles') {
      if (/^Format\s*:/i.test(line)) {
        styleFormat = line.replace(/^Format\s*:/i, '').split(',').map(x => x.trim().toLowerCase());
      } else if (/^Style\s*:/i.test(line) && styleFormat.length) {
        const values = splitCsvLimited(line.replace(/^Style\s*:/i, ''), styleFormat.length);
        const obj = Object.fromEntries(styleFormat.map((k, i) => [k, values[i] ?? '']));
        styles.set(obj.name || `style-${styles.size + 1}`, obj);
      }
    }

    if (section === 'events') {
      if (/^Format\s*:/i.test(line)) {
        eventFormat = line.replace(/^Format\s*:/i, '').split(',').map(x => x.trim().toLowerCase());
      } else if (/^(Dialogue|Comment)\s*:/i.test(line) && eventFormat.length) {
        const kind = line.slice(0, line.indexOf(':')).trim();
        const values = splitCsvLimited(line.slice(line.indexOf(':') + 1), eventFormat.length);
        const obj = Object.fromEntries(eventFormat.map((k, i) => [k, values[i] ?? '']));
        obj.kind = kind;
        obj.startSeconds = assTimeToSeconds(obj.start);
        obj.endSeconds = assTimeToSeconds(obj.end);
        events.push(obj);
      }
    }
  }

  const requestedFonts = new Set();
  for (const style of styles.values()) {
    if (style.fontname?.trim()) requestedFonts.add(style.fontname.trim());
  }
  const fnRegex = /\\fn([^\\}\r\n]+?)(?=\\|}|$)/g;
  for (const ev of events) {
    let m;
    while ((m = fnRegex.exec(ev.text || ''))) {
      const name = m[1].trim();
      if (name) requestedFonts.add(name);
    }
  }

  const dialogue = events.filter(e => e.kind?.toLowerCase() === 'dialogue');
  const previewTimes = choosePreviewTimes(dialogue, styles);
  const fontUsage = collectAssFontUsage(dialogue, styles);

  return {
    styles,
    events,
    requestedFonts: [...requestedFonts],
    fontUsage,
    previewTimes,
    dialogueCount: dialogue.length
  };
}


function collectAssFontUsage(dialogue, styles) {
  const usage = new Map();

  for (const event of dialogue) {
    const eventUsage = collectEventFontUsage(event, styles);
    for (const [fontName, codePoints] of eventUsage) {
      let set = usage.get(fontName);
      if (!set) usage.set(fontName, set = new Set());
      for (const cp of codePoints) set.add(cp);
    }
  }

  return [...usage.entries()]
    .map(([fontName, set]) => ({ fontName, codePoints: [...set].sort((a, b) => a - b) }))
    .sort((a, b) => a.fontName.localeCompare(b.fontName));
}

function collectEventFontUsage(event, styles) {
  const usage = new Map();
  const styleEntries = [...styles.entries()];
  const defaultStyle = styles.get('Default') || styleEntries[0]?.[1] || null;

  const resolveStyle = name => {
    if (name && styles.has(name)) return styles.get(name);
    if (name) {
      const folded = String(name).trim().toLowerCase();
      const hit = styleEntries.find(([key]) => String(key).trim().toLowerCase() === folded);
      if (hit) return hit[1];
    }
    return defaultStyle;
  };

  const addCodePoint = (fontName, cp) => {
    const name = String(fontName || '').trim();
    if (!name || !isRenderableCodePoint(cp)) return;
    let set = usage.get(name);
    if (!set) usage.set(name, set = new Set());
    set.add(cp);
  };

  const baseStyle = resolveStyle(event?.style);
  let activeStyle = baseStyle;
  let activeFont = String(activeStyle?.fontname || '').trim();
  let drawingMode = 0;
  const text = String(event?.text || '');
  let cursor = 0;

  while (cursor < text.length) {
    const open = text.indexOf('{', cursor);
    if (open < 0) {
      if (drawingMode <= 0) addAssTextSegment(text.slice(cursor), activeFont, addCodePoint);
      break;
    }

    if (open > cursor && drawingMode <= 0) {
      addAssTextSegment(text.slice(cursor, open), activeFont, addCodePoint);
    }

    const close = text.indexOf('}', open + 1);
    if (close < 0) {
      if (drawingMode <= 0) addAssTextSegment(text.slice(open), activeFont, addCodePoint);
      break;
    }

    const block = text.slice(open + 1, close);
    const tagPattern = /\\(fn|r|p(?=[\s+-]?\d|\\|}|$))([^\\}]*)/gi;
    let match;
    while ((match = tagPattern.exec(block))) {
      const tag = match[1].toLowerCase();
      const arg = String(match[2] || '').trim();
      if (tag === 'fn') {
        activeFont = arg || String(activeStyle?.fontname || '').trim();
      } else if (tag === 'r') {
        activeStyle = arg ? resolveStyle(arg) : baseStyle;
        activeFont = String(activeStyle?.fontname || '').trim();
        drawingMode = 0;
      } else if (tag === 'p') {
        const value = Number.parseInt(arg, 10);
        drawingMode = Number.isFinite(value) ? Math.max(0, value) : 0;
      }
    }
    cursor = close + 1;
  }

  return usage;
}

function normalizeRiskFontName(value = '') {
  return String(value).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function findGlyphRiskPreviewTimes(assInfo, glyphCoverage, limit = 6) {
  const max = Math.max(0, Math.min(12, Number(limit) || 0));
  if (!max || !assInfo?.styles || !Array.isArray(assInfo?.events)) return [];

  const riskByFont = new Map();
  for (const item of Array.isArray(glyphCoverage) ? glyphCoverage : []) {
    if (!['partial', 'unknown', 'unresolved'].includes(item?.status)) continue;
    const font = normalizeRiskFontName(item.requested || item.resolved || '');
    if (!font) continue;
    riskByFont.set(font, {
      status: item.status,
      missing: new Set((item.missingCodePoints || []).filter(Number.isInteger))
    });
  }
  if (!riskByFont.size) return [];

  const candidates = [];
  for (const event of assInfo.events) {
    if (event?.kind?.toLowerCase() !== 'dialogue' || !Number.isFinite(event.startSeconds)) continue;
    const eventUsage = collectEventFontUsage(event, assInfo.styles);
    const tokens = new Set();
    let score = 0;

    for (const [fontName, codePoints] of eventUsage) {
      const normalized = normalizeRiskFontName(fontName);
      const risk = riskByFont.get(normalized);
      if (!risk) continue;

      if (risk.status === 'partial') {
        for (const cp of codePoints) {
          if (!risk.missing.has(cp)) continue;
          tokens.add(normalized + ':' + cp.toString(16));
          score += 4;
        }
      } else if (codePoints.size) {
        tokens.add(normalized + ':*');
        score += risk.status === 'unresolved' ? 3 : 2;
      }
    }

    if (tokens.size) {
      candidates.push({
        time: midpoint(event),
        tokens,
        score,
        start: event.startSeconds
      });
    }
  }

  const chosen = [];
  const covered = new Set();
  const remaining = [...candidates];

  while (chosen.length < max && remaining.length) {
    let bestIndex = -1;
    let bestGain = -1;
    let bestScore = -1;
    let bestStart = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      let gain = 0;
      for (const token of candidate.tokens) if (!covered.has(token)) gain++;
      if (
        gain > bestGain ||
        (gain === bestGain && candidate.score > bestScore) ||
        (gain === bestGain && candidate.score === bestScore && candidate.start < bestStart)
      ) {
        bestIndex = i;
        bestGain = gain;
        bestScore = candidate.score;
        bestStart = candidate.start;
      }
    }

    if (bestIndex < 0 || bestGain <= 0) break;
    const [best] = remaining.splice(bestIndex, 1);
    chosen.push(best.time);
    for (const token of best.tokens) covered.add(token);
  }

  return [...new Set(
    chosen.map(v => Math.max(0, Math.round(v * 100) / 100))
  )].slice(0, max);
}

export function mergePreviewTimes(riskTimes = [], baseTimes = [], limit = 6) {
  const max = Math.max(1, Math.min(12, Number(limit) || 6));
  const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
  const round = value => Math.max(0, Math.round(Number(value) * 100) / 100);
  const combined = [];

  const add = value => {
    if (!Number.isFinite(Number(value))) return;
    const rounded = round(value);
    if (combined.some(existing => close(existing, rounded))) return;
    combined.push(rounded);
  };

  riskTimes.forEach(add);
  baseTimes.forEach(add);

  let selected = combined.slice(0, max);

  // Risk samples stay first, but reserve the final slot for broad context only
  // when that context is not already present. The previous replacement logic
  // could replace slot 6 with a time already in slots 1-5, producing identical
  // first/last preview samples.
  if (selected.length >= max && max > 1 && baseTimes.length) {
    const retained = selected.slice(0, max - 1);
    const context = baseTimes
      .map(Number)
      .find(time =>
        Number.isFinite(time) &&
        !riskTimes.some(risk => close(risk, time)) &&
        !retained.some(existing => close(existing, time))
      );
    if (context != null) selected[max - 1] = round(context);
  }

  selected = selected.filter((time, index, all) =>
    all.findIndex(other => close(other, time)) === index
  );

  const selectedRisk = riskTimes
    .map(Number)
    .filter(time => Number.isFinite(time) && selected.some(chosen => close(chosen, time)))
    .filter((time, index, all) => all.findIndex(other => close(other, time)) === index)
    .map(round);

  return { times: selected, riskTimes: selectedRisk };
}

function addAssTextSegment(segment, fontName, addCodePoint) {
  const decoded = String(segment)
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ');
  for (const char of decoded) addCodePoint(fontName, char.codePointAt(0));
}

function isRenderableCodePoint(cp) {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10FFFF) return false;
  if (cp <= 0x20 || (cp >= 0x7F && cp <= 0x9F)) return false;
  if (cp === 0x00A0) return false;
  if (cp >= 0x200B && cp <= 0x200F) return false;
  if (cp >= 0x202A && cp <= 0x202E) return false;
  if (cp >= 0x2060 && cp <= 0x206F) return false;
  if (cp === 0xFEFF) return false;
  if (cp >= 0xFE00 && cp <= 0xFE0F) return false;
  if (cp >= 0xE0100 && cp <= 0xE01EF) return false;
  if (cp >= 0xE0000 && cp <= 0xE007F) return false;
  return true;
}

function splitCsvLimited(text, count) {
  const out = [];
  let start = 0;
  for (let i = 0; i < count - 1; i++) {
    const idx = text.indexOf(',', start);
    if (idx < 0) break;
    out.push(text.slice(start, idx).trim());
    start = idx + 1;
  }
  out.push(text.slice(start).trim());
  while (out.length < count) out.push('');
  return out;
}

export function assTimeToSeconds(value = '') {
  const m = value.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})(?:[.](\d{1,3}))?$/);
  if (!m) return NaN;
  const frac = Number(`0.${m[4] || '0'}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac;
}

function choosePreviewTimes(dialogue, styles) {
  if (!dialogue.length) return [];
  const chosen = [];
  const seenStyles = new Set();

  const addEvent = event => {
    if (!event || !Number.isFinite(event.startSeconds)) return;
    chosen.push(midpoint(event));
  };

  // Keep the original intent: cover distinct styles and special override cases first.
  for (const e of dialogue) {
    if (!Number.isFinite(e.startSeconds)) continue;
    const key = e.style || 'Default';
    if (!seenStyles.has(key)) {
      addEvent(e);
      seenStyles.add(key);
    }
    if (seenStyles.size >= 4) break;
  }

  addEvent(dialogue.find(e => /\\fn/.test(e.text || '')));
  addEvent(dialogue.find(e => /\\(?:pos|move|an\d)/.test(e.text || '')));

  // A common ASS has only one style. Previously that produced one preview point,
  // so “next” wrapped back to the same frame and looked broken. Fill remaining
  // slots with dialogue events spread across the file so navigation always has
  // meaningful later samples when the subtitle actually contains them.
  if (chosen.length < 6) {
    const count = Math.min(6, dialogue.length);
    for (let i = 0; i < count; i++) {
      const index = count === 1
        ? 0
        : Math.round(i * (dialogue.length - 1) / (count - 1));
      addEvent(dialogue[index]);
    }
  }

  const dedup = [...new Set(
    chosen
      .filter(Number.isFinite)
      .map(v => Math.max(0, Math.round(v * 100) / 100))
  )].sort((a, b) => a - b);
  return dedup.slice(0, 6);
}

function midpoint(e) {
  const s = Number.isFinite(e.startSeconds) ? e.startSeconds : 0;
  const en = Number.isFinite(e.endSeconds) ? e.endSeconds : s + 1;
  return s + Math.max(0.08, Math.min((en - s) / 2, 1));
}


export function rewriteAssFonts(text, bindings = {}) {
  const lookup = new Map(
    Object.entries(bindings)
      .filter(([, target]) => target)
      .map(([source, target]) => [normalizeAssFontName(source), target])
  );
  if (!lookup.size) return text;

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let section = '';
  let styleFormat = [];
  let eventFormat = [];

  return lines.map(raw => {
    const sec = raw.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sec) {
      section = sec[1].toLowerCase();
      return raw;
    }

    if (section === 'v4+ styles' || section === 'v4 styles') {
      if (/^\s*Format\s*:/i.test(raw)) {
        styleFormat = raw.replace(/^\s*Format\s*:/i, '').split(',').map(x => x.trim().toLowerCase());
        return raw;
      }
      if (/^\s*Style\s*:/i.test(raw) && styleFormat.length) {
        const prefix = raw.slice(0, raw.indexOf(':') + 1);
        const values = splitCsvLimited(raw.slice(raw.indexOf(':') + 1), styleFormat.length);
        const fontIndex = styleFormat.indexOf('fontname');
        if (fontIndex >= 0) {
          const target = lookup.get(normalizeAssFontName(values[fontIndex] || ''));
          if (target) values[fontIndex] = target;
        }
        return `${prefix} ${values.join(',')}`;
      }
    }

    if (section === 'events') {
      if (/^\s*Format\s*:/i.test(raw)) {
        eventFormat = raw.replace(/^\s*Format\s*:/i, '').split(',').map(x => x.trim().toLowerCase());
        return raw;
      }
      if (/^\s*(Dialogue|Comment)\s*:/i.test(raw) && eventFormat.length) {
        const prefix = raw.slice(0, raw.indexOf(':') + 1);
        const values = splitCsvLimited(raw.slice(raw.indexOf(':') + 1), eventFormat.length);
        const textIndex = eventFormat.indexOf('text');
        if (textIndex >= 0) {
          values[textIndex] = replaceInlineFonts(values[textIndex] || '', lookup);
        }
        return `${prefix} ${values.join(',')}`;
      }
    }

    return raw;
  }).join('\n');
}

export function shiftAssForPreview(text, offsetSeconds) {
  if (!Number.isFinite(offsetSeconds) || offsetSeconds <= 0) return text;

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let section = '';
  let eventFormat = [];

  return lines.map(raw => {
    const sec = raw.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sec) {
      section = sec[1].toLowerCase();
      return raw;
    }

    if (section !== 'events') return raw;

    if (/^\s*Format\s*:/i.test(raw)) {
      eventFormat = raw.replace(/^\s*Format\s*:/i, '').split(',').map(x => x.trim().toLowerCase());
      return raw;
    }

    if (!/^\s*(Dialogue|Comment)\s*:/i.test(raw) || !eventFormat.length) return raw;

    const prefix = raw.slice(0, raw.indexOf(':') + 1);
    const values = splitCsvLimited(raw.slice(raw.indexOf(':') + 1), eventFormat.length);
    const startIndex = eventFormat.indexOf('start');
    const endIndex = eventFormat.indexOf('end');
    if (startIndex < 0 || endIndex < 0) return raw;

    const start = assTimeToSeconds(values[startIndex]);
    const end = assTimeToSeconds(values[endIndex]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return raw;

    values[startIndex] = secondsToAssTime(Math.max(0, start - offsetSeconds));
    values[endIndex] = secondsToAssTime(Math.max(0, end - offsetSeconds));
    return `${prefix} ${values.join(',')}`;
  }).join('\n');
}

function replaceInlineFonts(text, lookup) {
  return text.replace(/\\fn([^\\}\r\n]+?)(?=\\|}|$)/g, (full, name) => {
    const target = lookup.get(normalizeAssFontName(name));
    return target ? `\\fn${target}` : full;
  });
}

function normalizeAssFontName(value = '') {
  return String(value).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function secondsToAssTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const frac = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(frac).padStart(2, '0')}`;
}
