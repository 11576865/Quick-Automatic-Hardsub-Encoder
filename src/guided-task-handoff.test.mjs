import test from 'node:test';
import assert from 'node:assert/strict';
import {compileTask} from './media-task.js';
import {guidedTaskSettings} from './guided-task-handoff.js';
const defaults={operation:'hardsub',fpsMode:'auto',pixelFormat:'yuv420p',rotation:'none',deinterlace:'none',audio:'none'};
test('guided quality intent compiles in shared manual task without calibration authorization',()=>{
 const settings=guidedTaskSettings({plan:{codec:'h265',mode:'crf',crf:22,preset:'medium',calibration:{sampleSsim:.99}},audio:{audio:'aac',audioBitrate:128000},container:'mkv'},defaults);
 const task=compileTask(settings,{duration:5,fps:24,videoTracks:1,audioTracks:1});
 assert.equal(task.encoder,'libx265');assert.equal(task.quality,22);assert.equal(task.operation,'hardsub');
 assert.equal(settings.calibration,undefined);assert.equal(settings.audioPlan,'');assert.equal(settings.start,0);
});
test('guided strict target and two-pass policy survive as editable budget intent',()=>{
 const s=guidedTaskSettings({plan:{codec:'h264',mode:'budget-rate',preset:'medium',sizeCeiling:1000000,sizeBudgetPolicy:'strict-ceiling',outputWidth:640,outputHeight:360},audio:{audio:'none'},container:'mkv'},defaults);
 const t=compileTask(s,{duration:5,fps:24,videoTracks:1,audioTracks:0});
 assert.equal(t.sizeCeilingBytes,1000000);assert.equal(t.twoPass,true);assert.equal(s.width,640);assert.equal(s.height,360);
});
test('missing plan, unsupported codec or mode is refused before any handoff',()=>{
 for(const plan of [null,{codec:'h266',mode:'crf'},{codec:'h264',mode:'invented'}])assert.throws(()=>guidedTaskSettings({plan,audio:{audio:'none'},container:'mkv'},defaults));
});
test('copy-audio size intent requires current source measurement after handoff',()=>{
 const s=guidedTaskSettings({plan:{codec:'h264',mode:'budget-rate',preset:'medium',sizeCeiling:1000000,sizeBudgetPolicy:'best-effort'},audio:{audio:'copy'},container:'mkv'},defaults);
 assert.throws(()=>compileTask(s,{duration:5,fps:24,videoTracks:1,audioTracks:1}));
});
