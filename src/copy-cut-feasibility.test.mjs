import test from 'node:test';
import assert from 'node:assert/strict';
import {assessCopyCutStart} from './copy-cut-feasibility.js';
test('copy start is a predicted dependency, not certified actual presentation',()=>{
 const a=assessCopyCutStart({requestedIn:3.5,keyframes:[0,2,4,6],evidenceCurrent:true});
 assert.equal(a.state,'predicted-early');assert.equal(a.estimatedIn,2);
 assert.equal(a.delta,1.5);
 assert.match(a.description,/PTS\/DTS/);
 assert.equal('actualFirstPresentation' in a,false);
});
test('keyframe alignment is still a hypothesis rather than frame-exact proof',()=>{
 const a=assessCopyCutStart({requestedIn:4,keyframes:[0,2,4],evidenceCurrent:true});
 assert.equal(a.state,'predicted-aligned');assert.match(a.description,/不能保证/);
});
test('source drift and truncated coverage never reuse stale keyframes',()=>{
 assert.equal(assessCopyCutStart({requestedIn:3,keyframes:[0,2],evidenceCurrent:false}).state,'unknown');
 assert.equal(assessCopyCutStart({requestedIn:9,keyframes:[0,2,4],truncated:true,evidenceCurrent:true}).state,'unknown');
 assert.equal(assessCopyCutStart({requestedIn:1,keyframes:[3,4],evidenceCurrent:true}).state,'unknown');
});
test('zero start, no observation and malformed IN do not fabricate actual frames',()=>{
 assert.equal(assessCopyCutStart({requestedIn:0}).state,'beginning');
 assert.equal(assessCopyCutStart({requestedIn:6}).state,'unknown');
 assert.throws(()=>assessCopyCutStart({requestedIn:-1}),/nonnegative/);
});
