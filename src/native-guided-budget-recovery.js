// Only the Native Bridge may attest an already-completed job's strict byte gate.
// A transient client-side plan can explain an ordinary estimate but cannot
// manufacture native verification after reload.
export function completedGuidedNativeBudget(status, jobId, transient = null) {
  if(status?.ok !== true || status.state !== 'completed' ||
    !Number.isSafeInteger(Number(status.outputBytes)) ||
    Number(status.outputBytes) <= 0) return null;
  const native = status.budgetProjection;
  const plan = native && typeof native === 'object' ? native :
    transient?.jobId === jobId ? transient : null;
  if(!plan) return null;
  const plannedBytes=Number(plan.plannedBytes),budgetBytes=Number(plan.budgetBytes);
  const actualBytes=Number(status.outputBytes);
  if(!Number.isSafeInteger(plannedBytes)||plannedBytes<=0||
     !Number.isSafeInteger(budgetBytes)||budgetBytes<=0) return null;
  const policy=['best-effort','two-pass','strict-ceiling'].includes(plan.policy)
    ? plan.policy : 'best-effort';
  const withinBudget=actualBytes<=budgetBytes;
  const strictVerified=!!native && policy==='strict-ceiling' &&
    native.strictVerified===true && withinBudget;
  return Object.freeze({
    plannedBytes,budgetBytes,actualBytes,policy,withinBudget,strictVerified,
    errorPercent:(actualBytes-plannedBytes)/plannedBytes*100,
    provenance:native?'native-status':'transient-plan',
    costBasis:native?.costBasis||null
  });
}

export function formatCompletedGuidedNativeBudget(receipt, formatBytes) {
  if(!receipt)return '';
  const percent=receipt.errorPercent;
  const variance=' · 规划 '+formatBytes(receipt.plannedBytes)+
    ' · 与规划偏差 '+(percent>=0?'+':'')+percent.toFixed(1)+'%';
  const gate=' · 目标上限 '+formatBytes(receipt.budgetBytes)+
    (receipt.withinBudget?' · 未超出目标':' · 已超出目标');
  const strict=receipt.policy==='strict-ceiling'
    ? receipt.strictVerified?' · 严格字节上限已由 Native 核验':
      ' · 严格验收凭据不完整，不能宣称已核验'
    : '';
  return variance+gate+strict;
}
