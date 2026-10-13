// Strategies are views of the same authoritative form and artifact lifecycle.
export function sharedTaskPresentation({operation,strategy,sourceReady=false,legacyJob=false}) {
 const hardsub=operation==='hardsub',guided=hardsub&&strategy==='guided';
 return {workspaceSuppressed:hardsub&&!sourceReady,hideParameters:guided,
  hideGoalExplorer:!guided,hideLegacyExecution:!(guided&&legacyJob)};
}
export async function executeGuidedTask({legacyJob=false,shared,runLegacy}) {
 if(legacyJob)return runLegacy();
 if(!shared?.runCurrent)throw Error('共享任务工作台尚未初始化');
 return shared.runCurrent();
}
