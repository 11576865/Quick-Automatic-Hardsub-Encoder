import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('dedicated VVC acceptance fails if real runtime is unavailable',async()=>{
 const s=await readFile(new URL('../scripts/check-vvc-native.ps1',import.meta.url),'utf8');
 assert.match(s,/\[switch\]\$RequireRuntime/);
 const absent=s.slice(s.indexOf('if(-not (Test-EncoderListed'),s.indexOf('$probe=Test-VvcRuntime'));
 assert.match(absent,/if\(\$RequireRuntime\)\{throw/);
});
test('real VVC fixture includes hard-sub QP as well as transcode QP and bitrate',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'qhe-vvc-required-'));
 try{const path=join(dir,'tasks.json');execFileSync(process.execPath,['scripts/build-vvc-tasks.mjs',path,'--hardsub']);const tasks=JSON.parse(await readFile(path));assert.equal(tasks.length,3);assert.deepEqual(tasks.map(t=>t.operation),['transcode','transcode','hardsub']);assert.ok(tasks[2].outputArgs.some(s=>s.includes('ass=__ASS__')));}finally{await rm(dir,{recursive:true,force:true});}
});
