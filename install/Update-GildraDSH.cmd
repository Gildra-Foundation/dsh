@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-GildraDSH.ps1"
if errorlevel 1 pause
