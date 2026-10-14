# Round four: source / plan / artifact review

Continue the explicitly authorized five-round design. Add a read-only task review
projection to the existing manual editor. Source facts come from the current probe;
output rows come only from a validated compiled outputPlan; artifact facts are a
snapshot of the executed task and its result, never relabelled with new parameters.
Source/parameter changes invalidate plan evidence while preserving an earlier
saveable artifact with its original source and contract. Missing verification
receipts and physical-player validation remain explicit unknowns.

Repair the newly visible UI defect: completed state hides plan inspection even
after editing or switching modes. Keep the current artifact saving path independent.
Use a compact three-column desktop/tablet overview and stacked phone sections;
existing controls remain the only parameter owners. Test model lifecycle/unknowns,
source change and saved-state inspect reachability, wire browser acceptance into CI.

## Ledger
- Baseline remote c64cf42, local identical tree f163ccbf.
- Windows smoke and VVC browser checks now pass. Browser budget fixture fails
  because saved-state CSS hides inspection after mode change. Android emulator Pending.
- Ruling: this unit includes the visible inspect regression because it directly
  affects the current-plan versus previous-artifact product contract. Existing
  five-round scope and user's immediate execution instruction authorize implementation.

- Implemented pure review model and text-only DOM projection: unknown source,
  checked compiled plan, keep/drop per-stream rows, whole-budget ledger and original
  artifact contract. No new parameter storage or backend execution branch.
- Self-review: source identity changes clear frame-comparison ownership while
  retaining original saveable artifact; browser download handoff is labelled
  separately from Native save completion. Metadata/chapters/attachment deletion
  is explicit; missing backend receipt never implies runtime verification.
- Local verification: 211 tests passed / 7 conditional skips; actual FFmpeg
  integration 5/5 passed; Vite build passed. New model tests and browser fixture
  source/plan/artifact/save/source-change/phone assertions added. Browser runtime
  and visual screenshots remain Pending CI, physical devices Pending.
- Scope: manual shared workbench. Guided hard-sub flow still retains its existing
  task view; no claim of replacing the entire guided product structure.
