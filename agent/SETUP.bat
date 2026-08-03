@echo off
title SelfPrint - One-Click Setup
color 0B
cd /d "%~dp0.."

echo ================================================
echo       SELFPRINT - ONE-CLICK PRINTER SETUP
echo ================================================
echo.
echo  This sets up the printer service to run by itself,
echo  every time this computer turns on. Run this ONCE.
echo ------------------------------------------------
echo.

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

REM --- Install dependencies only if missing (bundled package ships them
REM     already installed; this is a safety net for a mismatched CPU
REM     architecture where the bundled node_modules won't load) ---
if not exist "node_modules" (
  echo.
  echo  First-time setup... installing. This may take 2-5 minutes.
  echo  Do NOT close the window. Wait for it to finish.
  echo.
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

REM --- Self-elevate to Administrator (needed to register the scheduled task) ---
net session >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Requesting administrator permission...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

set "VBS=%~dp0START-PRINTER-BACKGROUND.vbs"

if not exist "%VBS%" (
  color 0C
  echo.
  echo  [PROBLEM] Cannot find START-PRINTER-BACKGROUND.vbs next to this file.
  echo  Keep all files in the same folder and try again.
  echo.
  pause
  exit /b
)

echo.
echo  Installing startup task (runs hidden in background)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('\"' + '%VBS%' + '\"');" ^
  "$t = New-ScheduledTaskTrigger -AtLogOn;" ^
  "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero);" ^
  "Register-ScheduledTask -TaskName 'SelfPrintAgent' -Action $a -Trigger $t -Settings $s -RunLevel Highest -Force | Out-Null"

if errorlevel 1 (
  color 0C
  echo.
  echo  [PROBLEM] Install failed. Send a photo of this window to the developer.
  echo.
  pause
  exit /b
)

echo.
echo  Starting the printer service now...
schtasks /Run /TN "SelfPrintAgent" >nul 2>nul

color 0A
echo.
echo  ================================================
echo   DONE! The printer service is now running
echo   quietly in the background, and will start
echo   itself every time this computer turns on.
echo  ================================================
echo.
echo  You do not need to keep any window open.
echo  To test the printer, run TEST-PRINTER.bat.
echo.
echo  IMPORTANT - last step for FULLY hands-free:
echo   Turn ON Windows auto-login so it starts without
echo   typing a password after restart.
echo   (Ask the developer to set this up.)
echo.
pause
