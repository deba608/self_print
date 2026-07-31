@echo off
title SelfPrint - One-Time Auto-Start Installer
color 0B
cd /d "%~dp0.."

REM --- Self-elevate to Administrator (needed to register startup task) ---
net session >nul 2>nul
if errorlevel 1 (
  echo Requesting administrator permission...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

echo ================================================
echo     SELFPRINT - INSTALL AUTO-START (one time)
echo ================================================
echo.
echo  This makes the printer service start BY ITSELF
echo  every time this computer turns on.
echo.
echo  Run this ONCE. Then you never touch it again.
echo ------------------------------------------------
echo.

set "VBS=%~dp0START-PRINTER-BACKGROUND.vbs"

if not exist "%VBS%" (
  color 0C
  echo  [PROBLEM] Cannot find START-PRINTER-BACKGROUND.vbs next to this file.
  echo  Keep all files in the same folder and try again.
  echo.
  pause
  exit /b
)

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

color 0A
echo.
echo  ================================================
echo   DONE! Auto-start is installed.
echo  ================================================
echo.
echo  Starting the printer service now so you can test...
schtasks /Run /TN "SelfPrintAgent" >nul 2>nul
echo.
echo  IMPORTANT - last step for FULLY hands-free:
echo   Turn ON Windows auto-login so it starts without
echo   typing a password after restart.
echo   (Ask the developer to set this up.)
echo.
echo  You can close this window now.
echo.
pause
