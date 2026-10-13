import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditTrimCopyPayload} from './trim-copy-audit.js';
import {outputReport} from './media-planning.js';
const budgetEvidence={version:1,scope:'full-source',audioPacketBytes:[50000,90000],
  subtitlePacketBytes:[6000,4000]};
const task={
  operation:'transcode',hasTrimRange:true,rateMode:'size',audio:'copy',audioTrack:'all',
  expectedAudioTracks:2,audioRange:'trim',keepSubtitles:true,subtitleRange:'trim',
  subtitleSelection:[1],budgetEvidence,sizePlan:{copiedTrimReserveBytes:144000,targetBytes:500000}
};
const out={version:1,scope:'completed-artifact',
  audioPacketBytes:[12000,35000],subtitlePacketBytes:[1000]};
test('completed trim packet audit records exact observed payload but does not weaken upper-bound budget',()=>{
  const a=auditTrimCopyPayload(task,out);
  assert.equal(a.status,'observed');
  assert.equal(a.sourcePacketBytes,144000);
  assert.equal(a.outputPacketBytes,48000);
  assert.equal(a.overreserveBytes,96000);
  assert.equal(a.canReplacePreflightBudget,false);
  assert.deepEqual(a.selected.map(v=>[v.kind,v.sourceOrdinal,v.outputOrdinal]),
    [['audio',0,0],['audio',1,1],['subtitle',1,0]]);
  const report=outputReport(task,{outputBytes:250000,verified:true,outputPacketEvidence:out},5);
  assert.equal(report.trimCopyAudit.overreserveBytes,96000);
  assert.equal(report.withinBudget,true);
  assert.equal(report.parameters.sizePlan.copiedTrimReserveBytes,144000);
});
test('copied audio in mixed plans maps source ordinal to actual output ordinal',()=>{
  const mixed={...task,audioPlan:[
    {action:'aac',sourceOrdinal:0,range:'trim'},
    {action:'copy',sourceOrdinal:1,range:'trim'},
    {action:'drop',sourceOrdinal:0,range:'full'}],
    keepSubtitles:false,sizePlan:{copiedTrimReserveBytes:90000,targetBytes:500000}};
  const audit=auditTrimCopyPayload(mixed,{version:1,scope:'completed-artifact',
    audioPacketBytes:[20000,35000],subtitlePacketBytes:[]});
  assert.equal(audit.sourcePacketBytes,90000);
  assert.equal(audit.outputPacketBytes,35000);
  assert.equal(audit.selected[0].outputOrdinal,1);
});
test('missing, partial, wrong-scope and impossible evidence never creates exact-looking cost',()=>{
  assert.equal(auditTrimCopyPayload({...task,hasTrimRange:false},out),null);
  assert.equal(auditTrimCopyPayload(task,{...out,scope:'full-source'}),null);
  assert.equal(auditTrimCopyPayload(task,{...out,audioPacketBytes:[1000]}),null);
  assert.equal(auditTrimCopyPayload(task,{...out,subtitlePacketBytes:[]}),null);
  assert.equal(auditTrimCopyPayload({...task,sizePlan:{copiedTrimReserveBytes:140000}},out),null);
  assert.equal(auditTrimCopyPayload(task,{...out,audioPacketBytes:[-1,1]}),null);
  assert.equal(outputReport(task,{outputBytes:250000},5).trimCopyAudit,null);
});
test('a larger observed copy payload flags a mismatch without claiming an available cost reduction',()=>{
  const a=auditTrimCopyPayload(task,{...out,audioPacketBytes:[120000,45000]});
  assert.equal(a.status,'output-exceeds-source-cost');
  assert.ok(a.overreserveBytes<0);
  assert.equal(a.canReplacePreflightBudget,false);
});
test('Windows Native completed status emits one bounded audited packet snapshot',async()=>{
  const {readFile}=await import('node:fs/promises');
  const [bridge,main]=await Promise.all([
    readFile(new URL('../windows/native-bridge.ps1',import.meta.url),'utf8'),
    readFile(new URL('./main.js',import.meta.url),'utf8')
  ]);
  assert.match(bridge,/function Get-CompletedTrimPacketEvidence\(/);
  assert.match(bridge,/TrimPacketAuditFinished=\$false;TrimPacketEvidence=\$null/);
  assert.match(bridge,/Measure-AuxiliaryPackets \$Job\.Output 'a'/);
  assert.match(bridge,/Measure-AuxiliaryPackets \$Job\.Output 's'/);
  assert.equal((bridge.match(/\$outputPacketEvidence=Get-CompletedTrimPacketEvidence \$j/g)||[]).length,2);
  assert.match(main,/outputPacketEvidence:result\.outputPacketEvidence\?\?null/);
});
