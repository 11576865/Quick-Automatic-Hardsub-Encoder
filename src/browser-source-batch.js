// WU08 B21: one user-selected web File per independently compiled output.
// These are immutable preflight user preferences, NOT compiled or verified
// jobs; every source must be activated/probed before authoritative compileTask.
const MAX_FILES=8,MAX_BROWSER_BYTES=1024*1024*1024;
const frozen=v=>{
 if(v&&typeof v==='object'&&!Object.isFrozen(v)){
  Object.values(v).forEach(frozen);Object.freeze(v);
 }
 return v;
};
export function batchSourceIdentity(file){
 if(!file||typeof file.name!=='string')throw Error('缺少有效浏览器视频来源');
 return [file.name,Number(file.size),Number(file.lastModified)].join('|');
}
export function makeBrowserSourceBatch({files,settings,existingCount=0}={}){
 const inputs=Array.from(files||[]);
 if(!inputs.length||inputs.length>MAX_FILES||
    existingCount<0||existingCount+inputs.length>MAX_FILES)
   throw Error('每次选择视频，且整个多来源队列最多 8 项');
 if(!settings||!['copy','transcode'].includes(settings.operation))
   throw Error('多来源队列目前只支持 Stream Copy 和纯转码；硬字幕需逐来源独立分析');
 if(settings.rateMode==='size'||settings.budgetPolicy==='strict-ceiling')
   throw Error('多来源队列暂不继承整片体积证据；请对每个来源单独配置目标体积');
 if(settings.audioPlan&&settings.audioPlan!=='[]')
   throw Error('多来源任务不能沿用其他来源的逐轨音频计划');
 if(settings.mustCopyAudioOrdinals&&settings.mustCopyAudioOrdinals!=='[]')
   throw Error('多来源任务不能借用其他来源的音轨必须 Copy 锁');
 if(settings.audioKeepSourceIdentity)throw Error('多来源任务不允许继承旧来源的保留锁身份');
 const cloned=structuredClone(settings);
 const seen=new Set();
 return inputs.map((file,i)=>{
  if(!file||typeof file.slice!=='function'||!Number.isSafeInteger(file.size)||
     file.size<=0||file.size>MAX_BROWSER_BYTES)
    throw Error('第 '+(i+1)+' 个文件无效、为空或超过浏览器 1 GiB 限制');
  const identity=batchSourceIdentity(file);
  if(seen.has(identity))throw Error('本次包含名称、体积和修改时间相同的来源，无法独立证明任务归属');
  seen.add(identity);
  return Object.freeze({
   file,identity,
   name:file.name,size:file.size,
   operation:cloned.operation,
   settings:frozen(structuredClone(cloned))
  });
 });
}
export function assertBrowserBatchSource(entry,activatedFile,activeIdentity){
 if(!entry||activatedFile!==entry.file||entry.identity!==batchSourceIdentity(activatedFile)||
    String(activeIdentity||'')!==entry.identity)
   throw Error('多来源任务激活的实际 File 或身份不匹配；拒绝混用媒体计划');
 return entry;
}
