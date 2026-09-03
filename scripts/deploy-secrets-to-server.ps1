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

# THE CONNECTORS, and the reason they are written down here rather than added
# to the server by hand (incident, 2026-09-03).
#
# This script does not UPDATE core.env, it REPLACES it: the lines are built
# from the maps in this file and redirected over the target with ">". So any
# variable that is not in a map here does not merely go unmanaged - it is
# DESTROYED the next time anyone runs the script for an unrelated reason.
#
# That is what happened. The Google OAuth pair, the connector encryption key
# and the web URL were added to core.env by hand on 2026-08-27 and the
# connector worked. On 2026-09-02 this script was run to ship LiveKit, and it
# rewrote the file without them. Nothing failed loudly; the API kept serving,
# and the only symptom was a user saying "the integrations cannot connect to
# google right now, it was working before" - a whole feature switched off by a
# deploy for a different feature.
#
# They are OPTIONAL rather than required because the store on a given operator
# machine may genuinely not hold them, and refusing to deploy the database and
# the transcriber because a connector key is absent would be the worse
# failure. What is NOT optional is saying so: the run prints every optional
# name it could not find, so "the connectors are unconfigured" is a sentence
# on screen instead of an absence nobody can see.
$optionalConnectors = [ordered]@{
  echo_platform_google_oauth_client_id     = "echo_platform_google_oauth_client_id"
  echo_platform_google_oauth_client_secret = "echo_platform_google_oauth_client_secret"
  echo_platform_connector_encryption_key   = "echo_platform_connector_encryption_key"
  echo_platform_microsoft_oauth_client_id     = "echo_platform_microsoft_oauth_client_id"
  echo_platform_microsoft_oauth_client_secret = "echo_platform_microsoft_oauth_client_secret"
}

# NOT a secret, and not in the store: the address the OAuth redirect comes
# back to. It lives here because core.env is the file that must hold it, and
# because the incident above was half about a value that no store owns having
# nowhere to be written down.
$literals = [ordered]@{
  echo_platform_web_url = "https://app.neurai.pt"
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
$absentConnectors = @()
foreach ($k in $optionalConnectors.Keys) {
  $v = (& $py $get $optionalConnectors[$k] | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($v)) { $absentConnectors += $k }
  else { $lines += ($k + "=" + $v) }
}
foreach ($k in $literals.Keys) { $lines += ($k + "=" + $literals[$k]) }
if ($missing.Count -gt 0) {
  Write-Error ("Missing from the store: " + ($missing -join ", "))
}
# LOUD, not silent: an absent connector name means that provider cannot be
# connected at all, and the whole point of the 2026-09-03 incident is that
# nothing said so.
if ($absentConnectors.Count -gt 0) {
  Write-Warning ("NOT DEPLOYED - absent from this machine's store, so these providers will refuse to connect: " + ($absentConnectors -join ", "))
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
# It strips CARRIAGE RETURNS for the same reason (added 2026-09-03): the pipe
# to a native process converts line endings, so the file arrived with a
# trailing lone CR and bash reported "line 15: command not found" whenever
# anything sourced it. No VALUE carried one this time - checked, and that is
# the only reason it was cosmetic rather than an outage - but a CR on the end
# of a value is invisible in every listing and would make an OAuth redirect
# URI or a database URL fail to match while reading as correct. Same seam as
# the BOM, one character along.
$content | & ssh -i $sshKey $server "sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r`$//' | grep -v '^`$' > /etc/neurai/core.env && chown root:neurai /etc/neurai/core.env && chmod 640 /etc/neurai/core.env && head -c 8 /etc/neurai/core.env | grep -q '^NODE_ENV' && echo OK: wrote /etc/neurai/core.env with `$(grep -c = /etc/neurai/core.env) entries, BOM-free"

Write-Host "Done. The services on the server can now start."
