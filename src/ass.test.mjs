import assert from 'node:assert/strict';
import { parseAss, mergePreviewTimes } from './ass.js';

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


const positionTagSample = `[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,48
[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,{\\pos(100,100)}Visible`;

const positionParsed = parseAss(positionTagSample);
const positionUsage = new Map(positionParsed.fontUsage.map(x => [x.fontName, x.codePoints]));
assert.deepEqual(
  positionUsage.get('Arial'),
  [...'Visible'].map(ch => ch.codePointAt(0)).filter((v, i, a) => a.indexOf(v) === i).sort((a,b) => a-b)
);


const riskDirectedSample = `[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,48
Style: Rare,RareFont,48
[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,ordinary
Dialogue: 0,0:00:10.00,0:00:11.00,Rare,ABC
Dialogue: 0,0:00:20.00,0:00:21.00,Rare,𠮷
Dialogue: 0,0:00:30.00,0:00:31.00,Default,tail`;

const riskParsed = parseAss(riskDirectedSample);
const riskCoverage = [
  {
    requested: 'RareFont',
    status: 'partial',
    missingCodePoints: ['𠮷'.codePointAt(0)]
  }
];
const riskTimes = (await import('./ass.js')).findGlyphRiskPreviewTimes(riskParsed, riskCoverage, 4);
assert.deepEqual(riskTimes, [20.5]);

const unresolvedTimes = (await import('./ass.js')).findGlyphRiskPreviewTimes(
  riskParsed,
  [{ requested: 'RareFont', status: 'unresolved', missingCodePoints: [] }],
  4
);
assert.deepEqual(unresolvedTimes, [10.5]);


const mergedPreview = mergePreviewTimes(
  [1.5, 4.5, 7.5, 10.5, 13.5, 16.5],
  [1.5, 4.5, 7.5, 10.5, 13.5, 19.5],
  6
);
assert.deepEqual(mergedPreview.times, [1.5, 4.5, 7.5, 10.5, 13.5, 19.5]);
assert.equal(new Set(mergedPreview.times.map(v => v.toFixed(2))).size, mergedPreview.times.length);
