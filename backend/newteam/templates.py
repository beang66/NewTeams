"""반복 업무를 빠르게 시작하는 작업 템플릿."""

from __future__ import annotations

from typing import Any


TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "weekly_report",
        "icon": "🗓️",
        "title": "주간 보고서",
        "description": "진행 상황과 이슈를 요약하고 팀장 확인 포인트까지 정리합니다.",
        "goal": (
            "프로젝트명: {project}\n보고 기간: {period}\n진행 내용: {progress}\n"
            "이슈: {issues}\n다음 주 계획: {next_plan}\n\n"
            "위 내용을 바탕으로 팀장이 빠르게 판단할 수 있는 주간 보고서 초안을 작성해줘. "
            "완료·진행·지연 항목, 일정과 원가 영향, 의사결정이 필요한 이슈, 담당자와 기한이 있는 다음 주 계획, "
            "팀장 확인 포인트를 구분해줘."
        ),
        "fields": [
            {"key": "project", "label": "프로젝트명", "placeholder": "예: 강남역 브랜드 캠페인"},
            {"key": "period", "label": "보고 기간", "placeholder": "예: 10월 19일~10월 23일"},
            {"key": "progress", "label": "진행 내용", "placeholder": "완료 및 진행 중인 업무"},
            {"key": "issues", "label": "이슈", "placeholder": "일정·원가·협의 이슈"},
            {"key": "next_plan", "label": "다음 주 계획", "placeholder": "담당자와 목표 일정을 포함"},
        ],
        "tools": ["knowledge"],
        "recommended_app": "campaign_ops",
    },
    {
        "id": "campaign_brief",
        "icon": "📣",
        "title": "캠페인 브리프",
        "description": "목표, 타깃, 공간, 일정과 예산을 실행 가능한 브리프로 구조화합니다.",
        "goal": (
            "클라이언트/브랜드: {client}\n캠페인 목표: {objective}\n핵심 타깃: {audience}\n"
            "집행 공간: {location}\n기간: {period}\n예산 범위: {budget}\n\n"
            "위 정보를 캠페인 브리프로 정리해줘. 핵심 메시지, 필수 산출물, 일정 마일스톤, 예산 확인 항목, "
            "리스크와 승인 포인트를 포함해줘."
        ),
        "fields": [
            {"key": "client", "label": "브랜드", "placeholder": "예: 신제품 론칭 브랜드"},
            {"key": "objective", "label": "캠페인 목표", "placeholder": "예: 출시 2주 내 인지도 확보"},
            {"key": "audience", "label": "핵심 타깃", "placeholder": "예: 20~34세 직장인"},
            {"key": "location", "label": "집행 공간", "placeholder": "예: 강남역 지하상가"},
            {"key": "period", "label": "기간", "placeholder": "예: 11월 1일~14일"},
            {"key": "budget", "label": "예산", "placeholder": "예: 3천만 원 이내"},
        ],
        "tools": ["knowledge", "web"],
        "recommended_app": "campaign_ops",
    },
    {
        "id": "site_inspection",
        "icon": "📍",
        "title": "현장 점검",
        "description": "공간 매체의 가독성, 동선, 설치 조건과 촬영 증빙을 빠짐없이 점검합니다.",
        "goal": (
            "현장/공간: {location}\n매체 유형과 규격: {media}\n주요 관람 동선: {flow}\n"
            "확인된 제약: {constraints}\n\n"
            "현장 점검표를 작성해줘. 시야 거리와 각도, 조도와 반사, 체류 시간, 장애물, 설치·전기·안전 조건, "
            "사진 촬영 위치, 재방문 또는 보완 필요 사항을 우선순위와 함께 정리해줘."
        ),
        "fields": [
            {"key": "location", "label": "현장", "placeholder": "예: 서울역 2번 출구 환승 통로"},
            {"key": "media", "label": "매체", "placeholder": "예: 4m×2m LED 스크린"},
            {"key": "flow", "label": "관람 동선", "placeholder": "예: 지하철 하차 후 출구 방향"},
            {"key": "constraints", "label": "제약 사항", "placeholder": "예: 낮 시간 역광, 기둥 일부 가림"},
        ],
        "tools": ["knowledge", "browser"],
        "recommended_app": "spatial_media",
    },
    {
        "id": "brand_draft_review",
        "icon": "🎨",
        "title": "브랜드 시안 검수",
        "description": "공간 맥락과 브랜드 기준에 맞춰 시안·카피의 수정 우선순위를 제안합니다.",
        "goal": (
            "브랜드/캠페인: {brand}\n공간 콘셉트: {concept}\n검수할 시안: {draft}\n"
            "브랜드 기준: {criteria}\n\n"
            "시안을 브랜드 일관성, 공간 적합성, 메시지 위계, 원거리 가독성, 색상·대비, 제작 가능성 관점에서 검수해줘. "
            "유지할 점, 필수 수정, 권장 수정, 대체 카피 제안과 최종 승인 체크리스트로 정리해줘."
        ),
        "fields": [
            {"key": "brand", "label": "브랜드", "placeholder": "예: 프리미엄 뷰티 브랜드"},
            {"key": "concept", "label": "공간 콘셉트", "placeholder": "예: 도심 속 휴식과 발견"},
            {"key": "draft", "label": "시안 설명", "placeholder": "시안별 레이아웃·카피·색상 설명"},
            {"key": "criteria", "label": "브랜드 기준", "placeholder": "금지 표현, 컬러, 톤앤매너"},
        ],
        "tools": ["knowledge", "browser"],
        "recommended_app": "brand_experience",
    },
    {
        "id": "proposal_outline",
        "icon": "🧱",
        "title": "제안서 구성",
        "description": "클라이언트 설득 흐름에 맞춘 제안서 목차와 페이지별 핵심 메시지를 만듭니다.",
        "goal": (
            "클라이언트: {client}\n제안 목표: {objective}\n핵심 근거: {evidence}\n제출 일정: {deadline}\n\n"
            "공간 광고 제안서의 설득 구조를 설계해줘. 상황과 기회, 타깃 인사이트, 공간·매체 전략, 크리에이티브 방향, "
            "운영 일정, 예산, KPI, 증빙 계획 순서로 목차와 페이지별 한 줄 메시지 및 필요한 자료를 정리해줘."
        ),
        "fields": [
            {"key": "client", "label": "클라이언트", "placeholder": "예: 신규 F&B 브랜드"},
            {"key": "objective", "label": "제안 목표", "placeholder": "예: 오픈 첫 달 방문 전환"},
            {"key": "evidence", "label": "핵심 근거", "placeholder": "유동 인구, 매체 데이터, 유사 사례"},
            {"key": "deadline", "label": "제출 일정", "placeholder": "예: 10월 30일 오후 3시"},
        ],
        "tools": ["knowledge", "web"],
        "recommended_app": "spatial_media",
    },
    {
        "id": "execution_evidence",
        "icon": "📸",
        "title": "집행 증빙",
        "description": "게첨·송출·현장 사진과 KPI 자료를 클라이언트 제출용 목록으로 정리합니다.",
        "goal": (
            "캠페인: {campaign}\n집행 기간: {period}\n매체/지점: {placements}\n보유 자료: {materials}\n\n"
            "집행 증빙 패키지를 설계해줘. 지점별 필수 사진, 촬영 시간과 구도, 송출 로그, 검수 서명, KPI 원천 자료, "
            "누락 여부, 파일명 규칙과 최종 제출 목차를 표로 정리해줘."
        ),
        "fields": [
            {"key": "campaign", "label": "캠페인", "placeholder": "예: 여름 신제품 OOH 캠페인"},
            {"key": "period", "label": "집행 기간", "placeholder": "예: 7월 1일~31일"},
            {"key": "placements", "label": "매체/지점", "placeholder": "예: 성수 4개소, 강남 3개소"},
            {"key": "materials", "label": "보유 자료", "placeholder": "현장 사진, 송출 로그, 유동 인구 리포트"},
        ],
        "tools": ["knowledge", "workspace"],
        "recommended_app": "spatial_media",
    },
    {
        "id": "market_research",
        "icon": "📊",
        "title": "시장·경쟁사 조사 리포트",
        "description": "주제에 대한 근거를 모아 한 장짜리 리포트로 정리합니다.",
        "goal": "{topic} 시장의 주요 경쟁사와 최근 트렌드를 조사해서 의사결정자를 위한 1페이지 리포트로 정리해줘",
        "fields": [{"key": "topic", "label": "주제", "placeholder": "예: 국내 AI 에이전트 SaaS"}],
        "tools": ["knowledge", "web"],
    },
    {
        "id": "web_collect",
        "icon": "🌐",
        "title": "웹사이트 정보 수집",
        "description": "API가 없는 웹사이트를 탐색해 필요한 정보를 모읍니다.",
        "goal": "{url} 페이지에서 {what}을(를) 찾아 표로 정리해줘",
        "fields": [
            {"key": "url", "label": "웹 주소", "placeholder": "https://example.com"},
            {"key": "what", "label": "찾을 정보", "placeholder": "예: 요금제와 가격"},
        ],
        "tools": ["browser", "web"],
    },
    {
        "id": "data_cleanup",
        "icon": "🧮",
        "title": "데이터 정리·분석",
        "description": "격리된 작업 공간에서 스크립트를 실행해 데이터를 처리합니다.",
        "goal": "{data} 데이터를 정리하고 {metric}을(를) 계산하는 파이썬 스크립트를 만들어 실행 결과를 보고해줘",
        "fields": [
            {"key": "data", "label": "데이터 설명", "placeholder": "예: 월별·지역별 매출 CSV"},
            {"key": "metric", "label": "계산할 지표", "placeholder": "예: 지역별 합계와 평균"},
        ],
        "tools": ["workspace"],
    },
    {
        "id": "doc_qa",
        "icon": "📚",
        "title": "문서 기반 답변서",
        "description": "지식 베이스에 올린 문서만 근거로 답변서를 작성합니다.",
        "goal": "지식 베이스 문서를 근거로 '{question}'에 대한 답변서를 작성하고 근거 문서를 표시해줘",
        "fields": [{"key": "question", "label": "질문", "placeholder": "예: 신규 입사자 온보딩 절차는?"}],
        "tools": ["knowledge"],
    },
    {
        "id": "code_task",
        "icon": "💻",
        "title": "코드 작성·수정",
        "description": "작업 공간에서 코드를 만들고 실행해 결과를 확인합니다.",
        "goal": "작업 공간에 {feature} 기능을 하는 파이썬 스크립트를 만들고 실행 결과를 보고해줘",
        "fields": [{"key": "feature", "label": "만들 기능", "placeholder": "예: CSV를 JSON으로 변환"}],
        "tools": ["workspace"],
    },
]


def get_template(template_id: str | None) -> dict[str, Any] | None:
    return next((t for t in TEMPLATES if t["id"] == template_id), None)
