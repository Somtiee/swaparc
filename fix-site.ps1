Write-Host "=== SwapARC Fix Script ===" -ForegroundColor Cyan
Write-Host "Checking Node version..."
$nodeVersion = node -v
Write-Host "Current Node version: $nodeVersion"

if ($nodeVersion -match "v25") {
    Write-Host "ERROR: You are using Node v25. This version is known to break installs (protobufjs error)." -ForegroundColor Red
    Write-Host "---------------------------------------------------------------"
    Write-Host "ACTION REQUIRED:" -ForegroundColor Yellow
    Write-Host "1. Download and install Node 22 (LTS) from: https://nodejs.org/dist/v22.11.0/node-v22.11.0-x64.msi"
    Write-Host "2. Close VS Code completely and reopen it."
    Write-Host "3. Run this script again: .\fix-site.ps1"
    Write-Host "---------------------------------------------------------------"
    exit 1
}

Write-Host "Node version looks compatible. Proceeding with clean install..." -ForegroundColor Green

Write-Host "Step 1: Removing node_modules and package-lock.json..."
if (Test-Path "node_modules") { 
    Write-Host "Deleting node_modules (this may take a moment)..."
    Remove-Item -Recurse -Force "node_modules" -ErrorAction SilentlyContinue
}
if (Test-Path "package-lock.json") { 
    Remove-Item -Force "package-lock.json" -ErrorAction SilentlyContinue
}

Write-Host "Step 2: Cleaning npm cache..."
npm cache clean --force

Write-Host "Step 3: Installing dependencies..."
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "npm install failed! Please check the errors above." -ForegroundColor Red
    exit 1
}

Write-Host "Step 4: Starting dev server..." -ForegroundColor Green
npm run dev
