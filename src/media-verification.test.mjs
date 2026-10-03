import assert from 'node:assert/strict';
import test from 'node:test';
import { verificationDuration, verificationSourceTime, verificationHasSpatialTransforms, hardsubReferenceFilter } from './media-verification.js';

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


test('builds hardsub reference filters with absolute subtitle timing and full task transforms', () => {
  const task={
    operation:'hardsub',
    outputArgs:[
      '-map','0:v:0',
      '-vf','crop=1920:800:0:140,scale=1280:-2:flags=lanczos,setpts=PTS+10/TB,ass=__ASS__:fontsdir=__FONTS__,setpts=PTS-10/TB,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0'
    ]
  };
  assert.equal(
    hardsubReferenceFilter(task,12.345,'subtitle.ass','fonts',1200),
    'crop=1920:800:0:140,scale=1280:-2:flags=lanczos,setpts=PTS-STARTPTS+12.345/TB,ass=subtitle.ass:fontsdir=fonts,setpts=PTS-STARTPTS,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0,scale=1200:-2:force_original_aspect_ratio=decrease'
  );
});

test('hardsub reference timing is injected even when production starts at zero', () => {
  const task={operation:'hardsub',outputArgs:['-vf','ass=__ASS__:fontsdir=__FONTS__,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0']};
  assert.equal(
    hardsubReferenceFilter(task,57.5,'/subtitle.ass','/fonts',0),
    'setpts=PTS-STARTPTS+57.5/TB,ass=/subtitle.ass:fontsdir=/fonts,setpts=PTS-STARTPTS,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0'
  );
});
