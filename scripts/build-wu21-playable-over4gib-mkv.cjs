// WU21: a syntactically valid Matroska file with video/audio clusters on
// BOTH sides of the UInt32 offset boundary. We add segment-level EBML Void
// elements to a real FFmpeg LIVE Matroska file. Only the INPUT is NTFS sparse.
// This is a 4GiB+ playable CONTAINER, not 4GiB of encoded media payload.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const [original,destination]=process.argv.slice(2);
assert(original&&destination,'Usage: node build-wu21-playable-over4gib-mkv.cjs live-source.mkv >4gib-sparse-stage.mkv');
assert.equal(process.platform,'win32','WU21 >4GiB playable fixture requires real Windows NTFS.');
assert.equal(process.env.GITHUB_ACTIONS,'true','WU21 fixture is intended solely for hosted Windows CI.');
const bytes=fs.readFileSync(original);
assert(bytes.length>1000&&bytes.length<5000000,'Expected genuine short FFmpeg live video/audio MKV');
assert(bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])),'Missing Matroska EBML header');
const clusterId=Buffer.from([0x1f,0x43,0xb6,0x75]);
const positions=[];
for(let i=0;i<=bytes.length-4;i++)if(bytes.subarray(i,i+4).equals(clusterId))positions.push(i);
assert(positions.length>=6,'FFmpeg fixture must contain multiple separately encoded AV Clusters');
const split=positions[3];
assert(split>400&&split<bytes.length-512,'Invalid split between actual EBML media clusters');
assert(bytes.subarray(split,split+4).equals(clusterId));
const gaps=[1073741824,1073741824,1073741824,1073741824,65536];
const voidHeader=n=>{
  // EBML 8-octet variable-width size; 0x01 high marker + 56-bit payload.
  assert(Number.isSafeInteger(n)&&n>0&&n<Number(2n**56n-1n));
  const h=Buffer.alloc(9);h[0]=0xec;
  h.writeBigUInt64BE((1n<<56n)|BigInt(n),1);
  return h;
};
const expected=bytes.length+gaps.reduce((a,b)=>a+b+9,0);
assert(expected>4294967295&&expected<4500000000);
assert(!fs.existsSync(destination),'Refuse to overwrite an existing output fixture');
fs.closeSync(fs.openSync(destination,'wx'));
try{
  execFileSync('fsutil.exe',['sparse','setflag',destination],{stdio:'pipe',timeout:20000});
  const fd=fs.openSync(destination,'r+');
  try{
    let offset=0;
    const early=bytes.subarray(0,split);
    assert.equal(fs.writeSync(fd,early,0,early.length,offset),early.length);
    offset+=early.length;
    for(const size of gaps){
      const header=voidHeader(size);
      assert.equal(fs.writeSync(fd,header,0,header.length,offset),header.length);
      offset+=header.length+size;
    }
    const late=bytes.subarray(split);
    assert.equal(fs.writeSync(fd,late,0,late.length,offset),late.length);
    offset+=late.length;
    assert.equal(offset,expected);
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  assert.equal(fs.statSync(destination).size,expected,'Real file length is not >4GiB');
  console.log(JSON.stringify({
    kind:'wu21-real-matroska-with-4gib-segment-void',
    source:'FFmpeg-generated H264+AAC live MKV',
    inputSparse:true,encodedMediaPayloadBytes:bytes.length,
    outputLogicalBytes:expected,earlyClusterPosition:positions[0],
    firstClusterAfter4GiB:split+gaps.reduce((a,b)=>a+b+9,0),
    voidElementCount:gaps.length,
    voidPayloads:gaps,
    warning:'4GiB+ valid container, NOT 4GiB of actual encoded video/audio.'
  }));
}catch(e){
  try{fs.unlinkSync(destination)}catch{}
  throw e;
}
