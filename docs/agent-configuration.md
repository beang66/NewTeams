# 마스터·작업 AI 설정

마스터 AI와 작업 AI는 각각 Claude Code 또는 Codex CLI로 선택한다. 설정은 프로젝트를 여는 `chat`/`serve` 프로세스 시작 시 적용된다. 변경 후 서버를 다시 시작한다. 검수 판정은 Codex(GPT), 구독 한도 시 기존 OpenAI 예비 경로를 유지한다.

## 빠른 설정

`orchestrator/`에서 빌드한 뒤 실행한다.

```powershell
npm run build
node dist/cli.js configure --master codex --worker codex --output codex.json
node dist/cli.js --config codex.json serve todo-smoke
```

마스터를 Codex, 작업을 Claude로 나누려면:

```powershell
node dist/cli.js configure --master codex --worker claude --worker-model sonnet --escalated-model opus --output mixed.json
node dist/cli.js --config mixed.json new my-project
node dist/cli.js --config mixed.json chat my-project
node dist/cli.js --config mixed.json serve my-project
```

`configure`는 기존 파일을 덮어쓰지 않는다. 기존 설정을 유지하면서 AI만 바꾸려면 `--config 기존.json configure ... --output 새설정.json`으로 생성한다. 모델을 생략하면 Claude는 기존 역할별 기본값, Codex는 설치된 CLI의 기본 모델을 사용한다. 특정 모델을 쓰려면 `--master-model <모델ID>`, `--worker-model <모델ID>`를 지정한다. 현재 계정·CLI에서 지원하는 모델 ID를 사용한다. `default`는 CLI 기본 모델을 뜻한다.

## JSON 형식

```json
{
  "agents": {
    "master": { "provider": "codex" },
    "worker": { "provider": "claude", "model": "sonnet", "escalatedModel": "opus" }
  },
  "maxParallel": 3,
  "port": 4317
}
```

- `master`: 요구사항 대화, 기획, 에스컬레이션 판단, 최종 보고.
- `worker`: 개발, QA, 위키 작성, 로그 질의. `escalatedModel`은 개발 교착 시 적용한다.
- `provider`: `claude` 또는 `codex`. 알 수 없는 제공자·설정 키·빈 모델은 시작 전에 오류로 안내한다.
- `model`: 선택 사항. Claude 기본값은 마스터/기획 Opus, 개발/QA/로그 Sonnet, 위키 Haiku. Codex는 CLI 기본 모델.
- `escalatedModel`: 선택 사항. Claude 개발의 기본 상향은 Opus이며, Codex는 명시하지 않으면 현재 모델을 유지한다.

예제: `orchestrator/config.examples/codex.json`, `orchestrator/config.examples/mixed.json`. 경로·포트·시간 제한 등 기존 설정도 같은 파일에서 지정할 수 있다. 자격 증명을 파일에 넣지 않으며 각 CLI의 기존 로그인 상태를 사용한다.

## 적용 확인과 실행 계약

`GET /api/agents`는 현재 프로세스에 적용된 두 그룹 설정과 역할별 실제 제공자/모델을 반환한다. 이 API는 조회 전용이다. 대시보드 설정 화면은 별도 계획 2의 범위다.

Codex 개발·QA는 `--approve-for-me`로 workspace-write와 자동 승인 검토를 사용하며, 검수·마스터·기획·위키·로그는 명시적인 `read-only`로 실행한다. 설치된 CLI에서 `--approve-for-me`와 `--sandbox`는 상호 배타적이므로 함께 전달하지 않는다. QA 증거 경로는 추가 쓰기 디렉터리로 전달한다. QA의 Playwright MCP 설정은 CLI의 `mcp_servers` 설정으로 변환한다. 시드 분기는 `codex exec fork`, 수정은 `codex exec resume`을 사용하며, 프롬프트는 stdin으로 전달한다. 검수에는 계속 JSON 스키마를 강제한다.

세션 ID에 제공자를 표시해 Claude 세션을 Codex에 넘기거나 그 반대로 넘기지 않는다. 시드도 제공자·모델별로 관리하며, Codex는 읽기 전용 기획 시드와 쓰기 가능한 작업 시드를 분리한다. 제공자를 바꾼 경우 다른 제공자의 대화를 이어가는 대신 새 세션으로 시작한다. 기존 raw 로그는 수정하지 않는다. 프로세스 재시작 시 이전 일시정지 표시는 RESUMED(process_restart)로 정리하며, 다음 호출에서 현재 제공자의 한도·인증을 다시 확인한다.

## 실행 중 권한·세션 복구

권한이나 제공자 전환 뒤 기존 작업 세션을 재사용할 수 없으면 `POST /api/human/<eventId>`에 `{"action":"guidance","text":"복구 지침","restartSession":true}`를 보낸다. 원본 로그와 작업 파일을 유지하고 해당 작업의 세션만 새 시드에서 시작한다. 일반 지침은 기존대로 같은 세션을 이어간다.

마스터는 차단 오류의 상세를 받으며, 증거 부족을 해결할 때 원본 세션 로그의 필요한 명령·파일 변경 기록을 읽을 수 있다. 작업 보고의 일부 검증 한계와 실제 구현 불가능 상태는 구분한다. QA는 모든 시나리오의 실제 PNG와 구조화된 manifest를 생성하고, GPT가 근거로 검수한다. `.playwright-mcp/`는 예약된 브라우저 런타임 출력으로 공유 Git info/exclude에 기록하며 앱 소스 커밋에 섞지 않는다.

검증: 전체 회귀 테스트 225개, 타입 검사·빌드 통과. 실제 Codex 마스터→기획 반려/수정→GPT 승인→개발→브라우저 QA→GPT 반려→마스터 원본 증거 조회→재승인→병합→최종 QA→보고서까지 완료했다. 최종 스모크 결과는 [smoke-test.md](smoke-test.md)에 기록한다.
