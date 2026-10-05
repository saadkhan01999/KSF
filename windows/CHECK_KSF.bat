@echo off
title KSF - Database check
color 0B
rem The launchers live in windows\ ; everything runs from the project root.
cd /d "%~dp0.."

echo.
echo   Checking the database this installation is connected to...

call npm run db:check --silent

echo.
pause
