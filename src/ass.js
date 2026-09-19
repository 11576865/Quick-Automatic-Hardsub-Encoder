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
  const fnRegex = /\\fn([^\\}\r\n]+)/g;
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
