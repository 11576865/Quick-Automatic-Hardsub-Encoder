import assert from 'node:assert/strict';
import { inspectFontFile, fontSupportsCodePoint, analyzeFontUsageCoverage } from './fonts.js';

function writeTag(view, offset, tag) {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, tag.charCodeAt(i));
}

function syntheticFormat4Font() {
  const buffer = new ArrayBuffer(72);
  const view = new DataView(buffer);
  view.setUint32(0, 0x00010000, false);
  view.setUint16(4, 1, false);
  writeTag(view, 12, 'cmap');
  view.setUint32(20, 28, false);
  view.setUint32(24, 44, false);

  const cmap = 28;
  view.setUint16(cmap, 0, false);
  view.setUint16(cmap + 2, 1, false);
  view.setUint16(cmap + 4, 3, false);
  view.setUint16(cmap + 6, 1, false);
  view.setUint32(cmap + 8, 12, false);

  const sub = cmap + 12;
  view.setUint16(sub, 4, false);
  view.setUint16(sub + 2, 32, false);
  view.setUint16(sub + 4, 0, false);
  view.setUint16(sub + 6, 4, false);
  view.setUint16(sub + 8, 4, false);
  view.setUint16(sub + 10, 1, false);
  view.setUint16(sub + 12, 0, false);
  view.setUint16(sub + 14, 0x0043, false);
  view.setUint16(sub + 16, 0xFFFF, false);
  view.setUint16(sub + 18, 0, false);
  view.setUint16(sub + 20, 0x0041, false);
  view.setUint16(sub + 22, 0xFFFF, false);
  view.setInt16(sub + 24, 1 - 0x0041, false);
  view.setInt16(sub + 26, 1, false);
  view.setUint16(sub + 28, 0, false);
  view.setUint16(sub + 30, 0, false);
  return buffer;
}

function syntheticFormat12Font() {
  const buffer = new ArrayBuffer(68);
  const view = new DataView(buffer);
  view.setUint32(0, 0x00010000, false);
  view.setUint16(4, 1, false);
  writeTag(view, 12, 'cmap');
  view.setUint32(20, 28, false);
  view.setUint32(24, 40, false);

  const cmap = 28;
  view.setUint16(cmap, 0, false);
  view.setUint16(cmap + 2, 1, false);
  view.setUint16(cmap + 4, 3, false);
  view.setUint16(cmap + 6, 10, false);
  view.setUint32(cmap + 8, 12, false);

  const sub = cmap + 12;
  view.setUint16(sub, 12, false);
  view.setUint16(sub + 2, 0, false);
  view.setUint32(sub + 4, 28, false);
  view.setUint32(sub + 8, 0, false);
  view.setUint32(sub + 12, 1, false);
  view.setUint32(sub + 16, 0x1F600, false);
  view.setUint32(sub + 20, 0x1F601, false);
  view.setUint32(sub + 24, 20, false);
  return buffer;
}

const format4Faces = await inspectFontFile({
  name: 'synthetic-format4.ttf',
  arrayBuffer: async () => syntheticFormat4Font()
});
assert.equal(format4Faces[0].coverageKnown, true);
assert.equal(fontSupportsCodePoint(format4Faces[0], 0x41), true);
assert.equal(fontSupportsCodePoint(format4Faces[0], 0x43), true);
assert.equal(fontSupportsCodePoint(format4Faces[0], 0x44), false);

const format12Faces = await inspectFontFile({
  name: 'synthetic-format12.ttf',
  arrayBuffer: async () => syntheticFormat12Font()
});
assert.equal(fontSupportsCodePoint(format12Faces[0], 0x1F600), true);
assert.equal(fontSupportsCodePoint(format12Faces[0], 0x1F601), true);
assert.equal(fontSupportsCodePoint(format12Faces[0], 0x1F602), false);

const face = {
  ...format4Faces[0],
  family: 'Synthetic',
  fullName: 'Synthetic',
  aliases: ['Synthetic']
};
const coverage = analyzeFontUsageCoverage(
  [{ fontName: 'Requested', codePoints: [0x41, 0x43, 0x44] }],
  [face],
  { Requested: 'Synthetic' }
);
assert.equal(coverage[0].status, 'partial');
assert.deepEqual(coverage[0].missingCodePoints, [0x44]);

console.log('Font cmap coverage test passed');
