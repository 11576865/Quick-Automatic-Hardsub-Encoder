import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyFlacCachedPacketReuse as verify} from './flac-cache-reuse-contract.js';

const DIG='a'.repeat(64),MIXED='b'.repeat(64),SOURCE='c'.repeat(64);
const fixture=()=>{
 const cache={version:1,kind:'encoded-flac-cache-v1',sourceKey:'video-source',
   measurementId:'full-ledger-id',sourceSha256:SOURCE,artifactSha256:DIG,
   artifactWriteTicks:'638960827860000000',artifactBytes:81000,start:.4,end:2.4,
   tracks:[
    {codec:'flac',cacheOrdinal:0,sourceOrdinal:0,range:'full',channels:null,
     sampleRate:null,packetCount:32,packetBytes:39300,orderedPacketSha256:DIG},
    {codec:'flac',cacheOrdinal:1,sourceOrdinal:1,range:'trim',channels:1,
     sampleRate:48000,packetCount:21,packetBytes:27599,orderedPacketSha256:MIXED}]};
 const finished={version:1,kind:'completed-mixed-mux-v1',
   artifactSha256:MIXED,artifactWriteTicks:'638960827860011111',
   artifactBytes:101000,jobId:'this-job',tracks:[
    {codec:'flac',outputOrdinal:0,packetCount:32,packetBytes:39300,orderedPacketSha256:DIG},
    {codec:'flac',outputOrdinal:1,packetCount:21,packetBytes:27599,orderedPacketSha256:MIXED}]};
 const plan={version:1,method:'cached-flac-packets-copy-v1',
   sourceKey:'video-source',measurementId:'full-ledger-id',
   jobId:'this-job',start:.4,end:2.4,
   container:'matroska',audioCodec:'copy',hasVideo:true,softSubtitleStreams:1,
   maps:[{sourceOrdinal:0,cacheOrdinal:0,outputOrdinal:0,range:'full',
     channels:null,sampleRate:null},
    {sourceOrdinal:1,cacheOrdinal:1,outputOrdinal:1,range:'trim',
     channels:1,sampleRate:48000}]};
 return {cache,finished,plan,sourceKey:'video-source'};
};
test('actual cached packet sequence equality is a single-job certificate, never future strict budget admission',()=>{
 const r=verify(fixture());
 assert.equal(r.ok,true);assert.equal(r.audioPacketBytes,66899);
 assert.equal(r.tracks.length,2);
 assert.equal(r.cacheAudioPacketReuseVerified,true);
 assert.equal(r.canAuthorizeStrictBudget,false);
 assert.equal(r.canPredictNextJobSize,false);
 assert.equal(r.canRebaseWholeSourceLedger,false);
});
test('source identity, measured ledger and finished output job cannot be substituted',()=>{
 for(const mutate of [x=>x.sourceKey='other',
  x=>x.cache.sourceKey='other',x=>x.plan.sourceKey='other',
  x=>x.plan.measurementId='other',x=>x.finished.jobId='other',
  x=>x.cache.sourceSha256='bad',x=>x.cache.artifactSha256='bad',
  x=>x.finished.artifactWriteTicks=638960827860011111]){
  const x=fixture();mutate(x);
  assert.equal(verify(x).ok,false);
 }
});
test('silent FLAC re-encoding, packet mismatch or reordered payload cannot pass',()=>{
 for(const change of [x=>x.plan.audioCodec='flac',
  x=>x.finished.tracks[0].orderedPacketSha256='d'.repeat(64),
  x=>x.finished.tracks[1].packetCount++,
  x=>x.finished.tracks[1].packetBytes++,
  x=>x.finished.tracks[0].codec='aac',
  x=>x.cache.tracks[0].range='trim',
  x=>x.plan.maps[1].sampleRate=44100,
  x=>x.plan.maps[0].outputOrdinal=1,
  x=>x.finished.tracks[1].outputOrdinal=0]){
  const x=fixture();change(x);
  assert.equal(verify(x).ok,false);
 }
});
test('scope requires actual video and soft subtitle in a completed Matroska output',()=>{
 for(const mutate of [x=>x.plan.hasVideo=false,
  x=>x.plan.softSubtitleStreams=0,
  x=>x.plan.container='mp4',x=>x.plan.start=1,
  x=>x.plan.end=2.5,x=>x.plan.method='ffprobe-prediction']){
  const x=fixture();mutate(x);assert.equal(verify(x).ok,false);
 }
});
test('all encoded cache tracks must be mapped once without output duplication',()=>{
 for(const mutate of [x=>x.plan.maps.pop(),
  x=>x.plan.maps[1].cacheOrdinal=0,
  x=>x.plan.maps[1].outputOrdinal=0,
  x=>x.finished.tracks.push({...x.finished.tracks[0],outputOrdinal:2})]){
  const x=fixture();mutate(x);assert.equal(verify(x).ok,false);
 }
});
test('packet byte overflow, final mux smaller than reused audio and invalid hashes fail closed',()=>{
 for(const mutate of [x=>x.finished.artifactBytes=60000,
  x=>x.cache.tracks[1].packetBytes=Number.MAX_SAFE_INTEGER,
  x=>x.cache.tracks[0].packetCount=-1,
  x=>x.cache.tracks[1].orderedPacketSha256='invalid',
  x=>x.finished.tracks[0].packetBytes=null]){
  const x=fixture();mutate(x);assert.equal(verify(x).ok,false);
 }
});
function run(program,args,timeout=45000){
 const out=spawnSync(program,args,{encoding:'utf8',timeout,maxBuffer:20*1024*1024,
   windowsHide:true});
 if(out.error||out.status!==0)throw Error(program+' failed: '+(out.error?.message||out.stderr||out.stdout||out.status));
 return out.stdout;
}
function digest(bytes){return createHash('sha256').update(bytes).digest('hex');}
function packets(file){
 const raw=run('ffprobe',['-v','error','-select_streams','a',
  '-show_packets','-show_data_hash','sha256',
  '-show_entries','packet=stream_index,size,data_hash','-of','json',file]);
 const byStream=new Map();
 for(const p of JSON.parse(raw).packets||[]){
  const index=Number(p.stream_index),size=Number(p.size),hash=p.data_hash;
  assert.ok(Number.isSafeInteger(index)&&index>=0&&Number.isSafeInteger(size)&&size>0);
  assert.match(hash,/^SHA256:[a-f0-9]{64}$/);
  if(!byStream.has(index))byStream.set(index,[]);
  byStream.get(index).push([size,hash]);
 }
 return [...byStream.values()].map(p=>({
  packetCount:p.length,packetBytes:p.reduce((s,x)=>s+x[0],0),
  orderedPacketSha256:digest(p.map(x=>x.join('\t')+'\n').join(''))
 }));
}
test('REAL FFmpeg caches two FLAC tracks once then copies exact ordered encoded packets into video+softsubtitle mixed mux',
 {skip:process.env.QHE_B16_REAL_PACKET_FIXTURE!=='1'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'qhe-b16-flac-reuse-'));
 try{
  const src=join(dir,'source.mkv'),sub=join(dir,'sub.srt');
  const cachePath=join(dir,'cache.mka'),finalPath=join(dir,'final.mkv');
  writeFileSync(sub,'1\n00:00:00,100 --> 00:00:02,000\nFLAC cache reuse\n','utf8');
  run('ffmpeg',['-hide_banner','-loglevel','error','-y',
   '-f','lavfi','-i','testsrc2=size=64x64:rate=12:duration=3',
   '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3',
   '-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=3',
   '-i',sub,'-map','0:v:0','-map','1:a:0','-map','2:a:0','-map','3:s:0',
   '-c:v','ffv1','-c:a','pcm_s16le','-c:s','srt',src]);
  run('ffmpeg',['-hide_banner','-loglevel','error','-y',
   '-i',src,'-ss','0.4','-t','2','-i',src,
   '-map','0:a:0','-map','1:a:1','-c:a:0','flac','-c:a:1','flac',
   '-vn','-sn','-dn','-map_metadata','-1','-map_chapters','-1',
   '-f','matroska',cachePath]);
  run('ffmpeg',['-hide_banner','-loglevel','error','-y',
   '-i',src,'-i',cachePath,
   '-map','0:v:0','-map','1:a:0','-map','1:a:1','-map','0:s:0',
   '-c:v','libx264','-preset','ultrafast','-crf','42','-pix_fmt','yuv420p',
   '-c:a','copy','-c:s','copy','-map_metadata','-1','-map_chapters','-1',
   '-f','matroska',finalPath]);
  const p=packets(cachePath),q=packets(finalPath);
  assert.equal(p.length,2);assert.equal(q.length,2);
  const expected=fixture(),sourceHash=digest(readFileSync(src));
  expected.sourceKey=sourceHash;expected.cache.sourceKey=sourceHash;expected.plan.sourceKey=sourceHash;
  expected.cache.sourceSha256=sourceHash;
  expected.cache.artifactSha256=digest(readFileSync(cachePath));
  expected.cache.artifactBytes=statSync(cachePath).size;
  expected.finished.artifactSha256=digest(readFileSync(finalPath));
  expected.finished.artifactBytes=statSync(finalPath).size;
  for(let i=0;i<2;i++){
   Object.assign(expected.cache.tracks[i],p[i]);
   Object.assign(expected.finished.tracks[i],q[i]);
  }
  const actual=verify(expected);
  assert.equal(actual.ok,true,actual.reason);
  assert.equal(actual.canAuthorizeStrictBudget,false);
  assert.equal(actual.tracks[0].packetCount,32);
  assert.equal(actual.tracks[1].packetCount,21);
  const mutated=structuredClone(expected);
  mutated.finished.tracks[1].orderedPacketSha256='0'.repeat(64);
  assert.equal(verify(mutated).reason,'encoded-flac-packet-bytes-or-order-differ');
  console.log('FLAC reuse verified: '+p.map(x=>x.packetCount+' packets / '+x.packetBytes+' bytes').join('; '));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
