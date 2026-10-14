// WU07: explicit, source-bound "must retain this original audio track
// through copy" intent, enforced by the existing schema-v4 compiler.
// Copy intent itself is not a bit-for-bit output packet audit.
export function normalizeMustCopyAudio(raw,media,compiled){
 const value=raw.mustCopyAudioOrdinals;
 if(value==null||value==='')return Object.freeze([]);
 let entries;
 try{entries=typeof value==='string'?JSON.parse(value):value}
 catch{throw Error('必须保留的音轨列表 JSON 无效');}
 const total=Number(media.audioTracks??media.audioStreams?.length??0);
 if(!Array.isArray(entries)||entries.length>32||!Number.isInteger(total)||total<0||total>99)
   throw Error('必须保留音轨选择无效');
 const result=[],used=new Set();
 for(const ordinal of entries){
   if(!Number.isInteger(ordinal)||ordinal<0||ordinal>=total||used.has(ordinal))
     throw Error('必须保留音轨索引无效、重复或不属于当前来源');
   used.add(ordinal);result.push(ordinal);
 }
 if(!result.length)return Object.freeze([]);
 const expected=String(raw.audioKeepSourceIdentity||'');
 const actual=String(media.sourceIdentity||'');
 if(!expected||!actual||expected!==actual)
   throw Error('必须保留音轨的来源身份不符或缺失；重新核对并锁定当前素材');
 for(const ordinal of result){
   const entry=compiled.audioPlan?.find(x=>x.sourceOrdinal===ordinal);
   const canCopy=compiled.audioPlan
     ?entry?.action==='copy'
     :compiled.audio==='copy'&&(compiled.audioTrack==='all'||String(compiled.audioTrack)===String(ordinal));
   if(!canCopy)throw Error('音轨 #'+ordinal+' 已锁定必须 Copy；当前计划将转码或丢弃该轨，先经用户明确解锁或改回复制');
 }
 return Object.freeze(result);
}
