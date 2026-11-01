---
target: home dashboard
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:C:\\myproject\\NewTeams\\NewTeams-feature-home-dashboard\\dashboard\\src\\screens\\HomeScreen.tsx"
target_fingerprint: "sha256:f1ec6a300001187df6ed905b7403d7a43329bf5afb8ecc2823e070ebda6fe98a"
target_path: "C:\\myproject\\NewTeams\\NewTeams-feature-home-dashboard\\dashboard\\src\\screens\\HomeScreen.tsx"
timestamp: 2026-11-01T14-25-06Z
slug: src-screens-homescreen-tsx
---
⚠️ DEGRADED: single-context (design-review subagent ended without delivering its report; review done inline after fixes). Detector: separate subagent.

## Design Health Score: 27/40 (Acceptable, near Good)
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | StageRail shows "내 차례" waiting step; still no live/last-updated indicator |
| 2 | Match System / Real World | 3 | Drawn SVG section icons replace glyphs; board tiles still glyphs |
| 3 | User Control and Freedom | 3 | Project filter works; dead controls removed |
| 4 | Consistency and Standards | 3 | DESIGN.md regenerated from code; duplicates removed |
| 5 | Error Prevention | 3 | Deadlock sorted first, boxed, rule explained |
| 6 | Recognition Rather Than Recall | 3 | Calendar cells show day numbers |
| 7 | Flexibility and Efficiency | 2 | Skip link (7 tab stops to inbox) but no shortcuts or inline approve |
| 8 | Aesthetic and Minimalist Design | 2 | Still 13 sections; brain graph remains large in center column |
| 9 | Error Recovery | 2 | Routine "✕ 실패" still has no log/retry |
| 10 | Help and Documentation | 3 | Deadlock rule inline; mock labels |

## Detector
CLI 0 (regex-only .tsx). Overlay 1: monotonous-spacing (false positive; 4px base unit, gaps span 2-32px). Previous undersized-ui-text x4 resolved.

## Remaining Priority Issues
1. [P2] No keyboard shortcuts / inline approve on inbox rows. /impeccable harden
2. [P2] Routine failure lacks recovery action. /impeccable harden
3. [P2] Token usage shows no limit/reset (principle 5). /impeccable clarify
4. [P3] Board tile glyph icons. /impeccable polish
