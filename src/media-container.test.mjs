import assert from 'node:assert/strict';
import test from 'node:test';
import {checkContainerCompatibility,resolveOutputContainer,sourceContainer,outputFileName} from './media-container.js';

const media={
  formatName:'mov,mp4,m4a,3gp,3g2,mj2',
  sourceName:'source.mp4',
  videoCodec:'h264',
  audioCodec:'aac',
  audioCodecs:['aac']
};
const base={operation:'transcode',codec:'h264',audio:'copy',keepAttachments:false,keepSubtitles:false};

test('detects supported source containers',()=>{
  assert.equal(sourceContainer(media),'mp4');
  assert.equal(sourceContainer({...media,formatName:'matroska,webm',sourceName:'x.mkv'}),'mkv');
  assert.equal(sourceContainer({...media,formatName:'avi',sourceName:'x.avi'}),'');
});

test('copy auto keeps a compatible source container',()=>{
  const r=resolveOutputContainer('auto',{...base,operation:'copy'},media);
  assert.equal(r.key,'mp4');
  assert.match(r.reason,/保持源容器/);
});

test('encoded auto uses mp4 for conservative h264/aac and mkv for opus',()=>{
  assert.equal(resolveOutputContainer('auto',base,media).key,'mp4');
  assert.equal(resolveOutputContainer('auto',{...base,audio:'libopus'},media).key,'mkv');
});

test('explicit mp4 rejects transformations that would otherwise be silent',()=>{
  assert.equal(checkContainerCompatibility('mp4',{...base,audio:'aac'},media).ok,true);
  assert.throws(()=>resolveOutputContainer('mp4',{...base,audio:'libopus'},media),/Opus/);
  assert.throws(()=>resolveOutputContainer('mp4',{...base,audio:'copy'}, {...media,audioCodecs:['flac']}),/flac/);
  assert.throws(()=>resolveOutputContainer('mp4',{...base,keepAttachments:true},media),/附件/);
});

test('keep requires a supported source container and output naming follows resolved extension',()=>{
  assert.throws(()=>resolveOutputContainer('keep',{...base,operation:'copy'},{...media,formatName:'avi',sourceName:'x.avi'}),/保持源容器/);
  assert.equal(outputFileName('movie',{operation:'transcode',codec:'h265',outputExtension:'mp4'}),'movie_transcode_h265.mp4');
});
