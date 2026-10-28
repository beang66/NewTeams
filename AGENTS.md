# AGENTS.md

이 저장소(`orchestrator-v2` 브랜치)는 Claude Code 세션에서 진행하다 인계된 상태입니다.
작업을 시작하기 전에 **`docs/handoff/2026-10-28-codex-handoff.md`** 를 먼저 읽으세요. 텔레그램 Task 1~7 구현은 완료됐고, Task 8 실제 연결 확인은 사용자 봇·환경 변수 설정과 승인 대기입니다. 대시보드는 별도 작업에서 계속 진행됐으므로 최신 커밋과 해당 ledger도 확인하세요.

- 코드: `orchestrator/` (Node ≥ 20, TypeScript ESM, vitest), `dashboard/` (React + Vite)
- 테스트: `cd orchestrator && npx tsc --noEmit && npm test` · `cd dashboard && npm test && npm run build`
- 실제 `claude`/`codex` CLI, OpenAI API, Telegram API를 호출하는 작업은 사용자 확인 후에만 실행
- 원격 `main` 브랜치는 별개 프로젝트이므로 건드리지 말 것. 푸시는 사용자 확인 후에만
- 작업 트리의 `DESIGN.md` 서식 변경은 이 작업과 무관하니 커밋하지 말 것
