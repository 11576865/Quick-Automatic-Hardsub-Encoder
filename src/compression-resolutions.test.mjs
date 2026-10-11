import test from 'node:test';
import assert from 'node:assert/strict';
import {guidedResolutionCandidates,COMMON_REFERENCE_METRIC} from './compression-resolutions.js';

test('produce bounded original, 1080p, 720p candidates with even dimensions',()=>{
 const c=guidedResolutionCandidates({width:3840,height:2160});
 assert.deepEqual(c.map(x=>x.id),['source','1080p','720p']);
 assert.deepEqual(c.map(x=>[x.displayWidth,x.displayHeight]),
  [[3840,2160],[1920,1080],[1280,720]]);
 assert.ok(c.every(x=>x.metric===COMMON_REFERENCE_METRIC));
});
test('fit unusual aspect ratios safely and refuse unsupported upscale/input cases',()=>{
 const portrait=guidedResolutionCandidates({width:1080,height:1920});
 assert.deepEqual(portrait.map(x=>x.id),['source','1080p','720p']);
 assert.ok(portrait.every(x=>x.width===0 || x.width%2===0));
 assert.deepEqual(guidedResolutionCandidates({width:854,height:480}).map(x=>x.id),['source']);
 assert.deepEqual(guidedResolutionCandidates({width:853,height:480}),[]);
 assert.deepEqual(guidedResolutionCandidates({width:0,height:1080}),[]);
});
