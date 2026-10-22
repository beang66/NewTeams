"""오프라인 데모 공급자.

API 키 없이도 목표 → 계획 → 실행 → 검증 → 결과 흐름 전체를 시연할 수 있도록
요청 목적(purpose)과 컨텍스트만 보고 결정적인 응답을 만든다.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .base import LLMRequest, LLMResult, estimate_tokens

MODELS = ["demo"]

CODE_HINTS = ("코드", "스크립트", "데이터", "csv", "파이썬", "python", "계산", "통계", "변환")


def complete(model: str, req: LLMRequest, config: dict[str, Any]) -> LLMResult:
    handler = {
        "plan": _plan,
        "develop": _develop,
        "verify": _verify,
    }.get(req.purpose, _step)
    out = handler(req.context)
    text = out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)
    return LLMResult(
        text=text,
        model=f"mock:{model}",
        input_tokens=estimate_tokens(req.system + req.prompt),
        output_tokens=estimate_tokens(text),
    )


def _plan(ctx: dict[str, Any]) -> dict[str, Any]:
    goal: str = ctx.get("goal", "")
    tools: list[str] = ctx.get("tools", [])
    urls: list[str] = ctx.get("urls", [])
    steps: list[dict[str, str]] = []

    if ctx.get("has_knowledge"):
        steps.append(_s("지식 베이스에서 관련 문서 찾기", "researcher", "knowledge_search", goal,
                        "목표와 관련된 근거 문서를 찾아 핵심 내용을 정리하세요."))
    if urls and "browser" in tools:
        steps.append(_s("웹사이트 탐색 및 정보 수집", "browser", "browser", urls[0],
                        "페이지를 열어 목표와 관련된 정보를 수집하세요."))
    elif urls and "web" in tools:
        steps.append(_s("웹 페이지 내용 가져오기", "researcher", "web_fetch", urls[0],
                        "페이지 본문에서 목표와 관련된 정보를 정리하세요."))
    wants_code = ctx.get("template_id") in ("data_cleanup", "code_task") or any(
        h in goal.lower() for h in CODE_HINTS
    )
    if wants_code and "workspace" in tools:
        steps.append(_s("작업 공간에서 데이터 처리 스크립트 실행", "developer", "workspace", goal,
                        "격리된 작업 공간에 스크립트를 만들고 실행해 결과를 확인하세요."))
    if ctx.get("issues"):
        steps.append(_s("검토 의견 반영 보완 조사", "researcher",
                        "knowledge_search" if ctx.get("has_knowledge") else "none", goal,
                        "검토 의견: " + "; ".join(ctx["issues"])))
    if not steps:
        steps.append(_s("목표 분석 및 핵심 질문 정리", "researcher", "none", goal,
                        "목표를 세부 질문으로 나누고 확인해야 할 사항을 정리하세요."))
    steps.append(_s("결과물 작성", "writer", "none", goal,
                    "앞 단계의 결과를 바탕으로 읽기 쉬운 최종 결과물을 작성하세요."))
    summary = f"'{_short(goal)}' 목표를 {len(steps)}단계로 나눠 진행합니다."
    if ctx.get("feedback"):
        summary += f" (요청 반영: {_short(ctx['feedback'])})"
    return {"summary": summary, "steps": steps}


def _s(title: str, role: str, tool: str, input_: str, instructions: str) -> dict[str, str]:
    return {"title": title, "role": role, "tool": tool, "input": input_, "instructions": instructions}


def _step(ctx: dict[str, Any]) -> str:
    role = ctx.get("role")
    result = ctx.get("tool_result") or {}
    goal = ctx.get("goal", "")
    if role == "writer":
        return _write(ctx)
    if role == "developer":
        lines = ["작업 공간에서 수행한 작업:"]
        lines += [f"- 파일 작성: `{f}`" for f in result.get("files", [])]
        for c in result.get("commands", []):
            lines.append(f"- 명령 `{c['command']}` → 종료 코드 {c['exit_code']}")
            if c.get("stdout"):
                lines.append("```\n" + c["stdout"].strip()[:1200] + "\n```")
        return "\n".join(lines)
    if role == "browser" or "text" in result or "error" in result:
        if result.get("error"):
            return f"페이지를 가져오지 못했습니다: {result['error']}"
        sentences = _sentences(result.get("text", ""), 5)
        lines = [f"방문한 페이지: {result.get('title') or '(제목 없음)'} ({result.get('url', '')})", "", "주요 내용:"]
        lines += [f"- {s}" for s in sentences] or ["- 본문에서 의미 있는 문장을 찾지 못했습니다."]
        return "\n".join(lines)
    hits = result.get("hits")
    if hits:
        lines = [f"관련 문서 {len(hits)}건을 찾았습니다.", ""]
        for h in hits[:5]:
            lines.append(f"- **{h['document']}**: {_short(h['text'], 160)}")
        return "\n".join(lines)
    if hits is not None:
        return "지식 베이스에서 관련 문서를 찾지 못했습니다. 일반적인 관점에서 정리합니다.\n\n" + _analysis(goal)
    return _analysis(goal)


def _analysis(goal: str) -> str:
    return "\n".join([
        f"목표 '{_short(goal)}'를 다음 질문으로 나눴습니다.",
        "- 이 작업의 최종 사용자와 기대 결과는 무엇인가?",
        "- 결과물에 반드시 들어가야 할 근거와 수치는 무엇인가?",
        "- 결과를 검증할 기준은 무엇인가?",
    ])


def _write(ctx: dict[str, Any]) -> str:
    goal = ctx.get("goal", "")
    previous = ctx.get("previous", [])
    parts = [f"# {_short(goal, 60)}", "", "## 요약",
             f"총 {len(previous)}개 단계의 결과를 종합했습니다. 아래 근거를 바탕으로 결론과 다음 단계를 정리합니다.", ""]
    parts.append("## 단계별 결과")
    for p in previous:
        parts += [f"### {p['title']}", p["output"].strip(), ""]
    parts += ["## 결론 및 다음 단계",
              "- 수집한 근거를 기준으로 핵심 결론을 확정합니다.",
              "- 부족한 근거가 있으면 지식 베이스에 문서를 추가하거나 출처 URL을 지정해 다시 실행하세요."]
    return "\n".join(parts)


DEMO_SCRIPT = """import csv
import statistics

with open("data.csv", encoding="utf-8") as f:
    rows = list(csv.DictReader(f))

print(f"행 수: {len(rows)}")
by_region = {}
for row in rows:
    by_region.setdefault(row["region"], []).append(int(row["sales"]))
for region, values in sorted(by_region.items()):
    print(f"{region}: 합계 {sum(values):,} / 평균 {statistics.mean(values):,.0f}")

with open("summary.csv", "w", encoding="utf-8", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["region", "total", "average"])
    for region, values in sorted(by_region.items()):
        writer.writerow([region, sum(values), round(statistics.mean(values))])
print("summary.csv 저장 완료")
"""

DEMO_DATA = (
    "month,region,sales\n2026-07,서울,1200\n2026-07,부산,800\n2026-08,서울,1350\n"
    "2026-08,부산,760\n2026-09,서울,1420\n2026-09,부산,910\n"
)


def _develop(ctx: dict[str, Any]) -> dict[str, Any]:
    return {
        "notes": "예시 데이터(data.csv)를 만들고 지역별 합계·평균을 계산하는 스크립트를 실행합니다.",
        "files": [{"path": "data.csv", "content": DEMO_DATA}, {"path": "analyze.py", "content": DEMO_SCRIPT}],
        "commands": ["python analyze.py"],
    }


def _verify(ctx: dict[str, Any]) -> dict[str, Any]:
    draft: str = ctx.get("draft", "")
    issues = []
    if len(draft) < 80:
        issues.append("결과물이 너무 짧습니다.")
    if ctx.get("evidence_count", 0) == 0 and ctx.get("iteration", 0) == 0:
        issues.append("근거 자료가 부족합니다. 보완 조사가 필요합니다.")
    passed = not issues
    return {
        "passed": passed,
        "score": 0.9 if passed else 0.55,
        "issues": issues,
        "summary": "목표에 맞는 구조와 근거를 갖췄습니다." if passed else "보완이 필요합니다.",
    }


def _sentences(text: str, limit: int) -> list[str]:
    parts = re.split(r"(?<=[.!?。])\s+|\n+", text)
    return [p.strip() for p in parts if len(p.strip()) > 20][:limit]


def _short(text: str, n: int = 40) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1] + "…"
