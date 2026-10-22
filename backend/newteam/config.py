"""경로와 실행 정책 기본값. 모든 값은 환경 변수로 덮어쓸 수 있다."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("NEWTEAM_DATA_DIR", BACKEND_DIR / "data")))
    frontend_dist: Path = REPO_DIR / "frontend" / "dist"
    # dev: 내 PC에서 개발 / server: 다른 사람이 접속하는 배포 환경
    # NEWTEAM_HOST를 127.0.0.1·localhost가 아닌 주소로 열면 자동으로 server로 본다.
    mode: str = os.getenv("NEWTEAM_MODE", "dev")
    host: str = os.getenv("NEWTEAM_HOST", "127.0.0.1")
    # local: 작업 공간 폴더 안에서 실행(개발용, 격리 없음) / docker: 강화된 컨테이너에서 실행
    sandbox: str = os.getenv("NEWTEAM_SANDBOX", "local")
    # 위험을 알고도 서버 모드에서 local 실행을 허용할 때만 1로 설정한다.
    allow_local_sandbox: bool = os.getenv("NEWTEAM_ALLOW_LOCAL_SANDBOX", "0") == "1"
    docker_image: str = os.getenv("NEWTEAM_DOCKER_IMAGE", "python:3.12-slim")
    # runsc로 설정하면 gVisor(사용자 공간 커널) 위에서 컨테이너를 실행한다(Linux 서버 전용).
    docker_runtime: str = os.getenv("NEWTEAM_DOCKER_RUNTIME", "")
    docker_memory: str = os.getenv("NEWTEAM_DOCKER_MEMORY", "512m")
    docker_cpus: str = os.getenv("NEWTEAM_DOCKER_CPUS", "1")
    docker_pids: int = int(os.getenv("NEWTEAM_DOCKER_PIDS", "128"))
    # 비어 있으면 샌드박스 네트워크 완전 차단. 예) pypi.org,files.pythonhosted.org 면 이 도메인만 프록시로 허용
    sandbox_allowlist: list[str] = field(default_factory=lambda: [
        d.strip().lower() for d in os.getenv("NEWTEAM_SANDBOX_ALLOWLIST", "").split(",") if d.strip()
    ])
    command_timeout: int = int(os.getenv("NEWTEAM_COMMAND_TIMEOUT", "60"))
    # 1이면 누구나 회원가입 가능, 0이면 관리자만 계정을 만든다.
    allow_signup: bool = os.getenv("NEWTEAM_ALLOW_SIGNUP", "0") == "1"
    # HTTPS로 서비스할 때 1로 설정하면 세션 쿠키에 Secure 속성을 붙인다.
    secure_cookie: bool = os.getenv("NEWTEAM_SECURE_COOKIE", "0") == "1"
    session_days: int = int(os.getenv("NEWTEAM_SESSION_DAYS", "14"))

    @property
    def is_server(self) -> bool:
        return self.mode == "server" or self.host not in ("127.0.0.1", "localhost", "::1")

    @property
    def db_path(self) -> Path:
        return self.data_dir / "newteam.db"

    @property
    def checkpoint_path(self) -> Path:
        return self.data_dir / "checkpoints.db"

    @property
    def workspaces_dir(self) -> Path:
        return self.data_dir / "workspaces"

    @property
    def assets_dir(self) -> Path:
        return self.data_dir / "assets"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.workspaces_dir.mkdir(parents=True, exist_ok=True)
        self.assets_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
