// Product intent drafts are deliberately separate from executable media tasks.
export const INTENT_FIELDS = {
  goal: {label:'决策目标',options:[['balanced','质量与体积平衡'],['quality','优先保持画质'],['size','优先满足体积'],['time','限制编码时间']]},
  subtitle: {label:'字幕来源',options:[['external','外部 ASS'],['embedded','内封 ASS + 附件字体'],['preserve','保留原软字幕']]},
  color: {label:'色彩交付',options:[['preserve','保持源色彩'],['sdr','转换到 SDR'],['hdr','HDR / 高位深保真']]},
  preservation: {label:'保留合同',options:[['explicit','逐对象确认'],['all','保留所有可兼容对象'],['minimal','仅保留明确选择的对象']]},
  sampling: {label:'采样策略',options:[['quick','快速小样'],['scene','分层场景 + 风险加测'],['adaptive','自适应校准']]},
  comparison: {label:'候选空间',options:[['single','单编码器'],['codecs','跨编码器'],['resolution','跨编码器与分辨率']]},
  cut: {label:'切点约定',options:[['keyframe','关键帧附近切入'],['exact','请求精确切点，冲突时提示']]},
  verification: {label:'交付检查',options:[['structure','容器、轨道与字节'],['preservation','逐流保留差分'],['player','保留差分 + 播放器复开']]}
};
export function expectedIntent(operation='hardsub',sourceIdentity='') {
  return {operation,sourceIdentity,goal:operation==='copy'?'keyframe':'balanced',subtitle:operation==='hardsub'?'external':'preserve',color:'preserve',preservation:'explicit',sampling:'quick',comparison:'single',cut:'keyframe',verification:'structure',executionConnected:false,evidence:'unmeasured'};
}
export function updateExpectedIntent(draft,field,value) {
  if (!INTENT_FIELDS[field]?.options.some(([id])=>id===value)) throw Error('无效的设计意图');
  if(draft.operation==='copy'&&['goal','sampling','comparison'].includes(field))throw Error('复制剪切不使用重编码寻优');
  return {...draft,[field]:value,executionConnected:false,evidence:'unmeasured'};
}
export function restoreExpectedIntent(serialized,operation,sourceIdentity) {
  let draft=expectedIntent(operation,sourceIdentity);
  try {
    const saved=JSON.parse(serialized);
    if(saved.operation!==operation||saved.sourceIdentity!==sourceIdentity)return draft;
    for(const [field,value] of Object.entries(saved)) {
      if(INTENT_FIELDS[field]?.options.some(([id])=>id===value)) {
        try {draft=updateExpectedIntent(draft,field,value);}catch{}
      }
    }
  }catch{}
  return draft;
}
