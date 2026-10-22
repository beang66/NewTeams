"""에이전트 앱 설정과 기본 제공 팀."""

from __future__ import annotations

import copy
from typing import Any

from .crew import ROLES
from .db import Store, new_id


DEFAULT_APP: dict[str, Any] = {
    "name": "새 에이전트 앱",
    "icon": "🤖",
    "description": "",
    "shared": False,
    "model": "mock:demo",
    "effort": "medium",
    "instructions": "",
    "knowledge_ids": [],
    "retrieval_top_k": 5,
    "tools": {
        "knowledge": True,
        "web": True,
        "browser": True,
        "workspace": True,
        "workspace_engine": "builtin",
    },
    # name·goal·backstory를 비워 두면 crew.ROLES의 기본 정의를 쓴다.
    "roles": {key: {"enabled": True, "instructions": "", "model": "", "name": "", "goal": "", "backstory": ""} for key in ROLES},
    "policy": {
        "plan_approval": True,
        "tool_approval": True,
        "final_approval": False,
        "verify": True,
        "max_iterations": 2,
        "max_steps": 8,
    },
}


def _merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def normalize_app(data: dict[str, Any]) -> dict[str, Any]:
    app = _merge(DEFAULT_APP, data)
    policy = app["policy"]
    policy["max_iterations"] = max(1, min(int(policy["max_iterations"]), 5))
    policy["max_steps"] = max(2, min(int(policy["max_steps"]), 15))
    for cfg in app["roles"].values():
        for field, limit in (("name", 30), ("goal", 500), ("backstory", 500)):
            cfg[field] = str(cfg.get(field) or "").strip()[:limit]
    return app


PROTECTED = ("id", "created_at", "updated_at", "owner_id", "owner_name", "can_edit", "is_mine", "seed_key")


def create_app(store: Store, data: dict[str, Any], owner: dict[str, Any] | None = None) -> dict[str, Any]:
    app = normalize_app({k: v for k, v in data.items() if k not in PROTECTED})
    app["id"] = new_id("app")
    app["owner_id"] = owner["id"] if owner else None
    app["owner_name"] = owner["name"] if owner else ""
    return store.put("apps", app)


def update_app(store: Store, app_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    current = store.get("apps", app_id)
    if current is None:
        return None
    merged = normalize_app(_merge(current, {k: v for k, v in data.items() if k not in PROTECTED}))
    return store.put("apps", merged)


STARTER_APPS: list[tuple[str, dict[str, Any]]] = [
    ("research_report", {
        "name": "리서치 & 리포트 팀",
        "icon": "📊",
        "description": "조사 → 작성 → 검증 역할이 협업해 근거 있는 리포트를 만듭니다.",
        "shared": True,
    }),
    ("data_processing", {
        "name": "데이터 처리 팀",
        "icon": "🧮",
        "description": "격리된 작업 공간에서 스크립트를 실행해 데이터를 정리합니다.",
        "shared": True,
        "tools": {"browser": False},
        "policy": {"plan_approval": False},
    }),
    ("campaign_ops", {
        "name": "캠페인 운영팀",
        "icon": "🧭",
        "description": "일정·원가·리스크를 관리하고 의사결정 중심의 주간 보고를 만드는 팀장용 에이전트 팀입니다.",
        "shared": True,
        "instructions": (
            "공간 광고 캠페인의 운영 PMO로 행동한다. 모든 결과에 일정, 담당자, 원가 영향, 리스크, "
            "승인 필요 사항을 분리하고 팀장이 바로 판단할 수 있는 확인 포인트를 제시한다."
        ),
        "tools": {"browser": False, "workspace": False},
        "roles": {
            "planner": {"instructions": "마일스톤, 담당자, 선행 조건, 승인 게이트를 포함해 실행 계획을 만든다."},
            "researcher": {"instructions": "계약·견적·일정 자료에서 원가와 리스크 근거를 찾는다."},
            "writer": {"instructions": "결론 우선으로 쓰고 팀장 확인 포인트와 다음 액션을 표로 정리한다."},
            "verifier": {"instructions": "일정 누락, 원가 영향, 책임자와 기한이 없는 액션을 집중 검수한다."},
        },
        "policy": {"plan_approval": True, "tool_approval": True, "verify": True, "max_steps": 7},
    }),
    ("brand_experience", {
        "name": "브랜드 경험 디자인팀",
        "icon": "🎨",
        "description": "공간별 콘셉트와 카피를 제안하고 브랜드 기준·가독성·제작 가능성으로 시안을 검수합니다.",
        "shared": True,
        "instructions": (
            "공간을 하나의 브랜드 접점으로 보고 콘셉트, 메시지 위계, 카피, 시각적 일관성을 함께 설계한다. "
            "제안은 공간 동선과 관람 거리, 제작 조건을 근거로 설명하고 수정 우선순위를 명확히 한다."
        ),
        "roles": {
            "planner": {"instructions": "브랜드 이해, 공간 맥락, 콘셉트, 카피, 시안 검수 순서로 계획한다."},
            "researcher": {"instructions": "브랜드 가이드와 캠페인 맥락, 타깃 인사이트, 공간 특성을 정리한다."},
            "browser": {"instructions": "레퍼런스를 수집할 때 출처와 적용 가능한 요소를 함께 기록한다."},
            "writer": {"instructions": "공간별 콘셉트 문장, 헤드라인·서브카피 대안, 디자인 피드백을 구체적으로 쓴다."},
            "verifier": {"instructions": "브랜드 일관성, 원거리 가독성, 색상 대비, 제작 가능성과 금지 요소를 검수한다."},
        },
        "policy": {"plan_approval": True, "tool_approval": True, "final_approval": True, "verify": True, "max_iterations": 3},
    }),
    ("spatial_media", {
        "name": "공간 미디어 기획·검증팀",
        "icon": "🏙️",
        "description": "매체 비교, 현장 가독성, KPI 설계와 집행 증빙을 팀장과 디자이너가 함께 관리합니다.",
        "shared": True,
        "instructions": (
            "공간 미디어 후보를 동일 기준으로 비교하고 현장 조건과 크리에이티브 적합성을 함께 평가한다. "
            "모든 추천에는 근거, 가정, KPI 측정 방식과 집행 증빙 계획을 포함한다."
        ),
        "roles": {
            "planner": {"instructions": "매체 선정, 현장 검증, 크리에이티브 적용, KPI, 증빙을 하나의 일정으로 묶는다."},
            "researcher": {"instructions": "유동 인구, 비용, 노출 조건, 운영 제약을 출처와 함께 비교한다."},
            "browser": {"instructions": "매체사 자료와 위치 정보를 확인하고 근거 URL과 확인 날짜를 남긴다."},
            "writer": {"instructions": "비교표, 현장 체크리스트, KPI 정의, 증빙 목록을 실무자가 바로 쓰게 작성한다."},
            "verifier": {"instructions": "수치 단위, 비교 기준, 시야·조도·동선, KPI 산식과 증빙 누락을 검수한다."},
        },
        "policy": {"plan_approval": True, "tool_approval": True, "final_approval": True, "verify": True, "max_iterations": 3, "max_steps": 10},
    }),
]


def seed(store: Store) -> None:
    """누락된 기본 팀만 추가한다. 사용자가 수정한 기존 팀은 덮어쓰지 않는다."""
    current = store.list("apps")
    for seed_key, data in STARTER_APPS:
        existing = next((app for app in current if app.get("seed_key") == seed_key or app.get("name") == data["name"]), None)
        if existing:
            if not existing.get("seed_key"):
                store.update("apps", existing["id"], seed_key=seed_key)
            continue
        created = create_app(store, data)
        created = store.update("apps", created["id"], seed_key=seed_key) or created
        current.append(created)
