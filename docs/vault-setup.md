# Obsidian Vault 연결

대시보드 홈의 **세컨드 브레인**은 PC의 Obsidian Vault를 직접 읽는다(읽기·검색·그래프, AI Inbox에 새 메모 쓰기).

## 경로 정하기

오케스트레이터는 이 순서로 Vault를 찾는다(`orchestrator/src/cli.ts` `openVault`).

1. 환경 변수 `ORCH_VAULT_DIR`
2. 설정 JSON(`--config`)의 `vault.path`
3. 기본값 `<사용자 폴더>\Documents\Obsidian Vault`
4. 위 폴더가 없고 `vault.github`가 있으면 `~/.cache/newteams/vault`에 얕은 clone(시작할 때 한 번만 pull, Inbox 쓰기는 push하지 않음)

```powershell
$env:ORCH_VAULT_DIR = "C:\Users\<사용자>\Documents\Obsidian Vault"
```

```json
{ "vault": { "path": "C:\\Users\\<사용자>\\Documents\\Obsidian Vault", "read": ["01 Projects", "wiki"], "inbox": "01 Projects/[진행] NEWTEAMs AI Agent Studio/AI Inbox" } }
```

JSON에서는 역슬래시를 두 번 쓴다. 시작 로그의 `Obsidian: …`로 연결을 확인한다. 앞에 GitHub 주소가 붙어 있으면 clone을 읽고 있는 것이다.

## 읽기·쓰기 범위

- **읽기:** `vault.read` 폴더 안의 Markdown만. 밖·`..`·심볼릭 링크로 밖을 가리키는 경로는 막는다. AI Inbox는 검색에서 뺀다.
- **쓰기:** `vault.inbox`에 새 파일만(같은 이름이면 `409`). 기존 노트는 고치지 않는다.
- 파이프라인 에이전트의 프롬프트에는 Vault 내용이 들어가지 않는다(대시보드 화면 전용).

## 그래프

허용 폴더의 노트가 점, `[[위키 링크]]`와 `[텍스트](경로.md)`가 선이다. 폴더 이름에 `[진행]`처럼 대괄호가 있어도 링크를 읽는다(처음 나오는 `]]`까지 읽고 `|`·`#`·`^`를 뗀다). 점은 연결이 많은 순으로 최대 600개, Tab으로 들르는 노트는 20개, 300개를 넘으면 번짐 필터를 끈다.

## 개발 실행

`.claude/launch.json`의 `orchestrator`가 `projects/home`(INTAKE에서 멈춰 모델을 부르지 않는 빈 프로젝트)으로 서버를 띄운다. 처음 한 번 `npx tsx src/cli.ts new home`이 필요하다.

## 라이브러리 저장소 (`Libraries/`)

- 대시보드의 브랜드·콘텐츠·아이디어 페이지는 Vault의 `Libraries/brand`, `Libraries/content`, `Libraries/ideas`에 노트를 쓴다. 폴더는 처음 열 때 만든다.
- 카드를 누르면 `#/brand/<파일>` 같은 별도 페이지에서 전체 내용을 읽고 고친다. 삭제한 노트는 `Libraries/.trash/`에 남는다.
- Vault 규칙(`Obsidian Vault/CLAUDE.md`)에 이 세 폴더만 대시보드가 쓸 수 있다고 적어 두었다.
- GitHub 동기화(`beang66/Vault`)는 Obsidian Git이 맡는다. 이 PC의 Vault 폴더가 Git 저장소여야 한다.

## 파이프라인 문서

- `01 Projects/[진행] NEWTEAMs AI Agent Studio/파이프라인/`의 `00 파이프라인 설계`와 `01 요구사항·스펙` … `08 보고`를 에이전트가 단계마다 읽는다. 노트 이름을 바꾸면 에이전트가 찾지 못하니 이름은 유지하고 내용만 고친다.
