"""LangGraph 실행 그래프 — 전체 실행 흐름을 관리하는 핵심 엔진.

    retrieve → plan → review_plan ─(사람 승인)→ prepare → approve_step ─(위험 도구 승인)→ run_step
                 ▲                                ▲                                         │
                 │                                └──────────── 다음 단계 ───────────────────┤
                 └──── 검증 실패 / 사람의 수정 요청 ──── verify ←──── 모든 단계 완료 ─────────┘
                                                         │
                                                  final_review ─(사람 승인)→ finalize → END

사람의 개입이 필요한 지점은 langgraph.types.interrupt()로 멈추고, 체크포인트에 상태가
저장되므로 서버를 재시작해도 같은 지점에서 이어서 실행할 수 있다.
"""

from __future__ import annotations

import json
from typing import Any, Callable, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from .. import knowledge
from ..config import settings
from ..crew import ROLES, STEP_ROLES, role_enabled, role_model, role_profile, system_prompt
from ..db import Store
from ..llm import LLMError, LLMRequest, LLMResult
from ..llm import registry as llm_registry
from ..tools import browser, web
from ..tools.workspace import Workspace, openhands_available, run_openhands

RISKY_ACTIONS = ("workspace", "browser", "openhands")


class RunState(TypedDict, total=False):
    run_id: str
    goal: str
    template_id: str | None
    app: dict[str, Any]
    knowledge: list[dict[str, Any]]
    plan_summary: str
    plan: list[dict[str, Any]]
    cursor: int
    pending: dict[str, Any] | None
    outputs: list[dict[str, Any]]
    draft: str
    iteration: int
    verdict: dict[str, Any] | None
    feedback: str
    final: str


PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "role": {"type": "string", "enum": list(STEP_ROLES)},
                    "tool": {"type": "string", "enum": ["none", "knowledge_search", "web_fetch", "browser", "workspace"]},
                    "input": {"type": "string"},
                    "instructions": {"type": "string"},
                },
                "required": ["title", "role", "tool", "input", "instructions"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "steps"],
    "additionalProperties": False,
}

DEVELOP_SCHEMA = {
    "type": "object",
    "properties": {
        "notes": {"type": "string"},
        "files": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                "required": ["path", "content"],
                "additionalProperties": False,
            },
        },
        "commands": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["notes", "files", "commands"],
    "additionalProperties": False,
}

VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "passed": {"type": "boolean"},
        "score": {"type": "number"},
        "issues": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
    },
    "required": ["passed", "score", "issues", "summary"],
    "additionalProperties": False,
}


class Services:
    """그래프 노드가 쓰는 외부 자원(저장소, 모델, 이벤트)을 한곳에 모은다."""

    def __init__(self, store: Store, on_event: Callable[[dict[str, Any]], None] | None = None):
        self.store = store
        self.on_event = on_event

    def emit(self, run_id: str, type_: str, **data: Any) -> None:
        event = self.store.add_event(run_id, type_, data)
        if self.on_event:
            self.on_event(event)

    def llm(self, state: RunState, role: str, req: LLMRequest) -> LLMResult:
        app = state["app"]
        req.effort = req.effort or app.get("effort")
        model_ref = role_model(app, role)
        if not model_ref.startswith("anthropic:"):
            req.effort = None
        res = llm_registry.complete(self.store, model_ref, req)
        self._add_usage(state["run_id"], llm_calls=1, input_tokens=res.input_tokens, output_tokens=res.output_tokens)
        self.emit(state["run_id"], "llm", role=role, purpose=req.purpose, model=res.model,
                  input_tokens=res.input_tokens, output_tokens=res.output_tokens)
        return res

    def count_tool(self, run_id: str) -> None:
        self._add_usage(run_id, tool_calls=1)

    def _add_usage(self, run_id: str, **delta: int) -> None:
        run = self.store.get("runs", run_id)
        if run is None:
            return
        usage = run.get("usage") or {}
        for key, value in delta.items():
            usage[key] = usage.get(key, 0) + value
        self.store.update("runs", run_id, usage=usage)


# ---------------------------------------------------------------- 도우미

def _clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[:n] + " …(생략)"


def _tools_enabled(app: dict[str, Any]) -> list[str]:
    tools = app.get("tools") or {}
    enabled = [k for k in ("knowledge", "web", "browser", "workspace") if tools.get(k)]
    if not role_enabled(app, "browser"):
        enabled = [t for t in enabled if t != "browser"]
    if not role_enabled(app, "developer"):
        enabled = [t for t in enabled if t != "workspace"]
    return enabled


def normalize_plan(raw_steps: list[dict[str, Any]], app: dict[str, Any], iteration: int, goal: str) -> list[dict[str, Any]]:
    """모델이 만든 계획을 앱 설정(켜진 도구·역할, 최대 단계 수)에 맞게 정리한다."""
    tools = _tools_enabled(app)
    has_kb = "knowledge" in tools and bool(app.get("knowledge_ids"))
    steps: list[dict[str, Any]] = []
    for raw in raw_steps:
        role = raw.get("role") if raw.get("role") in STEP_ROLES else "researcher"
        tool = raw.get("tool") or "none"
        if role == "browser":
            if "browser" in tools:
                tool = "browser"
            elif "web" in tools and web.find_urls(raw.get("input", "")):
                role, tool = "researcher", "web_fetch"
            else:
                continue
        elif role == "developer":
            if "workspace" not in tools:
                continue
            tool = "workspace"
        elif role == "writer":
            tool = "none"
        else:
            if tool == "knowledge_search" and not has_kb:
                tool = "none"
            if tool == "web_fetch" and "web" not in tools:
                tool = "none"
            if tool not in ("knowledge_search", "web_fetch"):
                tool = "none"
        steps.append({
            "title": str(raw.get("title") or ROLES[role].name).strip(),
            "role": role,
            "tool": tool,
            "input": str(raw.get("input") or "").strip(),
            "instructions": str(raw.get("instructions") or "").strip(),
        })
    max_steps = app["policy"]["max_steps"]
    writers = [s for s in steps if s["role"] == "writer"]
    body = [s for s in steps if s["role"] != "writer"][: max_steps - 1]
    final = writers[-1] if writers else {
        "title": "결과물 작성", "role": "writer", "tool": "none", "input": goal,
        "instructions": "앞 단계 결과를 종합해 최종 결과물을 작성하세요.",
    }
    out = body + [final]
    for i, step in enumerate(out):
        step.update({"id": f"i{iteration}s{i + 1}", "status": "pending", "output": ""})
    return out


def render_tool_result(result: dict[str, Any] | None) -> str:
    if not result:
        return "(도구를 사용하지 않는 단계입니다)"
    if result.get("error"):
        return f"오류: {result['error']}"
    if "hits" in result:
        if not result["hits"]:
            return "검색 결과 없음"
        return "\n\n".join(f"[{h['document']} #{h['chunk']}] (점수 {h['score']})\n{h['text']}" for h in result["hits"])
    if "commands" in result or "files" in result:
        lines = [f"작성한 파일: {', '.join(result.get('files', [])) or '없음'}"]
        for c in result.get("commands", []):
            lines.append(f"$ {c['command']}  (종료 코드 {c['exit_code']})\n{c['stdout']}\n{c['stderr']}".strip())
        return "\n\n".join(lines)
    if "text" in result:
        return f"주소: {result.get('url', '')}\n제목: {result.get('title', '')}\n\n{_clip(result['text'], 8000)}"
    return json.dumps(result, ensure_ascii=False)[:8000]


def _evidence_block(state: RunState, limit: int = 3) -> str:
    hits = state.get("knowledge") or []
    if not hits:
        return "(지식 베이스 근거 없음)"
    return "\n\n".join(f"[{h['document']}] {_clip(h['text'], 600)}" for h in hits[:limit])


def _previous_block(outputs: list[dict[str, Any]], limit: int = 2500) -> str:
    if not outputs:
        return "(아직 없음)"
    return "\n\n".join(f"### {o['title']} ({ROLES[o['role']].name})\n{_clip(o['output'], limit)}" for o in outputs)


def _next(cursor: int, plan: list[dict[str, Any]]) -> str:
    return "prepare" if cursor < len(plan) else "verify"


# ---------------------------------------------------------------- 그래프

def build_graph(services: Services) -> StateGraph:
    store = services.store

    def retrieve(state: RunState) -> dict[str, Any]:
        app = state["app"]
        kb_ids = app.get("knowledge_ids") or []
        if not kb_ids or not (app.get("tools") or {}).get("knowledge"):
            return {"knowledge": []}
        hits = knowledge.search(store, kb_ids, state["goal"], top_k=app.get("retrieval_top_k", 5))
        services.emit(state["run_id"], "knowledge", query=state["goal"],
                      hits=[{"document": h["document"], "score": h["score"], "text": _clip(h["text"], 200)} for h in hits])
        return {"knowledge": hits}

    def plan(state: RunState) -> dict[str, Any]:
        app = state["app"]
        iteration = state.get("iteration", 0)
        verdict = state.get("verdict") or {}
        issues = verdict.get("issues", []) if verdict and not verdict.get("passed") else []
        tools = _tools_enabled(app)
        has_kb = "knowledge" in tools and bool(app.get("knowledge_ids"))
        def who(key: str) -> str:
            profile = role_profile(app, key)
            return f"{key}({profile['name']} — {profile['goal']})"

        role_lines = [
            f"- {who('researcher')}: tool=knowledge_search(input=검색어)"
            + (" / web_fetch(input=URL)" if "web" in tools else "") + " / none",
        ]
        if "browser" in tools:
            role_lines.append(f"- {who('browser')}: tool=browser(input=시작 URL과 할 일)")
        if "workspace" in tools:
            role_lines.append(f"- {who('developer')}: tool=workspace(input=작업 공간에서 할 개발·데이터 처리 작업)")
        role_lines.append(f"- {who('writer')}: tool=none, 마지막 단계에서 최종 결과물 작성")
        prompt = "\n".join([
            f"## 목표\n{state['goal']}",
            "\n## 맡길 수 있는 담당과 도구\n" + "\n".join(role_lines),
            f"\n## 지식 베이스 사용 가능 여부\n{'사용 가능' if has_kb else '사용 불가 — knowledge_search를 쓰지 마세요'}",
            f"\n## 지식 베이스 근거 미리보기\n{_evidence_block(state)}",
            f"\n## 이전 반복의 결과\n{_previous_block(state.get('outputs') or [], 800)}" if iteration else "",
            f"\n## 사람의 요청\n{state['feedback']}" if state.get("feedback") else "",
            "\n## 검증 담당의 지적\n" + "\n".join(f"- {i}" for i in issues) if issues else "",
            f"\n## 규칙\n- 단계는 {app['policy']['max_steps']}개 이하, 마지막 단계는 반드시 writer.",
            "- instructions에는 그 단계의 완료 기준을 구체적으로 적으세요.",
            "- 위 목록에 없는 도구는 쓰지 마세요.",
            "- summary에는 계획 전체를 한두 문장으로 요약하세요.",
        ])
        res = services.llm(state, "planner", LLMRequest(
            system=system_prompt(app, "planner"),
            prompt=prompt,
            purpose="plan",
            json_schema=PLAN_SCHEMA,
            context={
                "goal": state["goal"], "template_id": state.get("template_id"), "tools": tools,
                "urls": web.find_urls(state["goal"]), "has_knowledge": has_kb,
                "feedback": state.get("feedback", ""), "issues": issues, "iteration": iteration,
            },
        ))
        data = res.json()
        steps = normalize_plan(data.get("steps") or [], app, iteration, state["goal"])
        summary = str(data.get("summary") or "")
        services.emit(state["run_id"], "plan", summary=summary, steps=steps, iteration=iteration)
        return {"plan": steps, "plan_summary": summary, "cursor": 0, "pending": None, "feedback": ""}

    def review_plan(state: RunState) -> Command:
        if not state["app"]["policy"]["plan_approval"]:
            return Command(goto="prepare")
        decision = interrupt({"kind": "plan_review", "summary": state.get("plan_summary", ""), "plan": state["plan"]})
        action = (decision or {}).get("action", "approve")
        run_id = state["run_id"]
        if action == "revise":
            services.emit(run_id, "human", kind="plan_review", action="revise", feedback=decision.get("feedback", ""))
            return Command(goto="plan", update={"feedback": decision.get("feedback", "")})
        if action == "edit" and decision.get("plan"):
            steps = normalize_plan(decision["plan"], state["app"], state.get("iteration", 0), state["goal"])
            services.emit(run_id, "human", kind="plan_review", action="edit", steps=steps)
            return Command(goto="prepare", update={"plan": steps})
        services.emit(run_id, "human", kind="plan_review", action="approve")
        return Command(goto="prepare")

    def prepare(state: RunState) -> dict[str, Any]:
        app, run_id = state["app"], state["run_id"]
        plan_ = [dict(s) for s in state["plan"]]
        step = plan_[state["cursor"]]
        step["status"] = "running"
        services.emit(run_id, "step_started", step=step, index=state["cursor"], total=len(plan_))
        sender = "planner" if state["cursor"] == 0 else plan_[state["cursor"] - 1]["role"]
        services.emit(
            run_id,
            "agent_message",
            sender=sender,
            recipient=step["role"],
            kind="delegate",
            title=step["title"],
            message=step["instructions"] or step["input"] or "계획에 따라 다음 단계를 진행하세요.",
        )

        if step["role"] == "developer":
            if (app.get("tools") or {}).get("workspace_engine") == "openhands":
                pending = {"kind": "openhands", "instruction": f"{state['goal']}\n\n이번 단계: {step['title']}\n{step['instructions']}"}
            else:
                ws = Workspace(run_id)
                files = ", ".join(f["path"] for f in ws.list_files()) or "(비어 있음)"
                res = services.llm(state, "developer", LLMRequest(
                    system=system_prompt(app, "developer"),
                    prompt="\n".join([
                        f"## 전체 목표\n{state['goal']}",
                        f"\n## 이번 단계: {step['title']}\n{step['instructions']}\n입력: {step['input']}",
                        f"\n## 작업 공간의 현재 파일\n{files}",
                        f"\n## 앞 단계 결과\n{_previous_block(state.get('outputs') or [], 1500)}",
                        "\n## 출력 형식",
                        "작업 공간 폴더에 만들 파일(files)과 그 폴더에서 차례로 실행할 셸 명령(commands)을 JSON으로 제시하세요.",
                        "- 파일 경로는 작업 공간 기준 상대 경로만 사용합니다.",
                        "- 명령은 `python 파일명.py`처럼 짧게 쓰세요.",
                        "- 필요한 패키지는 `pip install 패키지` 명령으로 먼저 설치할 수 있습니다(허용된 패키지 저장소만 접속 가능)."
                        if settings.sandbox == "docker" and settings.sandbox_allowlist else
                        "- 인터넷에 접속할 수 없고 표준 라이브러리만 쓸 수 있습니다.",
                        "- 입력 데이터가 없으면 현실적인 예시 데이터를 파일로 함께 만드세요.",
                    ]),
                    purpose="develop",
                    json_schema=DEVELOP_SCHEMA,
                    context={"goal": state["goal"], "step": step},
                ))
                data = res.json()
                pending = {
                    "kind": "workspace",
                    "notes": data.get("notes", ""),
                    "files": [f for f in data.get("files", []) if f.get("path")],
                    "commands": [c for c in data.get("commands", []) if c.strip()],
                }
        elif step["tool"] == "browser":
            urls = web.find_urls(step["input"]) or web.find_urls(state["goal"])
            pending = {"kind": "browser", "task": f"{step['instructions']}\n{step['input']}".strip(), "url": urls[0] if urls else None}
        elif step["tool"] == "knowledge_search":
            pending = {"kind": "knowledge_search", "query": step["input"] or state["goal"]}
        elif step["tool"] == "web_fetch":
            urls = web.find_urls(step["input"]) or web.find_urls(state["goal"])
            pending = {"kind": "web_fetch", "url": urls[0] if urls else ""}
        else:
            pending = {"kind": "none"}
        return {"plan": plan_, "pending": pending}

    def approve_step(state: RunState) -> Command:
        pending = state.get("pending") or {"kind": "none"}
        policy = state["app"]["policy"]
        if not (policy["tool_approval"] and pending["kind"] in RISKY_ACTIONS):
            return Command(goto="run_step")
        step = state["plan"][state["cursor"]]
        decision = interrupt({"kind": "tool_approval", "step": step, "action": pending})
        action = (decision or {}).get("action", "approve")
        run_id = state["run_id"]
        if action == "skip":
            plan_ = [dict(s) for s in state["plan"]]
            plan_[state["cursor"]].update(status="skipped", output="사람이 이 단계를 건너뛰었습니다.")
            services.emit(run_id, "human", kind="tool_approval", action="skip", step_id=step["id"])
            cursor = state["cursor"] + 1
            return Command(goto=_next(cursor, plan_), update={"plan": plan_, "cursor": cursor, "pending": None})
        if action == "edit" and pending["kind"] == "workspace" and isinstance(decision.get("commands"), list):
            pending = {**pending, "commands": [c for c in decision["commands"] if c.strip()]}
            services.emit(run_id, "human", kind="tool_approval", action="edit", commands=pending["commands"])
        else:
            services.emit(run_id, "human", kind="tool_approval", action="approve", step_id=step["id"])
        return Command(goto="run_step", update={"pending": pending})

    def execute_tool(state: RunState, pending: dict[str, Any]) -> dict[str, Any] | None:
        run_id, kind = state["run_id"], pending["kind"]
        if kind == "none":
            return None
        services.count_tool(run_id)
        if kind == "knowledge_search":
            hits = knowledge.search(store, state["app"].get("knowledge_ids") or [], pending["query"],
                                    top_k=state["app"].get("retrieval_top_k", 5))
            services.emit(run_id, "tool", tool="knowledge_search", query=pending["query"],
                          hits=[{"document": h["document"], "score": h["score"]} for h in hits])
            return {"hits": hits}
        if kind == "web_fetch":
            if not pending.get("url"):
                return {"error": "가져올 URL이 없습니다."}
            page = web.fetch(pending["url"])
            services.emit(run_id, "browser", mode="fetch", url=page.get("url"), title=page.get("title", ""),
                          error=page.get("error"), preview=_clip(page.get("text", ""), 500))
            return page
        provider_id, model, cfg = llm_registry.provider_config(store, role_model(state["app"], "developer" if kind != "browser" else "browser"))
        if kind == "browser":
            page = browser.run_task(pending["task"], pending.get("url"), provider_id, model, cfg)
            services.emit(run_id, "browser", mode=page.get("mode"), url=page.get("url"), title=page.get("title", ""),
                          error=page.get("error"), note=page.get("note", ""), actions=page.get("actions", []),
                          preview=_clip(page.get("text", ""), 500))
            return page
        ws = Workspace(run_id)
        if kind == "openhands":
            if not openhands_available():
                return {"error": "OpenHands SDK가 설치되어 있지 않습니다. `pip install openhands-sdk openhands-tools` 후 다시 시도하거나 앱 설정에서 내장 실행기를 선택하세요."}
            result = run_openhands(ws, pending["instruction"], provider_id, model, cfg)
            for path in result["files"]:
                services.emit(run_id, "file_written", path=path, engine="openhands")
            return result
        written = []
        for f in pending.get("files", []):
            path = ws.write_file(f["path"], f.get("content", ""))
            written.append(path)
            services.emit(run_id, "file_written", path=path, size=len(f.get("content", "")))
        commands = []
        for command in pending.get("commands", []):
            out = ws.run(command)
            commands.append(out)
            services.emit(run_id, "command", **out)
        return {"files": written, "commands": commands}

    def run_step(state: RunState) -> Command:
        app, run_id = state["app"], state["run_id"]
        cursor = state["cursor"]
        plan_ = [dict(s) for s in state["plan"]]
        step = plan_[cursor]
        pending = state.get("pending") or {"kind": "none"}
        try:
            tool_result = execute_tool(state, pending)
        except Exception as e:  # 도구 실패는 단계 결과로 남기고 계속 진행한다
            tool_result = {"error": str(e)}
            services.emit(run_id, "tool_error", step_id=step["id"], error=str(e))

        outputs = list(state.get("outputs") or [])
        prior = [o for o in outputs if o["role"] != "writer"]
        is_writer = step["role"] == "writer"
        prompt = "\n".join([
            f"## 전체 목표\n{state['goal']}",
            f"\n## 이번 단계: {step['title']}\n{step['instructions']}",
            f"\n## 도구 실행 결과\n{render_tool_result(tool_result)}" if not is_writer else "",
            f"\n## 앞 단계 결과\n{_previous_block(prior if is_writer else outputs[-4:])}",
            f"\n## 지식 베이스 근거\n{_evidence_block(state, 5)}",
            f"\n## 이전 초안\n{_clip(state['draft'], 4000)}" if is_writer and state.get("draft") else "",
            f"\n## 검증 담당의 지적\n" + "\n".join(f"- {i}" for i in (state.get("verdict") or {}).get("issues", []))
            if is_writer and state.get("verdict") and not state["verdict"].get("passed") else "",
            "\n## 출력",
            "최종 결과물 전체를 마크다운으로 작성하세요. 근거로 쓴 문서나 URL을 밝히세요."
            if is_writer else
            "이번 단계의 결과만 마크다운으로 간결하게 정리하세요. 도구 결과에 없는 사실은 지어내지 마세요.",
        ])
        res = services.llm(state, step["role"], LLMRequest(
            system=system_prompt(app, step["role"]),
            prompt=prompt,
            purpose="step",
            context={
                "role": step["role"], "goal": state["goal"], "step": step, "tool_result": tool_result,
                "previous": [{"title": o["title"], "output": o["output"]} for o in prior],
            },
        ))
        output = res.text.strip()
        step.update(status="failed" if tool_result and tool_result.get("error") and not is_writer else "done", output=output)
        outputs.append({
            "step_id": step["id"], "title": step["title"], "role": step["role"], "tool": step["tool"],
            "iteration": state.get("iteration", 0), "output": output,
            "has_evidence": bool(tool_result and not tool_result.get("error") and (tool_result.get("hits") or tool_result.get("text") or tool_result.get("commands"))),
        })
        services.emit(run_id, "step_completed", step_id=step["id"], title=step["title"], role=step["role"],
                      status=step["status"], output=output)
        recipient = plan_[cursor + 1]["role"] if cursor + 1 < len(plan_) else "verifier"
        services.emit(
            run_id,
            "agent_message",
            sender=step["role"],
            recipient=recipient,
            kind="handoff",
            title=f"{step['title']} 결과 전달",
            message=_clip(output, 700),
            artifacts=(tool_result or {}).get("files", []),
        )
        update: dict[str, Any] = {"plan": plan_, "cursor": cursor + 1, "outputs": outputs, "pending": None}
        if is_writer:
            update["draft"] = output
        return Command(goto=_next(cursor + 1, plan_), update=update)

    def verify(state: RunState) -> Command:
        app, run_id = state["app"], state["run_id"]
        iteration = state.get("iteration", 0)
        if not app["policy"]["verify"] or not role_enabled(app, "verifier"):
            return Command(goto="final_review")
        outputs = state.get("outputs") or []
        evidence = len(state.get("knowledge") or []) + sum(1 for o in outputs if o.get("has_evidence"))
        res = services.llm(state, "verifier", LLMRequest(
            system=system_prompt(app, "verifier"),
            prompt="\n".join([
                f"## 목표\n{state['goal']}",
                f"\n## 검토할 결과물\n{state.get('draft') or '(결과물 없음)'}",
                f"\n## 실행 단계에서 확보한 근거\n{_previous_block([o for o in outputs if o['role'] != 'writer'], 1200)}",
                f"\n## 지식 베이스 근거\n{_evidence_block(state, 5)}",
                "\n## 판단 기준",
                "- 목표가 요구한 내용을 빠짐없이 다뤘는가",
                "- 주장마다 근거가 있고 근거와 모순되지 않는가",
                "- 읽는 사람이 바로 활용할 수 있는 형태인가",
                "passed는 세 기준을 모두 만족할 때만 true, score는 0~1, issues에는 고칠 점을 구체적으로 적으세요.",
            ]),
            purpose="verify",
            json_schema=VERDICT_SCHEMA,
            context={"goal": state["goal"], "draft": state.get("draft", ""), "iteration": iteration, "evidence_count": evidence},
        ))
        data = res.json()
        verdict = {
            "passed": bool(data.get("passed")),
            "score": float(data.get("score") or 0),
            "issues": [str(i) for i in data.get("issues") or []],
            "summary": str(data.get("summary") or ""),
            "iteration": iteration,
        }
        services.emit(run_id, "verdict", **verdict)
        services.emit(
            run_id,
            "agent_message",
            sender="verifier",
            recipient="planner" if not verdict["passed"] else "human",
            kind="review",
            title="검증 결과 전달",
            message=verdict["summary"] + ("\n" + "\n".join(f"- {issue}" for issue in verdict["issues"]) if verdict["issues"] else ""),
        )
        if not verdict["passed"] and iteration + 1 < app["policy"]["max_iterations"]:
            services.emit(run_id, "replan", iteration=iteration + 1, reason=verdict["issues"])
            return Command(goto="plan", update={"verdict": verdict, "iteration": iteration + 1})
        return Command(goto="final_review", update={"verdict": verdict})

    def final_review(state: RunState) -> Command:
        if not state["app"]["policy"]["final_approval"]:
            return Command(goto="finalize")
        decision = interrupt({"kind": "final_review", "draft": state.get("draft", ""), "verdict": state.get("verdict")})
        action = (decision or {}).get("action", "approve")
        if action == "revise":
            services.emit(state["run_id"], "human", kind="final_review", action="revise", feedback=decision.get("feedback", ""))
            return Command(goto="plan", update={"feedback": decision.get("feedback", ""), "iteration": state.get("iteration", 0) + 1})
        services.emit(state["run_id"], "human", kind="final_review", action="approve")
        return Command(goto="finalize")

    def finalize(state: RunState) -> dict[str, Any]:
        final = state.get("draft") or "(결과물이 작성되지 않았습니다)"
        Workspace(state["run_id"]).write_file("result.md", final)
        services.emit(state["run_id"], "file_written", path="result.md", size=len(final))
        run = store.get("runs", state["run_id"]) or {}
        destinations = [
            {"kind": "workspace", "label": "실행 작업 공간", "path": "result.md"},
            {"kind": "history", "label": "실행 기록", "path": f"/runs/{state['run_id']}"},
        ]
        if run.get("project_id"):
            for kb in store.list("knowledge_bases", project_id=run["project_id"])[:1]:
                doc = knowledge.add_document(store, kb["id"], f"[실행 결과] {state['goal'][:60]}", final)
                store.update("documents", doc["id"], run_id=state["run_id"])
                destinations.append({"kind": "knowledge", "label": f"프로젝트 저장소 · {kb['name']}", "path": "/knowledge"})
            destinations.append({
                "kind": "project",
                "label": f"프로젝트 · {run.get('project_name') or '이름 없음'}",
                "path": f"/projects/{run['project_id']}",
            })
        services.emit(state["run_id"], "artifact_stored", name="result.md", destinations=destinations)
        return {"final": final}

    builder = StateGraph(RunState)
    builder.add_node("retrieve", retrieve)
    builder.add_node("plan", plan)
    builder.add_node("review_plan", review_plan, destinations=("plan", "prepare"))
    builder.add_node("prepare", prepare)
    builder.add_node("approve_step", approve_step, destinations=("run_step", "prepare", "verify"))
    builder.add_node("run_step", run_step, destinations=("prepare", "verify"))
    builder.add_node("verify", verify, destinations=("plan", "final_review"))
    builder.add_node("final_review", final_review, destinations=("plan", "finalize"))
    builder.add_node("finalize", finalize)
    builder.add_edge(START, "retrieve")
    builder.add_edge("retrieve", "plan")
    builder.add_edge("plan", "review_plan")
    builder.add_edge("prepare", "approve_step")
    builder.add_edge("finalize", END)
    return builder


__all__ = ["RunState", "Services", "build_graph", "normalize_plan", "LLMError"]
