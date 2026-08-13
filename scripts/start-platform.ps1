# NeurAI platform - one-command local start.
#
# Starts everything the platform needs, each piece in its own window:
#   core api   :8080  (identity, calls, members, audit - the product's brain)
#   ml         :7801  (speech: VAD, transcription, diarization)
#   worker            (processes recordings through the pipeline)
#   web        :3100  (the app you open in the browser)
#
# Secrets are fetched from the local encrypted (DPAPI) store AT RUNTIME.
# No secret is ever written to disk by this script, and this file is safe
# to commit because it contains only the NAMES of secrets, never values.
#
# Idempotent: anything already running (by port / process) is left alone,
# so re-running this after a crash restarts only what died.
#
# NOTE: this file is deliberately pure ASCII. PowerShell 5.1 reads BOM-less
# UTF-8 as ANSI, and a mangled typographic character can become a stray
# quote that breaks parsing (see CLAUDE.md, the Windows encoding rule).

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot   # mvp/ (this file lives in mvp/scripts/)

# --- secret store access (NeurAI DPAPI store; names only, values fetched live) ---
$env:NEURAI_DATA_DIR = Join-Path $env:USERPROFILE ".neurai"
$py  = Join-Path $env:LOCALAPPDATA "NeurAI\venv\Scripts\python.exe"
$get = Join-Path (Split-Path -Parent $repo) "Neurai-Echo\backend\scripts\get_key.py"
if (-not (Test-Path $py))  { Write-Error "Secret-store python not found at $py - install the NeurAI engine first." }
if (-not (Test-Path $get)) { Write-Error "get_key.py not found at $get - the Neurai-Echo repo must sit beside mvp/." }

function Get-StoreSecret([string]$name, [bool]$required) {
  $v = & $py $get $name
  if ($required -and [string]::IsNullOrWhiteSpace($v)) {
    Write-Error "Secret '$name' is missing from the store - store it with store_secret_key.py and re-run."
  }
  return $v
}

Write-Host "Fetching secrets from the encrypted store (names only are ever shown)..."
$env:DATABASE_URL_APP    = Get-StoreSecret "echo_platform_db_app_url"   $true
$env:DATABASE_URL_AGENT  = Get-StoreSecret "echo_platform_db_agent_url" $true
$env:SUPABASE_JWT_SECRET = Get-StoreSecret "echo_platform_jwt_secret"   $true
$env:OPENROUTER_API_KEY  = Get-StoreSecret "openrouter_key"             $true
$env:SUPABASE_URL        = Get-StoreSecret "echo_platform_supabase_url" $true
$env:SUPABASE_SERVICE_KEY = Get-StoreSecret "echo_platform_supabase_secret_key" $true
$env:SONIOX_API_KEY      = Get-StoreSecret "soniox_key"                 $false  # optional: ml runs stubbed without it

function Test-PortListening([int]$port) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  return ($null -ne $c)
}

function Start-Piece([string]$label, [string]$workdir, [string]$command) {
  # Child windows inherit this process's environment (the secrets above).
  # cmd /k keeps the window open so crashes stay readable.
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k", $command `
    -WorkingDirectory $workdir -WindowStyle Minimized
  Write-Host ("  started: {0}" -f $label)
}

$pnpm = Join-Path $env:APPDATA "npm\pnpm.cmd"

# --- core api (:8080) ---
if (Test-PortListening 8080) { Write-Host "  already running: core api (:8080)" }
else { Start-Piece "core api (:8080)" (Join-Path $repo "core") "node --experimental-strip-types src/api/main.ts" }

# --- ml speech service (:7801) ---
if (Test-PortListening 7801) { Write-Host "  already running: ml (:7801)" }
else { Start-Piece "ml (:7801)" (Join-Path $repo "ml") ($pnpm + " dev") }

# --- worker (no port; detected by command line) ---
$workerAlive = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match "worker[\\/]main\.ts" }
if ($workerAlive) { Write-Host "  already running: worker" }
else { Start-Piece "worker" (Join-Path $repo "core") "node --experimental-strip-types src/worker/main.ts" }

# --- web app (:3100) ---
if (Test-PortListening 3100) { Write-Host "  already running: web (:3100)" }
else { Start-Piece "web (:3100)" (Join-Path $repo "web") ($pnpm + " dev") }

Write-Host ""
Write-Host "Waiting for the web app to answer..."
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:3100/fa" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { break }
  } catch { Start-Sleep -Seconds 2 }
}

Start-Process "http://localhost:3100"
Write-Host "NeurAI is up: http://localhost:3100 (each service runs in its own minimized window)"
