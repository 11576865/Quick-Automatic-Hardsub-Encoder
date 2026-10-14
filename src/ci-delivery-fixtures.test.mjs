import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
test('manual strict artifact fixture inspects the manual job directory, not the guided directory',async()=>{
 const bridge=await read('windows/native-bridge.ps1');
 const manual=bridge.slice(bridge.indexOf('function Start-MediaTaskJob'),bridge.indexOf('function Start-EncodeJob'));
 const prefix=manual.match(/New-BridgeWorkDir \("([^"$]+)\$jobId-/)?.[1];
 assert.equal(prefix,'quick-media-job-');
 const fixture=await read('scripts/check-guided-budget-native.ps1');
 const inspection=fixture.slice(fixture.indexOf('Manual oversized container was not rejected'),fixture.indexOf('Manual oversized artifact reached save dialog'));
 assert.ok(inspection.includes('"'+prefix+'"'),'fixture must inspect the actual manual staging namespace');
});
test('VVC viewport measurement waits for the responsive shell before judging overflow',async()=>{
 const fixture=await read('scripts/check-vvc-ui.cjs');
 const resize=fixture.indexOf('await page.setViewportSize');
 const measurement=fixture.indexOf('document.documentElement.scrollWidth',resize);
 const transition=fixture.slice(resize,measurement);
 assert.match(transition,/await page.waitForFunction\([^;]*dataset.uiShell[^;]*phone/);
});
