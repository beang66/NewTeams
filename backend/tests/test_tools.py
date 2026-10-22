import time

import pytest
from conftest import wait_for

from newteam import knowledge
from newteam.apps import create_app
from newteam.llm import registry
from newteam.llm.base import parse_json
from newteam.tools.workspace import Workspace, WorkspaceError


def test_workspace_blocks_path_escape():
    ws = Workspace("run_test")
    with pytest.raises(WorkspaceError):
        ws.write_file("../outside.txt", "x")
    with pytest.raises(WorkspaceError):
        ws.resolve("/etc/passwd")
    assert ws.write_file("sub/a.txt", "hello") == "sub/a.txt"
    assert ws.read_file("sub/a.txt")["content"] == "hello"


def test_workspace_runs_python_and_blocks_dangerous_commands():
    ws = Workspace("run_cmd")
    ws.write_file("hi.py", "print('안녕')")
    out = ws.run("python hi.py")
    assert out["exit_code"] == 0 and "안녕" in out["stdout"]
    blocked = ws.run("rm -rf /")
    assert blocked["exit_code"] == -1 and "차단" in blocked["stderr"]
    assert ws.run("python ../x.py")["exit_code"] == -1


def test_chunking_and_korean_search(store):
    text = "\n\n".join(f"문단 {i}: " + "내용 " * 50 for i in range(10))
    chunks = knowledge.chunk_text(text, size=300, overlap=50)
    assert len(chunks) > 3 and all(len(c) <= 400 for c in chunks)

    kb = store.put("knowledge_bases", {"id": "kb_1", "name": "kb"})
    knowledge.add_document(store, kb["id"], "a.md", "환불은 구매 후 7일 이내에 가능합니다.")
    knowledge.add_document(store, kb["id"], "b.md", "배송은 평균 2일이 걸립니다.")
    hits = knowledge.search(store, ["kb_1"], "환불 가능 기간")
    assert hits[0]["document"] == "a.md"


def test_parse_json_variants():
    assert parse_json('{"a": 1}') == {"a": 1}
    assert parse_json('설명\n```json\n{"a": 2}\n```') == {"a": 2}
    assert parse_json('결과: {"a": 3} 끝') == {"a": 3}


def test_pause_and_resume(store, runner, monkeypatch):
    original = registry.PROVIDERS["mock"]["fn"]

    def slow(model, req, config):
        time.sleep(0.15)
        return original(model, req, config)

    monkeypatch.setitem(registry.PROVIDERS["mock"], "fn", slow)
    app = create_app(store, {"name": "t", "policy": {"plan_approval": False, "tool_approval": False}})
    run = runner.start(app, "느린 작업")
    time.sleep(0.05)
    runner.pause(run["id"])
    paused = wait_for(store, run["id"], ("paused", "completed"))
    assert paused["status"] == "paused"
    next_nodes = runner.state(run["id"])["next"]
    assert next_nodes  # 체크포인트에 다음 단계가 남아 있다

    runner.resume(run["id"])
    done = wait_for(store, run["id"], ("completed", "failed"))
    assert done["status"] == "completed", done.get("error")


def test_failed_step_can_be_retried(store, runner, monkeypatch):
    original = registry.PROVIDERS["mock"]["fn"]
    calls = {"n": 0}

    def flaky(model, req, config):
        if req.purpose == "verify" and calls["n"] == 0:
            calls["n"] += 1
            raise registry.LLMError("일시적인 오류")
        return original(model, req, config)

    monkeypatch.setitem(registry.PROVIDERS["mock"], "fn", flaky)
    app = create_app(store, {"name": "t", "policy": {"plan_approval": False, "tool_approval": False}})
    run = runner.start(app, "재시도 테스트")
    failed = wait_for(store, run["id"], ("failed", "completed"))
    assert failed["status"] == "failed" and "일시적인 오류" in failed["error"]
    runner.resume(run["id"])
    assert wait_for(store, run["id"], ("completed", "failed"))["status"] == "completed"
