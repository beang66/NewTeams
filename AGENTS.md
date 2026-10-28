# AGENTS.md

이 저장소(`orchestrator-v2` 브랜치)는 Claude Code 세션에서 진행하다 인계된 상태입니다.
작업을 시작하기 전에 **`docs/handoff/2026-10-28-codex-handoff.md`** 를 먼저 읽으세요. 현재 상태, 바로 이어서 할 일(텔레그램 Task 5 미커밋 진행분), 지켜야 할 규칙이 정리되어 있습니다.

- 코드: `orchestrator/` (Node ≥ 20, TypeScript ESM, vitest), `dashboard/` (React + Vite)
- 테스트: `cd orchestrator && npx tsc --noEmit && npm test` · `cd dashboard && npm test && npm run build`
- 실제 `claude`/`codex` CLI, OpenAI API, Telegram API를 호출하는 작업은 사용자 확인 후에만 실행
- 원격 `main` 브랜치는 별개 프로젝트이므로 건드리지 말 것. 푸시는 사용자 확인 후에만
- 작업 트리의 `DESIGN.md` 서식 변경은 이 작업과 무관하니 커밋하지 말 것
