@echo off
echo cmd_started=%DATE% %TIME%
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0worker.ps1"
