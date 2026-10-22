"""HTTP API. 프런트엔드(frontend/dist)가 빌드되어 있으면 같은 서버에서 함께 제공한다.

/api/auth/* 를 제외한 모든 API는 로그인이 필요하다. 다른 사용자의 실행이나 비공개 앱·지식 베이스에
접근하면 존재 여부를 드러내지 않도록 404를 돌려준다.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import Counter
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, apps, auth, knowledge, projects
from .config import settings
from .crew import roles_payload
from .db import Store, new_id
from .engine.runner import ACTIVE_STATUSES, RunError, Runner
from .llm import LLMError, discover_models, list_providers, save_provider, test_provider
from .templates import TEMPLATES
from .tools.browser import browser_use_available
from .tools.workspace import Workspace, WorkspaceError, openhands_available

TERMINAL = ("completed", "failed", "cancelled")
User = dict[str, Any]


class RunCreate(BaseModel):
    app_id: str
    goal: str = Field(min_length=1, max_length=4000)
    template_id: str | None = None
    project_id: str | None = None


class Decision(BaseModel):
    action: str = "approve"  # approve | revise | edit | skip
    feedback: str = ""
    plan: list[dict[str, Any]] | None = None
    commands: list[str] | None = None


class KBCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    shared: bool = False


class KBUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    shared: bool | None = None


class TextDoc(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1)


class SearchBody(BaseModel):
    kb_ids: list[str]
    query: str
    top_k: int = 5


class ProviderBody(BaseModel):
    api_key: str | None = None
    base_url: str | None = None
    models: str | None = None
    clear_api_key: bool = False


class ModelTest(BaseModel):
    model: str


class NewAccount(BaseModel):
    name: str = Field(max_length=50)
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)


class Login(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)


class MeUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=50)
    current_password: str | None = None
    new_password: str | None = Field(default=None, max_length=200)


class UserCreate(NewAccount):
    role: str = "member"


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=50)
    role: str | None = None
    active: bool | None = None
    password: str | None = Field(default=None, max_length=200)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    client: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=2000)
    status: str = "planning"
    start_date: str = Field(default="", max_length=20)
    end_date: str = Field(default="", max_length=20)
    budget: str = Field(default="", max_length=120)
    member_ids: list[str] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    client: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    status: str | None = None
    start_date: str | None = Field(default=None, max_length=20)
    end_date: str | None = Field(default=None, max_length=20)
    budget: str | None = Field(default=None, max_length=120)
    member_ids: list[str] | None = None


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    x: float | None = Field(default=None, ge=0, le=100)
    y: float | None = Field(default=None, ge=0, le=100)


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.ensure_dirs()
        store = Store(settings.db_path)
        apps.seed(store)
        app.state.store = store
        app.state.runner = Runner(store)
        yield
        app.state.runner.pool.shutdown(wait=False, cancel_futures=True)

    api = FastAPI(title="NewTeam Studio", version=__version__, lifespan=lifespan)

    def store_of(request: Request) -> Store:
        return request.app.state.store

    def runner_of(request: Request) -> Runner:
        return request.app.state.runner

    def must(doc: dict[str, Any] | None, what: str) -> dict[str, Any]:
        if doc is None:
            raise HTTPException(404, f"{what}을(를) 찾을 수 없습니다.")
        return doc

    # ---------------------------------------------------------- 인증 의존성
    def current_user(request: Request) -> User:
        user = auth.user_for_token(store_of(request), request.cookies.get(auth.COOKIE))
        if user is None:
            raise HTTPException(401, "로그인이 필요합니다.")
        # 프로젝트 멤버 권한 판정(auth.in_project)에 쓰인다
        user["project_ids"] = {p["id"] for p in store_of(request).list("projects") if projects.can_view(user, p)}
        return user

    def member_project(user: User, project_id: Any) -> None:
        if project_id and project_id not in user["project_ids"]:
            raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")

    def admin_user(user: User = Depends(current_user)) -> User:
        if not auth.is_admin(user):
            raise HTTPException(403, "관리자만 할 수 있습니다.")
        return user

    def run_for(request: Request, user: User, run_id: str) -> dict[str, Any]:
        run = store_of(request).get("runs", run_id)
        if run is None:
            raise HTTPException(404, "실행을 찾을 수 없습니다.")
        allowed = auth.can_view_run(user, run)
        if not allowed and run.get("project_id"):
            project = store_of(request).get("projects", run["project_id"])
            allowed = bool(project and projects.can_view(user, project))
        if not allowed:
            raise HTTPException(404, "실행을 찾을 수 없습니다.")
        return run

    def project_for(
        request: Request,
        user: User,
        project_id: str,
        *,
        edit: bool = False,
        contribute: bool = False,
    ) -> dict[str, Any]:
        project = store_of(request).get("projects", project_id)
        if project is None or not projects.can_view(user, project):
            raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
        if edit and not projects.can_edit(user, project):
            raise HTTPException(403, "프로젝트 소유자나 관리자만 설정을 바꿀 수 있습니다.")
        if contribute and not projects.can_contribute(user, project):
            raise HTTPException(403, "이 프로젝트에 결과물을 추가할 권한이 없습니다.")
        return project

    def asset_for(request: Request, user: User, project_id: str, asset_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        project = project_for(request, user, project_id)
        asset = store_of(request).get("assets", asset_id)
        if asset is None or asset.get("project_id") != project_id:
            raise HTTPException(404, "이미지 시안을 찾을 수 없습니다.")
        return project, asset

    def shared_for(request: Request, user: User, table: str, doc_id: str, what: str, edit: bool = False) -> dict[str, Any]:
        doc = store_of(request).get(table, doc_id)
        if doc is None or not auth.can_view_shared(user, doc):
            raise HTTPException(404, f"{what}을(를) 찾을 수 없습니다.")
        if edit and not auth.can_edit_shared(user, doc):
            raise HTTPException(403, f"이 {what}은(는) 소유자나 관리자만 수정할 수 있습니다. 복제해서 사용하세요.")
        return doc

    def visible_kb_ids(request: Request, user: User) -> set[str]:
        return {kb["id"] for kb in store_of(request).list("knowledge_bases") if auth.can_view_shared(user, kb)}

    def start_run(
        request: Request,
        user: User,
        app_: dict[str, Any],
        goal: str,
        template_id: str | None,
        project: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        # 공유 앱에 연결된 지식 베이스 중 실행하는 사람이 볼 수 없는 것은 빼고 실행한다.
        allowed = visible_kb_ids(request, user)
        snapshot = {**app_, "knowledge_ids": [k for k in app_.get("knowledge_ids", []) if k in allowed]}
        if project:
            # 같은 프로젝트의 저장소(올린 문서와 이전 결과물)를 항상 근거로 쓴다
            kb_id = projects.ensure_kb(store_of(request), project)["id"]
            snapshot["knowledge_ids"] = [*dict.fromkeys([kb_id, *snapshot["knowledge_ids"]])]
            snapshot["tools"] = {**snapshot.get("tools", {}), "knowledge": True}
        try:
            return runner_of(request).start(snapshot, goal, template_id, owner=user, project=project)
        except RunError as e:
            raise HTTPException(400, str(e)) from e

    def scoped_runs(request: Request, user: User, scope: str, project_id: str | None = None) -> list[dict[str, Any]]:
        if project_id:
            # 프로젝트 기준이면 멤버 전원의 실행을 함께 본다
            project_for(request, user, project_id)
            return store_of(request).list("runs", project_id=project_id)
        runs = store_of(request).list("runs")
        if auth.is_admin(user) and scope == "all":
            return runs
        return [r for r in runs if r.get("owner_id") == user["id"]]

    # ---------------------------------------------------------- 프로젝트·캠페인
    @api.get("/api/projects")
    def list_projects(request: Request, user: User = Depends(current_user)) -> list[dict[str, Any]]:
        store = store_of(request)
        return [projects.payload(store, user, project) for project in store.list("projects") if projects.can_view(user, project)]

    @api.post("/api/projects")
    def create_project(request: Request, body: ProjectCreate, user: User = Depends(current_user)) -> dict[str, Any]:
        store = store_of(request)
        project = projects.create(store, body.model_dump(), user)
        return projects.payload(store, user, project)

    @api.get("/api/projects/{project_id}")
    def get_project(request: Request, project_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
        store = store_of(request)
        return projects.payload(store, user, project_for(request, user, project_id))

    @api.put("/api/projects/{project_id}")
    def update_project(request: Request, project_id: str, body: ProjectUpdate, user: User = Depends(current_user)) -> dict[str, Any]:
        store = store_of(request)
        project = project_for(request, user, project_id, edit=True)
        updated = projects.update(store, project, body.model_dump(exclude_none=True))
        return projects.payload(store, user, updated)

    @api.delete("/api/projects/{project_id}")
    def delete_project(request: Request, project_id: str, user: User = Depends(current_user)) -> dict[str, bool]:
        store = store_of(request)
        project = project_for(request, user, project_id, edit=True)
        runs = store.list("runs", project_id=project_id)
        if any(r["status"] in ACTIVE_STATUSES for r in runs):
            raise HTTPException(400, "실행 중인 작업이 있는 프로젝트는 삭제할 수 없습니다. 먼저 취소하세요.")
        # 프로젝트에 속한 실행 결과물(기록·작업 공간 파일)도 함께 지운다
        for r in runs:
            runner_of(request).delete(r["id"])
        projects.delete_project(store, project)
        return {"ok": True}

    @api.get("/api/projects/{project_id}/runs")
    def project_runs(request: Request, project_id: str, user: User = Depends(current_user)) -> list[dict[str, Any]]:
        project_for(request, user, project_id)
        runs = store_of(request).list("runs", project_id=project_id)
        return [{**{k: v for k, v in run.items() if k not in ("final", "draft")},
                 "result_preview": (run.get("final") or run.get("draft") or "")[:280]} for run in runs]

    @api.get("/api/projects/{project_id}/assets")
    def list_assets(request: Request, project_id: str, user: User = Depends(current_user)) -> list[dict[str, Any]]:
        project_for(request, user, project_id)
        store = store_of(request)
        out = []
        for asset in store.list("assets", project_id=project_id):
            comments = store.list("comments", asset_id=asset["id"])
            out.append({**{k: v for k, v in asset.items() if k != "stored_name"}, "comment_count": len(comments)})
        return out

    @api.post("/api/projects/{project_id}/assets")
    async def upload_asset(
        request: Request,
        project_id: str,
        file: UploadFile = File(...),
        user: User = Depends(current_user),
    ) -> dict[str, Any]:
        project = project_for(request, user, project_id, contribute=True)
        raw = await file.read()
        try:
            asset = projects.save_asset(store_of(request), project, user, file.filename or "시안", raw)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return {**{k: v for k, v in asset.items() if k != "stored_name"}, "comment_count": 0}

    @api.get("/api/projects/{project_id}/assets/{asset_id}/content")
    def asset_content(request: Request, project_id: str, asset_id: str, user: User = Depends(current_user)) -> FileResponse:
        _, asset = asset_for(request, user, project_id, asset_id)
        target = projects.asset_path(asset)
        if not target.is_file():
            raise HTTPException(404, "이미지 파일이 없습니다.")
        return FileResponse(target, media_type=asset["mime_type"], filename=asset["name"])

    @api.delete("/api/projects/{project_id}/assets/{asset_id}")
    def delete_asset(request: Request, project_id: str, asset_id: str, user: User = Depends(current_user)) -> dict[str, bool]:
        project, asset = asset_for(request, user, project_id, asset_id)
        if not (projects.can_edit(user, project) or asset.get("owner_id") == user["id"]):
            raise HTTPException(403, "업로더, 프로젝트 소유자 또는 관리자만 시안을 삭제할 수 있습니다.")
        projects.delete_asset(store_of(request), asset)
        return {"ok": True}

    @api.get("/api/projects/{project_id}/assets/{asset_id}/comments")
    def list_comments(request: Request, project_id: str, asset_id: str, user: User = Depends(current_user)) -> list[dict[str, Any]]:
        asset_for(request, user, project_id, asset_id)
        return store_of(request).list("comments", asset_id=asset_id)

    @api.post("/api/projects/{project_id}/assets/{asset_id}/comments")
    def create_comment(
        request: Request,
        project_id: str,
        asset_id: str,
        body: CommentCreate,
        user: User = Depends(current_user),
    ) -> dict[str, Any]:
        project, asset = asset_for(request, user, project_id, asset_id)
        return projects.add_comment(store_of(request), project, asset, user, body.body, body.x, body.y)

    @api.delete("/api/projects/{project_id}/assets/{asset_id}/comments/{comment_id}")
    def delete_comment(
        request: Request,
        project_id: str,
        asset_id: str,
        comment_id: str,
        user: User = Depends(current_user),
    ) -> dict[str, bool]:
        project, _ = asset_for(request, user, project_id, asset_id)
        comment = store_of(request).get("comments", comment_id)
        if comment is None or comment.get("asset_id") != asset_id:
            raise HTTPException(404, "댓글을 찾을 수 없습니다.")
        if not (projects.can_edit(user, project) or comment.get("author_id") == user["id"]):
            raise HTTPException(403, "작성자, 프로젝트 소유자 또는 관리자만 댓글을 삭제할 수 있습니다.")
        store_of(request).delete("comments", comment_id)
        return {"ok": True}

    # ---------------------------------------------------------- 계정
    @api.get("/api/auth/state")
    def auth_state(request: Request) -> dict[str, Any]:
        user = auth.user_for_token(store_of(request), request.cookies.get(auth.COOKIE))
        return {
            "needs_setup": auth.needs_setup(store_of(request)),
            "allow_signup": settings.allow_signup,
            "user": auth.public_user(user) if user else None,
        }

    @api.post("/api/auth/setup")
    def setup(request: Request, body: NewAccount, response: Response) -> dict[str, Any]:
        store = store_of(request)
        if not auth.needs_setup(store):
            raise HTTPException(409, "이미 관리자 계정이 있습니다. 로그인하세요.")
        try:
            user = auth.create_user(store, body.name, body.email, body.password, role="admin")
        except auth.AuthError as e:
            raise HTTPException(400, str(e)) from e
        auth.claim_orphans(store, user)
        auth.set_cookie(response, auth.create_session(store, user))
        return auth.public_user(user)

    @api.post("/api/auth/signup")
    def signup(request: Request, body: NewAccount, response: Response) -> dict[str, Any]:
        store = store_of(request)
        if auth.needs_setup(store):
            raise HTTPException(409, "먼저 관리자 계정을 만들어야 합니다.")
        if not settings.allow_signup:
            raise HTTPException(403, "회원가입이 닫혀 있습니다. 관리자에게 계정을 요청하세요.")
        try:
            user = auth.create_user(store, body.name, body.email, body.password)
        except auth.AuthError as e:
            raise HTTPException(400, str(e)) from e
        auth.set_cookie(response, auth.create_session(store, user))
        return auth.public_user(user)

    @api.post("/api/auth/login")
    def login(request: Request, body: Login, response: Response) -> dict[str, Any]:
        store = store_of(request)
        auth.check_rate_limit(request, body.email)
        user = auth.find_by_email(store, body.email)
        # 사용자가 없어도 해시 검증을 한 번 수행해 응답 시간으로 계정 존재를 추측하지 못하게 한다.
        ok = auth.verify_password(body.password, user["password_hash"] if user else auth.hash_password("dummy-password"))
        if not (user and ok and user.get("active", True)):
            auth.record_failure(request, body.email)
            raise HTTPException(401, "이메일 또는 비밀번호가 올바르지 않습니다.")
        auth.clear_failures(request, body.email)
        auth.set_cookie(response, auth.create_session(store, user))
        return auth.public_user(user)

    @api.post("/api/auth/logout")
    def logout(request: Request, response: Response) -> dict[str, bool]:
        auth.delete_session(store_of(request), request.cookies.get(auth.COOKIE))
        auth.clear_cookie(response)
        return {"ok": True}

    @api.get("/api/auth/me")
    def me(user: User = Depends(current_user)) -> dict[str, Any]:
        return auth.public_user(user)

    @api.put("/api/auth/me")
    def update_me(request: Request, body: MeUpdate, response: Response, user: User = Depends(current_user)) -> dict[str, Any]:
        store = store_of(request)
        fields: dict[str, Any] = {}
        if body.name is not None:
            if not body.name.strip():
                raise HTTPException(400, "이름을 입력하세요.")
            fields["name"] = body.name.strip()
        if body.new_password:
            if not auth.verify_password(body.current_password or "", user["password_hash"]):
                raise HTTPException(400, "현재 비밀번호가 올바르지 않습니다.")
            if len(body.new_password) < auth.MIN_PASSWORD:
                raise HTTPException(400, f"비밀번호는 {auth.MIN_PASSWORD}자 이상이어야 합니다.")
            fields["password_hash"] = auth.hash_password(body.new_password)
        updated = store.update("users", user["id"], **fields) or user
        if "password_hash" in fields:
            # 다른 기기의 세션은 모두 끊고 지금 세션만 새로 발급한다.
            auth.delete_user_sessions(store, user["id"])
            auth.set_cookie(response, auth.create_session(store, updated))
        return auth.public_user(updated)

    # ---------------------------------------------------------- 사용자 관리(관리자)
    @api.get("/api/users")
    def list_users(request: Request, _: User = Depends(admin_user)) -> list[dict[str, Any]]:
        runs = Counter(r.get("owner_id") for r in store_of(request).list("runs"))
        return [auth.public_user(u) | {"runs": runs.get(u["id"], 0)} for u in store_of(request).list("users")]

    @api.post("/api/users")
    def create_user(request: Request, body: UserCreate, _: User = Depends(admin_user)) -> dict[str, Any]:
        try:
            return auth.public_user(auth.create_user(store_of(request), body.name, body.email, body.password, body.role))
        except auth.AuthError as e:
            raise HTTPException(400, str(e)) from e

    @api.put("/api/users/{user_id}")
    def update_user(request: Request, user_id: str, body: UserUpdate, _: User = Depends(admin_user)) -> dict[str, Any]:
        store = store_of(request)
        target = must(store.get("users", user_id), "사용자")
        fields: dict[str, Any] = {}
        if body.name is not None:
            if not body.name.strip():
                raise HTTPException(400, "이름을 입력하세요.")
            fields["name"] = body.name.strip()
        if body.role is not None:
            if body.role not in ("admin", "member"):
                raise HTTPException(400, "역할은 admin 또는 member여야 합니다.")
            fields["role"] = body.role
        if body.active is not None:
            fields["active"] = body.active
        if body.password:
            if len(body.password) < auth.MIN_PASSWORD:
                raise HTTPException(400, f"비밀번호는 {auth.MIN_PASSWORD}자 이상이어야 합니다.")
            fields["password_hash"] = auth.hash_password(body.password)
        loses_admin = target["role"] == "admin" and (fields.get("role") == "member" or fields.get("active") is False)
        if loses_admin and [a["id"] for a in auth.active_admins(store)] == [target["id"]]:
            raise HTTPException(400, "마지막 관리자는 강등하거나 비활성화할 수 없습니다.")
        updated = store.update("users", user_id, **fields)
        if fields.get("active") is False or "password_hash" in fields:
            auth.delete_user_sessions(store, user_id)
        return auth.public_user(updated)

    # ---------------------------------------------------------- 메타
    @api.get("/api/meta")
    def meta(_: User = Depends(current_user)) -> dict[str, Any]:
        return {
            "version": __version__,
            "roles": roles_payload(),
            "templates": TEMPLATES,
            "integrations": {
                "browser_use": browser_use_available(),
                "openhands": openhands_available(),
                "sandbox": settings.sandbox,
                "docker_runtime": settings.docker_runtime,
                "server_mode": settings.is_server,
                # 서버 모드인데 local이면 명령 실행이 거부된다는 것을 화면에 알린다.
                "sandbox_blocked": settings.is_server and settings.sandbox == "local" and not settings.allow_local_sandbox,
            },
        }

    # ---------------------------------------------------------- 앱
    @api.get("/api/apps")
    def list_apps(request: Request, user: User = Depends(current_user)) -> list[dict[str, Any]]:
        return [auth.with_access(user, a) for a in store_of(request).list("apps") if auth.can_view_shared(user, a)]

    @api.post("/api/apps")
    def create_app_(request: Request, body: dict[str, Any], user: User = Depends(current_user)) -> dict[str, Any]:
        member_project(user, body.get("project_id"))
        return auth.with_access(user, apps.create_app(store_of(request), body, owner=user))

    @api.get("/api/apps/{app_id}")
    def get_app(request: Request, app_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
        return auth.with_access(user, shared_for(request, user, "apps", app_id, "앱"))

    @api.put("/api/apps/{app_id}")
    def update_app(request: Request, app_id: str, body: dict[str, Any], user: User = Depends(current_user)) -> dict[str, Any]:
        shared_for(request, user, "apps", app_id, "앱", edit=True)
        member_project(user, body.get("project_id"))
        return auth.with_access(user, must(apps.update_app(store_of(request), app_id, body), "앱"))

    @api.post("/api/apps/{app_id}/duplicate")
    def duplicate_app(request: Request, app_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
        src = shared_for(request, user, "apps", app_id, "앱")
        copy = {**src, "name": f"{src['name']} (복사본)", "shared": False}
        return auth.with_access(user, apps.create_app(store_of(request), copy, owner=user))

    @api.delete("/api/apps/{app_id}")
    def delete_app(request: Request, app_id: str, user: User = Depends(current_user)) -> dict[str, bool]:
        shared_for(request, user, "apps", app_id, "앱", edit=True)
        store_of(request).delete("apps", app_id)
        return {"ok": True}

    # ---------------------------------------------------------- 실행
    @api.get("/api/runs")
    def list_runs(
        request: Request,
        app_id: str | None = None,
        status: str | None = None,
        scope: str = "mine",
        project_id: str | None = None,
        limit: int = 100,
        user: User = Depends(current_user),
    ) -> list[dict[str, Any]]:
        runs = [r for r in scoped_runs(request, user, scope, project_id)
                if (not app_id or r["app_id"] == app_id) and (not status or r["status"] == status)][:limit]
        # 목록에서는 무거운 본문 대신 검색·확인용 결과 미리보기만 보낸다.
        result = []
        for run in runs:
            item = {k: v for k, v in run.items() if k not in ("final", "draft")}
            final = (run.get("final") or run.get("draft") or "").strip()
            item["result_preview"] = final[:280]
            result.append(item)
        return result

    @api.post("/api/runs")
    def create_run(request: Request, body: RunCreate, user: User = Depends(current_user)) -> dict[str, Any]:
        app_ = shared_for(request, user, "apps", body.app_id, "앱")
        project = project_for(request, user, body.project_id, contribute=True) if body.project_id else None
        return start_run(request, user, app_, body.goal, body.template_id, project)

    @api.get("/api/runs/{run_id}")
    def get_run(request: Request, run_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
        return run_for(request, user, run_id)

    @api.delete("/api/runs/{run_id}")
    def delete_run(request: Request, run_id: str, user: User = Depends(current_user)) -> dict[str, bool]:
        control(request, user, run_id, "delete")
        return {"ok": True}

    def control(request: Request, user: User, run_id: str, fn: str, *args: Any) -> dict[str, Any]:
        run_for(request, user, run_id)
        try:
            return getattr(runner_of(request), fn)(run_id, *args)
        except RunError as e:
            raise HTTPException(400, str(e)) from e

    @api.post("/api/runs/{run_id}/respond")
    def respond(request: Request, run_id: str, body: Decision, user: User = Depends(current_user)) -> dict[str, Any]:
        return control(request, user, run_id, "respond", body.model_dump(exclude_none=True))

    @api.post("/api/runs/{run_id}/pause")
    def pause(request: Request, run_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
        return control(request, user, run_id, "pause")

    @api.post("/api/runs/{run_id}/resume")
    def resume(request: Request, run_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
        return control(request, user, run_id, "resume")

    @api.post("/api/runs/{run_id}/cancel")
    def cancel(request: Request, run_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
        return control(request, user, run_id, "cancel")

    @api.post("/api/runs/{run_id}/rerun")
    def rerun(request: Request, run_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
        run = run_for(request, user, run_id)
        app_ = shared_for(request, user, "apps", run["app_id"], "앱")
        project = project_for(request, user, run["project_id"], contribute=True) if run.get("project_id") else None
        return start_run(request, user, app_, run["goal"], run.get("template_id"), project)

    @api.get("/api/runs/{run_id}/events")
    def run_events(request: Request, run_id: str, after: int = 0, user: User = Depends(current_user)) -> list[dict[str, Any]]:
        run_for(request, user, run_id)
        return store_of(request).events(run_id, after)

    @api.get("/api/runs/{run_id}/stream")
    async def run_stream(request: Request, run_id: str, after: int = 0, user: User = Depends(current_user)) -> StreamingResponse:
        store = store_of(request)
        run_for(request, user, run_id)

        async def gen():
            last_id, last_updated, idle = after, None, 0
            while not await request.is_disconnected():
                events = store.events(run_id, last_id)
                for ev in events:
                    last_id = ev["id"]
                    yield f"event: event\ndata: {json.dumps(ev, ensure_ascii=False, default=str)}\n\n"
                run = store.get("runs", run_id)
                if run is None:
                    return
                if run["updated_at"] != last_updated:
                    last_updated = run["updated_at"]
                    yield f"event: run\ndata: {json.dumps(run, ensure_ascii=False, default=str)}\n\n"
                if run["status"] in TERMINAL and not events:
                    idle += 1
                    if idle > 3:
                        yield "event: end\ndata: {}\n\n"
                        return
                else:
                    idle = 0
                yield ": keep-alive\n\n" if not events else ""
                await asyncio.sleep(0.4)

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # ---------------------------------------------------------- 작업 공간
    def workspace_of(request: Request, user: User, run_id: str) -> Workspace:
        run_for(request, user, run_id)
        return Workspace(run_id)

    @api.get("/api/runs/{run_id}/files")
    def list_files(request: Request, run_id: str, user: User = Depends(current_user)) -> list[dict[str, Any]]:
        return workspace_of(request, user, run_id).list_files()

    @api.get("/api/runs/{run_id}/files/content")
    def read_file(request: Request, run_id: str, path: str, user: User = Depends(current_user)) -> dict[str, Any]:
        try:
            return workspace_of(request, user, run_id).read_file(path)
        except WorkspaceError as e:
            raise HTTPException(400, str(e)) from e

    @api.get("/api/runs/{run_id}/files/download")
    def download_file(request: Request, run_id: str, path: str, user: User = Depends(current_user)) -> FileResponse:
        try:
            target = workspace_of(request, user, run_id).resolve(path)
        except WorkspaceError as e:
            raise HTTPException(400, str(e)) from e
        if not target.is_file():
            raise HTTPException(404, "파일이 없습니다.")
        return FileResponse(target, filename=target.name)

    # ---------------------------------------------------------- 지식
    def doc_summary(doc: dict[str, Any]) -> dict[str, Any]:
        return {**{k: v for k, v in doc.items() if k != "chunks"}, "chunk_count": len(doc["chunks"])}

    @api.get("/api/knowledge")
    def list_kbs(request: Request, user: User = Depends(current_user)) -> list[dict[str, Any]]:
        store = store_of(request)
        out = []
        for kb in store.list("knowledge_bases"):
            if not auth.can_view_shared(user, kb):
                continue
            docs = store.list("documents", kb_id=kb["id"])
            out.append({**auth.with_access(user, kb), "documents": len(docs),
                        "chunks": sum(len(d["chunks"]) for d in docs), "chars": sum(d["chars"] for d in docs)})
        return out

    @api.post("/api/knowledge")
    def create_kb(request: Request, body: KBCreate, user: User = Depends(current_user)) -> dict[str, Any]:
        kb = store_of(request).put("knowledge_bases", {
            "id": new_id("kb"), **body.model_dump(), "owner_id": user["id"], "owner_name": user["name"],
        })
        return auth.with_access(user, kb)

    @api.put("/api/knowledge/{kb_id}")
    def update_kb(request: Request, kb_id: str, body: KBUpdate, user: User = Depends(current_user)) -> dict[str, Any]:
        shared_for(request, user, "knowledge_bases", kb_id, "지식 베이스", edit=True)
        kb = store_of(request).update("knowledge_bases", kb_id, **body.model_dump(exclude_none=True))
        return auth.with_access(user, must(kb, "지식 베이스"))

    @api.delete("/api/knowledge/{kb_id}")
    def delete_kb(request: Request, kb_id: str, user: User = Depends(current_user)) -> dict[str, bool]:
        shared_for(request, user, "knowledge_bases", kb_id, "지식 베이스", edit=True)
        store = store_of(request)
        for doc in store.list("documents", kb_id=kb_id):
            store.delete("documents", doc["id"])
        store.delete("knowledge_bases", kb_id)
        return {"ok": True}

    @api.get("/api/knowledge/{kb_id}/documents")
    def list_docs(request: Request, kb_id: str, user: User = Depends(current_user)) -> list[dict[str, Any]]:
        shared_for(request, user, "knowledge_bases", kb_id, "지식 베이스")
        docs = store_of(request).list("documents", kb_id=kb_id)
        return [doc_summary(d) | {"preview": d["chunks"][0][:200] if d["chunks"] else ""} for d in docs]

    @api.post("/api/knowledge/{kb_id}/documents")
    async def upload_doc(request: Request, kb_id: str, file: UploadFile = File(...), user: User = Depends(current_user)) -> dict[str, Any]:
        shared_for(request, user, "knowledge_bases", kb_id, "지식 베이스", edit=True)
        raw = await file.read()
        if len(raw) > 10 * 1024 * 1024:
            raise HTTPException(400, "10MB 이하 파일만 올릴 수 있습니다.")
        try:
            text = knowledge.extract_text(file.filename or "document.txt", raw)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        if not text.strip():
            raise HTTPException(400, "문서에서 텍스트를 찾지 못했습니다.")
        return doc_summary(knowledge.add_document(store_of(request), kb_id, file.filename or "document.txt", text))

    @api.post("/api/knowledge/{kb_id}/text")
    def add_text(request: Request, kb_id: str, body: TextDoc, user: User = Depends(current_user)) -> dict[str, Any]:
        shared_for(request, user, "knowledge_bases", kb_id, "지식 베이스", edit=True)
        return doc_summary(knowledge.add_document(store_of(request), kb_id, body.name, body.text))

    @api.delete("/api/knowledge/{kb_id}/documents/{doc_id}")
    def delete_doc(request: Request, kb_id: str, doc_id: str, user: User = Depends(current_user)) -> dict[str, bool]:
        shared_for(request, user, "knowledge_bases", kb_id, "지식 베이스", edit=True)
        doc = store_of(request).get("documents", doc_id)
        if doc and doc["kb_id"] == kb_id:
            store_of(request).delete("documents", doc_id)
        return {"ok": True}

    @api.post("/api/knowledge/search")
    def search(request: Request, body: SearchBody, user: User = Depends(current_user)) -> list[dict[str, Any]]:
        allowed = visible_kb_ids(request, user)
        return knowledge.search(store_of(request), [k for k in body.kb_ids if k in allowed], body.query, body.top_k)

    # ---------------------------------------------------------- 모델
    @api.get("/api/providers")
    def providers(request: Request, user: User = Depends(current_user)) -> list[dict[str, Any]]:
        items = list_providers(store_of(request))
        if auth.is_admin(user):
            return items
        # 일반 사용자에게는 쓸 수 있는 모델 목록만 보여주고 접속 정보는 숨긴다.
        return [{**p, "fields": [], "config": {"base_url": "", "models": "", "api_key_preview": ""}} for p in items]

    @api.put("/api/providers/{provider_id}")
    def update_provider(request: Request, provider_id: str, body: ProviderBody, _: User = Depends(admin_user)) -> list[dict[str, Any]]:
        try:
            save_provider(store_of(request), provider_id, body.model_dump())
        except LLMError as e:
            raise HTTPException(400, str(e)) from e
        return list_providers(store_of(request))

    @api.post("/api/providers/{provider_id}/discover")
    def discover(request: Request, provider_id: str, body: ProviderBody, _: User = Depends(admin_user)) -> dict[str, Any]:
        try:
            models = discover_models(store_of(request), provider_id, {"api_key": body.api_key, "base_url": body.base_url})
        except LLMError as e:
            raise HTTPException(400, str(e)) from e
        return {"models": models}

    @api.post("/api/providers/test")
    def test_model(request: Request, body: ModelTest, _: User = Depends(admin_user)) -> dict[str, Any]:
        return test_provider(store_of(request), body.model)

    # ---------------------------------------------------------- 운영 통계
    @api.get("/api/stats")
    def stats(
        request: Request, days: int = 7, scope: str = "mine", project_id: str | None = None, user: User = Depends(current_user)
    ) -> dict[str, Any]:
        runs = scoped_runs(request, user, scope, project_id)
        since = time.time() - days * 86400
        recent = [r for r in runs if r["created_at"] >= since]
        durations = [r["finished_at"] - r["started_at"] for r in recent
                     if r["status"] == "completed" and r.get("finished_at") and r.get("started_at")]
        usage = Counter()
        for r in recent:
            usage.update(r.get("usage") or {})
        per_day = Counter(time.strftime("%Y-%m-%d", time.localtime(r["created_at"])) for r in recent)
        day_keys = [time.strftime("%Y-%m-%d", time.localtime(time.time() - i * 86400)) for i in range(days - 1, -1, -1)]
        finished = [r for r in recent if r["status"] in TERMINAL]
        return {
            "scope": "all" if auth.is_admin(user) and scope == "all" else "mine",
            "total": len(recent),
            "by_status": dict(Counter(r["status"] for r in recent)),
            "success_rate": round(sum(r["status"] == "completed" for r in finished) / len(finished), 3) if finished else None,
            "avg_duration": round(sum(durations) / len(durations), 1) if durations else None,
            "usage": dict(usage),
            "per_day": [{"date": d, "count": per_day.get(d, 0)} for d in day_keys],
            "per_app": [{"app": k, "count": v} for k, v in Counter(r["app_name"] for r in recent).most_common()],
            "per_user": [{"user": k or "(알 수 없음)", "count": v}
                         for k, v in Counter(r.get("owner_name", "") for r in recent).most_common()],
            "waiting": [{"id": r["id"], "goal": r["goal"], "kind": (r.get("pending") or {}).get("kind"), "owner_name": r.get("owner_name", "")}
                        for r in runs if r["status"] == "waiting"],
            "recent_failures": [{"id": r["id"], "goal": r["goal"], "error": r.get("error", "")}
                                for r in runs if r["status"] == "failed"][:5],
        }

    # ---------------------------------------------------------- 프런트엔드
    dist = settings.frontend_dist
    if dist.exists():
        api.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @api.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str) -> FileResponse:
            candidate = (dist / full_path).resolve()
            if full_path and candidate.is_file() and candidate.is_relative_to(dist.resolve()):
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return api


app = create_app()
