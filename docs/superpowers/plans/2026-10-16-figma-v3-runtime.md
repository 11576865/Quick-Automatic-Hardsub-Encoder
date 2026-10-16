# Figma v3 runtime implementation

Source: user authorizes implementing the reviewed desktop/tablet design with pending feature entries. Spec: docs/ui/desktop-tablet-figma-v3-2026-10-16.md. Anchors: R24 §19–20 / B20, B02/B05.

1. Add an adaptive plan-first workspace over existing vanilla JS controls. Keep original nodes, listeners, form ownership, execution and save gates. Expose detailed controls in a disclosure; retain the phone layout.
2. Implement real source identity/readouts, pending delivery entries, plan/preview switching, label density, contextual help and inspector. Never ship sample metadata or invented measurements.
3. Verify model contracts, existing Node suite, build and desktop/tablet browser geometry, workflow/draft isolation, keyboard access and preview toggling. Commit/publish a recovery checkpoint before long browser checks; final whole-branch review before integration.

Review focus: moved nodes still reachable by existing controllers; no duplicate IDs or form state; disabled actions remain disabled; no draft-to-execution leakage; non-square/portrait preview ratio; 834/1194/1440 layouts and phone fallback.

Ruling: use a new isolated feature branch in this clean checkout; preserve the existing docs draft PR rather than merge it implicitly. Implementation and review occur inline under the user's request.
