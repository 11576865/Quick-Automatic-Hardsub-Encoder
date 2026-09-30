import assert from 'node:assert/strict';
import { parseAss } from './ass.js';

const sample = `[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,HYQiHei-55S,48
[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,Hello {\\fnArial}world`;

const p = parseAss(sample);
assert.equal(p.dialogueCount, 1);
assert.deepEqual(new Set(p.requestedFonts), new Set(['HYQiHei-55S','Arial']));
assert.ok(p.previewTimes.length >= 1);

const sameStyle = `[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,48
[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,One
Dialogue: 0,0:00:04.00,0:00:05.00,Default,Two
Dialogue: 0,0:00:07.00,0:00:08.00,Default,Three
Dialogue: 0,0:00:10.00,0:00:11.00,Default,Four
Dialogue: 0,0:00:13.00,0:00:14.00,Default,Five
Dialogue: 0,0:00:16.00,0:00:17.00,Default,Six
Dialogue: 0,0:00:19.00,0:00:20.00,Default,Seven`;

const p2 = parseAss(sameStyle);
assert.equal(p2.dialogueCount, 7);
assert.equal(p2.previewTimes.length, 6);
assert.deepEqual([...p2.previewTimes].sort((a, b) => a - b), p2.previewTimes);
assert.ok(new Set(p2.previewTimes).size > 1);

console.log('ASS parser test passed');


const usageSample = `[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,48
Style: Alt,Noto Sans CJK SC,44
[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,A中{\\fnCourier New}B{\\rAlt}文{\\p1}m 0 0 l 10 10{\\p0}C`;

const usageParsed = parseAss(usageSample);
const usageMap = new Map(usageParsed.fontUsage.map(x => [x.fontName, x.codePoints]));
assert.deepEqual(usageMap.get('Arial'), ['A'.codePointAt(0), '中'.codePointAt(0)].sort((a,b) => a-b));
assert.deepEqual(usageMap.get('Courier New'), ['B'.codePointAt(0)]);
assert.deepEqual(usageMap.get('Noto Sans CJK SC'), ['C'.codePointAt(0), '文'.codePointAt(0)].sort((a,b) => a-b));
assert.equal([...usageMap.values()].flat().includes('m'.codePointAt(0)), false);
