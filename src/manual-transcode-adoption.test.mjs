import test from 'node:test';
import assert from 'node:assert/strict';
import {commitVerifiedManualCandidate} from './manual-transcode-adoption.js';
const candidate={id:'h265-x265',codec:'h265',encoder:'libx265',preset:'medium'};
function fixture(){
  const values={codec:'h264',encoder:'libx264',preset:'slow',
    multipass:'disabled',rateMode:'quality',bitrate:'1500000',
    twoPass:false,operation:'transcode',audio:'copy'};
  const el={};
  for(const [name,value] of Object.entries(values)) el[name]={
    value:String(value),checked:value===true
  };
  const read=()=>Object.fromEntries(Object.entries(el).map(([name,x])=>[
    name,name==='twoPass'?x.checked:x.value
  ]));
  const old=read(),events=[];
  const run=({override={},compile=(actual)=>({
    operation:'transcode',codec:actual.codec,encoder:actual.encoder,
    preset:actual.preset,rateMode:actual.rateMode,bitrate:Number(actual.bitrate)
  })}={})=>commitVerifiedManualCandidate({
    candidate,bitrate:850000,expectedSettings:old,
    expectedSourceIdentity:'source-v1',read,
    sourceIdentity:()=> 'source-v1',get:k=>el[k],
    updateEncoder:()=>{el.encoder.value='libx264';},
    updatePreset:()=>{el.preset.value='fast';},
    updateRate:()=>{events.push('rate');},
    compile,media:{duration:60},...override
  });
  return {el,old,read,events,run};
}
test('atomic form commit builds one complete bitrate-mode HEVC plan',()=>{
  const x=fixture(),result=x.run();
  assert.equal(result.ok,true);
  assert.equal(result.task.encoder,'libx265');
  assert.equal(result.task.rateMode,'bitrate');
  assert.equal(x.read().codec,'h265');
  assert.equal(x.read().preset,'medium');
  assert.equal(x.read().bitrate,'850000');
  assert.equal(x.read().twoPass,false);
});
test('failed final compiler restores all old fields; no task is adopted',()=>{
  const x=fixture();
  const result=x.run({compile:()=>{throw Error('invalid mux');}});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'adoption-rejected');
  assert.deepEqual(x.read(),x.old);
});
test('source/settings drift is rejected before touching form',()=>{
  const x=fixture();
  const s=x.run({override:{sourceIdentity:()=> 'other'}});
  assert.equal(s.reason,'stale-adoption-settings');
  assert.equal(x.events.length,0);
  assert.deepEqual(x.read(),x.old);
  const t=x.run({override:{expectedSettings:{...x.old,codec:'h265'}}});
  assert.equal(t.reason,'stale-adoption-settings');
  assert.deepEqual(x.read(),x.old);
});
test('unknown/contradictory encoders and invalid rate cannot be committed',()=>{
  const x=fixture();
  for(const p of [{candidate:{...candidate,encoder:'hevc_nvenc'}},
    {candidate:{...candidate,codec:'av1'}},{bitrate:0},
    {bitrate:'850000'}]){
    const y=x.run({override:p});assert.equal(y.ok,false);
    assert.deepEqual(x.read(),x.old);
  }
});
test('invalid chosen encoder options trigger rollback instead of partial switch',()=>{
  const x=fixture();
  const y=x.run({override:{updateEncoder:()=>{x.el.encoder.value='';}}});
  assert.equal(y.ok,false);
  assert.deepEqual(x.read(),x.old);
});
