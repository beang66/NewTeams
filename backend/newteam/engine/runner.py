"""실행 관리자 — 그래프를 백그라운드에서 돌리고 상태(대기·실행·승인 대기·일시정지·완료)를 관리한다.

LangGraph 체크포인터(SQLite)에 단계마다 상태가 저장되므로
- 일시정지: 현재 단계가 끝난 뒤 멈추고, 재개하면 다음 단계부터 이어간다.
- 실패: '다시 시도'하면 실패한 단계부터 다시 실행한다.
- 서버 재시작: 실행 중이던 작업은 '일시정지'로 바뀌고 재개할 수 있다.
"""

from __future__ import annotations

import shutil
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command

from ..config import settings
from ..crew import role_names
from ..db import Store, new_id, now
from .graph import Services, build_graph

ACTIVE_STATUSES = ("queued", "running")
RESUMABLE_STATUSES = ("paused", "failed")


class RunError(ValueError):
    pass


class Runner:
    def __init__(self, store: Store, max_workers: int = 4):
        self.store = store
        self.services = Services(store)
        conn = sqlite3.connect(settings.checkpoint_path, check_same_thread=False)
        self.checkpointer = SqliteSaver(conn)
        self.graph = build_graph(self.services).compile(checkpointer=self.checkpointer)
        self.pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="run")
        self._controls: dict[str, str] = {}
        self._lock = threading.Lock()
        self._recover()

    # ------------------------------------------------------------ 공개 API

    def start(
        self,
        app: dict[str, Any],
        goal: str,
        template_id: str | None = None,
        owner: dict[str, Any] | None = None,
        project: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        goal = goal.strip()
        if not goal:
            raise RunError("목표를 입력하세요.")
        run = self.store.put("runs", {
            "id": new_id("run"),
            "owner_id": owner["id"] if owner else None,
            "owner_name": owner["name"] if owner else "",
            "app_id": app["id"],
            "app_name": app["name"],
            "app_icon": app.get("icon", "🤖"),
            "role_names": role_names(app),  # 실행 당시 이름을 남겨 나중에 바꿔도 기록이 그대로 보이게 한다
            "model": app["model"],
            "goal": goal,
            "template_id": template_id,
            "project_id": project["id"] if project else None,
            "project_name": project["name"] if project else "",
            "status": "queued",
            "plan": [],
            "plan_summary": "",
            "iteration": 0,
            "pending": None,
            "verdict": None,
            "final": "",
            "error": "",
            "usage": {"llm_calls": 0, "tool_calls": 0, "input_tokens": 0, "output_tokens": 0},
        })
        initial = {
            "run_id": run["id"], "goal": goal, "template_id": template_id, "app": app,
            "iteration": 0, "outputs": [], "draft": "", "feedback": "", "verdict": None,
        }
        self.services.emit(run["id"], "status", status="queued", goal=goal)
        self.services.emit(
            run["id"],
            "user_instruction",
            sender=owner["name"] if owner else "사용자",
            message=goal,
            project_id=project["id"] if project else None,
            project_name=project["name"] if project else "",
        )
        self.pool.submit(self._drive, run["id"], initial)
        return run

    def respond(self, run_id: str, decision: dict[str, Any]) -> dict[str, Any]:
        """승인 대기 중인 실행에 사람의 결정을 전달한다."""
        run = self._get(run_id)
        if run["status"] != "waiting":
            raise RunError("승인 대기 중인 실행이 아닙니다.")
        self.store.update("runs", run_id, status="queued", pending=None)
        self.pool.submit(self._drive, run_id, Command(resume=decision))
        return self._get(run_id)

    def resume(self, run_id: str) -> dict[str, Any]:
        run = self._get(run_id)
        if run["status"] not in RESUMABLE_STATUSES:
            raise RunError("일시정지되었거나 실패한 실행만 재개할 수 있습니다.")
        self.store.update("runs", run_id, status="queued", error="")
        self.services.emit(run_id, "status", status="resumed")
        self.pool.submit(self._drive, run_id, None)
        return self._get(run_id)

    def pause(self, run_id: str) -> dict[str, Any]:
        run = self._get(run_id)
        if run["status"] not in ACTIVE_STATUSES:
            raise RunError("실행 중인 작업만 일시정지할 수 있습니다.")
        with self._lock:
            self._controls[run_id] = "pause"
        self.services.emit(run_id, "status", status="pausing", message="현재 단계가 끝나면 일시정지합니다.")
        return self._get(run_id)

    def cancel(self, run_id: str) -> dict[str, Any]:
        run = self._get(run_id)
        if run["status"] in ("completed", "cancelled"):
            return run
        if run["status"] in ACTIVE_STATUSES:
            with self._lock:
                self._controls[run_id] = "cancel"
            self.services.emit(run_id, "status", status="cancelling", message="현재 단계가 끝나면 취소합니다.")
        else:
            self._finish(run_id, "cancelled")
        return self._get(run_id)

    def delete(self, run_id: str) -> None:
        """실행 기록과 이벤트, 체크포인트, 작업 공간 파일을 모두 지운다."""
        run = self._get(run_id)
        if run["status"] in ACTIVE_STATUSES:
            raise RunError("실행 중인 작업은 먼저 취소하세요.")
        self.store.delete("runs", run_id)
        self.store.delete_events(run_id)
        for doc in self.store.list("documents", run_id=run_id):
            self.store.delete("documents", doc["id"])
        self.checkpointer.delete_thread(run_id)
        shutil.rmtree(settings.workspaces_dir / run_id, ignore_errors=True)

    def state(self, run_id: str) -> dict[str, Any]:
        snapshot = self.graph.get_state(self._config(run_id))
        return {"values": snapshot.values or {}, "next": list(snapshot.next or [])}

    # ------------------------------------------------------------ 내부

    def _config(self, run_id: str) -> dict[str, Any]:
        return {"configurable": {"thread_id": run_id}, "recursion_limit": 300}

    def _get(self, run_id: str) -> dict[str, Any]:
        run = self.store.get("runs", run_id)
        if run is None:
            raise RunError("실행을 찾을 수 없습니다.")
        return run

    def _recover(self) -> None:
        for run in self.store.list("runs"):
            if run["status"] in ACTIVE_STATUSES:
                self.store.update("runs", run["id"], status="paused")
                self.services.emit(run["id"], "status", status="paused", message="서버 재시작으로 일시정지되었습니다. 재개할 수 있습니다.")

    def _sync(self, run_id: str) -> None:
        values = self.graph.get_state(self._config(run_id)).values or {}
        self.store.update(
            "runs", run_id,
            plan=values.get("plan", []),
            plan_summary=values.get("plan_summary", ""),
            iteration=values.get("iteration", 0),
            verdict=values.get("verdict"),
            draft=values.get("draft", ""),
        )

    def _finish(self, run_id: str, status: str, **fields: Any) -> None:
        self.store.update("runs", run_id, status=status, finished_at=now(), pending=None, **fields)
        self.services.emit(run_id, "status", status=status, **{k: v for k, v in fields.items() if k == "error"})

    def _drive(self, run_id: str, payload: Any) -> None:
        config = self._config(run_id)
        run = self.store.update("runs", run_id, status="running")
        if run and not run.get("started_at"):
            self.store.update("runs", run_id, started_at=now())
        self.services.emit(run_id, "status", status="running")
        try:
            for _ in self.graph.stream(payload, config, stream_mode="updates"):
                self._sync(run_id)
                with self._lock:
                    control = self._controls.pop(run_id, None)
                if control == "pause":
                    self.store.update("runs", run_id, status="paused")
                    self.services.emit(run_id, "status", status="paused")
                    return
                if control == "cancel":
                    self._finish(run_id, "cancelled")
                    return
            snapshot = self.graph.get_state(config)
            self._sync(run_id)
            if snapshot.interrupts:
                value = snapshot.interrupts[0].value
                self.store.update("runs", run_id, status="waiting", pending=value)
                self.services.emit(run_id, "approval_requested", **value)
            elif snapshot.next:
                self.store.update("runs", run_id, status="paused")
            else:
                values = snapshot.values or {}
                self._finish(run_id, "completed", final=values.get("final", ""))
        except Exception as e:  # 실패한 단계는 체크포인트에 남아 '다시 시도'로 이어갈 수 있다
            self._finish(run_id, "failed", error=str(e) or e.__class__.__name__)
        finally:
            with self._lock:
                self._controls.pop(run_id, None)
