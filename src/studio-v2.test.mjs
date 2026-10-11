import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('studio v2 uses real operation controls and defers runtime tutorials',async()=>{
  const [main,media,css]=await Promise.all([
    readFile(new URL('./main.js',import.meta.url),'utf8'),
    readFile(new URL('./media-workspace.js',import.meta.url),'utf8'),
    readFile(new URL('./studio-v2.css',import.meta.url),'utf8')
  ]);
  assert.match(main,/import '.\/studio-v2\.css'/);
  assert.match(main,/workArea\.after\(runtimeHelp\)/);
  assert.match(css,/body\.ui-phone \.media-mode-switcher\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\) !important/);
  assert.match(css,/body\.ui-phone \.mobile-runtime-help\s*\{[^}]*display:block !important/);
  assert.match(css,/body\.ui-phone \.support-rail\s*\{display:none/);
  assert.match(css,/\.preview-wrap\s*\{[^}]*aspect-ratio:16 \/ 9/);
  assert.match(css,/\.encode-card #encodeBtn/);
  for(const [mode,accessibleName,visibleLabel] of [
    ['hardsub','硬字幕压制','硬压'],['transcode','纯视频转码','转码'],
    ['copy','视频流复制与快速剪辑','剪切']
  ]) {
    assert.match(media,new RegExp('data-media-mode="'+mode+'" aria-label="'+accessibleName+'"'));
    assert.match(media,new RegExp('<strong>'+visibleLabel+'</strong>'));
  }
  for(const id of ['video','ass','fonts','analyze','preview','previewBtn',
    'hardsubStrategySwitcher','planCard','encodeBtn','cancelEncodeBtn',
    'progressBar','nativeStatusBar','taskOverviewRail']){
    assert.match(main,new RegExp('id="'+id+'"'));
  }
});
