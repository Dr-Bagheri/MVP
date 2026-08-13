@echo off
rem NeurAI platform - double-click starter. Runs the PowerShell script beside it.
rem Pure ASCII on purpose, like start-platform.ps1: cmd.exe reads this file in
rem the OEM codepage, so a typographic character here is a byte it cannot mean.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-platform.ps1"
pause
