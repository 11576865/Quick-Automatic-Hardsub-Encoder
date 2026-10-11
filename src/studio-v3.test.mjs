import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
test('professional workbench composes real source, media viewer and inspector',async()=>{
  const [main,media,css]=await Promise.all([
    readFile(new URL('./main.js',import.meta.url),'utf8'),
    readFile(new URL('./media-workspace.js',import.meta.url),'utf8'),
    readFile(new URL('./studio-v3.css',import.meta.url),'utf8')]);
  assert.match(main,/import '.\/studio-v3\.css'/);
  assert.match(main,/id="studioModeDock" class="studio-mode-dock"/);
  assert.match(main,/id="studioEmptyStage"/);
  assert.match(media,/id="taskClipQueuePanel"/);
  assert.match(media,/saveQueuedResult=async result/);
  assert.match(media,/id="taskCancelClipEdit"/);
  assert.match(media,/clipEditingIndex=-1/);
  assert.match(media,/clips\[editing\]=\{\.\.\.clip,state:'queued'\}/);
  assert.match(media,/clipBatchRunning=true/);
  assert.match(media,/if \(modeDock\) modeDock.append\(modeNav\)/);
  assert.match(media,/if \(manualMount && section.parentElement !== manualMount\) manualMount.append\(section\)/);
  assert.match(css,/\.production-region:has\(#subtitleCard\.hidden\) #sharedMediaOutputMount/);
  assert.match(media,/modeNav\.remove\(\)/);
  assert.match(media,/run\.disabled=busy\|\|stateName==='saving'\|\|!!requirement/);
  assert.match(media,/const mediaInfoListener = \(\) => \{[^}]*syncTaskActions\(\);[^}]*clearClipQueueOnSourceChange\(\);[^}]*syncClipQueue\(\);/);
  assert.match(css,/\.media-action-dock #taskRun:disabled\[data-input-requirement="video"\]/);
  assert.match(css,/grid-template-areas:"source stage" "check stage" "log log"/);
  assert.match(css,/body\.ui-desktop \.preview-workspace/);
  assert.match(css,/body\.ui-phone \.studio-mode-dock/);
  for(const id of ['video','ass','fonts','analyze','previewBtn','encodeBtn','cancelEncodeBtn','progressBar','taskOverviewRail']){
    assert.match(main,new RegExp('id="'+id+'"'));
  }
});
