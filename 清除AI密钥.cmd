@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\clear-local-ai.ps1"
if errorlevel 1 (
  echo.
  echo Clear failed. See the message above.
)
echo.
pause
endlocal
