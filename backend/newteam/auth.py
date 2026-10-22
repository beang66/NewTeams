"""계정·세션·권한.

- 비밀번호는 scrypt로 해시해 저장한다(표준 라이브러리만 사용).
- 세션 토큰은 HttpOnly 쿠키로 주고, 저장소에는 토큰의 SHA-256만 남긴다.
- 실행 기록은 만든 사람과 관리자만 볼 수 있다.
- 앱·지식 베이스는 만든 사람이 수정하고, '공유'를 켜면 다른 사용자는 읽기만 할 수 있다.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import threading
import time
from collections import defaultdict
from typing import Any

from fastapi import HTTPException, Request

from .config import settings
from .db import Store, new_id, now

COOKIE = "newteam_session"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8

# 로그인 실패 제한: 같은 IP·이메일로 10분 안에 5번 실패하면 잠시 막는다.
_FAIL_WINDOW = 600
_FAIL_LIMIT = 5
_failures: dict[str, list[float]] = defaultdict(list)
_fail_lock = threading.Lock()


class AuthError(ValueError):
    pass


# ---------------------------------------------------------------- 비밀번호

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt$16384$8$1${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual.hex(), digest)


def validate_new_user(name: str, email: str, password: str) -> tuple[str, str]:
    name, email = name.strip(), email.strip().lower()
    if not name:
        raise AuthError("이름을 입력하세요.")
    if not EMAIL_RE.match(email):
        raise AuthError("이메일 형식이 올바르지 않습니다.")
    if len(password) < MIN_PASSWORD:
        raise AuthError(f"비밀번호는 {MIN_PASSWORD}자 이상이어야 합니다.")
    return name, email


# ---------------------------------------------------------------- 사용자

def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {k: user[k] for k in ("id", "name", "email", "role", "active", "created_at") if k in user} | {
        "last_login_at": user.get("last_login_at")
    }


def find_by_email(store: Store, email: str) -> dict[str, Any] | None:
    email = email.strip().lower()
    return next((u for u in store.list("users") if u["email"] == email), None)


def create_user(store: Store, name: str, email: str, password: str, role: str = "member") -> dict[str, Any]:
    name, email = validate_new_user(name, email, password)
    if role not in ("admin", "member"):
        raise AuthError("역할은 admin 또는 member여야 합니다.")
    if find_by_email(store, email):
        raise AuthError("이미 등록된 이메일입니다.")
    return store.put("users", {
        "id": new_id("usr"),
        "name": name,
        "email": email,
        "role": role,
        "active": True,
        "password_hash": hash_password(password),
    })


def needs_setup(store: Store) -> bool:
    return not store.list("users")


def active_admins(store: Store) -> list[dict[str, Any]]:
    return [u for u in store.list("users") if u["role"] == "admin" and u.get("active", True)]


def claim_orphans(store: Store, admin: dict[str, Any]) -> None:
    """계정 기능 도입 전에 만들어진 데이터를 첫 관리자에게 넘긴다."""
    for run in store.list("runs"):
        if not run.get("owner_id"):
            store.update("runs", run["id"], owner_id=admin["id"], owner_name=admin["name"])
    for table in ("apps", "knowledge_bases"):
        for doc in store.list(table):
            if not doc.get("owner_id"):
                store.update(table, doc["id"], owner_id=admin["id"], owner_name=admin["name"], shared=True)


# ---------------------------------------------------------------- 세션

def _token_id(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(store: Store, user: dict[str, Any]) -> str:
    token = secrets.token_urlsafe(32)
    store.put("sessions", {
        "id": _token_id(token),
        "user_id": user["id"],
        "expires_at": now() + settings.session_days * 86400,
    })
    store.update("users", user["id"], last_login_at=now())
    return token


def delete_session(store: Store, token: str | None) -> None:
    if token:
        store.delete("sessions", _token_id(token))


def delete_user_sessions(store: Store, user_id: str) -> None:
    for s in store.list("sessions", user_id=user_id):
        store.delete("sessions", s["id"])


def user_for_token(store: Store, token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    session = store.get("sessions", _token_id(token))
    if session is None:
        return None
    if session["expires_at"] < now():
        store.delete("sessions", session["id"])
        return None
    user = store.get("users", session["user_id"])
    if user is None or not user.get("active", True):
        return None
    return user


def set_cookie(response: Any, token: str) -> None:
    response.set_cookie(
        COOKIE, token,
        max_age=settings.session_days * 86400,
        httponly=True,
        samesite="lax",  # 다른 사이트에서 보낸 POST에는 쿠키가 붙지 않는다(CSRF 방어)
        secure=settings.secure_cookie,
        path="/",
    )


def clear_cookie(response: Any) -> None:
    response.delete_cookie(COOKIE, path="/")


# ---------------------------------------------------------------- 로그인 실패 제한

def _fail_key(request: Request, email: str) -> str:
    host = request.client.host if request.client else "?"
    return f"{host}|{email.strip().lower()}"


def check_rate_limit(request: Request, email: str) -> None:
    key = _fail_key(request, email)
    with _fail_lock:
        recent = [t for t in _failures[key] if t > time.time() - _FAIL_WINDOW]
        _failures[key] = recent
        if len(recent) >= _FAIL_LIMIT:
            raise HTTPException(429, "로그인 시도가 너무 많습니다. 10분 뒤 다시 시도하세요.")


def record_failure(request: Request, email: str) -> None:
    with _fail_lock:
        _failures[_fail_key(request, email)].append(time.time())


def clear_failures(request: Request, email: str) -> None:
    with _fail_lock:
        _failures.pop(_fail_key(request, email), None)


# ---------------------------------------------------------------- 권한

def is_admin(user: dict[str, Any]) -> bool:
    return user.get("role") == "admin"


def in_project(user: dict[str, Any], doc: dict[str, Any]) -> bool:
    """문서가 프로젝트에 속하고 사용자가 그 프로젝트 멤버인가(api.current_user가 project_ids를 채운다)."""
    return bool(doc.get("project_id")) and doc["project_id"] in user.get("project_ids", ())


def can_view_run(user: dict[str, Any], run: dict[str, Any]) -> bool:
    return is_admin(user) or run.get("owner_id") == user["id"] or in_project(user, run)


def can_view_shared(user: dict[str, Any], doc: dict[str, Any]) -> bool:
    """앱·지식 베이스: 관리자, 소유자, 또는 공유된 항목이면 볼 수 있다."""
    return is_admin(user) or doc.get("owner_id") == user["id"] or bool(doc.get("shared")) or in_project(user, doc)


def can_edit_shared(user: dict[str, Any], doc: dict[str, Any]) -> bool:
    # 프로젝트 팀·저장소는 멤버 모두가 함께 고친다
    return is_admin(user) or doc.get("owner_id") == user["id"] or in_project(user, doc)


def with_access(user: dict[str, Any], doc: dict[str, Any]) -> dict[str, Any]:
    return {**doc, "can_edit": can_edit_shared(user, doc), "is_mine": doc.get("owner_id") == user["id"]}
