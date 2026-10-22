"""프로젝트와 캠페인, 이미지 시안, 댓글 저장 규칙."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .config import settings
from .db import Store, new_id


STATUSES = ("planning", "active", "review", "completed", "paused")
MAX_ASSET_BYTES = 15 * 1024 * 1024
IMAGE_FORMATS = {
    "png": ("image/png", ".png"),
    "jpeg": ("image/jpeg", ".jpg"),
    "gif": ("image/gif", ".gif"),
    "webp": ("image/webp", ".webp"),
}


def can_view(user: dict[str, Any], project: dict[str, Any]) -> bool:
    return user.get("role") == "admin" or user["id"] in project.get("member_ids", [])


def can_edit(user: dict[str, Any], project: dict[str, Any]) -> bool:
    return user.get("role") == "admin" or project.get("owner_id") == user["id"]


def can_contribute(user: dict[str, Any], project: dict[str, Any]) -> bool:
    return can_view(user, project)


def normalize(data: dict[str, Any], owner: dict[str, Any] | None = None) -> dict[str, Any]:
    project = {
        "name": str(data.get("name") or "").strip(),
        "client": str(data.get("client") or "").strip(),
        "description": str(data.get("description") or "").strip(),
        "status": data.get("status") if data.get("status") in STATUSES else "planning",
        "start_date": str(data.get("start_date") or "").strip(),
        "end_date": str(data.get("end_date") or "").strip(),
        "budget": str(data.get("budget") or "").strip(),
        "member_ids": list(dict.fromkeys(data.get("member_ids") or [])),
    }
    if owner and owner["id"] not in project["member_ids"]:
        project["member_ids"].insert(0, owner["id"])
    return project


def create(store: Store, data: dict[str, Any], owner: dict[str, Any]) -> dict[str, Any]:
    project = normalize(data, owner)
    project.update({"id": new_id("prj"), "owner_id": owner["id"], "owner_name": owner["name"]})
    project = store.put("projects", project)
    ensure_kb(store, project)
    return project


def ensure_kb(store: Store, project: dict[str, Any]) -> dict[str, Any]:
    """프로젝트마다 하나뿐인 공유 저장소(지식 베이스). 기존 프로젝트는 처음 조회할 때 만든다."""
    found = store.list("knowledge_bases", project_id=project["id"])
    if found:
        return found[0]
    return store.put("knowledge_bases", {
        "id": new_id("kb"),
        "name": f"{project['name']} 저장소",
        "description": "프로젝트 멤버가 함께 쓰는 문서와 실행 결과물",
        "project_id": project["id"],
        "owner_id": project["owner_id"],
        "owner_name": project.get("owner_name", ""),
        "shared": False,
    })


def update(store: Store, project: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    editable = normalize({**project, **data})
    editable["member_ids"] = list(dict.fromkeys([project["owner_id"], *editable["member_ids"]]))
    return store.update("projects", project["id"], **editable) or project


def payload(store: Store, user: dict[str, Any], project: dict[str, Any]) -> dict[str, Any]:
    user_names = {u["id"]: u["name"] for u in store.list("users")}
    assets = store.list("assets", project_id=project["id"])
    runs = store.list("runs", project_id=project["id"])
    kb = ensure_kb(store, project)
    return {
        **project,
        "kb_id": kb["id"],
        "kb_documents": len(store.list("documents", kb_id=kb["id"])),
        "member_names": [user_names[user_id] for user_id in project.get("member_ids", []) if user_id in user_names],
        "asset_count": len(assets),
        "run_count": len(runs),
        "can_edit": can_edit(user, project),
        "can_contribute": can_contribute(user, project),
    }


def image_format(raw: bytes) -> str | None:
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if raw.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return None


def save_asset(store: Store, project: dict[str, Any], user: dict[str, Any], filename: str, raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_ASSET_BYTES:
        raise ValueError("이미지는 15MB 이하만 올릴 수 있습니다.")
    kind = image_format(raw)
    if kind is None:
        raise ValueError("PNG, JPG, GIF, WEBP 이미지 파일만 올릴 수 있습니다.")

    asset_id = new_id("asset")
    mime_type, suffix = IMAGE_FORMATS[kind]
    folder = settings.assets_dir / project["id"]
    folder.mkdir(parents=True, exist_ok=True)
    stored_name = f"{asset_id}{suffix}"
    (folder / stored_name).write_bytes(raw)
    asset = {
        "id": asset_id,
        "project_id": project["id"],
        "name": Path(filename).name or f"시안{suffix}",
        "mime_type": mime_type,
        "size": len(raw),
        "stored_name": stored_name,
        "owner_id": user["id"],
        "owner_name": user["name"],
    }
    return store.put("assets", asset)


def asset_path(asset: dict[str, Any]) -> Path:
    target = (settings.assets_dir / asset["project_id"] / asset["stored_name"]).resolve()
    root = settings.assets_dir.resolve()
    if not target.is_relative_to(root):
        raise ValueError("잘못된 이미지 경로입니다.")
    return target


def delete_asset(store: Store, asset: dict[str, Any]) -> None:
    for comment in store.list("comments", asset_id=asset["id"]):
        store.delete("comments", comment["id"])
    asset_path(asset).unlink(missing_ok=True)
    store.delete("assets", asset["id"])


def delete_project(store: Store, project: dict[str, Any]) -> None:
    for asset in store.list("assets", project_id=project["id"]):
        delete_asset(store, asset)
    shutil.rmtree(settings.assets_dir / project["id"], ignore_errors=True)
    for kb in store.list("knowledge_bases", project_id=project["id"]):
        for doc in store.list("documents", kb_id=kb["id"]):
            store.delete("documents", doc["id"])
        store.delete("knowledge_bases", kb["id"])
    # 프로젝트 팀은 지우지 않고 만든 사람의 개인 앱으로 남긴다
    for app in store.list("apps", project_id=project["id"]):
        store.update("apps", app["id"], project_id=None)
    store.delete("projects", project["id"])


def add_comment(
    store: Store,
    project: dict[str, Any],
    asset: dict[str, Any],
    user: dict[str, Any],
    body: str,
    x: float | None,
    y: float | None,
) -> dict[str, Any]:
    comment = {
        "id": new_id("cmt"),
        "project_id": project["id"],
        "asset_id": asset["id"],
        "body": body.strip(),
        "x": x,
        "y": y,
        "author_id": user["id"],
        "author_name": user["name"],
    }
    return store.put("comments", comment)
