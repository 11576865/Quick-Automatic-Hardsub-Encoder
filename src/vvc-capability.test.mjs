import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as capabilities from './media-capabilities.js';
const good={backend:'windows-native',available:true,encoders:[{Key:'libvvenc',Available:true,
  Runtime:true,RuntimeValidation:'encode-mkv-decode-v1',Options:['-qp','-preset'],PixelFormats:['yuv420p10le']}]};
test('VVC availability requires Windows and real encode/mux/decode evidence, never a catalog entry',()=>{
  assert.equal(typeof capabilities.vvcCapability,'function');
  assert.equal(capabilities.vvcCapability(good).available,true);
  for(const patch of [{Available:false},{Runtime:false},{RuntimeValidation:undefined},
    {Options:['-preset']},{PixelFormats:['yuv420p']}]){
    assert.equal(capabilities.vvcCapability({...good,encoders:[{...good.encoders[0],...patch}]}).available,false);
  }
  assert.equal(capabilities.vvcCapability({...good,backend:'android-native'}).available,false);
  assert.equal(capabilities.vvcCapability({...good,available:false}).available,false);
  assert.equal(capabilities.vvcCapability({}).available,false);
});
