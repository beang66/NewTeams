"""역할별 에이전트 정의 — CrewAI의 role / goal / backstory 패턴.

계획 담당이 목표를 단계로 나누어 각 단계를 조사·탐색·개발·작성 담당에게 위임하고,
검증 담당이 마지막에 결과물을 독립적으로 검토한다.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class Role:
    key: str
    name: str
    goal: str
    backstory: str
    tools: list[str] = field(default_factory=list)
    icon: str = "🤖"


ROLES: dict[str, Role] = {
    r.key: r
    for r in [
        Role(
            "planner", "계획 담당",
            "목표를 실행 가능한 단계로 나누고 각 단계를 가장 알맞은 담당에게 맡긴다.",
            "여러 팀의 프로젝트를 이끌어 온 PM. 단계는 적고 명확하게, 각 단계의 완료 기준이 분명하게 잡는다.",
            icon="🧭",
        ),
        Role(
            "researcher", "조사 담당",
            "목표에 필요한 사실과 근거를 찾아 출처와 함께 정리한다.",
            "꼼꼼한 리서처. 확인된 사실과 추정을 구분하고, 근거가 없으면 없다고 말한다.",
            ["knowledge_search", "web_fetch"], "🔎",
        ),
        Role(
            "browser", "웹 탐색 담당",
            "API가 없는 웹사이트를 직접 열어 필요한 정보를 수집한다.",
            "웹 자동화 전문가. 페이지에서 확인한 내용만 보고하고 방문한 주소를 남긴다.",
            ["browser"], "🌐",
        ),
        Role(
            "developer", "개발 담당",
            "격리된 작업 공간에서 코드를 작성·실행해 데이터 처리와 개발 작업을 수행한다.",
            "실용적인 엔지니어. 작은 스크립트로 빠르게 검증하고 실행 결과로 말한다.",
            ["workspace"], "🛠️",
        ),
        Role(
            "writer", "작성 담당",
            "앞 단계의 결과를 종합해 목표에 맞는 최종 결과물을 작성한다.",
            "비개발자도 이해할 수 있게 쓰는 테크니컬 라이터. 근거가 있는 내용만 쓰고 출처를 밝힌다.",
            icon="✍️",
        ),
        Role(
            "verifier", "검증 담당",
            "결과물이 목표를 충족하고 근거와 일치하는지 독립적으로 검토한다.",
            "엄격한 리뷰어. 작성자와 독립적으로 판단하고, 부족한 점은 고칠 수 있게 구체적으로 지적한다.",
            icon="✅",
        ),
    ]
}

STEP_ROLES = ("researcher", "browser", "developer", "writer")


def role_config(app: dict[str, Any], key: str) -> dict[str, Any]:
    return (app.get("roles") or {}).get(key) or {}


def role_enabled(app: dict[str, Any], key: str) -> bool:
    return role_config(app, key).get("enabled", True)


def role_model(app: dict[str, Any], key: str) -> str:
    return role_config(app, key).get("model") or app["model"]


def role_profile(app: dict[str, Any], key: str) -> dict[str, str]:
    """앱에서 바꾼 이름·목표·배경. 비워 둔 항목은 기본 역할 정의를 쓴다."""
    role, cfg = ROLES[key], role_config(app, key)
    return {field: (cfg.get(field) or "").strip() or getattr(role, field) for field in ("name", "goal", "backstory")}


def role_names(app: dict[str, Any]) -> dict[str, str]:
    return {key: role_profile(app, key)["name"] for key in ROLES}


def system_prompt(app: dict[str, Any], key: str) -> str:
    role = role_profile(app, key)
    parts = [
        f"당신은 AI 에이전트 팀의 '{role['name']}'입니다.",
        f"목표: {role['goal']}",
        f"배경: {role['backstory']}",
        "답변은 한국어로 작성합니다.",
    ]
    if app.get("instructions"):
        parts.append(f"\n[앱 공통 지침]\n{app['instructions']}")
    if extra := role_config(app, key).get("instructions"):
        parts.append(f"\n[이 역할에 대한 추가 지침]\n{extra}")
    return "\n".join(parts)


def roles_payload() -> list[dict[str, Any]]:
    return [asdict(r) for r in ROLES.values()]
