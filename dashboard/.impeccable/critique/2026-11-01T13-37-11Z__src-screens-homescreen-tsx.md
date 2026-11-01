---
target: home dashboard
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:C:\\myproject\\NewTeams\\NewTeams-feature-home-dashboard\\dashboard\\src\\screens\\HomeScreen.tsx"
target_fingerprint: "sha256:aeb4a551ce95a78512293e70ae83a3dc3f60029f80707c730884fcdb432d2c9a"
target_path: "C:\\myproject\\NewTeams\\NewTeams-feature-home-dashboard\\dashboard\\src\\screens\\HomeScreen.tsx"
timestamp: 2026-11-01T13-37-11Z
slug: src-screens-homescreen-tsx
---
Method: dual-agent (A: design review · B: detector + browser overlay)

## Design Health Score: 20/40 (Acceptable)

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | StageRail has no "waiting on human" state; no live/last-updated indicator |
| 2 | Match System / Real World | 3 | Domain words good; glyph icons (▥ ▦ ↺ ✦ ⟳) arbitrary |
| 3 | User Control and Freedom | 2 | Project select filters nothing; inbox checkboxes have no action; month arrows permanently disabled |
| 4 | Consistency and Standards | 2 | DESIGN.md (Linear analysis) disagrees with tokens.css; approvals duplicated in calendar and inbox |
| 5 | Error Prevention | 2 | Deadlock row differs only by a white ring, sorted by time not urgency |
| 6 | Recognition Rather Than Recall | 3 | Calendar heat cells have no date numbers |
| 7 | Flexibility and Efficiency | 1 | No shortcuts, 56 tab stops before 내 차례, every link goes to generic #/run |
| 8 | Aesthetic and Minimalist Design | 1 | 13 sections; social metrics, other dashboards and brain graph compete with inbox |
| 9 | Error Recovery | 2 | "연결 오류 · 재연결 필요" and "✕ 실패" offer no action |
| 10 | Help and Documentation | 2 | Deadlock rule not explained where deadlock appears |

## Design Specificity Verdict
Components speak this product's language, but the composition is borrowed from another product (HomeScreen.tsx:14-17, CHATdaeri layout): channel metrics and a decorative Obsidian graph hold the prime space, 내 차례 sits in a side column. Detector: CLI 0 findings (regex-only on .tsx, undercount); browser overlay 5: undersized-ui-text x4 (.hs-opt small 10px, home.css:255, real) and monotonous spacing banner (likely false positive, 4px is the DESIGN.md base step).

## Priority Issues
1. [P0] Operator inbox is not the hero on desktop: at 1280px the right column drops below left/center (home.css:183-186), 내 차례 starts at y≈1654. Fix: 내 차례 + 진행 중 실행 first and widest, demote brain graph. /impeccable layout
2. [P1] Deadlock not distinct: sort first, full reason, counts, deep link + 원본 보기, StageRail 사람 대기 state. /impeccable bolder
3. [P1] Controls that do nothing: inbox checkboxes (HomeScreen.tsx:453), project filter (550), disabled month arrows (161-163), hardcoded "09:05 확인" (464). /impeccable harden
4. [P2] Off-mission content in prime space: channel tiles, 다른 대시보드 (5/6 준비 중), personal tasks. /impeccable distill
5. [P2] Keyboard/SR path: no h1, no skip link, outline:none on .hb-cluster/.hb-node (home.css:123,137), brain categories announced 3 times, 10px option labels. /impeccable audit then /impeccable harden

## Persona Red Flags
Alex: no shortcuts, no inline approve/open-raw, token counts lack limit/reset, checkboxes imply triage that doesn't exist.
Sam: 56 tabs to inbox, no skip link/h1, near-invisible focus on brain SVG groups, hs-unread aria-label without role.

## Minor Observations
Repeated "게시 승인 · WordPress · 게시 승인"; "눌러서 세컨드 브레인 열기" click-here label; 준비됨 as play-button verb; ↗ on internal links; brain search should disable when Obsidian is disconnected.

## Questions to Consider
- If nothing needs you, what should this screen say?
- Does the second brain earn half the canvas of a control room?
- Should a deadlock take over the top of the page until resolved?
