@echo off
title KSF - Restore from backup
color 0E
rem The launchers live in windows\ ; everything runs from the project root.
cd /d "%~dp0.."

echo.
echo   ================================================================
echo     RESTORING REPLACES YOUR CURRENT DATA
echo   ================================================================
echo.
echo   Everything recorded since the backup was taken will be lost.
echo   The current data is backed up first, so this can itself be undone.
echo   Stop KSF (close its window) before you continue.
echo.
echo   Backups in .data\backups:
dir /b /o-d ".data\backups\*.ndjson.gz" 2>nul
echo.
set /p FILE=  Type the file name to restore (or press Enter to cancel):
if "%FILE%"=="" exit /b 0

call npm run db:restore --silent -- ".data\backups\%FILE%" --yes

echo.
pause
