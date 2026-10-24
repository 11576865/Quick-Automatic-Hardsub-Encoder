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

/** Native B21 is a separate authorization domain from File objects:
 * the Bridge stores OS paths; the browser only freezes opaque IDs and stats.
 * Each source is independently re-probed before compileTask.
 */
export function makeNativeSourceBatch({selections,settings,existingCount=0}={}){
 const inputs=Array.from(selections||[]);
 if(!inputs.length||inputs.length>MAX_FILES||
    existingCount<0||existingCount+inputs.length>MAX_FILES)
   throw Error('Native 多来源队列最多 8 项，必须通过 Windows 选择视频');
 if(!settings||!['copy','transcode'].includes(settings.operation))
   throw Error('Native 多来源队列仅支持 Stream Copy / 纯转码；逐来源 ASS 硬压尚未开放');
 if(settings.rateMode==='size'||settings.budgetPolicy==='strict-ceiling'||
    settings.audioPlan&&settings.audioPlan!=='[]'||
    settings.mustCopyAudioOrdinals&&settings.mustCopyAudioOrdinals!=='[]'||
    settings.audioKeepSourceIdentity)
   throw Error('Native 多来源不得复用旧来源的音轨锁、逐轨计划或体积证据');
 const seenIds=new Set(),seenIdentities=new Set();
 const snapshot=frozen(structuredClone(settings));
 return inputs.map((row,index)=>{
   if(!/^[a-f0-9]{32}$/i.test(String(row?.id||''))||
      typeof row?.name!=='string'||!row.name||
      !Number.isSafeInteger(row.size)||row.size<=0||
      !Number.isSafeInteger(row.lastModified)||row.lastModified<0)
     throw Error('Native 第 '+(index+1)+' 个授权缺少有效的 ID / 来源统计');
   const identity=batchSourceIdentity(row);
   if(seenIds.has(row.id)||seenIdentities.has(identity))
     throw Error('Native 来源重复或统计身份相同，拒绝混用任务');
   seenIds.add(row.id);seenIdentities.add(identity);
   return Object.freeze({
     nativeId:row.id,identity,name:row.name,size:row.size,
     lastModified:row.lastModified,operation:snapshot.operation,
     settings:frozen(structuredClone(snapshot))
   });
 });
}
export function assertNativeBatchSource(entry,activated,activeIdentity){
 if(!entry?.nativeId||activated?.id!==entry.nativeId||
    entry.identity!==batchSourceIdentity(activated?.file)||
    String(activeIdentity||'')!==entry.identity)
   throw Error('Native 授权、重新探测的源文件与当前任务身份不匹配');
 if(activated?.probe?.ok!==true)
   throw Error('Native 来源激活后没有取得实际 FFprobe 证明');
 return entry;
}

/** B21 post-publication receipt. The Bridge—not the web page—owns the path,
 * hashes the delivered file, and returns its own job-bound export result.
 * Never turn browser download hand-off or an unverified job into this receipt.
 */
export function nativeBatchDeliveryReceipt(source, completed, exportResult){
 if(!source?.nativeId||!source?.identity||!completed?.jobId||
    !exportResult||exportResult.ok!==true||
    exportResult.jobId!==completed.jobId||
    typeof exportResult.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(exportResult.sha256)||
    !Number.isSafeInteger(Number(exportResult.bytes))||Number(exportResult.bytes)<=0){
   throw Error('Native 批次保存回执缺少同一 Job 的真实 SHA-256 或字节数');
 }
 return Object.freeze({
   kind:'native-published',
   sourceName:source.name,
   sourceIdentity:source.identity,
   sourceGrantId:source.nativeId,
   jobId:completed.jobId,
   bytes:Number(exportResult.bytes),
   sha256:exportResult.sha256.toLowerCase()
 });
}
export function formatNativeBatchDeliveryReceipt(receipt){
 if(receipt?.kind!=='native-published')throw Error('尚无可复制的 Native 已发布文件回执');
 return [
   'QHE Native 批次保存回执（Native Bridge 提供的文件哈希，不代表独立播放器现场验收）',
   '来源: '+receipt.sourceName,
   '来源身份: '+receipt.sourceIdentity,
   '授权标识: '+receipt.sourceGrantId,
   'Native Job: '+receipt.jobId,
   '保存文件字节: '+receipt.bytes,
   'SHA-256: '+receipt.sha256
 ].join('\n');
}
