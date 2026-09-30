import assert from 'node:assert/strict';
import { parseLibassFontDiagnostics, codePointDisplay } from './font-diagnostics.js';

const resolved = parseLibassFontDiagnostics([
  "fontselect: (Arial, 400, 0) -> C:/Windows/Fonts/arial.ttf, 0, Arial",
  "Glyph 0x20BB7 not found, selecting one more font for (Arial, 400, 0)",
  "fontselect: (Arial, 400, 0) -> C:/Windows/Fonts/msyh.ttc, 0, Microsoft YaHei"
]);

assert.equal(resolved.missingGlyphs.length, 1);
assert.equal(resolved.missingGlyphs[0].codePoint, 0x20BB7);
assert.equal(resolved.missingGlyphs[0].requested, 'Arial');
assert.equal(resolved.missingGlyphs[0].status, 'fallback-selected');
assert.equal(resolved.missingGlyphs[0].fallbackSelected, 'Microsoft YaHei');
assert.equal(resolved.fallbackSelections.length, 1);
assert.equal(resolved.hasRisk, true);
assert.equal(resolved.hasUnresolvedRisk, false);

const unresolved = parseLibassFontDiagnostics([
  "Glyph U+30EDE not found, selecting one more font for (RareFont, 400, 0)",
  "failed to find fallback font for (RareFont, 400, 0)"
]);
assert.equal(unresolved.missingGlyphs.length, 1);
assert.equal(unresolved.missingGlyphs[0].status, 'fallback-failed');
assert.equal(unresolved.hasUnresolvedRisk, true);
assert.equal(unresolved.failures.length, 1);

const normal = parseLibassFontDiagnostics([
  "fontselect: (Noto Sans SC, 400, 0) -> /fonts/NotoSansSC-Regular.otf, 0, Noto Sans SC"
]);
assert.equal(normal.hasRisk, false);
assert.equal(normal.normalSelections.length, 1);
assert.equal(normal.normalSelections[0].selected, 'Noto Sans SC');

assert.deepEqual(codePointDisplay(0x20BB7), { char: '𠮷', hex: 'U+020BB7' });

console.log('libass font diagnostics test passed');
