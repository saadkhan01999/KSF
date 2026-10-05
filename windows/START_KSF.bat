@echo off
title KSF Pharmacy Management System
color 0A
rem The launchers live in windows\ ; everything runs from the project root.
cd /d "%~dp0.."

echo.
echo   ================================================================
echo     KSF PHARMACY MANAGEMENT SYSTEM
echo   ================================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  color 0C
  echo   Node.js is not installed on this computer.
  echo.
  echo   1. Open https://nodejs.org in your browser
  echo   2. Download the "LTS" version and install it
  echo   3. Close this window and double-click windows\START_KSF.bat again
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -v') do set NODEMAJOR=%%v
set NODEMAJOR=%NODEMAJOR:v=%
if %NODEMAJOR% LSS 20 (
  color 0C
  echo   Your Node.js is too old for KSF. It needs version 20 or newer.
  node -v
  echo   Install the latest LTS from https://nodejs.org and try again.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  color 0E
  echo   A settings file has been created for you: .env
  echo.
  echo   Before KSF can start, open .env in Notepad and:
  echo     1. paste your MongoDB connection string into MONGODB_URI
  echo     2. set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD
  echo   Then run:  npm run secrets -- --write
  echo   DATABASE_SETUP.md explains every step.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   First run - installing the packages KSF needs.
  echo   This takes a few minutes and only happens once.
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    color 0C
    echo.
    echo   The install did not finish. Check your internet connection
    echo   and run windows\START_KSF.bat again.
    echo.
    pause
    exit /b 1
  )
)

echo   Checking the database connection...
call npm run db:check --silent
if errorlevel 1 (
  color 0E
  echo.
  echo   The database is not ready yet - the lines above say what to fix.
  echo   If this is the very first start, that is expected: KSF will now
  echo   create everything it needs.
  echo.
)

echo.
echo   Starting KSF. Your browser will open by itself in a moment.
echo   Keep THIS window open while you are using the system.
echo.

call npm run dev

echo.
echo   KSF has stopped.
pause
