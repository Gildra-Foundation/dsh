@echo off
set "INSTALL_ROOT=%LOCALAPPDATA%\GildraDSH"
if not "%GILDRA_DSH_INSTALL_ROOT%"=="" set "INSTALL_ROOT=%GILDRA_DSH_INSTALL_ROOT%"
if exist "%INSTALL_ROOT%\bin\Update-GildraDSH.cmd" (
  call "%INSTALL_ROOT%\bin\Update-GildraDSH.cmd"
) else (
  echo Подключаем безопасные обновления к существующей установке Gildra DSH...
  powershell.exe -NoProfile -Command "$needle = Join-Path '%INSTALL_ROOT%' 'source\apps\cli\lib\bin.js'; Get-CimInstance Win32_Process ^| Where-Object { $_.CommandLine -like ('*' + $needle + '*') } ^| ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
  call "%~dp0install\windows-install.cmd"
)
