import time

import pytest
from fastapi.testclient import TestClient

from newteam.api import create_app


ADMIN = {"name": "관리자", "email": "admin@example.com", "password": "admin-pass-1"}


@pytest.fixture
def client():
    with TestClient(create_app()) as c:
        assert c.post("/api/auth/setup", json=ADMIN).status_code == 200
        yield c


def wait_status(client, run_id, statuses=("waiting", "completed", "failed"), timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in statuses:
            return run
        time.sleep(0.05)
    raise AssertionError("timeout")


def test_meta_and_seeded_apps(client):
    meta = client.get("/api/meta").json()
    assert {t["id"] for t in meta["templates"]} >= {"market_research", "data_cleanup"}
    assert {r["key"] for r in meta["roles"]} >= {"planner", "researcher", "writer", "verifier"}
    apps = client.get("/api/apps").json()
    assert len(apps) == 5
    assert {a.get("seed_key") for a in apps} >= {
        "campaign_ops", "brand_experience", "spatial_media",
    }


def app_named(client, prefix):
    return next(a for a in client.get("/api/apps").json() if a["name"].startswith(prefix))


def test_app_update_is_deep_merged(client):
    app = app_named(client, "리서치")
    updated = client.put(f"/api/apps/{app['id']}", json={"policy": {"max_iterations": 9}, "roles": {"writer": {"instructions": "표를 쓰세요"}}}).json()
    assert updated["policy"]["max_iterations"] == 5  # 상한 적용
    assert updated["policy"]["plan_approval"] is True  # 다른 값은 유지
    assert updated["roles"]["writer"]["instructions"] == "표를 쓰세요"
    assert updated["roles"]["verifier"]["enabled"] is True


def test_run_lifecycle_over_http(client):
    app = app_named(client, "리서치")  # 계획 승인이 필요한 앱
    run = client.post("/api/runs", json={"app_id": app["id"], "goal": "고객 인터뷰 질문지를 만들어줘"}).json()
    waiting = wait_status(client, run["id"])
    assert waiting["status"] == "waiting" and waiting["pending"]["kind"] == "plan_review"

    edited = [dict(s, title="질문 범위 정하기") if s["role"] != "writer" else s for s in waiting["plan"]]
    client.post(f"/api/runs/{run['id']}/respond", json={"action": "edit", "plan": edited})
    waiting = wait_status(client, run["id"])
    titles = [e["data"]["title"] for e in client.get(f"/api/runs/{run['id']}/events").json() if e["type"] == "step_completed"]
    assert titles[0] == "질문 범위 정하기"
    while waiting["status"] == "waiting":
        client.post(f"/api/runs/{run['id']}/respond", json={"action": "approve"})
        waiting = wait_status(client, run["id"])
    assert waiting["status"] == "completed"

    events = client.get(f"/api/runs/{run['id']}/events").json()
    assert events[0]["type"] == "status"
    assert {event["type"] for event in events} >= {"user_instruction", "agent_message", "artifact_stored"}
    files = client.get(f"/api/runs/{run['id']}/files").json()
    assert any(f["path"] == "result.md" for f in files)
    content = client.get(f"/api/runs/{run['id']}/files/content", params={"path": "result.md"}).json()
    assert content["content"].startswith("# ")
    assert client.get(f"/api/runs/{run['id']}/files/content", params={"path": "../../x"}).status_code == 400

    stats = client.get("/api/stats").json()
    assert stats["total"] == 1 and stats["by_status"] == {"completed": 1}


def test_knowledge_upload_and_search(client):
    kb = client.post("/api/knowledge", json={"name": "제품 문서"}).json()
    up = client.post(f"/api/knowledge/{kb['id']}/documents",
                     files={"file": ("pricing.md", "# 요금제\n\n프로 요금제는 월 29,000원입니다.\n\n팀 요금제는 사용자당 월 15,000원입니다.".encode())})
    assert up.status_code == 200 and up.json()["chunk_count"] >= 1
    hits = client.post("/api/knowledge/search", json={"kb_ids": [kb["id"]], "query": "팀 요금제 가격"}).json()
    assert hits and "팀 요금제" in hits[0]["text"]
    kbs = client.get("/api/knowledge").json()
    assert kbs[0]["documents"] == 1


def test_provider_settings_mask_key(client):
    client.put("/api/providers/compat", json={"api_key": "sk-test-1234567890abcd", "base_url": "http://localhost:11434/v1", "models": "llama3, qwen3"})
    providers = {p["id"]: p for p in client.get("/api/providers").json()}
    assert providers["compat"]["models"] == ["compat:llama3", "compat:qwen3"]
    assert "1234567890" not in providers["compat"]["config"]["api_key_preview"]
    assert client.post("/api/providers/test", json={"model": "mock:demo"}).json()["ok"] is True


def test_project_assets_comments_and_member_access(client):
    member = client.post("/api/users", json={
        "name": "브랜드 디자이너",
        "email": "designer@example.com",
        "password": "designer-pass-1",
        "role": "member",
    }).json()
    project = client.post("/api/projects", json={
        "name": "강남역 브랜드 캠페인",
        "client": "샘플 브랜드",
        "status": "active",
        "member_ids": [member["id"]],
    }).json()
    assert project["member_names"] == ["관리자", "브랜드 디자이너"]
    assert project["can_edit"] is True

    png = b"\x89PNG\r\n\x1a\n" + b"test-image-content"
    uploaded = client.post(
        f"/api/projects/{project['id']}/assets",
        files={"file": ("메인 시안.png", png, "image/png")},
    )
    assert uploaded.status_code == 200
    asset = uploaded.json()
    comment = client.post(
        f"/api/projects/{project['id']}/assets/{asset['id']}/comments",
        json={"body": "로고를 조금 더 키워주세요.", "x": 42.5, "y": 31.0},
    )
    assert comment.status_code == 200
    assert comment.json()["x"] == 42.5

    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={
        "email": "designer@example.com",
        "password": "designer-pass-1",
    }).status_code == 200
    visible = client.get(f"/api/projects/{project['id']}")
    assert visible.status_code == 200 and visible.json()["can_edit"] is False
    assert client.get(f"/api/projects/{project['id']}/assets/{asset['id']}/content").content == png
    reply = client.post(
        f"/api/projects/{project['id']}/assets/{asset['id']}/comments",
        json={"body": "수정 시안에서 반영하겠습니다."},
    )
    assert reply.status_code == 200
    assert len(client.get(f"/api/projects/{project['id']}/assets/{asset['id']}/comments").json()) == 2


def test_project_run_is_linked_to_repository(client):
    project = client.post("/api/projects", json={"name": "옥외 미디어 테스트"}).json()
    app = app_named(client, "리서치")
    created = client.post("/api/runs", json={
        "app_id": app["id"],
        "goal": "현장 가독성 점검표를 만들어줘",
        "project_id": project["id"],
    }).json()
    assert created["project_id"] == project["id"]
    linked = client.get(f"/api/projects/{project['id']}/runs").json()
    assert [run["id"] for run in linked] == [created["id"]]
    events = client.get(f"/api/runs/{created['id']}/events").json()
    instruction = next(event for event in events if event["type"] == "user_instruction")
    assert instruction["data"]["project_name"] == "옥외 미디어 테스트"


def test_asset_rejects_non_image(client):
    project = client.post("/api/projects", json={"name": "파일 검증"}).json()
    response = client.post(
        f"/api/projects/{project['id']}/assets",
        files={"file": ("not-image.txt", b"plain text", "text/plain")},
    )
    assert response.status_code == 400
    assert "이미지 파일만" in response.json()["detail"]


def test_delete_run_removes_result_files_and_checkpoint(client):
    from newteam.config import settings

    app = app_named(client, "데이터")  # 승인 없이 끝나는 앱
    run = client.post("/api/runs", json={"app_id": app["id"], "goal": "회의 내용을 요약해줘"}).json()
    wait_status(client, run["id"], ("completed", "failed"))
    workspace = settings.workspaces_dir / run["id"]
    assert (workspace / "result.md").exists()
    runner = client.app.state.runner
    assert runner.graph.get_state({"configurable": {"thread_id": run["id"]}}).values

    assert client.delete(f"/api/runs/{run['id']}").json() == {"ok": True}
    assert client.get(f"/api/runs/{run['id']}").status_code == 404
    assert client.get(f"/api/runs/{run['id']}/events").status_code == 404
    assert not workspace.exists()
    assert not runner.graph.get_state({"configurable": {"thread_id": run["id"]}}).values


def test_delete_project_removes_its_runs_and_assets(client):
    from newteam.config import settings

    project = client.post("/api/projects", json={"name": "삭제할 캠페인"}).json()
    png = b"\x89PNG\r\n\x1a\n" + b"x"
    asset = client.post(f"/api/projects/{project['id']}/assets", files={"file": ("a.png", png, "image/png")}).json()
    app = app_named(client, "데이터")
    run = client.post("/api/runs", json={"app_id": app["id"], "goal": "정리해줘", "project_id": project["id"]}).json()
    wait_status(client, run["id"], ("completed", "failed"))

    assert client.delete(f"/api/projects/{project['id']}").json() == {"ok": True}
    assert client.get(f"/api/projects/{project['id']}").status_code == 404
    assert client.get(f"/api/runs/{run['id']}").status_code == 404
    assert not (settings.workspaces_dir / run["id"]).exists()
    assert not (settings.assets_dir / project["id"]).exists()
    assert asset["id"]


def test_cannot_delete_active_run_or_its_project(client):
    project = client.post("/api/projects", json={"name": "진행 중"}).json()
    run = client.post("/api/runs", json={"app_id": app_named(client, "리서치")["id"], "goal": "x", "project_id": project["id"]}).json()
    store = client.app.state.store
    wait_status(client, run["id"], ("waiting", "completed", "failed"))
    store.update("runs", run["id"], status="running")  # 실행 중 상태를 흉내 낸다
    assert client.delete(f"/api/runs/{run['id']}").status_code == 400
    assert client.delete(f"/api/projects/{project['id']}").status_code == 400
    store.update("runs", run["id"], status="waiting")
    assert client.delete(f"/api/runs/{run['id']}").status_code == 200  # 승인 대기 중인 작업은 지울 수 있다


def test_project_shares_one_store_across_members(client):
    """같은 프로젝트 멤버는 저장소·팀·실행 기록·통계를 함께 쓰고, 저장소 내용이 실행에 적용된다."""
    def login(email, password):
        client.cookies.clear()
        assert client.post("/api/auth/login", json={"email": email, "password": password}).status_code == 200

    member = client.post("/api/users", json={"name": "멤버", "email": "m@example.com", "password": "member-pass-1"}).json()
    client.post("/api/users", json={"name": "외부인", "email": "o@example.com", "password": "outsider-pass-1"})
    project = client.post("/api/projects", json={"name": "성수 팝업", "member_ids": [member["id"]]}).json()
    kb_id = project["kb_id"]

    # 관리자가 프로젝트 저장소에 문서를 올리고 프로젝트 팀을 만든다
    client.post(f"/api/knowledge/{kb_id}/text", json={"name": "현장 조건.md", "text": "성수 팝업 매장은 전면 유리창 폭이 6미터입니다."})
    team = client.post("/api/apps", json={"name": "성수 팀", "project_id": project["id"],
                                          "policy": {"plan_approval": False, "tool_approval": False}}).json()

    # 멤버: 같은 저장소·팀을 보고 고칠 수 있고, 실행하면 저장소 내용이 근거로 쓰인다
    login("m@example.com", "member-pass-1")
    kb = next(k for k in client.get("/api/knowledge").json() if k["id"] == kb_id)
    assert kb["can_edit"] and kb["project_id"] == project["id"]
    assert client.post(f"/api/knowledge/{kb_id}/text", json={"name": "멤버 메모.md", "text": "설치는 야간에만 가능합니다."}).status_code == 200
    assert client.put(f"/api/apps/{team['id']}", json={"description": "멤버가 고침"}).status_code == 200
    run = client.post("/api/runs", json={"app_id": team["id"], "goal": "성수 팝업 현장 조건 요약", "project_id": project["id"]}).json()
    done = wait_status(client, run["id"], ("completed", "failed"))
    assert done["status"] == "completed" and "현장 조건.md" in done["final"]

    # 결과물이 프로젝트 저장소에 쌓인다
    docs = client.get(f"/api/knowledge/{kb_id}/documents").json()
    assert any(d["name"].startswith("[실행 결과]") for d in docs)

    # 관리자(다른 사람)도 프로젝트 기준으로 멤버의 실행과 통계를 본다
    login(ADMIN["email"], ADMIN["password"])
    assert [r["id"] for r in client.get(f"/api/runs?project_id={project['id']}").json()] == [run["id"]]
    assert client.get(f"/api/stats?project_id={project['id']}").json()["total"] == 1

    # 외부인은 저장소·팀·실행 어디에도 접근할 수 없다
    login("o@example.com", "outsider-pass-1")
    assert all(k["id"] != kb_id for k in client.get("/api/knowledge").json())
    assert all(a["id"] != team["id"] for a in client.get("/api/apps").json())
    assert client.get(f"/api/runs?project_id={project['id']}").status_code == 404
    assert client.get(f"/api/runs/{run['id']}").status_code == 404
    assert client.post("/api/apps", json={"name": "x", "project_id": project["id"]}).status_code == 404

    # 실행을 지우면 저장소에 쌓인 결과 문서도 지워진다
    login(ADMIN["email"], ADMIN["password"])
    client.delete(f"/api/runs/{run['id']}")
    assert not any(d["name"].startswith("[실행 결과]") for d in client.get(f"/api/knowledge/{kb_id}/documents").json())
    # 프로젝트를 지우면 저장소는 사라지고 팀은 개인 앱으로 남는다
    client.delete(f"/api/projects/{project['id']}")
    assert all(k["id"] != kb_id for k in client.get("/api/knowledge").json())
    assert client.get(f"/api/apps/{team['id']}").json()["project_id"] is None
