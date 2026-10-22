import test from 'node:test';
import assert from 'node:assert/strict';
import {previewAspect,toolbarDensity,sourceObjects,previewFrameReady} from './workbench-v3-model.js';

test('preview follows display aspect including non-square pixels without inventing metadata',()=>{
  assert.equal(previewAspect({width:720,height:576,sar:'16:15'}),4/3);
  assert.equal(previewAspect({width:1080,height:1920}),9/16);
  assert.equal(previewAspect(null),null);
  assert.equal(previewAspect({width:0,height:100}),null);
});
test('automatic density only adapts action labels and respects explicit choice',()=>{
  assert.equal(toolbarDensity('auto',834),'compact');
  assert.equal(toolbarDensity('auto',1440),'standard');
  assert.equal(toolbarDensity('standard',834),'standard');
  assert.equal(toolbarDensity('compact',1440),'compact');
});
test('source projection includes actual attachmentStreams and preserves ffprobe tag identities',()=>{
  const objects=sourceObjects({videoStreams:[{codec:'hevc',width:1920,height:1080}],audioStreams:[{codec:'flac',tags:{title:'日语原声',language:'jpn'}}],attachmentStreams:[{codec_name:'ttf',tags:{filename:'NotoSans.ttf'}}]});
  assert.equal(objects.length,3);
  assert.equal(objects[1].name,'日语原声');
  assert.match(objects[1].properties,/jpn/);
  assert.equal(objects[2].name,'NotoSans.ttf');
});

test('central preview fails closed on frames from a previous source',()=>{
  assert.equal(previewFrameReady('blob:old',false,'blob:old'),false);
  assert.equal(previewFrameReady('blob:new',false,'blob:old'),true);
  assert.equal(previewFrameReady('data:image/png;base64,AA',false,null),true);
  assert.equal(previewFrameReady(null,false,null),false);
  assert.equal(previewFrameReady('blob:ready',true,null),false);
});
