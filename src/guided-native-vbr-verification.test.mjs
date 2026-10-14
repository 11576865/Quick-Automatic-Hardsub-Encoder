import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyGuidedNativeVbr} from './guided-native-vbr-verification.js';

const scope=JSON.stringify(['decision-reference-v1','guided-ass-rendered','source','runtime','abc']);
const windows=[{start:12,duration:2},{start:67,duration:2}];
const plan=()=>({mode:'budget-rate',sizeBudgetPolicy:'best-effort',
 codec:'h264',preset:'medium',targetVideoBitrate:700000,sizeCeiling:4000000,
 outputWidth:0,outputHeight:0,referenceWidth:0,referenceHeight:0});
const sha='c'.repeat(64),fonts='d'.repeat(64);
function evidence(window,index=0) {
 const receipt={
  schemaVersion:1,method:'windows-native-exact-guided-ass-vbr-v1',
  referenceDomain:'guided-ass-rendered',referenceMetric:'ass-rendered-yuv420p-ssim-v1',
  identityKind:'file-stat-snapshot-plus-staged-asset-sha256',
  mode:'bitrate',requestedRate:700000,requestedQuality:null,codec:'h264',
  encoder:'libx264',preset:'medium',multipass:'disabled',
  videoStream:0,pixelFormat:'yuv420p',
  outputWidth:0,outputHeight:0,referenceWidth:0,referenceHeight:0,
  sourceToken:'media-stamp',runtimeToken:'ffmpeg-stamp',
  assTextSha256:sha,fontContentSha256:fonts,fontCount:1,
  requestedStart:window.start,requestedDuration:window.duration,
  actualDuration:window.duration
 };
 return {window,assTextSha256:sha,
  sample:{nativeEvidence:receipt,encoder:'libx264',duration:window.duration,
   ssim:index?.991:.989,totalVideoBytes:150000,elapsedSeconds:1.3}};
}
const samples=()=>windows.map(evidence);
const check=(overrides={})=>verifyGuidedNativeVbr({
 plan:plan(),windows,samples:samples(),referenceScope:scope,targetSsim:.985,
 expectedEncoder:'libx264',...overrides
});
test('two complete Native ASS rendered VBR windows produce an observational receipt only',()=>{
 const r=check();
 assert.equal(r.ok,true);assert.equal(r.passed,true);
 assert.equal(r.minimumSsim,.989);
 assert.equal(r.averageVideoBitrate,600000);
 assert.equal(r.measuredWindows,2);
 assert.equal(r.kind,'native-guided-ass-rendered-short-vbr-v1');
 assert.equal(r.outputBytesVerified,false);
 assert.equal(r.wholeMovieQualityVerified,false);
 assert.equal(r.canAutoAdopt,false);
});
test('quality threshold failure is not evidence admission failure or formal adoption',()=>{
 const r=check({targetSsim:.990});
 assert.equal(r.ok,true);assert.equal(r.passed,false);
 assert.equal(r.canAutoAdopt,false);
});
test('Manual source-only evidence cannot masquerade as ASS rendered evidence',()=>{
 const s=samples();s[0].sample.nativeEvidence.method='windows-native-exact-vbr-v1';
 assert.equal(check({samples:s}).reason,'incompatible-guided-rendered-receipt');
 assert.equal(check({referenceScope:'manual-source-sdr'}).reason,'invalid-guided-vbr-request');
});
test('native ASS digest mismatch, malformed digest or font drift reject',()=>{
 const s=samples();s[1].sample.nativeEvidence.assTextSha256='e'.repeat(64);
 assert.equal(check({samples:s}).reason,'incompatible-guided-rendered-receipt');
 const t=samples();t[0].sample.nativeEvidence.fontContentSha256='bad';
 assert.equal(check({samples:t}).reason,'incompatible-guided-rendered-receipt');
 const u=samples();u[1].sample.nativeEvidence.fontContentSha256='e'.repeat(64);
 assert.equal(check({samples:u}).reason,'guided-font-bytes-drift');
});
test('source/runtime drift, unexpected encoder and wrong geometry reject',()=>{
 const s=samples();s[1].sample.nativeEvidence.sourceToken='other';
 assert.equal(check({samples:s}).reason,'guided-origin-drift');
 const t=samples();t[0].sample.nativeEvidence.encoder='h264_nvenc';
 assert.equal(check({samples:t}).reason,'incompatible-guided-rendered-receipt');
 const u=samples();u[0].sample.nativeEvidence.outputWidth=1280;
 assert.equal(check({samples:u}).reason,'incompatible-guided-rendered-receipt');
 const v=samples();v[1].sample.nativeEvidence.runtimeToken='other';
 assert.equal(check({samples:v}).reason,'guided-origin-drift');
});
test('duplicate or unpaired windows, wrong requested rate, nonfinite readings reject',()=>{
 const s=samples();s[1].window=s[0].window;
 assert.equal(check({samples:s}).reason,'missing-or-duplicate-guided-window');
 const t=samples();t[0].sample.nativeEvidence.requestedRate=750000;
 assert.equal(check({samples:t}).reason,'incompatible-guided-rendered-receipt');
 const u=samples();u[0].sample.ssim=NaN;
 assert.equal(check({samples:u}).reason,'invalid-guided-vbr-measurement');
 assert.equal(check({windows:[windows[0],windows[0]]}).reason,'invalid-paired-vbr-windows');
 assert.equal(check({samples:[samples()[0]]}).reason,'invalid-guided-vbr-request');
});
test('strict/two-pass production strategies cannot adopt a single-pass sample',()=>{
 for(const sizeBudgetPolicy of ['strict-ceiling','two-pass']){
  const result=check({plan:{...plan(),sizeBudgetPolicy}});
  assert.equal(result.reason,'invalid-guided-vbr-request');
 }
});
test('Guided width/height and original rendered reference are both bound',()=>{
 const scaled={...plan(),outputWidth:1280,outputHeight:720,referenceWidth:1920,referenceHeight:1080};
 const s=samples();
 for(const x of s){
  x.sample.nativeEvidence.outputWidth=1280;
  x.sample.nativeEvidence.outputHeight=720;
  x.sample.nativeEvidence.referenceWidth=1920;
  x.sample.nativeEvidence.referenceHeight=1080;
  x.sample.nativeEvidence.referenceMetric='ass-rendered-bicubic-upscale-ssim-v1';
 }
 assert.equal(check({plan:scaled,samples:s}).ok,true);
 s[1].sample.nativeEvidence.referenceWidth=1280;
 assert.equal(check({plan:scaled,samples:s}).reason,'incompatible-guided-rendered-receipt');
});
test('Guided hardware Native evidence reports actual production p7, not balanced UI preset',()=>{
 const cases=samples();
 for(const x of cases){
   x.sample.encoder='h264_nvenc';
   x.sample.nativeEvidence.encoder='h264_nvenc';
   x.sample.nativeEvidence.preset='p7';
 }
 const matched=check({samples:cases,expectedEncoder:'h264_nvenc',expectedPreset:'p7'});
 assert.equal(matched.ok,true);
 assert.equal(check({samples:cases,expectedEncoder:'h264_nvenc',expectedPreset:'p4'}).reason,
   'incompatible-guided-rendered-receipt');
});
test('Guided UI uses real paired ASS Native sample with SHA-256 and explicit approval',async()=>{
 const {readFile}=await import('node:fs/promises');
 const [main,bridge,helper]=await Promise.all([
  readFile(new URL('./main.js',import.meta.url),'utf8'),
  readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8'),
  readFile(new URL('../windows/guided-rendered-sample-evidence.ps1',import.meta.url),'utf8')
 ]);
 assert.match(main,/guidedRenderedReference:true,withSubtitles:true,measureSsim:true/);
 assert.match(main,/verifyGuidedNativeVbr\(/);
 assert.match(main,/guidedTextSha256\(shifted\)/);
 assert.match(main,/function confirmGuidedVbrVerification\(/);
 assert.match(main,/Number\(\$\('qualityTarget'\)\?\.value\|\|\.985\)/);
 assert.match(bridge,/\$exactGuidedEvidence/);
 assert.match(bridge,/New-GuidedExactVbrReceipt/);
 assert.match(bridge,/if\(\$exactManualEvidence\)/);
 assert.match(helper,/Get-FileHash -LiteralPath \$ass -Algorithm SHA256/);
});
