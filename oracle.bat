@echo off
setlocal EnableDelayedExpansion
title RideSync - put it online (Oracle Cloud)
cd /d "%~dp0"
echo.
echo   This copies your settings and database to your Oracle server and sets RideSync up there.
echo   Follow deploy\oracle\README.md first (create the free server, download its key).
echo   Stop start.bat first so the database isn't being written while it's copied.
echo.
set /p IP=  Server's public IP address (from the Oracle console):
set /p KEY=  Path to the server's private key file (drag the .key file here):
set KEY=!KEY:"=!
set /p DOMAIN=  Your DuckDNS name, e.g. ridesync-vit.duckdns.org (leave empty to use a free IP name):
set TOKEN=
if not "!DOMAIN!"=="" set /p TOKEN=  Your DuckDNS token (from duckdns.org, leave empty to skip):

if not exist "!KEY!" (
  echo.
  echo   Can't find the key file: !KEY!
  pause
  exit /b 1
)
rem SSH refuses keys that other Windows users can read.
icacls "!KEY!" /inheritance:r /grant:r "%USERNAME%:R" >nul

echo.
echo   Copying your settings and database...
ssh -i "!KEY!" -o StrictHostKeyChecking=accept-new ubuntu@!IP! "mkdir -p ~/upload"
if errorlevel 1 (
  echo.
  echo   Couldn't connect. Check the IP address, the key file, and that the server is running.
  pause
  exit /b 1
)
if exist ".env" scp -i "!KEY!" ".env" ubuntu@!IP!:upload/
if exist "firebase-key.json" scp -i "!KEY!" "firebase-key.json" ubuntu@!IP!:upload/
if exist "data" scp -i "!KEY!" -r "data" ubuntu@!IP!:upload/

echo.
echo   Setting up the server (5-10 minutes the first time)...
ssh -t -i "!KEY!" ubuntu@!IP! "curl -fsSL https://raw.githubusercontent.com/mastermac123/SB-PROJECT/main/deploy/oracle/setup.sh -o setup.sh && DUCKDNS_TOKEN=!TOKEN! bash setup.sh !DOMAIN!"
echo.
pause
