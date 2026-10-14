import test from 'node:test';
import assert from 'node:assert/strict';
import {compileTask} from './media-task.js';
import {manualCandidateSet} from './manual-candidate-set.js';
test('default candidate set preserves the two medium codecs and twelve samples',()=>{
 const s=manualCandidateSet('codecs',{width:640,height:360});
 assert.equal(s.maxRequests,12);assert.deepEqual(s.candidates.map(c=>[c.id,c.preset]),[['h264-x264','medium'],['h265-x265','medium']]);
});
test('codec preset cross-product compiles four independent plans with bounded samples',()=>{
 const s=manualCandidateSet('codecs-presets',{width:640,height:360});
 assert.equal(s.maxRequests,24);assert.equal(new Set(s.candidates.map(c=>c.id)).size,4);
 assert.deepEqual(new Set(s.candidates.map(c=>c.preset)),new Set(['medium','fast']));
 for(const c of s.candidates){const t=compileTask({operation:'transcode',start:0,end:'',rateMode:'quality',quality:28,audio:'none',fpsMode:'auto',rotation:'none',deinterlace:'none',...c},{duration:5,fps:24,videoTracks:1,audioTracks:0});assert.equal(t.encoder,c.encoder);assert.equal(t.preset,c.preset);}
});
test('unsupported candidate policy or geometry fails instead of inventing candidates',()=>{
 assert.throws(()=>manualCandidateSet('unbounded',{width:640,height:360}));
 assert.throws(()=>manualCandidateSet('codecs-presets',{width:0,height:360}));
});
test('resolution policy creates twelve geometry-bound branches and seventy-two maximum samples',()=>{
 const s=manualCandidateSet('codecs-presets-resolutions',{width:3840,height:2160});
 assert.equal(s.candidates.length,12);assert.equal(s.maxRequests,72);
 assert.equal(new Set(s.candidates.map(c=>c.id)).size,12);
 assert.deepEqual(new Set(s.candidates.map(c=>c.outputHeight)),new Set([2160,1080,720]));
 assert.ok(s.candidates.every(c=>c.scaleAlgorithm==='bicubic'));
 assert.equal(manualCandidateSet('codecs-presets-resolutions',{width:640,height:360}).candidates.length,4);
});
