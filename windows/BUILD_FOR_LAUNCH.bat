@echo off
title KSF - Build for launch
color 0B
rem The launchers live in windows\ ; everything runs from the project root.
cd /d "%~dp0.."

echo.
echo   Building KSF for a live installation...
echo.

if not exist "node_modules" call npm install --no-audit --no-fund

call npm run typecheck
if errorlevel 1 (
  color 0C
  echo.
  echo   The type check failed. The build has been stopped.
  pause
  exit /b 1
)

call npm run build
if errorlevel 1 (
  color 0C
  echo.
  echo   The build failed.
  pause
  exit /b 1
)

echo.
echo   Done. The API is in backend\dist and the website in frontend\dist.
echo.
echo   To run it live:
echo     1. In .env set NODE_ENV=production and COOKIE_SECURE=true
echo        (the site must be served over HTTPS)
echo     2. Set PUBLIC_APP_URL and PUBLIC_ALLOWED_ORIGINS to your domain
echo     3. Run:  npm start
echo.
pause
