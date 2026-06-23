@echo off
title SelfPrint - Test Printer
color 0B
cd /d "%~dp0"

echo ================================================
echo            SELFPRINT - TEST PRINTER
echo ================================================
echo.
echo  This prints ONE test page to check the printer
echo  and print engine are working.
echo.
echo ------------------------------------------------

REM --- Find the SumatraPDF print engine ---
set "ENGINE="
if exist "%~dp0agent\vendor\SumatraPDF.exe" set "ENGINE=%~dp0agent\vendor\SumatraPDF.exe"
if not defined ENGINE if exist "%LOCALAPPDATA%\SumatraPDF\SumatraPDF.exe" set "ENGINE=%LOCALAPPDATA%\SumatraPDF\SumatraPDF.exe"
if not defined ENGINE if exist "C:\Program Files\SumatraPDF\SumatraPDF.exe" set "ENGINE=C:\Program Files\SumatraPDF\SumatraPDF.exe"

if not defined ENGINE (
  color 0C
  echo  [PROBLEM] Print engine not found.
  echo  Expected: agent\vendor\SumatraPDF.exe
  echo  Send a photo of this window to the developer.
  echo.
  pause
  exit /b
)

REM --- Find a test file to print ---
set "TESTFILE=%~dp0docs\selfprint-shop-qr-a4.pdf"
if not exist "%TESTFILE%" (
  color 0C
  echo  [PROBLEM] Test file missing: docs\selfprint-shop-qr-a4.pdf
  echo  Send a photo of this window to the developer.
  echo.
  pause
  exit /b
)

echo  Available printers on this PC:
echo.
powershell -NoProfile -Command "Get-Printer | ForEach-Object { '   - ' + $_.Name }"
echo.
echo ------------------------------------------------
echo  Type the EXACT printer name from the list above.
echo  (Leave blank and press Enter to use the default printer.)
echo.
set "PRINTER="
set /p "PRINTER=Printer name: "

echo.
if defined PRINTER (
  echo  Sending test page to: %PRINTER%
  "%ENGINE%" -silent -exit-when-done -print-to "%PRINTER%" "%TESTFILE%"
) else (
  echo  Sending test page to the DEFAULT printer...
  "%ENGINE%" -silent -exit-when-done -print-to-default "%TESTFILE%"
)

if errorlevel 1 (
  color 0C
  echo.
  echo  [PROBLEM] Print command failed.
  echo  Check: printer is ON, has paper, name spelled exactly right.
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
echo    YES -> Printer is working. You are done.
echo    NO  -> Printer may be off / out of paper / wrong name.
echo           Check it and run this test again.
echo.
pause
