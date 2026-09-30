import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { decodeAssFile } from './ass-decoding.js';

const ass = '[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,中文';
const utf8 = new Blob([ass]);
assert.equal((await decodeAssFile(utf8)).text, ass);
const utf16 = new Blob([new Uint8Array([0xff, 0xfe]), Buffer.from(ass, 'utf16le')]);
assert.equal((await decodeAssFile(utf16)).text, ass);
const gbk = new Blob([Buffer.from(ass.slice(0, -2), 'ascii'), new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])]);
await assert.rejects(decodeAssFile(gbk), /无效 UTF-8/);

const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const start = source.indexOf('function invalidateAnalysis()');
const end = source.indexOf("for (const [inputId, role]", start);
assert(start > 0 && end > start);
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, {
    disabled: false,
    classList: { add() {} },
    innerHTML: '',
    checked: false
  });
  return elements.get(id);
};
const revoked = [];
const state = {
  video: { name: 'new.mp4' }, ass: { name: 'new.ass' }, fonts: [],
  analyzedVideo: { name: 'old.mp4' }, analyzedAss: { name: 'old.ass' },
  analyzedFontKey: 'old.ttf', inputDecodeOk: true, media: { duration: 10 },
  assInfo: { previewTimes: [1] }, selectedCodec: 'h264', acceptedWarnings: true,
  previewUrls: ['blob:old'], previewBaseUrls: ['blob:base'], previewVisualChange: [true],
  selectedTest: { sampleUrl: 'blob:sample-a' },
  selectedTests: {
    a: { sampleUrl: 'blob:sample-a' },
    b: { sampleUrl: 'blob:sample-b' }
  },
  latestNativeSampleId: 'sample-id',
  benchmarks: { h264: {} },
  operationBusy: false
};
let runs = 0;
const context = vm.createContext({
  state, $: element, document: { querySelectorAll: () => [] },
  URL: { revokeObjectURL: url => revoked.push(url) },
  invalidateQualityCalibration() {}, refreshBenchmarkEnabled() {}, refreshAnalyze() {},
  updateQualityCalibrationControls() {}, log() {}, alert() {}
});
vm.runInContext(source.slice(start, end), context);
context.invalidateAnalysis();
assert.equal(state.inputDecodeOk, false);
assert.equal(state.analyzedVideo, null);
assert.equal(state.media, null);
assert.equal(state.selectedCodec, null);
assert.deepEqual(revoked, ['blob:old', 'blob:base', 'blob:sample-a', 'blob:sample-b']);
assert.equal(Object.keys(state.selectedTests).length, 0);
assert.equal(state.latestNativeSampleId, null);
assert.equal(element('previewBtn').disabled, true);

let release;
const pending = context.runWebTask(async () => {
  runs++;
  await new Promise(resolve => { release = resolve; });
});
assert.equal(state.operationBusy, true);
assert.equal(element('ass').disabled, true);
await context.runWebTask(async () => { runs++; });
assert.equal(runs, 1);
release();
await pending;
assert.equal(state.operationBusy, false);
assert.equal(element('ass').disabled, false);
console.log('Input decoding, invalidation, and task exclusion passed');
