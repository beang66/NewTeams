"""샌드박스 격리 테스트.

단위 테스트는 항상 돌고, 실제 컨테이너 탈출 시도 테스트는 Docker 데몬이 켜져 있을 때만 돈다.
"""

import shutil
import subprocess
import time

import pytest

from newteam.config import settings
from newteam.tools import workspace as ws_mod
from newteam.tools.workspace import LOCAL_REFUSED, Workspace, WorkspaceError, docker_args, run_openhands


@pytest.fixture
def server_mode(monkeypatch):
    monkeypatch.setattr(settings, "mode", "server")
    monkeypatch.setattr(settings, "sandbox", "local")
    monkeypatch.setattr(settings, "allow_local_sandbox", False)


# ---------------------------------------------------------------- 단위 테스트

def test_server_detection(monkeypatch):
    monkeypatch.setattr(settings, "mode", "dev")
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    assert not settings.is_server
    monkeypatch.setattr(settings, "host", "0.0.0.0")
    assert settings.is_server
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "mode", "server")
    assert settings.is_server


def test_local_sandbox_refused_in_server_mode(server_mode, tmp_path):
    ws = Workspace("run_srv")
    marker = tmp_path / "should-not-exist.txt"
    out = ws.run(f'python -c "open(r\'{marker}\', \'w\').write(\'x\')"')
    assert out["exit_code"] == -1 and out["stderr"] == LOCAL_REFUSED
    assert not marker.exists()


def test_local_sandbox_escape_hatch(server_mode, monkeypatch):
    monkeypatch.setattr(settings, "allow_local_sandbox", True)
    ws = Workspace("run_srv_ok")
    ws.write_file("a.py", "print('ok')")
    assert Workspace("run_srv_ok").run("python a.py")["exit_code"] == 0


def test_openhands_refused_in_server_mode(server_mode):
    with pytest.raises(WorkspaceError, match="서버 모드"):
        run_openhands(Workspace("run_oh"), "x", "anthropic", "m", {})


def test_docker_args_are_hardened(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "docker_runtime", "")
    args = docker_args(tmp_path, "newteam-x", "python a.py")
    joined = " ".join(args)
    for flag in ("--network none", "--cap-drop ALL", "--security-opt no-new-privileges", "--read-only",
                 "--pids-limit 128", "--memory 512m", "--memory-swap 512m", "--cpus 1", "--name newteam-x"):
        assert flag in joined, flag
    user = args[args.index("--user") + 1]
    assert not user.startswith("0:")
    assert f"{tmp_path}:/workspace:rw" in args
    assert "--runtime" not in args
    # 서버의 환경 변수(API 키 등)를 컨테이너에 넘기지 않는다
    env_values = [args[i + 1] for i, a in enumerate(args) if a == "-e"]
    assert all(not v.startswith(("ANTHROPIC", "OPENAI")) for v in env_values)
    assert args[-3:] == ["sh", "-c", "python a.py"]


def test_docker_runtime_option(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "docker_runtime", "runsc")
    args = docker_args(tmp_path, "n", "true")
    assert args[args.index("--runtime") + 1] == "runsc"


def test_timeout_force_removes_container(monkeypatch):
    monkeypatch.setattr(settings, "sandbox", "docker")
    monkeypatch.setattr(ws_mod.shutil, "which", lambda _: "docker")
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args[:2] == ["docker", "run"]:
            raise subprocess.TimeoutExpired(args, kwargs.get("timeout"))
        return subprocess.CompletedProcess(args, 0, b"", b"")

    monkeypatch.setattr(ws_mod.subprocess, "run", fake_run)
    out = Workspace("run_to").run("sleep 100", timeout=1)
    name = calls[0][calls[0].index("--name") + 1]
    assert calls[1] == ["docker", "rm", "-f", name]
    assert out["exit_code"] == -1 and "컨테이너를 종료" in out["stderr"]


def test_allowlist_uses_internal_network_and_proxy(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "sandbox_allowlist", ["pypi.org"])
    args = docker_args(tmp_path, "n", "pip install six")
    assert args[args.index("--network") + 1] == ws_mod.EGRESS_NETWORK
    assert "none" not in args
    assert f"HTTPS_PROXY=http://{ws_mod.EGRESS_PROXY}:3128" in args
    assert "PIP_TARGET=/workspace/.pydeps" in args


def test_squid_conf_validates_domains():
    conf = ws_mod.squid_conf(["pypi.org", "files.pythonhosted.org"])
    assert "acl allowed dstdomain .pypi.org .files.pythonhosted.org" in conf
    assert conf.rstrip().splitlines()[-2:] == ["http_access deny all", "cache deny all"]
    # 설정 파일 주입(줄바꿈으로 규칙 추가) 차단
    with pytest.raises(WorkspaceError):
        ws_mod.squid_conf(["pypi.org\nhttp_access allow all"])
    with pytest.raises(WorkspaceError):
        ws_mod.squid_conf(["*"])


def test_egress_failure_refuses_command(monkeypatch):
    monkeypatch.setattr(settings, "sandbox", "docker")
    monkeypatch.setattr(settings, "sandbox_allowlist", ["pypi.org"])
    monkeypatch.setattr(ws_mod.shutil, "which", lambda _: "docker")

    def boom():
        raise WorkspaceError("프록시 실패")

    monkeypatch.setattr(ws_mod, "ensure_egress", boom)
    monkeypatch.setattr(ws_mod.subprocess, "run", lambda *a, **k: pytest.fail("컨테이너를 띄우면 안 됨"))
    out = Workspace("run_eg").run("pip install six")
    assert out["exit_code"] == -1 and out["stderr"] == "프록시 실패"


# ---------------------------------------------------------------- 실제 컨테이너

def _docker_ready() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        return subprocess.run(["docker", "info"], capture_output=True, timeout=20).returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


docker_only = pytest.mark.skipif(not _docker_ready(), reason="Docker 데몬이 실행 중이 아님")


@pytest.fixture(scope="module")
def image():
    subprocess.run(["docker", "pull", "-q", settings.docker_image], capture_output=True, timeout=600)
    return settings.docker_image


@pytest.fixture
def docker_ws(monkeypatch, image):
    monkeypatch.setattr(settings, "sandbox", "docker")
    monkeypatch.setattr(settings, "mode", "server")
    return Workspace("run_docker")


@docker_only
def test_container_runs_workspace_code(docker_ws):
    docker_ws.write_file("a.py", "open('out.txt','w').write('hi'); print('안녕')")
    out = docker_ws.run("python a.py")
    assert out["exit_code"] == 0, out
    assert "안녕" in out["stdout"]
    assert docker_ws.read_file("out.txt")["content"] == "hi"


@docker_only
def test_container_cannot_read_server_db(docker_ws):
    # 서버 DB와 API 키는 작업 공간 밖(data 폴더)에 있다. 컨테이너에는 작업 공간만 보인다.
    settings.db_path.write_text("SECRET-API-KEY-1234")
    script = (
        "import os\n"
        f"paths = [r'{settings.db_path.as_posix()}', '/workspace/../newteam.db', '/data/newteam.db']\n"
        "found = [p for p in paths if os.path.exists(p)]\n"
        "hits = []\n"
        "for root, _, files in os.walk('/'):\n"
        "    if root.startswith(('/proc', '/sys')): continue\n"
        "    hits += [os.path.join(root, f) for f in files if f == 'newteam.db']\n"
        "print('FOUND' if found or hits else 'CLEAN', found, hits)\n"
    )
    docker_ws.write_file("probe.py", script)
    out = docker_ws.run("python probe.py")
    assert out["exit_code"] == 0, out
    assert "CLEAN" in out["stdout"], out["stdout"]


@docker_only
def test_container_has_no_network(docker_ws):
    docker_ws.write_file("net.py", "import urllib.request\nurllib.request.urlopen('http://1.1.1.1', timeout=3)\n")
    out = docker_ws.run("python net.py")
    assert out["exit_code"] != 0
    assert "Errno" in out["stderr"] or "unreachable" in out["stderr"].lower()


@docker_only
def test_container_is_unprivileged_and_read_only(docker_ws):
    out = docker_ws.run("id -u; touch /etc/pwned 2>&1; echo rc=$?")
    lines = out["stdout"].split()
    assert lines[0] != "0"  # root가 아님
    assert "rc=1" in out["stdout"]  # 루트 파일시스템에 쓸 수 없음


@docker_only
def test_container_env_has_no_secrets(docker_ws, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-not-leak")
    out = docker_ws.run("env")
    assert "sk-should-not-leak" not in out["stdout"]


@docker_only
def test_timeout_leaves_no_container(docker_ws):
    out = docker_ws.run("sleep 60", timeout=3)
    assert out["exit_code"] == -1
    time.sleep(1)
    ps = subprocess.run(["docker", "ps", "-aq", "--filter", "name=newteam-run_docker"], capture_output=True, text=True)
    assert ps.stdout.strip() == ""


@docker_only
def test_fork_bomb_is_contained(docker_ws):
    docker_ws.write_file("bomb.py", "import os\nfor _ in range(1000):\n    try:\n        os.fork()\n    except OSError:\n        print('LIMIT'); break\n")
    out = docker_ws.run("python bomb.py", timeout=30)
    assert "LIMIT" in out["stdout"]


@pytest.fixture
def egress_ws(docker_ws, monkeypatch):
    monkeypatch.setattr(settings, "sandbox_allowlist", ["pypi.org", "files.pythonhosted.org"])
    monkeypatch.setattr(ws_mod, "_egress_started", False)  # 테스트용 data 폴더에 설정을 새로 쓰게 한다
    return docker_ws


EGRESS_PROBE = """import urllib.request
def get(url, proxy=True):
    opener = urllib.request.build_opener() if proxy else urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        return opener.open(url, timeout=10).status
    except Exception as e:
        return 'BLOCKED'
print('allowed', get('https://pypi.org/simple/six/'))
print('other', get('https://example.com/'))
print('ip', get('http://1.1.1.1/'))
print('bypass', get('https://pypi.org/simple/six/', proxy=False))
"""


@docker_only
def test_allowlist_only_reaches_allowed_domains(egress_ws):
    egress_ws.write_file("egress.py", EGRESS_PROBE)
    out = egress_ws.run("python egress.py", timeout=90)
    assert out["exit_code"] == 0, out
    lines = dict(line.split(" ", 1) for line in out["stdout"].strip().splitlines())
    assert lines == {"allowed": "200", "other": "BLOCKED", "ip": "BLOCKED", "bypass": "BLOCKED"}, out["stdout"]


@docker_only
def test_pip_install_through_allowlist(egress_ws):
    out = egress_ws.run("pip install -q six", timeout=120)
    assert out["exit_code"] == 0, out
    # 설치한 패키지는 같은 실행의 다음 명령에서도 쓸 수 있고, 파일 목록에는 보이지 않는다
    out = egress_ws.run("python -c 'import six; print(six.__version__)'")
    assert out["exit_code"] == 0 and out["stdout"].strip(), out
    assert not [f for f in egress_ws.list_files() if f["path"].startswith(".pydeps")]
