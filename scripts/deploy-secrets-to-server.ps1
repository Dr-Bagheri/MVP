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
  SUPABASE_JWT_SECRET  = "echo_platform_jwt_secret"
  OPENROUTER_API_KEY   = "openrouter_key"
  SUPABASE_URL         = "echo_platform_supabase_url"
  SUPABASE_SERVICE_KEY = "echo_platform_supabase_secret_key"
  SONIOX_API_KEY       = "soniox_key"
}

$lines = @("NODE_ENV=production")
$missing = @()
foreach ($k in $names.Keys) {
  $v = (& $py $get $names[$k] | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($v)) { $missing += $names[$k] }
  else { $lines += ($k + "=" + $v) }
}
if ($missing.Count -gt 0) {
  Write-Error ("Missing from the store: " + ($missing -join ", "))
}

Write-Host ("Fetched " + ($lines.Count - 1) + " secrets (names only shown above). Writing to server...")
$content = ($lines -join "`n") + "`n"
$content | & ssh -i $sshKey $server "cat > /etc/neurai/env && chown root:neurai /etc/neurai/env && chmod 640 /etc/neurai/env && echo OK: wrote /etc/neurai/env with `$(grep -c = /etc/neurai/env) entries"

Write-Host "Done. The services on the server can now start."
