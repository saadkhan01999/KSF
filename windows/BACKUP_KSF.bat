@echo off
title KSF - Backup
color 0B
rem The launchers live in windows\ ; everything runs from the project root.
cd /d "%~dp0.."

echo.
echo   Taking a backup of the whole database, and reading it back to
echo   prove it can be restored. It is saved in the .data\backups folder.

call npm run db:backup --silent

echo.
echo   Copy the newest file in .data\backups (and its .sha256 file) to a
echo   USB drive or cloud folder. A backup on the same computer is not a backup.
echo.
pause
