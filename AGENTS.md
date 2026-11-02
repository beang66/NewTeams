# AGENTS.md

이 저장소(`feature/home-dashboard` 브랜치)는 Claude Code 세션에서 진행하다 인계된 상태입니다.
작업을 시작하기 전에 **`docs/handoff/2026-11-02-handoff.md`** 를 먼저 읽으세요(비용 절감·하네스 보안·Vault 연결·스킬 실행과 루틴, 남은 일). 그 전 기록은 `docs/handoff/2026-10-28-codex-handoff.md`이며, 텔레그램 Task 8 실제 연결 확인은 여전히 사용자 설정과 승인 대기입니다.

- 설계 이유: `docs/decisions.md` · 보안 현황과 남은 위험: `docs/security.md` · 스킬·루틴: `docs/skills-and-routines.md` · Vault: `docs/vault-setup.md`

- 코드: `orchestrator/` (Node ≥ 20, TypeScript ESM, vitest), `dashboard/` (React + Vite)
- 테스트: `cd orchestrator && npx tsc --noEmit && npm test` · `cd dashboard && npm test && npm run build`
- 실제 `claude`/`codex` CLI, OpenAI API, Telegram API를 호출하는 작업은 사용자 확인 후에만 실행
- 원격 `main` 브랜치는 별개 프로젝트이므로 건드리지 말 것. 푸시는 사용자 확인 후에만
- 작업 트리의 `DESIGN.md` 서식 변경은 이 작업과 무관하니 커밋하지 말 것
