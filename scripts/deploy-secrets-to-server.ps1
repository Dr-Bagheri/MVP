# NeurAI platform - one-shot secret provisioning for the Hetzner server.
#
# Reads the SAME secrets start-platform.ps1 uses from the local encrypted
# (DPAPI) store and writes them to /etc/neurai/env on the server (root-only,
# group-readable by the service user). Values never touch this repo, never
# appear on screen, and never land in any file on this PC.
#
# Run it from a normal PowerShell window:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-secrets-to-server.ps1
#
# NOTE: deliberately pure ASCII (PS 5.1 encoding rule - see CLAUDE.md).

$ErrorActionPreference = "Stop"

$server = "root@178.105.251.216"
$sshKey = Join-Path $env:USERPROFILE ".ssh\neurai_hetzner"

$env:NEURAI_DATA_DIR = Join-Path $env:USERPROFILE ".neurai"
$py  = Join-Path $env:LOCALAPPDATA "NeurAI\venv\Scripts\python.exe"
$get = "C:\Users\amirreza\Desktop\Neurai-Echo\backend\scripts\get_key.py"
if (-not (Test-Path $py))  { Write-Error "Secret-store python not found at $py" }
if (-not (Test-Path $get)) { Write-Error "get_key.py not found at $get" }

# env var on the server  ->  secret NAME in the DPAPI store
$names = [ordered]@{
  DATABASE_URL_APP     = "echo_platform_db_app_url"
  DATABASE_URL_AGENT   = "echo_platform_db_agent_url"
  OPENROUTER_API_KEY   = "openrouter_key"
  SUPABASE_URL         = "echo_platform_supabase_url"
  SUPABASE_SERVICE_KEY = "echo_platform_supabase_secret_key"
  SONIOX_API_KEY       = "soniox_key"
  # the video room (LiveKit). The URL is not a secret and the key is not much
  # of one, but they travel together with the secret that signs tokens - one
  # place, one deploy, no half-configured video.
  LIVEKIT_URL          = "echo_platform_livekit_url"
  LIVEKIT_API_KEY      = "echo_platform_livekit_api_key"
  LIVEKIT_API_SECRET   = "echo_platform_livekit_api_secret"
}

# OPTIONAL: a project on asymmetric signing keys (ES256, the Frankfurt
# project) has no shared JWT secret at all - core verifies via JWKS derived
# from SUPABASE_URL. The var ships only when the store actually holds one;
# requiring it here refused to deploy the exact configuration that is now
# correct (core/src/api/main.ts makes the same choice).
$optional = [ordered]@{
  SUPABASE_JWT_SECRET  = "echo_platform_jwt_secret"
}

$lines = @("NODE_ENV=production")
$missing = @()
foreach ($k in $names.Keys) {
  $v = (& $py $get $names[$k] | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($v)) { $missing += $names[$k] }
  else { $lines += ($k + "=" + $v) }
}
foreach ($k in $optional.Keys) {
  $v = (& $py $get $optional[$k] | Out-String).Trim()
  if (-not [string]::IsNullOrWhiteSpace($v)) { $lines += ($k + "=" + $v) }
}
if ($missing.Count -gt 0) {
  Write-Error ("Missing from the store: " + ($missing -join ", "))
}

Write-Host ("Fetched " + ($lines.Count - 1) + " secrets (names only shown above). Writing to server...")
$content = ($lines -join "`n") + "`n"
# TARGET: /etc/neurai/core.env - the file the systemd units actually load
# (EnvironmentFile=). This script wrote /etc/neurai/env for a day, which
# nothing reads: the deploy "succeeded" while the services kept the old
# values, and the Frankfurt cutover shipped tokens to a deleted project's
# verifier. Two files, one truth - the wrong one was ours.
# The sed strips the BOM PowerShell's pipe prepends: systemd would read the
# first variable as "﻿NODE_ENV", silently a different name (the
# CLAUDE.md encoding rule, at the deploy seam this time).
$content | & ssh -i $sshKey $server "sed '1s/^\xEF\xBB\xBF//' > /etc/neurai/core.env && chown root:neurai /etc/neurai/core.env && chmod 640 /etc/neurai/core.env && head -c 8 /etc/neurai/core.env | grep -q '^NODE_ENV' && echo OK: wrote /etc/neurai/core.env with `$(grep -c = /etc/neurai/core.env) entries, BOM-free"

Write-Host "Done. The services on the server can now start."
