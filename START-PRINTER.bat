@echo off
title SelfPrint - Printer Service
color 0A
cd /d "%~dp0"

echo ================================================
echo            SELFPRINT - PRINTER SERVICE
echo ================================================
echo.
echo  Keep this window OPEN while the shop is running.
echo  Closing it stops printing.
echo.
echo ------------------------------------------------

REM --- Check Node.js is installed ---
where node >nul 2>nul
if errorlevel 1 (
  color 0C
  echo.
  echo  [PROBLEM] Node.js is not installed.
  echo.
  echo  FIX: Install from  https://nodejs.org
  echo       Pick the "LTS" button, run it, click Next/Next/Finish.
  echo       Then restart this file.
  echo.
  pause
  exit /b
)

REM --- Check config exists ---
if not exist "agent\config.json" (
  color 0C
  echo.
  echo  [PROBLEM] Missing file: agent\config.json
  echo.
  echo  FIX: Call the developer. Send a screenshot of this window.
  echo.
  pause
  exit /b
)

REM --- First-time install if needed ---
if not exist "node_modules" (
  echo.
  echo  First-time setup... installing. This may take 2-5 minutes.
  echo  Do NOT close the window. Wait for it to finish.
  echo.
  REM Plain install. better-sqlite3 is an optionalDependency: if it fails to
  REM build (no C++ tools) npm continues anyway. sharp's binaries still install.
  call npm install
  if errorlevel 1 (
    color 0C
    echo.
    echo  [PROBLEM] Setup failed. Check internet connection and try again.
    echo  If it keeps failing, send a photo of this window to the developer.
    echo.
    pause
    exit /b
  )
)

:run
echo.
echo  Starting printer service...
echo  When you see "Connected" below, printing is LIVE.
echo ------------------------------------------------
echo.
call npm run agent

REM --- If it crashes, auto-restart ---
color 0E
echo.
echo  Printer service stopped. Restarting in 5 seconds...
echo  (If this keeps repeating, send a photo to the developer.)
timeout /t 5 /nobreak >nul
color 0A
goto run
