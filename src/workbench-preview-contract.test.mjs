import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {previewAspect} from './workbench-v3-model.js';

// Exercise the real adapters without starting a DOM application or FFmpeg runtime.
test('browser probe retains SAR through normalization into the UI projection',()=>{
  const code=readFileSync(new URL('./engine.js',import.meta.url),'utf8');
  const body=code.slice(code.indexOf('function normalizeMediaInfo('),code.indexOf('function q(value)'));
  const normalize=vm.runInNewContext(`${body};normalizeMediaInfo`);
  const media=normalize({streams:[{codec_type:'video',width:720,height:576,sample_aspect_ratio:'16:15'}]});
  assert.equal(previewAspect(media),4/3);
});
test('native probe retains SAR through normalization into the UI projection',()=>{
  const code=readFileSync(new URL('./main.js',import.meta.url),'utf8');
  const body=code.slice(code.indexOf('function mediaFromNativeProbe('),code.indexOf('function requestNativePreview('));
  const normalize=vm.runInNewContext(`${body};mediaFromNativeProbe`,{state:{video:{name:'sample.mkv',size:100}}});
  const media=normalize({videoStreams:[{width:720,height:576,sample_aspect_ratio:'16:15'}]});
  assert.equal(previewAspect(media),4/3);
});
