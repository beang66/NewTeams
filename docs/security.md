# 하네스 보안

오케스트레이터는 저장소 내용과 웹 페이지를 읽는 AI 에이전트를 이 PC에서 실행한다. 읽은 내용 안의 숨은 지시가 권한으로 이어지지 않게 하는 것이 목표다. 2026-11-02 점검 결과와 남은 위험을 적는다.

## 막아 둔 것

| 위험 | 대책 | 위치 |
| --- | --- | --- |
| 로컬 서버(127.0.0.1)에 다른 웹사이트가 요청을 보냄. 본문 없는 `POST /api/spec/approve`·`/api/resume`은 CORS 사전 확인도 없다. DNS 리바인딩으로 다른 API도 열린다 | 모든 요청에서 `Host`와 `Origin`이 `127.0.0.1`·`localhost`·`[::1]`이 아니면 `403`. `Origin: null`도 거부 | `orchestrator/src/server/http.ts` `onRequest` |
| 파이프라인 에이전트(dev·qa·planner·master·reviewer…)가 사용자 전역 설정을 실음: 플러그인 7개(그중 `claude-mem`은 읽은 내용을 기억으로 저장해 사용자 세션에 다시 넣음), 훅 11개, MCP | Claude 실행에 `--setting-sources project,local --strict-mcp-config`. QA는 넘겨준 Playwright MCP만 쓴다. 사람이 직접 고른 **스킬 실행만** 사용자 설정을 싣는다 | `orchestrator/src/runners/claudeRunner.ts` |
| 에이전트가 작업 폴더에 `.claude/settings.json` 등을 써서 다음 실행의 훅·권한을 넓힘 | `.claude/`, `.codex/`, `.mcp.json` 변경은 소유 범위와 무관하게 하네스가 반려하고, **반려 전에 태스크 시작 상태로 되돌려 커밋**한다(다음 회차 에이전트가 불러오지 못하게) | `harness/checks.ts` `checkAgentConfig`, `workspace/git.ts` `restoreFiles`, `engine/reviewLoop.ts` |
| 검수자가 잘린 diff만 보고 승인 | 잠금 파일(`package-lock.json` 등)을 diff에서 빼고, 6만 자에서 잘리면 못 본 파일 목록을 붙여 작업 폴더에서 직접 읽게 한다 | `workspace/git.ts` `diff` |
| QA의 Playwright MCP를 실행마다 `@latest`로 받음(공급망) | `@playwright/mcp@0.0.83` 고정 | `engine/reviewLoop.ts` `PLAYWRIGHT_MCP` |
| 스킬 실행이 파일을 마음대로 씀 | 처음엔 권한 없이 돌리고, 거부되면 사람이 승인해야 실행 폴더 안 편집만 허용. 셸은 계속 막음 | [skills-and-routines.md](skills-and-routines.md) |
| 대시보드가 Vault 노트를 마음대로 고침 | 쓰기는 `Libraries/brand`·`content`·`ideas` 세 폴더의 `.md`만. 파일 이름에 경로 구분자·`..`·숨김 이름 금지, 폴더 실제 경로가 Vault 안인지 확인, 심볼릭 링크 파일 거부. 삭제는 `Libraries/.trash/`로 이동, 수정은 수정 시각이 다르면 409. frontmatter 값은 `JSON.stringify` | `vault/library.ts` |
| Vault Inbox 메모의 frontmatter에 키 주입 | `sources`를 `JSON.stringify`로 감쌈 | `vault/vault.ts` `writeInbox` |

이미 있던 것: 서버는 `127.0.0.1`에만 열린다. 검수자(Codex)는 읽기 전용 샌드박스, 로그 질의는 `Read`·`Grep`만. Vault는 허용 폴더 밖·`..`·심볼릭 링크로 밖을 막는다. 텔레그램은 허용한 채팅만 받고 비밀값을 걸러 보낸다. `projects/`와 `raw/`는 git에서 빠진다.

## 남은 위험

1. **계획의 셸 명령이 샌드박스 없이 실행된다.** `plan.testCommands`는 기획 AI가 쓰고 GPT만 검수한 뒤 `shell: true`로 이 PC에서 돈다(`harness/checks.ts`). 가장 큰 위험이다. 대책 후보: 계획 승인 때 명령 목록을 사람이 확인(HUMAN_REQUIRED) 또는 허용 명령 목록.
2. **QA 에이전트는 제한 없는 `Bash`를 쓴다.** 개발 서버를 띄워야 해서 필요하지만, 시험하는 웹 페이지의 숨은 지시가 명령으로 이어질 수 있다. Claude Code 샌드박스는 Windows를 지원하지 않는다.
3. **Codex는 사용자 설정을 그대로 싣는다.** `codex exec`가 `~/.codex/config.toml`의 computer-use·chrome·browser 플러그인과 apify MCP를 불러온다. `--ignore-user-config`는 Windows 샌드박스 설정(`sandbox = "unelevated"`)까지 빼므로 실제 Codex로 확인한 뒤 바꾼다.
4. `--setting-sources project,local`로 에이전트가 사용자 설정의 기본 모델·권한을 받지 않는다. 지금 사용자 설정에 허용 목록이 없어 영향은 없지만, 다음 실제 실행에서 확인한다.
