import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../windows/native-backend.ps1',import.meta.url),'utf8');
const expression=source.match(/\[regex\]::Matches\(\$(?:fullHelp|HelpText),\s*'([^']+)'/)[1];
const options=text=>[...new Set([...text.matchAll(new RegExp(expression.replace('(?m)',''),'gm'))].map(m=>m[1]))];
test('actual Windows capability regex recognizes modern optional stream selectors',()=>{
 assert.deepEqual(options('-fps_mode[:<stream_spec>] <string> set output timing\n-c[:stream_specifier] codec set codec\n-b:v[:<stream_spec>] bitrate\n-vsync number\n-fps_mode value'),['-fps_mode','-c','-b:v','-vsync']);
});
test('help prose and malformed suffix do not invent available flags',()=>{
 assert.deepEqual(options('  description mentions -fps_mode\n-fps_mode[broken text\n--fps_mode value\n-fps_modeBogus[broken'),[]);
});
