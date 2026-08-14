# NeurAI platform - clean stop. Companion to start-platform.ps1.
# Stops the four local services by port/process; safe to run when
# nothing is running. Pure ASCII on purpose (see start-platform.ps1).

$ErrorActionPreference = "SilentlyContinue"

function Stop-ByPort([int]$port, [string]$label) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  if (-not $pids) { Write-Host ("  not running: {0}" -f $label); return }
  foreach ($procId in $pids) {
    try { Stop-Process -Id $procId -Force -Confirm:$false } catch {}
  }
  Write-Host ("  stopped: {0}" -f $label)
}

Stop-ByPort 3100 "web (:3100)"
Stop-ByPort 8080 "core api (:8080)"
Stop-ByPort 7801 "ml (:7801)"

$workers = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match "worker[\\/]main\.ts" }
if ($workers) {
  foreach ($w in $workers) { try { Stop-Process -Id $w.ProcessId -Force -Confirm:$false } catch {} }
  Write-Host "  stopped: worker"
} else {
  Write-Host "  not running: worker"
}

Write-Host "NeurAI stopped. start-platform.cmd brings it all back."
