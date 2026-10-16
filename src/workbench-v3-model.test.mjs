import test from 'node:test';
import assert from 'node:assert/strict';
import {previewAspect,toolbarDensity} from './workbench-v3-model.js';

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
