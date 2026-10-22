"""실행별 격리 작업 공간 — OpenHands SDK의 작업 공간 개념에 대응.

각 실행(run)은 data/workspaces/<run_id> 폴더를 하나씩 받는다. 파일 경로는 이 폴더
밖으로 나갈 수 없고, 명령은 아래 중 하나에서 실행된다.

- local  : 개발용. 작업 공간 폴더를 현재 디렉터리로 하는 하위 프로세스(시간 제한, 위험 명령 차단).
           서버와 같은 권한으로 돌기 때문에 격리가 없으며, 서버 모드에서는 실행을 거부한다.
- docker : 강화된 일회용 컨테이너(NEWTEAM_SANDBOX=docker). 네트워크 차단, root 아님, 권한 제거,
           읽기 전용 루트, 자원 제한. NEWTEAM_DOCKER_RUNTIME=runsc면 gVisor 커널 위에서 실행한다.

OpenHands SDK가 설치되어 있으면 개발 단계 전체를 OpenHands 에이전트에 맡길 수도 있다.

    pip install openhands-sdk openhands-tools
"""

from __future__ import annotations

import importlib.util
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from ..config import settings

BLOCKED = [
    r"\brm\s+-rf\s+[/~]",
    r"\bshutdown\b",
    r"\breboot\b",
    r"\bmkfs\b",
    r"\bformat\s+[a-z]:",
    r"\bdel\s+/[sq]",
    r":\(\)\s*\{",  # fork bomb
    r"\b(curl|wget)\b[^|]*\|\s*(ba)?sh",
    r"\.\.[/\\]",
]
MAX_OUTPUT = 8000


class WorkspaceError(ValueError):
    pass


class Workspace:
    def __init__(self, run_id: str):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", run_id):
            raise WorkspaceError("잘못된 실행 ID")
        self.root = (settings.workspaces_dir / run_id).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def resolve(self, rel: str) -> Path:
        path = (self.root / rel).resolve()
        if not path.is_relative_to(self.root):
            raise WorkspaceError(f"작업 공간 밖의 경로는 사용할 수 없습니다: {rel}")
        return path

    def write_file(self, rel: str, content: str) -> str:
        path = self.resolve(rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path.relative_to(self.root).as_posix()

    def read_file(self, rel: str, max_bytes: int = 200_000) -> dict[str, Any]:
        path = self.resolve(rel)
        if not path.is_file():
            raise WorkspaceError(f"파일이 없습니다: {rel}")
        raw = path.read_bytes()[:max_bytes]
        try:
            return {"path": rel, "content": raw.decode("utf-8"), "binary": False}
        except UnicodeDecodeError:
            return {"path": rel, "content": "", "binary": True}

    def list_files(self) -> list[dict[str, Any]]:
        files = []
        for p in sorted(self.root.rglob("*")):
            if p.is_file() and ".openhands" not in p.parts and ".pydeps" not in p.parts:
                files.append({"path": p.relative_to(self.root).as_posix(), "size": p.stat().st_size})
        return files

    def run(self, command: str, timeout: int | None = None) -> dict[str, Any]:
        timeout = timeout or settings.command_timeout
        for pattern in BLOCKED:
            if re.search(pattern, command, re.I):
                return _refused(command, "보안 정책으로 차단된 명령입니다.")
        if settings.sandbox == "docker":
            return self._run_docker(command, timeout)
        if settings.is_server and not settings.allow_local_sandbox:
            return _refused(command, LOCAL_REFUSED)
        return self._run_local(command, timeout)

    def _run_local(self, command: str, timeout: int) -> dict[str, Any]:
        """개발용: 서버와 같은 사용자 권한으로 실행되므로 격리가 없다."""
        started = time.time()
        # 'python'은 서버와 같은 인터프리터로 실행해 Windows/가상환경 차이를 없앤다.
        args = re.sub(r"^(python3?|py)\b", lambda _: f'"{sys.executable}"', command.strip())
        env = {
            "PATH": os.environ.get("PATH", ""),
            "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
            "HOME": str(self.root),
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUTF8": "1",
        }
        try:
            proc = subprocess.run(args, cwd=self.root, shell=True, capture_output=True, timeout=timeout, env=env)
            code, out, err = proc.returncode, proc.stdout, proc.stderr
        except subprocess.TimeoutExpired as e:
            code, out, err = -1, e.stdout or b"", (e.stderr or b"") + f"\n{timeout}초 시간 제한 초과".encode()
        return _result(command, code, out, err, started)

    def _run_docker(self, command: str, timeout: int) -> dict[str, Any]:
        if not shutil.which("docker"):
            return _refused(command, "docker를 찾을 수 없습니다. Docker를 설치하고 실행하세요.")
        if settings.sandbox_allowlist:
            try:
                ensure_egress()
            except (WorkspaceError, subprocess.TimeoutExpired) as e:
                return _refused(command, str(e))
        started = time.time()
        name = f"newteam-{self.root.name}-{uuid.uuid4().hex[:8]}"
        try:
            # docker CLI 자체는 신뢰하는 프로세스이므로 서버 환경 변수를 그대로 쓴다(컨테이너에는 전달되지 않는다).
            proc = subprocess.run(docker_args(self.root, name, command), capture_output=True, timeout=timeout)
            code, out, err = proc.returncode, proc.stdout, proc.stderr
        except subprocess.TimeoutExpired as e:
            # docker 클라이언트만 끝내면 컨테이너는 계속 돌 수 있으므로 이름으로 확실히 종료한다.
            subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=30)
            code, out, err = -1, e.stdout or b"", (e.stderr or b"") + f"\n{timeout}초 시간 제한 초과 — 컨테이너를 종료했습니다.".encode()
        if code == 125:  # docker 자체 오류(이미지 없음, 데몬 꺼짐, 런타임 없음 등)
            err += "\n[docker] 샌드박스 컨테이너를 시작하지 못했습니다. Docker 실행 여부와 이미지·런타임 설정을 확인하세요.".encode()
        return _result(command, code, out, err, started)


LOCAL_REFUSED = (
    "서버 모드에서는 local 샌드박스로 명령을 실행하지 않습니다(격리가 없어 서버의 API 키·DB를 읽을 수 있습니다). "
    "NEWTEAM_SANDBOX=docker로 설정하세요."
)


# ---- 허용 목록 네트워크 ----
# 샌드박스는 외부와 끊긴 내부 네트워크에만 붙고, 같은 네트워크의 squid 프록시만 바깥(bridge)에 나갈 수 있다.
# 프록시는 허용 목록 도메인만 통과시키므로 pip install은 되지만 다른 곳으로는 나갈 수 없다.
EGRESS_NETWORK = "newteam-sandbox"
EGRESS_PROXY = "newteam-egress"
EGRESS_IMAGE = "ubuntu/squid:latest"
DOMAIN_RE = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")
_egress_lock = threading.Lock()
_egress_started = False  # 이 서버 프로세스에서 현재 허용 목록으로 프록시를 띄웠는지


def squid_conf(domains: list[str]) -> str:
    bad = [d for d in domains if not DOMAIN_RE.match(d)]
    if bad:
        raise WorkspaceError(f"NEWTEAM_SANDBOX_ALLOWLIST에 잘못된 도메인이 있습니다: {', '.join(bad)}")
    return "\n".join([
        "http_port 3128",
        "max_filedescriptors 1024",  # 기본값(컨테이너 ulimit)이면 squid가 메모리를 과하게 잡아 OOM으로 죽는다
        "acl allowed dstdomain " + " ".join(f".{d}" for d in domains),  # 앞의 점: 하위 도메인 포함
        "acl SSL_ports port 443",
        "acl Safe_ports port 80 443",
        "acl CONNECT method CONNECT",
        "http_access deny !Safe_ports",
        "http_access deny CONNECT !SSL_ports",
        "http_access allow allowed",
        "http_access deny all",
        "cache deny all",
        "",
    ])


def _docker(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(["docker", *args], capture_output=True, timeout=120)
    if check and proc.returncode != 0:
        raise WorkspaceError(f"샌드박스 네트워크 준비 실패(docker {args[0]}): {_decode(proc.stderr).strip()}")
    return proc


def ensure_egress() -> None:
    """허용 목록 프록시와 내부 네트워크를 준비한다. 프록시가 죽었거나 서버가 재시작되면 다시 만든다."""
    global _egress_started
    with _egress_lock:
        running = _docker("inspect", "-f", "{{.State.Running}}", EGRESS_PROXY, check=False).stdout.strip() == b"true"
        if _egress_started and running:
            return
        conf = settings.data_dir / "egress" / "squid.conf"
        conf.parent.mkdir(parents=True, exist_ok=True)
        conf.write_text(squid_conf(settings.sandbox_allowlist), encoding="utf-8", newline="\n")
        if _docker("network", "inspect", EGRESS_NETWORK, check=False).returncode != 0:
            _docker("network", "create", "--internal", EGRESS_NETWORK)
        _docker("rm", "-f", EGRESS_PROXY, check=False)
        _docker("run", "-d", "--name", EGRESS_PROXY, "--network", EGRESS_NETWORK, "--memory", "128m",
                "-v", f"{conf}:/etc/squid/squid.conf:ro", EGRESS_IMAGE)
        _docker("network", "connect", "bridge", EGRESS_PROXY)  # 프록시만 바깥으로 나가는 다리를 가진다
        deadline = time.time() + 30
        while b"Accepting HTTP" not in (logs := _docker("logs", EGRESS_PROXY, check=False)).stdout + logs.stderr:
            if time.time() > deadline:
                raise WorkspaceError("허용 목록 프록시가 30초 안에 시작되지 않았습니다.")
            time.sleep(0.5)
        _egress_started = True


def docker_args(root: Path, name: str, command: str) -> list[str]:
    """강화된 일회용 컨테이너 실행 인자. 작업 공간 폴더만 쓰기 가능하게 마운트한다."""
    if hasattr(os, "getuid"):
        user = f"{os.getuid()}:{os.getgid()}"  # 작업 공간 파일 소유자를 서버 사용자와 맞춘다
    else:
        user = "1000:1000"  # Windows(Docker Desktop)는 마운트 권한을 자체 처리한다
    if settings.sandbox_allowlist:
        proxy = f"http://{EGRESS_PROXY}:3128"
        network = [
            "--network", EGRESS_NETWORK,
            *[x for var in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy") for x in ("-e", f"{var}={proxy}")],
            # pip 패키지는 작업 공간에 설치해 같은 실행의 다음 명령에서도 쓸 수 있게 한다(루트는 읽기 전용).
            "-e", "PIP_TARGET=/workspace/.pydeps", "-e", "PYTHONPATH=/workspace/.pydeps",
            "-e", "PIP_NO_CACHE_DIR=1", "-e", "PIP_DISABLE_PIP_VERSION_CHECK=1",
        ]
    else:
        network = ["--network", "none"]  # 외부 통신 완전 차단
    args = [
        "docker", "run", "--rm", "--name", name,
        *network,
        "--memory", settings.docker_memory, "--memory-swap", settings.docker_memory,
        "--cpus", settings.docker_cpus,
        "--pids-limit", str(settings.docker_pids),  # 포크 폭탄 방지
        "--user", user,  # root가 아닌 사용자
        "--cap-drop", "ALL",  # 리눅스 권한 전부 제거
        "--security-opt", "no-new-privileges",  # setuid 등으로 권한 상승 차단
        "--read-only",  # 루트 파일시스템 읽기 전용
        "--tmpfs", "/tmp:rw,size=256m",  # pip가 내려받은 휠을 잠시 풀어 둘 공간
        "-e", "HOME=/tmp",
        "-e", "PYTHONDONTWRITEBYTECODE=1",
        "-v", f"{root}:/workspace:rw",
        "-w", "/workspace",
    ]
    if settings.docker_runtime:
        args += ["--runtime", settings.docker_runtime]  # 예: runsc(gVisor)
    return args + [settings.docker_image, "sh", "-c", command]


def _refused(command: str, reason: str) -> dict[str, Any]:
    return {"command": command, "exit_code": -1, "stdout": "", "stderr": reason, "duration": 0}


def _result(command: str, code: int, out: bytes, err: bytes, started: float) -> dict[str, Any]:
    return {
        "command": command,
        "exit_code": code,
        "stdout": _decode(out)[-MAX_OUTPUT:],
        "stderr": _decode(err)[-MAX_OUTPUT:],
        "duration": round(time.time() - started, 2),
    }


def _decode(raw: bytes) -> str:
    for enc in ("utf-8", "cp949"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


# ---- OpenHands SDK 연결 ----

def openhands_available() -> bool:
    return importlib.util.find_spec("openhands") is not None and importlib.util.find_spec("openhands.sdk") is not None


def run_openhands(ws: Workspace, instruction: str, provider_id: str, model: str, config: dict[str, Any]) -> dict[str, Any]:
    """OpenHands 에이전트에게 작업 공간 안에서 단계 하나를 통째로 맡긴다."""
    if settings.is_server and not settings.allow_local_sandbox:
        # OpenHands 로컬 작업 공간은 서버 프로세스와 같은 권한으로 명령을 실행한다.
        raise WorkspaceError("서버 모드에서는 OpenHands 로컬 실행을 막습니다. 앱 설정에서 내장 실행기(docker 샌드박스)를 사용하세요.")
    from openhands.sdk import LLM, Agent, Conversation, Tool
    from openhands.tools.file_editor import FileEditorTool
    from openhands.tools.terminal import TerminalTool

    prefix = {"anthropic": "anthropic", "openai": "openai", "gemini": "gemini", "compat": "openai"}.get(provider_id)
    if prefix is None:
        raise WorkspaceError("OpenHands 모드에는 Anthropic·OpenAI·Gemini 또는 OpenAI 호환 모델이 필요합니다.")
    llm_kwargs: dict[str, Any] = {"model": f"{prefix}/{model}"}
    api_key = config.get("api_key") or os.getenv({"anthropic": "ANTHROPIC_API_KEY", "gemini": "GEMINI_API_KEY"}.get(prefix, "OPENAI_API_KEY"))
    if api_key:
        llm_kwargs["api_key"] = api_key
    if provider_id == "compat" and config.get("base_url"):
        llm_kwargs["base_url"] = config["base_url"]
    agent = Agent(llm=LLM(**llm_kwargs), tools=[Tool(name=TerminalTool.name), Tool(name=FileEditorTool.name)])
    before = {f["path"] for f in ws.list_files()}
    conversation = Conversation(agent=agent, workspace=str(ws.root))
    conversation.send_message(instruction)
    conversation.run()
    after = ws.list_files()
    return {
        "engine": "openhands",
        "files": [f["path"] for f in after if f["path"] not in before],
        "commands": [],
    }
