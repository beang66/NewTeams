import time

import pytest
from fastapi.testclient import TestClient

from newteam import auth
from newteam.api import create_app

ADMIN = {"name": "관리자", "email": "admin@example.com", "password": "admin-pass-1"}
ALICE = {"name": "앨리스", "email": "alice@example.com", "password": "alice-pass-1"}
BOB = {"name": "밥", "email": "bob@example.com", "password": "bob-pass-12"}


@pytest.fixture
def client():
    auth._failures.clear()
    with TestClient(create_app()) as c:
        yield c


def login_as(client, who):
    client.cookies.clear()
    res = client.post("/api/auth/login", json={"email": who["email"], "password": who["password"]})
    assert res.status_code == 200, res.text
    return res.json()


@pytest.fixture
def team(client):
    """관리자 + 일반 사용자 두 명."""
    client.post("/api/auth/setup", json=ADMIN)
    for who in (ALICE, BOB):
        assert client.post("/api/users", json=who).status_code == 200
    client.cookies.clear()
    return client


def wait_status(client, run_id, statuses=("waiting", "completed", "failed"), timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in statuses:
            return run
        time.sleep(0.05)
    raise AssertionError("timeout")


def test_setup_flow_and_protected_routes(client):
    state = client.get("/api/auth/state").json()
    assert state["needs_setup"] is True and state["user"] is None
    assert client.get("/api/runs").status_code == 401
    assert client.get("/api/meta").status_code == 401

    bad = client.post("/api/auth/setup", json={**ADMIN, "password": "short"})
    assert bad.status_code == 400

    me = client.post("/api/auth/setup", json=ADMIN).json()
    assert me["role"] == "admin" and "password_hash" not in me
    assert client.get("/api/auth/state").json()["user"]["email"] == ADMIN["email"]
    # 관리자는 한 번만 만들 수 있다
    assert client.post("/api/auth/setup", json=ALICE).status_code == 409
    # 시드 앱은 첫 관리자 소유의 공유 앱이 된다
    apps = client.get("/api/apps").json()
    assert all(a["shared"] and a["owner_id"] == me["id"] for a in apps)


def test_login_logout_and_password_storage(team):
    stored = auth.find_by_email(team.app.state.store, ALICE["email"])
    assert ALICE["password"] not in stored["password_hash"]
    assert team.post("/api/auth/login", json={"email": ALICE["email"], "password": "wrong-pass"}).status_code == 401
    login_as(team, ALICE)
    assert team.get("/api/auth/me").json()["name"] == ALICE["name"]
    team.post("/api/auth/logout")
    assert team.get("/api/auth/me").status_code == 401


def test_login_rate_limit(team):
    for _ in range(5):
        team.post("/api/auth/login", json={"email": BOB["email"], "password": "nope-nope"})
    res = team.post("/api/auth/login", json={"email": BOB["email"], "password": BOB["password"]})
    assert res.status_code == 429


def test_signup_closed_by_default(team):
    res = team.post("/api/auth/signup", json={"name": "x", "email": "x@example.com", "password": "12345678"})
    assert res.status_code == 403


def test_runs_are_private_per_user(team):
    login_as(team, ALICE)
    app_id = next(a["id"] for a in team.get("/api/apps").json() if a["name"].startswith("데이터"))
    run = team.post("/api/runs", json={"app_id": app_id, "goal": "앨리스의 비밀 작업"}).json()
    assert run["owner_name"] == ALICE["name"]
    wait_status(team, run["id"])

    login_as(team, BOB)
    assert team.get("/api/runs").json() == []
    for path in ("", "/events", "/files", "/files/content?path=result.md", "/stream"):
        assert team.get(f"/api/runs/{run['id']}{path}").status_code == 404, path
    for action in ("pause", "resume", "cancel", "rerun", "respond"):
        assert team.post(f"/api/runs/{run['id']}/{action}", json={}).status_code == 404, action
    assert team.delete(f"/api/runs/{run['id']}").status_code == 404
    # scope=all은 일반 사용자에게 무시된다
    assert team.get("/api/runs?scope=all").json() == []
    assert team.get("/api/stats?scope=all").json()["total"] == 0

    login_as(team, ADMIN)
    assert team.get("/api/runs").json() == []  # 기본은 내 실행만
    all_runs = team.get("/api/runs?scope=all").json()
    assert [r["id"] for r in all_runs] == [run["id"]]
    assert team.get(f"/api/runs/{run['id']}").status_code == 200


def test_shared_apps_are_read_only_for_others(team):
    login_as(team, ALICE)
    shared = team.get("/api/apps").json()[0]
    assert shared["can_edit"] is False
    assert team.put(f"/api/apps/{shared['id']}", json={"name": "해킹"}).status_code == 403
    assert team.delete(f"/api/apps/{shared['id']}").status_code == 403

    mine = team.post(f"/api/apps/{shared['id']}/duplicate").json()
    assert mine["can_edit"] and mine["shared"] is False and mine["owner_name"] == ALICE["name"]
    assert team.put(f"/api/apps/{mine['id']}", json={"owner_id": "usr_x", "name": "내 앱"}).json()["owner_name"] == ALICE["name"]

    login_as(team, BOB)
    assert mine["id"] not in [a["id"] for a in team.get("/api/apps").json()]
    assert team.get(f"/api/apps/{mine['id']}").status_code == 404

    login_as(team, ALICE)
    team.put(f"/api/apps/{mine['id']}", json={"shared": True})
    login_as(team, BOB)
    assert team.get(f"/api/apps/{mine['id']}").json()["can_edit"] is False


def test_private_knowledge_is_hidden_and_not_used_by_others(team):
    login_as(team, ALICE)
    kb = team.post("/api/knowledge", json={"name": "앨리스 메모"}).json()
    team.post(f"/api/knowledge/{kb['id']}/text", json={"name": "비밀.md", "text": "앨리스의 비밀 코드는 7788입니다."})
    # 앨리스가 자기 지식을 연결한 앱을 팀에 공유한다
    app = team.post("/api/apps", json={"name": "앨리스 앱", "shared": True, "knowledge_ids": [kb["id"]],
                                       "policy": {"plan_approval": False, "tool_approval": False}}).json()

    login_as(team, BOB)
    assert team.get("/api/knowledge").json() == []
    assert team.get(f"/api/knowledge/{kb['id']}/documents").status_code == 404
    assert team.post("/api/knowledge/search", json={"kb_ids": [kb["id"]], "query": "비밀 코드"}).json() == []
    run = team.post("/api/runs", json={"app_id": app["id"], "goal": "비밀 코드가 뭐야?"}).json()
    done = wait_status(team, run["id"], ("completed", "failed"))
    assert "7788" not in done["final"]


def test_providers_hidden_from_members(team):
    login_as(team, ADMIN)
    team.put("/api/providers/compat", json={"api_key": "sk-secret-abcdefghijkl", "base_url": "http://x/v1", "models": "m1"})
    login_as(team, ALICE)
    providers = {p["id"]: p for p in team.get("/api/providers").json()}
    assert providers["compat"]["models"] == ["compat:m1"]
    assert providers["compat"]["config"]["api_key_preview"] == ""
    assert providers["compat"]["config"]["base_url"] == ""
    assert team.put("/api/providers/compat", json={"api_key": "x"}).status_code == 403
    assert team.post("/api/providers/test", json={"model": "mock:demo"}).status_code == 403
    assert team.get("/api/users").status_code == 403


def test_user_management_and_last_admin_guard(team):
    login_as(team, ADMIN)
    users = {u["email"]: u for u in team.get("/api/users").json()}
    admin_id, bob_id = users[ADMIN["email"]]["id"], users[BOB["email"]]["id"]
    assert team.put(f"/api/users/{admin_id}", json={"role": "member"}).status_code == 400
    assert team.put(f"/api/users/{admin_id}", json={"active": False}).status_code == 400

    # 비활성화하면 기존 세션도 끊긴다
    bob_client_cookie = None
    login_as(team, BOB)
    bob_client_cookie = team.cookies.get(auth.COOKIE)
    login_as(team, ADMIN)
    team.put(f"/api/users/{bob_id}", json={"active": False})
    team.cookies.clear()
    team.cookies.set(auth.COOKIE, bob_client_cookie)
    assert team.get("/api/auth/me").status_code == 401
    assert team.post("/api/auth/login", json={"email": BOB["email"], "password": BOB["password"]}).status_code == 401


def test_change_own_password(team):
    login_as(team, ALICE)
    assert team.put("/api/auth/me", json={"current_password": "wrong", "new_password": "new-pass-123"}).status_code == 400
    assert team.put("/api/auth/me", json={"current_password": ALICE["password"], "new_password": "new-pass-123"}).status_code == 200
    assert team.get("/api/auth/me").status_code == 200  # 지금 세션은 유지
    team.cookies.clear()
    assert team.post("/api/auth/login", json={"email": ALICE["email"], "password": ALICE["password"]}).status_code == 401
    assert team.post("/api/auth/login", json={"email": ALICE["email"], "password": "new-pass-123"}).status_code == 200
