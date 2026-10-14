import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaRecipeSignature,createOutputRecipe,validateOutputRecipe,outputRecipeFilename} from './output-recipe-matrix.js';
const media={
 duration:5,videoTracks:1,audioTracks:2,subtitleTracks:1,attachmentTracks:1,
 videoStreams:[{codec:'ffv1',width:320,height:180,fps:12,pixelFormat:'yuv420p'}],
 audioStreams:[{codec:'flac',channels:2,sampleRate:48000},{codec:'aac',channels:2,sampleRate:48000}]
};
const task=(operation='transcode')=>({
 version:4,operation,codec:'h264',encoder:'libx264',
 outputArgs:['-map','0:v:0','-c:v','libx264'],outputFormat:'matroska'
});
test('B21 snapshots distinct output contracts without borrowing mutable parameters',()=>{
 const source=task();
 const a=createOutputRecipe({task:source,sourceKey:'source-1',assetKey:'',media,index:1,name:'H.264'});
 source.outputArgs.push('-preset','fast');
 assert.deepEqual(a.task.outputArgs,['-map','0:v:0','-c:v','libx264']);
 assert.equal(Object.isFrozen(a.task.outputArgs),true);
 const b=createOutputRecipe({task:{...task(),encoder:'libx265'},sourceKey:'source-1',media,index:2,name:'H.265'});
 assert.equal(b.task.encoder,'libx265');
 assert.notEqual(a.id,b.id);
});
test('wrong source and independently changing stream facts reject output execution',()=>{
 const plan=createOutputRecipe({task:task(),sourceKey:'source-a',media,index:1});
 assert.throws(()=>validateOutputRecipe(plan,{sourceKey:'source-b',media}),/来源已更换/);
 assert.throws(()=>validateOutputRecipe(plan,{sourceKey:'source-a',media:{...media,audioTracks:1}}),/媒体流信息已变化/);
 assert.equal(validateOutputRecipe(plan,{sourceKey:'source-a',media}),plan.task);
});
test('ASS/font binding prevents obsolete hard-sub recipe reuse',()=>{
 const plan=createOutputRecipe({task:task('hardsub'),sourceKey:'source-a',assetKey:'ass:A-font:X',media,index:1});
 assert.throws(()=>validateOutputRecipe(plan,{sourceKey:'source-a',assetKey:'ass:B-font:X',media}),/ASS 或字体/);
 assert.equal(validateOutputRecipe(plan,{sourceKey:'source-a',assetKey:'ass:A-font:X',media}),plan.task);
 assert.throws(()=>createOutputRecipe({task:task('hardsub'),sourceKey:'source-a',media,index:2}),/绑定 ASS/);
});
test('all three workflows can be separate recipes; a clip queue is not a substitute',()=>{
 for(const op of ['hardsub','transcode','copy']){
  const recipe=createOutputRecipe({task:task(op),sourceKey:'source',assetKey:'same',media,index:1});
  assert.equal(recipe.task.operation,op);
 }
 assert.throws(()=>createOutputRecipe({task:{...task(),version:3},sourceKey:'source',media,index:1}),/正式 v4/);
});
test('output variants are uniquely named without changing the file format',()=>{
 assert.equal(outputRecipeFilename('result.mkv',1),'result-variant-01.mkv');
 assert.equal(outputRecipeFilename('film.hevc.mp4',12),'film.hevc-variant-12.mp4');
 assert.equal(mediaRecipeSignature(media),mediaRecipeSignature(structuredClone(media)));
});
