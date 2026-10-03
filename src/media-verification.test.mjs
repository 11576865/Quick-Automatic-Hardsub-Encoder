import assert from 'node:assert/strict';
import test from 'node:test';
import { verificationDuration, verificationSourceTime, verificationHasSpatialTransforms } from './media-verification.js';

test('output verification maps output time onto the actual source start', () => {
  const task={start:10,expectedDuration:100};
  const completed={actualStart:10.25,outputDuration:99.8};
  assert.equal(verificationDuration(task,completed),99.8);
  assert.equal(verificationSourceTime(task,completed,5),15.25);
  assert.equal(verificationSourceTime(task,completed,999),110.05);
});

test('output verification falls back to task duration and detects spatial transforms', () => {
  assert.equal(verificationDuration({expectedDuration:12},{}),12);
  assert.equal(verificationSourceTime({start:3,expectedDuration:12},{},4),7);
  assert.equal(verificationHasSpatialTransforms({}),false);
  assert.equal(verificationHasSpatialTransforms({width:1920}),true);
  assert.equal(verificationHasSpatialTransforms({rotation:'clock'}),true);
});
