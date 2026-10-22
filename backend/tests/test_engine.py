from conftest import wait_for

from newteam import knowledge
from newteam.apps import create_app
from newteam.db import new_id
from newteam.tools.workspace import Workspace


def make_app(store, **policy):
    base = {"plan_approval": False, "tool_approval": False, "final_approval": False}
    base.update(policy)
    return create_app(store, {"name": "테스트", "policy": base})


def kinds(store, run_id):
    return [e["type"] for e in store.events(run_id)]


def test_full_run_without_approvals_replans_once_then_completes(store, runner):
    app = make_app(store)
    run = runner.start(app, "신규 서비스 출시 체크리스트를 정리해줘")
    done = wait_for(store, run["id"], ("completed", "failed"))
    assert done["status"] == "completed", done.get("error")
    assert done["final"].startswith("# ")
    # 근거가 없으면 데모 검증 담당이 한 번 보완을 요구하고 두 번째 반복에서 통과한다.
    assert done["iteration"] == 1
    assert done["verdict"]["passed"] is True
    assert "replan" in kinds(store, run["id"])
    assert (Workspace(run["id"]).root / "result.md").exists()
    assert done["usage"]["llm_calls"] > 0


def test_plan_approval_interrupt_and_revise(store, runner):
    app = make_app(store, plan_approval=True)
    run = runner.start(app, "팀 회고 진행 방법을 정리해줘")
    waiting = wait_for(store, run["id"])
    assert waiting["status"] == "waiting"
    assert waiting["pending"]["kind"] == "plan_review"

    runner.respond(run["id"], {"action": "revise", "feedback": "더 짧게"})
    waiting = wait_for(store, run["id"])
    assert waiting["status"] == "waiting"
    assert "더 짧게" in waiting["plan_summary"]

    runner.respond(run["id"], {"action": "approve"})
    # 재계획 후 다시 계획 승인을 묻는다.
    again = wait_for(store, run["id"])
    assert again["status"] == "waiting" and again["iteration"] == 1
    runner.respond(run["id"], {"action": "approve"})
    assert wait_for(store, run["id"])["status"] == "completed"


def test_tool_approval_runs_workspace_commands(store, runner):
    app = make_app(store, tool_approval=True)
    run = runner.start(app, "매출 CSV 데이터를 정리하고 지역별 합계를 계산해줘", template_id="data_cleanup")
    waiting = wait_for(store, run["id"])
    assert waiting["pending"]["kind"] == "tool_approval"
    action = waiting["pending"]["action"]
    assert action["kind"] == "workspace" and action["commands"] == ["python analyze.py"]

    runner.respond(run["id"], {"action": "approve"})
    done = wait_for(store, run["id"], ("completed", "failed"))
    assert done["status"] == "completed", done.get("error")
    commands = [e["data"] for e in store.events(run["id"]) if e["type"] == "command"]
    assert commands and commands[0]["exit_code"] == 0, commands
    assert "서울" in commands[0]["stdout"]
    assert (Workspace(run["id"]).root / "summary.csv").exists()


def test_tool_approval_skip(store, runner):
    app = make_app(store, tool_approval=True)
    run = runner.start(app, "파이썬 스크립트로 통계를 계산해줘", template_id="code_task")
    run_ = wait_for(store, run["id"])
    # 건너뛰면 근거가 없어 검증에서 재계획되고, 개발 단계 승인을 다시 묻는다.
    while run_["status"] == "waiting":
        runner.respond(run["id"], {"action": "skip"})
        run_ = wait_for(store, run["id"])
    assert run_["status"] == "completed"
    assert not [e for e in store.events(run["id"]) if e["type"] == "command"]
    skips = [e for e in store.events(run["id"]) if e["type"] == "human" and e["data"]["action"] == "skip"]
    assert len(skips) == 2


def test_knowledge_grounded_run_passes_first_iteration(store, runner):
    kb = store.put("knowledge_bases", {"id": new_id("kb"), "name": "사내 규정"})
    knowledge.add_document(store, kb["id"], "휴가 규정.md", "연차 휴가는 입사 1년 후 15일이 부여됩니다.\n\n휴가 신청은 3일 전까지 팀장 승인을 받아야 합니다.")
    app = create_app(store, {"name": "문서", "knowledge_ids": [kb["id"]],
                             "policy": {"plan_approval": False, "tool_approval": False}})
    run = runner.start(app, "휴가 신청 절차를 알려줘", template_id="doc_qa")
    done = wait_for(store, run["id"], ("completed", "failed"))
    assert done["status"] == "completed", done.get("error")
    assert done["iteration"] == 0
    assert "휴가 규정.md" in done["final"]


def test_final_approval_gate(store, runner):
    app = make_app(store, final_approval=True, verify=False)
    run = runner.start(app, "주간 보고서 초안을 써줘")
    waiting = wait_for(store, run["id"])
    assert waiting["pending"]["kind"] == "final_review"
    assert waiting["pending"]["draft"]
    runner.respond(run["id"], {"action": "approve"})
    assert wait_for(store, run["id"])["status"] == "completed"


def test_cancel_waiting_run(store, runner):
    app = make_app(store, plan_approval=True)
    run = runner.start(app, "아무 작업")
    wait_for(store, run["id"])
    runner.cancel(run["id"])
    assert store.get("runs", run["id"])["status"] == "cancelled"


def test_custom_role_name_and_goal(store, runner, monkeypatch):
    from newteam.crew import role_profile, system_prompt
    from newteam.llm import registry

    app = create_app(store, {"name": "t", "policy": {"plan_approval": False, "tool_approval": False},
                             "roles": {"researcher": {"name": "  법무 검토관 ", "goal": "계약서 위험 조항을 찾는다", "backstory": ""},
                                       "writer": {"name": "x" * 100}}})
    assert app["roles"]["researcher"]["name"] == "법무 검토관"
    assert len(app["roles"]["writer"]["name"]) == 30  # 길이 제한
    # 비워 둔 항목은 기본 정의를 쓴다
    assert role_profile(app, "researcher")["backstory"].startswith("꼼꼼한 리서처")
    assert "'법무 검토관'" in system_prompt(app, "researcher") and "계약서 위험 조항" in system_prompt(app, "researcher")

    prompts = []
    original = registry.PROVIDERS["mock"]["fn"]
    monkeypatch.setitem(registry.PROVIDERS["mock"], "fn", lambda m, req, c: (prompts.append(req), original(m, req, c))[1])
    run = runner.start(app, "계약 검토 체크리스트")
    done = wait_for(store, run["id"], ("completed", "failed"))
    assert done["role_names"]["researcher"] == "법무 검토관"
    assert done["role_names"]["planner"] == "계획 담당"
    plan_prompt = next(r.prompt for r in prompts if r.purpose == "plan")
    assert "researcher(법무 검토관 — 계약서 위험 조항을 찾는다)" in plan_prompt
