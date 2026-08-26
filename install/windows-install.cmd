@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-install.ps1"
set "GILDRA_EXIT_CODE=%ERRORLEVEL%"
if not "%GILDRA_EXIT_CODE%"=="0" pause
exit /b %GILDRA_EXIT_CODE%
