"""SQLite 기반 문서 저장소. 각 테이블은 id + JSON 본문 형태로 단순하게 유지한다."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

TABLES = (
    "apps", "runs", "knowledge_bases", "documents", "providers", "users", "sessions",
    "projects", "assets", "comments",
)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def now() -> float:
    return time.time()


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock, self._conn:
            self._conn.execute("PRAGMA journal_mode=WAL")
            for table in TABLES:
                self._conn.execute(
                    f"CREATE TABLE IF NOT EXISTS {table} ("
                    "id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at REAL, updated_at REAL)"
                )
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS events ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, ts REAL, "
                "type TEXT NOT NULL, data TEXT NOT NULL)"
            )
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, id)")

    # ---- 문서 ----
    def put(self, table: str, doc: dict[str, Any]) -> dict[str, Any]:
        assert table in TABLES, table
        ts = now()
        doc.setdefault("created_at", ts)
        doc["updated_at"] = ts
        with self._lock, self._conn:
            self._conn.execute(
                f"INSERT INTO {table}(id, data, created_at, updated_at) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                (doc["id"], json.dumps(doc, ensure_ascii=False), doc["created_at"], ts),
            )
        return doc

    def get(self, table: str, doc_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(f"SELECT data FROM {table} WHERE id=?", (doc_id,)).fetchone()
        return json.loads(row["data"]) if row else None

    def update(self, table: str, doc_id: str, **fields: Any) -> dict[str, Any] | None:
        with self._lock:
            doc = self.get(table, doc_id)
            if doc is None:
                return None
            doc.update(fields)
            return self.put(table, doc)

    def list(self, table: str, **filters: Any) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(f"SELECT data FROM {table} ORDER BY created_at DESC").fetchall()
        docs = [json.loads(r["data"]) for r in rows]
        return [d for d in docs if all(d.get(k) == v for k, v in filters.items())]

    def delete(self, table: str, doc_id: str) -> None:
        with self._lock, self._conn:
            self._conn.execute(f"DELETE FROM {table} WHERE id=?", (doc_id,))

    # ---- 실행 이벤트 ----
    def add_event(self, run_id: str, type_: str, data: dict[str, Any]) -> dict[str, Any]:
        ts = now()
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO events(run_id, ts, type, data) VALUES (?, ?, ?, ?)",
                (run_id, ts, type_, json.dumps(data, ensure_ascii=False, default=str)),
            )
        return {"id": cur.lastrowid, "run_id": run_id, "ts": ts, "type": type_, "data": data}

    def events(self, run_id: str, after_id: int = 0) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, run_id, ts, type, data FROM events WHERE run_id=? AND id>? ORDER BY id",
                (run_id, after_id),
            ).fetchall()
        return [
            {"id": r["id"], "run_id": r["run_id"], "ts": r["ts"], "type": r["type"], "data": json.loads(r["data"])}
            for r in rows
        ]

    def delete_events(self, run_id: str) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM events WHERE run_id=?", (run_id,))
