# 스킬 실행과 루틴

대시보드 홈의 **스킬** 카드에서 이 PC에 설치된 Claude Code 스킬을 실행하고, **루틴** 카드에서 정한 시각에 스킬을 실행하게 한다. 둘 다 오케스트레이터(`serve`)가 켜져 있어야 동작한다.

## 스킬 목록

`GET /api/skills`가 세 곳을 읽는다(`orchestrator/src/skills/skills.ts`).

| 출처 | 경로 | 이름 |
| --- | --- | --- |
| 사용자 | `~/.claude/skills/*/SKILL.md` | `ponytail` |
| 저장소 | `<repo>/.claude/skills/*/SKILL.md` | `impeccable` |
| 플러그인 | `~/.claude/settings.json`의 `enabledPlugins`가 켠 플러그인의 `installPath/skills/*/SKILL.md` | `superpowers:brainstorming` |

꺼진 플러그인과 플러그인 캐시의 예전 버전은 읽지 않는다. 같은 이름은 먼저 읽힌 것 하나만 남긴다.

### 고정(☆)

기본 화면은 고정한 스킬만 보여 준다. 고정 목록은 사용자 홈의 `~/.newteams/pinned-skills.json`에 저장된다(프로젝트와 무관, 직전 본은 `.bak`). 파일이 없을 때만 예전 `skill-runs/pinned.json` → `DEFAULT_PINNED`(`runs.ts`) 순으로 채운다. 설치되지 않은 이름은 화면에서 빠진다.

## 실행 흐름

```
실행 ─▶ running ─┬─▶ done            결과·만든 파일 기록
                 ├─▶ needs_approval  파일 쓰기 등이 거부됨 ─┬─ 승인 ─▶ running(같은 세션, acceptEdits) ─▶ done
                 │                                         └─ 거절 ─▶ cancelled
                 ├─▶ failed
                 └─▶ cancelled       사람이 중단
```

1. `POST /api/skills/run`은 바로 `202`와 실행 정보를 돌려준다. 실행은 `claude -p "/<스킬> <입력>"`이고, 작업 폴더는 `skill-runs/<실행 ID>/`이다.
2. 스킬 실행은 사람이 고른 것이므로 **사용자 설정(스킬·플러그인·MCP)을 싣는다**(`userSettings: true`). 파이프라인 에이전트는 사용자 설정 없이 돈다([security.md](security.md)).
3. 처음에는 권한을 열지 않는다. Claude CLI 결과의 `permission_denials`에 거부된 도구가 있으면 `needs_approval`로 멈추고 `denied`에 `Write: <경로>` 형태로 남긴다.
4. **승인**하면 같은 세션을 `--resume`과 `--permission-mode acceptEdits`로 이어 간다. 파일 쓰기·편집만 허용되고 **셸 명령은 승인해도 막혀 있다.** 승인 뒤에도 남은 거부는 결과와 함께 `denied`로 보여 주고 더 열지 않는다.
5. **중단**하면 `AbortSignal`이 `spawnCli`에 전달되어 Claude 프로세스 트리를 끝낸다(`taskkill /T` 또는 `SIGKILL`). 시작 직후 중단해도 프로세스를 띄우지 않는다.
6. 한 번에 하나만 실행한다. 실행 중에 다른 실행을 요청하면 `409`.

## 저장

프로젝트 폴더 `projects/<이름>/skill-runs/`(git 제외):

| 파일 | 내용 |
| --- | --- |
| `history.jsonl` | 상태가 바뀔 때마다 실행 한 줄. 같은 `id`의 마지막 줄이 현재 상태. 메모리에는 최근 200건 |
| `<실행 ID>/session.jsonl` | Claude stream-json 원본 |
| `<실행 ID>/*` | 스킬이 만든 파일 |
| `pinned.json` | (예전) 고정 목록. 지금은 `~/.newteams/pinned-skills.json` |
| `routines.json` | 루틴 |

서버가 꺼질 때 `running`이던 실행은 다시 켤 때 `failed`(재시작으로 중단)로 바뀐다.

## 루틴

루틴은 `이름 + 스킬 + 입력 + 모델·effort + 일정 + 켜기`이다. 일정은 매일 `HH:MM` 또는 매주 요일(0=일 … 6=토)과 `HH:MM`, 이 PC의 시간대 기준이다(`orchestrator/src/skills/schedule.ts`, 대시보드도 같은 파일을 쓴다).

- 오케스트레이터가 **30초마다** 확인한다. 예정 시각이 지났고 그 예정분을 아직 안 돌았으면 실행한다.
- 꺼져 있던 동안 놓친 실행은 켜질 때 **가장 최근 예정분 한 번만** 따라잡는다. 루틴을 만들기 전의 예정분은 돌지 않는다.
- 다른 스킬이 실행 중이면 이번 확인은 건너뛰고 다음 확인 때 다시 시도한다.
- 스킬이 없어지는 등 시작에 실패하면 그 예정분은 소진하고 `lastError`에 남긴다.
- 파일을 만드는 스킬을 루틴으로 돌리면 `needs_approval`로 멈춘다. 스킬 카드의 실행 기록에서 승인한다.

Windows 작업 스케줄러는 쓰지 않는다. 서버가 꺼져 있으면 루틴도 돌지 않는다.

## API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/skills` | 설치된 스킬 |
| GET·PUT | `/api/skills/pinned` | 고정 목록 |
| GET | `/api/skills/runs` | 최근 실행 50건 |
| POST | `/api/skills/run` | `{ name, input?, model?, effort? }` → `202` 실행 |
| POST | `/api/skills/runs/:id/approve` · `reject` · `cancel` | 승인·거절·중단 |
| GET·POST | `/api/routines` | 목록·만들기 |
| PUT·DELETE | `/api/routines/:id` | 고치기·지우기 |

입력 검사: 스킬은 설치 목록에 있는 이름만, `model`은 `기본 모델·Opus·Sonnet·Haiku·Fable`, `effort`는 `기본·low·medium·high·xhigh·max`, 시각은 `^([01]\d|2[0-3]):[0-5]\d$`. 모든 요청은 로컬 Host·Origin만 받는다.

## 검증 기록 (2026-11-02, 실제 Claude CLI)

- `ponytail-help`: 실행 15초 만에 완료. 다시 실행해 3초 뒤 중단 → 0.9초 만에 `cancelled`, 남은 프로세스 0개.
- `doc-coauthoring`에 `note.md`로 저장하라고 요청: `Write` 거부로 `needs_approval` → 승인 → 같은 세션이 `note.md`를 실제로 저장하고 `done`.

## 알려진 제한

- 셸 명령이 필요한 스킬은 끝까지 돌지 않는다.
- `history.jsonl`은 추가만 하고 정리하지 않는다.
- 승인 대기는 스킬 카드에만 보이고 상단 알림에는 아직 없다.
- 실행 결과를 Vault로 보내는 기능은 없다.
