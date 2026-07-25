<#
.SYNOPSIS
  Aktualisiert die Mission-Control-App auf der Synology-NAS in einem Rutsch.
.DESCRIPTION
  Klont den angegebenen Branch frisch von GitHub, fügt die Docker-Dateien
  (Dockerfile/docker-compose.yml/.dockerignore aus diesem Ordner) hinzu,
  überträgt alles per SSH auf die NAS und baut den Container neu.
  Der Ordner ./data auf der NAS (SQLite-DB + Workspace) bleibt dabei erhalten.
.EXAMPLE
  .\update.ps1
  .\update.ps1 -Branch main
  .\update.ps1 -NoRebuild        # nur Code aktualisieren, Container ohne Rebuild neu starten
#>
[CmdletBinding()]
param(
  [string]$Branch    = "claude/multi-exchange-arbitrage-RtvFj",
  [string]$NasUser   = "c4rTman",
  [string]$NasHost   = "192.168.178.159",
  [string]$RemoteDir = "/volume1/docker/mission-control",
  [string]$RepoUrl   = "https://github.com/bfloesser/mission-control.git",
  [switch]$NoRebuild
)

$ErrorActionPreference = "Stop"
$key    = "$env:USERPROFILE\.ssh\id_ed25519_nas"
$deploy = $PSScriptRoot
$work   = Join-Path $env:TEMP "mc-update"
$clone  = Join-Path $work "mission-control"
$tgz    = Join-Path $work "mc.tgz"

function Assert-Ok($msg) { if ($LASTEXITCODE -ne 0) { throw "FEHLGESCHLAGEN: $msg (exit $LASTEXITCODE)" } }

if (-not (Test-Path $key)) { throw "SSH-Key fehlt: $key" }

Write-Host "==> 1/5 Frischer Klon des Branches '$Branch'" -ForegroundColor Cyan
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $work | Out-Null
$env:GIT_TERMINAL_PROMPT = "0"
git clone --depth 1 --branch $Branch $RepoUrl $clone
Assert-Ok "git clone"
$commit = (git -C $clone log -1 --oneline)
Write-Host "    -> $commit"

Write-Host "==> 2/5 Docker-Dateien einfuegen" -ForegroundColor Cyan
Copy-Item "$deploy\Dockerfile","$deploy\docker-compose.yml","$deploy\.dockerignore","$deploy\Caddyfile" $clone -Force

Write-Host "==> 3/5 Quellcode packen" -ForegroundColor Cyan
tar -czf $tgz --exclude='./.git' --exclude='./node_modules' --exclude='./.next' --exclude='./data' -C $clone .
Assert-Ok "tar"
Write-Host ("    -> {0:N0} KB" -f ((Get-Item $tgz).Length/1KB))

Write-Host "==> 4/5 Uebertragen auf NAS (scp -O)" -ForegroundColor Cyan
scp -O -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new $tgz "${NasUser}@${NasHost}:/tmp/mc.tgz"
Assert-Ok "scp"

Write-Host "==> 5/5 Ersetzen (data/ bleibt) + Container neu bauen/starten" -ForegroundColor Cyan
$composeArgs = if ($NoRebuild) { "up -d" } else { "up -d --build" }
$remote = "set -e; find '$RemoteDir' -mindepth 1 -maxdepth 1 ! -name data -exec rm -rf {} + ; tar xzf /tmp/mc.tgz -C '$RemoteDir'; rm -f /tmp/mc.tgz; mkdir -p '$RemoteDir/data'; cd '$RemoteDir'; sudo -n /usr/local/bin/docker compose $composeArgs"
ssh -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new "${NasUser}@${NasHost}" $remote
Assert-Ok "remote rebuild"

Write-Host "==> Funktionstest" -ForegroundColor Cyan
Start-Sleep -Seconds 6
try {
  $r = Invoke-WebRequest "http://${NasHost}:4000/arbitrage" -UseBasicParsing -TimeoutSec 25
  Write-Host ("    /arbitrage  -> HTTP {0}" -f $r.StatusCode) -ForegroundColor Green
} catch { Write-Warning "/arbitrage nicht erreichbar: $($_.Exception.Message)" }

Write-Host ""
Write-Host "Fertig ($commit). App: http://${NasHost}:4000/arbitrage" -ForegroundColor Green
