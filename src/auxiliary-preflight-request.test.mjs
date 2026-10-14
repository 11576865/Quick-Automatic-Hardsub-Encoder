import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAuxiliaryPreflightRequest} from './auxiliary-preflight-request.js';
const media={duration:8,audioTracks:2,subtitleTracks:1};
const budget={version:1,scope:'full-source',measurementId:'native-ledger-one',
 audioPacketBytes:[90000,100000],subtitlePacketBytes:[12000]};
const settings=()=>({start:1,end:7,audio:'copy',audioTrack:'all',
 audioRange:'trim',subtitleRange:'trim',keepSubtitles:true,
 subtitleStreams:'all'});
const make=opts=>buildAuxiliaryPreflightRequest({settings:settings(),media,budgetEvidence:budget,...opts});
test('trim copy preview maps both audio tracks plus one soft subtitle in same source interval',()=>{
 const x=make();
 assert.equal(x.ok,true);
 assert.equal(x.mode,'copy');
 assert.deepEqual(x.request.audioOrdinals,[0,1]);
 assert.deepEqual(x.request.subtitleOrdinals,[0]);
 assert.equal(x.request.start,1);
 assert.equal(x.request.end,7);
});
test('explicit FLAC multi-track plan retains each stream full vs trimmed source input and resampling intent',()=>{
 const s={...settings(),audioPlan:JSON.stringify([
 {sourceOrdinal:0,action:'flac',range:'full'},
 {sourceOrdinal:1,action:'flac',range:'trim',channels:1,sampleRate:44100}
 ])};
 const x=make({settings:s});
 assert.equal(x.ok,true);
 assert.equal(x.mode,'flac');
 assert.deepEqual(x.request.tracks,[
 {action:'flac',sourceOrdinal:0,range:'full',channels:null,sampleRate:null},
 {action:'flac',sourceOrdinal:1,range:'trim',channels:1,sampleRate:44100}
 ]);
});
test('partial FLAC observation cannot impersonate copy track cost',()=>{
 const s={...settings(),audioPlan:[{sourceOrdinal:0,action:'copy',range:'trim'},
 {sourceOrdinal:1,action:'flac',range:'trim'}]};
 const x=make({settings:s});
 assert.equal(x.ok,true);
 assert.equal(x.partial,true);
 assert.equal(x.request.tracks.length,1);
});
test('copy preview rejects mixed full and trimmed track costs',()=>{
 const s={...settings(),audioPlan:[{sourceOrdinal:0,action:'copy',range:'full'},
 {sourceOrdinal:1,action:'copy',range:'trim'}]};
 assert.equal(make({settings:s}).reason,'mixed-or-full-copy-not-a-trim-preview');
});
test('untrimmed copy, absent source measurement and no relevant streams are refused',()=>{
 assert.equal(make({settings:{...settings(),start:0,end:8,keepSubtitles:false}}).reason,'no-trim-requested');
 assert.equal(make({budgetEvidence:null}).reason,'missing-source-measurement');
 assert.equal(make({settings:{...settings(),audio:'none',keepSubtitles:false}}).reason,'no-relevant-copy-or-flac-stream');
});
test('invalid track indexes and subtitle selection are rejected',()=>{
 assert.equal(make({settings:{...settings(),audioTrack:'4',keepSubtitles:false}}).reason,'invalid-source-audio-ordinal');
 assert.equal(make({settings:{...settings(),subtitleStreams:'3'}}).reason,'invalid-subtitle-selection');
});
test('mixed source ranges for soft subtitles and trimmed copies never count as same remux',()=>{
 assert.equal(make({settings:{...settings(),subtitleRange:'full'}}).reason,'mixed-or-full-copy-not-a-trim-preview');
});
test('workbench selects Native backend and does not change strict sizeBudget source',async()=>{
 const {readFile}=await import('node:fs/promises');
 const [ui,main,client,planning]=await Promise.all([
  readFile(new URL('./media-workspace.js',import.meta.url),'utf8'),
  readFile(new URL('./main.js',import.meta.url),'utf8'),
  readFile(new URL('./windows-native-client.js',import.meta.url),'utf8'),
  readFile(new URL('./media-planning.js',import.meta.url),'utf8')
 ]);
 assert.match(ui,/buildAuxiliaryPreflightRequest\(/);
 assert.match(ui,/assessFlacEncodeObservation\(/);
 assert.match(ui,/正式体积预算保持不变/);
 assert.match(main,/auxiliaryPreflight: async request =>/);
 assert.match(client,/startFlacEncodePreflight/);
 assert.match(client,/startTrimCopyPreflight/);
 assert.match(planning,/FLAC 重编码体积成本未知/);
});
