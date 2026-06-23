@echo off
REM SelfPrint print agent launcher - auto-restarts on crash
cd /d "%~dp0.."
:loop
echo [%date% %time%] Starting SelfPrint agent...
call npm run agent
echo [%date% %time%] Agent exited. Restarting in 5s...
timeout /t 5 /nobreak >nul
goto loop
