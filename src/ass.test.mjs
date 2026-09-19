import assert from 'node:assert/strict';
import { parseAss } from './ass.js';
const sample = `[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: Default,HYQiHei-55S,48\n[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,Hello {\\fnArial}world`;
const p = parseAss(sample);
assert.equal(p.dialogueCount, 1);
assert.deepEqual(new Set(p.requestedFonts), new Set(['HYQiHei-55S','Arial']));
assert.ok(p.previewTimes.length >= 1);
console.log('ASS parser test passed');
