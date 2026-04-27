# ===========================================================
# Solution Manager (Node.js) - Windows Setup Script
# Run ONCE: powershell -ExecutionPolicy Bypass -File setup-node.ps1
# ===========================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Solution Manager - Node.js Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js
$nodeCmd = $null
try {
    $ver = & node --version 2>&1
    if ($ver -match "^v\d+") {
        $nodeCmd = "node"
        Write-Host "[OK] Found Node.js $ver" -ForegroundColor Green
    }
} catch { }
if (-not $nodeCmd) {
    Write-Host "[ERROR] Node.js not found. Install from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# 2. Check npm
try {
    $npmVer = & npm --version 2>&1
    Write-Host "[OK] Found npm v$npmVer" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] npm not found." -ForegroundColor Red
    exit 1
}

# 3. Install dependencies
Set-Location $PSScriptRoot
Write-Host "[...] Installing npm dependencies..." -ForegroundColor Yellow
& npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install failed." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Dependencies installed." -ForegroundColor Green

# 4. Create .env from template if needed
$envFile = Join-Path $PSScriptRoot ".env"
$envExample = Join-Path $PSScriptRoot ".env.example"
if (-not (Test-Path $envFile)) {
    if (Test-Path $envExample) {
        Copy-Item $envExample $envFile
        Write-Host ""
        Write-Host "[ACTION REQUIRED] .env file created from template." -ForegroundColor Yellow
        Write-Host "  Edit .env and fill in your API keys before running the server." -ForegroundColor Yellow
    }
} else {
    Write-Host "[OK] .env file already exists." -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "  1. Edit .env with your API keys" -ForegroundColor White
Write-Host "  2. Run: .\run-node.bat" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
