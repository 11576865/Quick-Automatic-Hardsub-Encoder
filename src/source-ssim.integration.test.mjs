import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const run=(args)=>{const p=spawnSync('ffmpeg',args,{encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(p.status,0,p.stderr);return p.stderr;};
test('source-backed SSIM aligns a seeked sample without intermediate FFV1 reference', {skip:process.env.FFMPEG_INTEGRATION!=='1'},()=>{
  const dir=mkdtempSync(join(tmpdir(),'qhe-sample-ssim-'));
  try{
    const source=join(dir,'source.mkv'),encoded=join(dir,'encoded.mkv');
    run(['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=30',
      '-t','12','-c:v','libx264','-g','48','-pix_fmt','yuv420p',source]);
    run(['-hide_banner','-loglevel','error','-y','-ss','5','-t','4','-i',source,
      '-an','-sn','-c:v','ffv1','-pix_fmt','yuv420p',encoded]);
    const stderr=run(['-hide_banner','-nostdin','-loglevel','info',
      '-i',encoded,'-ss','5','-t','4','-i',source,
      '-filter_complex','[0:v]setpts=PTS-STARTPTS[encoded];[1:v]format=yuv420p,setpts=PTS-STARTPTS[reference];[encoded][reference]ssim',
      '-an','-sn','-f','null','-']);
    const match=stderr.match(/All:([0-9.]+)/);
    assert.ok(match,'missing SSIM metric');
    assert.ok(Number(match[1])>.995,'seeked source pixels mismatched candidate: '+match[1]);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
