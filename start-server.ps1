# 다른 사람이 접속하는 '서버 모드'로 NewTeam Studio를 실행합니다.
#  - 에이전트가 만든 코드는 Docker 샌드박스에서만 실행됩니다(Docker Desktop이 켜져 있어야 함).
#  - 처음 실행하면 브라우저에서 관리자 계정을 만드는 화면이 나옵니다.
#
# 사용법:  powershell -ExecutionPolicy Bypass -File .\start-server.ps1
#          (HTTPS 터널 뒤에서 쓸 때)  .\start-server.ps1 -Https
#          (Tailscale 등 다른 PC에서 직접 접속)  .\start-server.ps1 -BindHost 0.0.0.0
#          (에이전트가 pip install을 쓰게 허용)  .\start-server.ps1 -AllowPyPI

param([switch]$Https, [int]$Port = 8000, [string]$BindHost = "127.0.0.1", [switch]$AllowPyPI)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker가 실행 중이 아닙니다. Docker Desktop을 켠 뒤 다시 실행하세요." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path "$root\frontend\dist\index.html")) {
    Write-Host "프런트엔드 빌드가 없습니다. 먼저 빌드합니다..."
    Push-Location "$root\frontend"; npm install; npm run build; Pop-Location
}
Write-Host "샌드박스 이미지를 준비합니다(처음 한 번만 오래 걸립니다)..."
docker pull -q python:3.12-slim | Out-Null

$env:NEWTEAM_MODE = "server"
$env:NEWTEAM_SANDBOX = "docker"
$env:NEWTEAM_PORT = "$Port"
$env:NEWTEAM_HOST = $BindHost
if ($Https) { $env:NEWTEAM_SECURE_COOKIE = "1" }
# 샌드박스는 기본적으로 인터넷이 막혀 있다. PyPI만 프록시로 허용한다.
if ($AllowPyPI) { $env:NEWTEAM_SANDBOX_ALLOWLIST = "pypi.org,files.pythonhosted.org" }

Write-Host "NewTeam Studio 서버 모드: http://${BindHost}:$Port" -ForegroundColor Green
Set-Location "$root\backend"
& "$root\backend\.venv\Scripts\python.exe" -m newteam
