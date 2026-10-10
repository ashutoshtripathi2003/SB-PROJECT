@echo off
title RideSync AI
cd /d "%~dp0"
echo.
echo   Running from: %CD%
if /i not "%CD%"=="%USERPROFILE%\SB-PROJECT" (
  echo   WARNING: this is NOT the main copy. Use the one in %USERPROFILE%\SB-PROJECT
  echo   and delete or rename this older folder, or your settings and updates will not match.
)
where node >nul 2>nul || (echo. & echo   Node.js is not installed. Get the LTS version from https://nodejs.org & echo. & pause & exit /b 1)
rem Install when node_modules is missing or incomplete (an interrupted install or a copied folder).
if not exist node_modules\.bin\concurrently.cmd (
  echo Installing RideSync. This takes a minute...
  call npm install || (pause & exit /b 1)
)
rem Stop an older RideSync still running in another window, so the website and app
rem don't keep talking to the old copy (old code, old settings).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":8787 .*LISTENING" /C:":5173 .*LISTENING"') do (
  echo   Stopping an older RideSync that was still running...
  taskkill /F /PID %%p >nul 2>nul
)
echo.
echo   RideSync is starting at http://localhost:5173
echo   Login codes appear in THIS window until email is set up.
echo   Keep this window open. Press Ctrl+C to stop.
echo.
call npm run dev
pause
