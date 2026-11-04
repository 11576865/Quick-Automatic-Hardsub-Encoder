// Native reports a published file separately from the verified staging output.
// A browser download handoff is never a file-system receipt.
export function savedArtifactReceipt(completed,data){
 if(data?.ok!==true||!completed?.jobId||data.jobId!==completed.jobId||
    !Number.isSafeInteger(data.bytes)||data.bytes<=0||data.bytes!==completed.outputBytes||
    typeof data.path!=='string'||!data.path.trim()||
    typeof data.sha256!=='string'||!/^\p{ASCII_Hex_Digit}{64}$/u.test(data.sha256))return null;
 return {kind:'native-saved-file',jobId:data.jobId,path:data.path,
   bytes:data.bytes,sha256:data.sha256.toLowerCase()};
}
