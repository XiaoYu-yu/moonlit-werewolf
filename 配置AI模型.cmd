@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-local-ai.ps1"
if errorlevel 1 (
  echo.
  echo Configuration failed. See the message above.
)
echo.
pause
endlocal
