@echo off
title SelfPrint - Test Printer
color 0B
cd /d "%~dp0"

echo ================================================
echo            SELFPRINT - TEST PRINTER
echo ================================================
echo.
echo  Prints ONE test page to check the printer works.
echo  (Uses the same Windows printing the app uses.)
echo.
echo ------------------------------------------------
echo  Printers on this PC:
echo.
powershell -NoProfile -Command "Get-Printer | ForEach-Object { '   - ' + $_.Name }"
echo.
echo ------------------------------------------------
echo  Type the EXACT printer name from the list above.
echo  (Leave blank + Enter to use the default printer.)
echo.
set "PRINTER="
set /p "PRINTER=Printer name: "

echo.
echo  Sending test page...
if defined PRINTER (
  powershell -NoProfile -Command "$ErrorActionPreference='Stop'; try { 'SelfPrint test page - %date% %time%' | Out-Printer -Name '%PRINTER%'; 'SENT to %PRINTER%' } catch { Write-Host ('FAILED: ' + $_.Exception.Message); exit 1 }"
) else (
  powershell -NoProfile -Command "$ErrorActionPreference='Stop'; try { 'SelfPrint test page - %date% %time%' | Out-Printer; 'SENT to default printer' } catch { Write-Host ('FAILED: ' + $_.Exception.Message); exit 1 }"
)

if errorlevel 1 (
  color 0C
  echo.
  echo  [PROBLEM] Could not send the page.
  echo  Check: printer ON, has paper, name spelled exactly right.
  echo  Send a photo of this window to the developer.
  echo.
  pause
  exit /b
)

color 0A
echo.
echo  ================================================
echo   Test page SENT.
echo  ================================================
echo.
echo  Did a page come out of the printer?
echo    YES -> Printer works. You are done.
echo    NO  -> Printer may be OFF / out of paper / asleep.
echo           The page is waiting in the queue. Turn the
echo           printer on and it will print.
echo.
pause
