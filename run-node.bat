@echo off
REM ===========================================================
REM Solution Manager (Node.js) - Windows Run Script
REM Double-click this to start the chatbot server.
REM ===========================================================

echo.
echo ========================================
echo   Solution Manager - Node.js Server
echo ========================================
echo.

cd /d "%~dp0"

REM Check node_modules
if not exist "node_modules" (
    echo [ERROR] Dependencies not installed. Run setup-node.ps1 first.
    pause
    exit /b 1
)

REM Check .env
if not exist ".env" (
    echo [WARNING] .env file not found. Copy .env.example to .env and fill in your keys.
    pause
    exit /b 1
)

echo [OK] Starting Node.js server on http://127.0.0.1:5000
echo [OK] Press Ctrl+C to stop the server.
echo.

node server.js

pause
