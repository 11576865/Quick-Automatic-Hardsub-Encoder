import assert from 'node:assert/strict';
import test from 'node:test';
import { plotFractionAtX, plotXFromClientX, renderRateDistortionSvg, renderExplorationSvg } from './curve-chart-svg.js';
import { buildSizeFrontierPlot } from './size-frontier-ui.js';
import { buildExplorationPlot } from './transcode-curves.js';
import { fitRateDistortionModel, createSizeQualityFrontier } from './rate-distortion-model.js';

test('small budgets use readable units and selected cursor exposes its estimated value',()=>{
 const f=createSizeQualityFrontier(fitRateDistortionModel([
  {sampleBitrate:100000,ssim:.95},{sampleBitrate:200000,ssim:.98}
 ]),{durationSeconds:2});
 const p=buildSizeFrontierPlot(f,{selectedTargetBytes:f.minimumEvidenceTargetBytes});
 const svg=renderRateDistortionSvg(p);
 assert.match(svg,/kB/);
 assert.match(svg,/对数刻度/);
 assert.match(svg,/SSIM/);
 assert.match(svg,/curve-selection-label/);
 assert.match(svg,/估计/);
 assert.match(svg,/curve-cursor-horizontal/);
 const labels=[...svg.matchAll(/class="curve-tick curve-x-tick"[^>]*>([^<]+)</g)].map(m=>m[1]);
 assert.ok(labels.length>=3);
 assert.equal(new Set(labels).size,labels.length);
});

test('narrow SSIM ranges keep distinct y tick labels',()=>{
 const f=createSizeQualityFrontier(fitRateDistortionModel([
  {sampleBitrate:1e6,ssim:.99801},{sampleBitrate:2e6,ssim:.99802}
 ]),{durationSeconds:60});
 const p=buildSizeFrontierPlot(f);
 // Exercise tiny ranges as well as the model's normal display padding.
 const svg=renderRateDistortionSvg({...p,qualityMin:.99801,qualityMax:.99802});
 const labels=[...svg.matchAll(/class="curve-tick curve-y-tick"[^>]*>([^<]+)</g)].map(m=>m[1]);
 assert.ok(labels.length>=3);
 assert.equal(new Set(labels).size,labels.length);
});

test('search status differs by shape and latest trial has a visible label',()=>{
 const p=buildExplorationPlot([
  {iteration:1,qualitySetting:30,ssim:.95,meetsTarget:false},
  {iteration:2,qualitySetting:20,ssim:.99,meetsTarget:true}
 ],.98);
 const svg=renderExplorationSvg(p);
 assert.match(svg,/<path class="curve-fail"/);
 assert.match(svg,/<circle class="curve-pass"/);
 assert.match(svg,/最新/);
 assert.match(svg,/最低样本 SSIM/);
 assert.match(svg,/试压轮次/);
});

const frontier=()=>{
 const model=fitRateDistortionModel([
 {sampleBitrate:4e6,ssim:.91,averageSsim:.935,sampleMeasurements:[{ssim:.91},{ssim:.96}]},
 {sampleBitrate:12e6,ssim:.97,averageSsim:.982,sampleMeasurements:[{ssim:.97},{ssim:.99}]},
 {sampleBitrate:23e6,ssim:.984,averageSsim:.990,sampleMeasurements:[{ssim:.984},{ssim:.996}]}
 ]);
 return createSizeQualityFrontier(model,{durationSeconds:25200,audioBitrate:192000,reservePercent:4});
};
test('plot geometry and interaction share one evidence coordinate system',()=>{
 const f=frontier(),p=buildSizeFrontierPlot(f,{selectedTargetBytes:f.minimumEvidenceTargetBytes});
 assert.equal(p.ok,true);
 assert.equal(plotFractionAtX(p,p.paddingX),0);
 assert.equal(plotFractionAtX(p,p.width-p.paddingX),1);
 assert.equal(plotFractionAtX(p,p.width/2),.5);
 assert.equal(plotFractionAtX(p,-1),0);
 assert.equal(plotFractionAtX(p,p.width+1),1);
 assert.equal(plotFractionAtX(p,Number.NaN),null);
 assert.equal(plotXFromClientX(300,{left:100,width:400},720),360);
 assert.equal(plotXFromClientX(300,{left:100,width:0},720),null);
});
test('size plot distinguishes measured points, fitted line, sample envelope, knee and selected guide',()=>{
 const f=frontier(),p=buildSizeFrontierPlot(f,{selectedTargetBytes:f.minimumEvidenceTargetBytes});
 const svg=renderRateDistortionSvg(p);
 assert.match(svg,/curve-grid/);
 assert.match(svg,/GB/);
 assert.match(svg,/curve-observation/);
 assert.match(svg,/curve-band/);
 assert.match(svg,/curve-fit/);
 assert.match(svg,/curve-selected/);
 assert.match(svg,/curve-cursor/);
 assert.doesNotMatch(svg,/NaN|undefined/);
});
test('exploration is a discrete search trace with explicit SSIM threshold and measured spread',()=>{
 const plot=buildExplorationPlot([
  {iteration:1,qualitySetting:25,ssim:.96,meetsTarget:false,sampleMeasurements:[{ssim:.96},{ssim:.98}]},
  {iteration:2,qualitySetting:32,ssim:.987,meetsTarget:true,sampleMeasurements:[{ssim:.987},{ssim:.995}]},
  {iteration:3,qualitySetting:28,ssim:.975,meetsTarget:false,sampleMeasurements:[{ssim:.975},{ssim:.99}]}
 ],.98);
 const svg=renderExplorationSvg(plot);
 assert.match(svg,/curve-threshold/);
 assert.match(svg,/curve-trajectory/);
 assert.match(svg,/curve-sample-whisker/);
 assert.match(svg,/curve-pass/);
 assert.match(svg,/curve-fail/);
 assert.match(svg,/Q32/);
 assert.doesNotMatch(svg,/NaN|undefined/);
});
