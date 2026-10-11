import assert from 'node:assert/strict';
import test from 'node:test';
import {makeQueuedClip,validateQueuedCopySettings,clipOutputName} from './clip-queue.js';

test('make queued clip parses IN/OUT and rejects ambiguous or invalid ranges',()=>{
  const media={duration:280.123};
  assert.deepEqual(makeQueuedClip('1:00.250','1:05.500',media),{
    start:60.25,end:65.5,startText:'1:00.25',endText:'1:05.5',duration:5.25
  });
  assert.throws(()=>makeQueuedClip('5','',media),/明确填写结束时间/);
  assert.throws(()=>makeQueuedClip('10','9',media),/晚于/);
  assert.throws(()=>makeQueuedClip('0','281',media),/超出媒体时长/);
  assert.throws(()=>makeQueuedClip('0','3',null),/有效的视频时长/);
});
test('queue preserves stream-copy trim semantics',()=>{
  const valid={operation:'copy',videoRange:'trim',audio:'copy',audioRange:'trim',subtitleRange:'trim',keepSubtitles:false};
  assert.doesNotThrow(()=>validateQueuedCopySettings(valid));
  assert.throws(()=>validateQueuedCopySettings({...valid,operation:'transcode'}),/仅用于无损剪切/);
  assert.throws(()=>validateQueuedCopySettings({...valid,videoRange:'full'}),/视频时间轴/);
  assert.throws(()=>validateQueuedCopySettings({...valid,audioRange:'full'}),/音频/);
  assert.throws(()=>validateQueuedCopySettings({...valid,keepSubtitles:true,subtitleRange:'full'}),/软字幕/);
  assert.doesNotThrow(()=>validateQueuedCopySettings({...valid,audio:'none',audioRange:'full'}));
});
test('each clip has a unique predictable name, without changing container',()=>{
  assert.equal(clipOutputName('travel.mkv',1),'travel-clip-01.mkv');
  assert.equal(clipOutputName('footage.final.mp4',23),'footage.final-clip-23.mp4');
  assert.equal(clipOutputName('export',2),'export-clip-02');
});
