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

  return {
    styles,
    events,
    requestedFonts: [...requestedFonts],
    previewTimes,
    dialogueCount: dialogue.length
  };
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

  for (const e of dialogue) {
    if (!Number.isFinite(e.startSeconds)) continue;
    const key = e.style || 'Default';
    if (!seenStyles.has(key)) {
      chosen.push(midpoint(e));
      seenStyles.add(key);
    }
    if (chosen.length >= 4) break;
  }

  const inlineFont = dialogue.find(e => /\\fn/.test(e.text || ''));
  if (inlineFont) chosen.push(midpoint(inlineFont));

  const positioned = dialogue.find(e => /\\(?:pos|move|an\d)/.test(e.text || ''));
  if (positioned) chosen.push(midpoint(positioned));

  const dedup = [...new Set(chosen.filter(Number.isFinite).map(v => Math.max(0, Math.round(v * 100) / 100)))];
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
