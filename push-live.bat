@echo off
REM ============================================================
REM  push-live.bat — one-click "send my changes live" button
REM  for the 804re.com website repo.
REM
REM  Put this file in:
REM  C:\Users\Micha\OneDrive\2026 804michael Real Estate\GetHub-CloudFlare Website\804michael-website
REM
REM  Then just double-click it any time you've saved new files
REM  from Claude into that folder. It will:
REM    1) show you what changed
REM    2) ask you to confirm before doing anything
REM    3) commit everything with a timestamped message
REM    4) push to GitHub, which triggers Cloudflare Pages to
REM       rebuild and deploy automatically
REM ============================================================

cd /d "%~dp0"

echo.
echo ===== 804re.com deploy =====
echo Folder: %cd%
echo.

git status
echo.

set /p CONFIRM="Commit and push these changes to GitHub? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo.
    echo Cancelled. Nothing was pushed.
    pause
    exit /b
)

for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set TODAY=%%a-%%b-%%c
set TIMESTAMP=%date% %time%

git add -A
git commit -m "Site update %TIMESTAMP%"
git push origin

echo.
echo ===== Done =====
echo Pushed to GitHub. Cloudflare Pages will rebuild automatically
echo (usually live within 1-2 minutes; remember static asset
echo  caching per _headers may delay it a few minutes more).
echo.
pause
