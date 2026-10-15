import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedIntent,restoreExpectedIntent,updateExpectedIntent} from './expected-workbench-model.js';

test('copy has time-boundary intent instead of rate-distortion optimization',()=>{
  const copy=expectedIntent('copy','source-a');
  assert.equal(copy.goal,'keyframe');
  assert.equal(copy.operation,'copy');
  assert.equal(expectedIntent('transcode','source-a').goal,'balanced');
});
test('design intent never authorizes execution or measurement evidence',()=>{
  const draft=updateExpectedIntent(expectedIntent('hardsub','source-a'),'color','hdr');
  assert.equal(draft.color,'hdr');
  assert.equal(draft.executionConnected,false);
  assert.equal(draft.evidence,'unmeasured');
  assert.throws(()=>updateExpectedIntent(draft,'executionConnected',true));
  assert.throws(()=>updateExpectedIntent(draft,'goal','fabricated'));
});
test('drafts cannot cross source or operation and invalid stored values are ignored',()=>{
  const draft=updateExpectedIntent(expectedIntent('hardsub','a'),'subtitle','embedded');
  assert.equal(restoreExpectedIntent(JSON.stringify(draft),'hardsub','a').subtitle,'embedded');
  assert.equal(restoreExpectedIntent(JSON.stringify(draft),'hardsub','b').subtitle,'external');
  assert.equal(restoreExpectedIntent(JSON.stringify(draft),'transcode','a').subtitle,'preserve');
  assert.equal(restoreExpectedIntent('{broken','hardsub','a').subtitle,'external');
  assert.equal(restoreExpectedIntent(JSON.stringify({...draft,color:'fake',executionConnected:true}),'hardsub','a').executionConnected,false);
});
