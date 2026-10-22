"""API가 없는 웹 페이지의 본문을 가져오는 단순 수집기."""

from __future__ import annotations

import ipaddress
import re
import socket
from typing import Any
from urllib.parse import urlparse

import httpx

from ..knowledge import html_to_text

URL_RE = re.compile(r"https?://[^\s<>\"')\]]+")
MAX_CHARS = 20000


def find_urls(text: str) -> list[str]:
    return [u.rstrip(".,;") for u in URL_RE.findall(text)]


def _is_private(host: str) -> bool:
    try:
        for info in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return True
    except (socket.gaierror, ValueError):
        return False
    return False


def fetch(url: str, allow_private: bool = False) -> dict[str, Any]:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return {"url": url, "error": "http(s) 주소만 열 수 있습니다."}
    if not allow_private and _is_private(parsed.hostname):
        return {"url": url, "error": "내부망 주소는 보안 정책상 열 수 없습니다."}
    try:
        resp = httpx.get(
            url,
            follow_redirects=True,
            timeout=20,
            headers={"User-Agent": "Mozilla/5.0 (NewTeam Studio agent)"},
        )
    except httpx.HTTPError as e:
        return {"url": url, "error": f"요청 실패: {e}"}
    content_type = resp.headers.get("content-type", "")
    if "html" in content_type:
        title, text = html_to_text(resp.text)
    else:
        title, text = "", resp.text
    return {
        "url": str(resp.url),
        "status": resp.status_code,
        "title": title,
        "text": text[:MAX_CHARS],
        "truncated": len(text) > MAX_CHARS,
    }
