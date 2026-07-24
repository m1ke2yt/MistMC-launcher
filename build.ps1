# Build for Windows x64 + Linux x64.
# Run from the project folder: powershell -ExecutionPolicy Bypass -File .\build.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Optional: drop client mods (Fabric jars) into resources/mods to bundle them.
New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot "resources\mods") | Out-Null

Write-Host "JRE 21 (Temurin), win + linux"
if (-not (Test-Path (Join-Path $PSScriptRoot "resources\jre-win\bin\javaw.exe"))) { node scripts/fetch-jre.mjs win }
if (-not (Test-Path (Join-Path $PSScriptRoot "resources\jre-linux\bin\java")))    { node scripts/fetch-jre.mjs linux }

Write-Host "npm install"
npm install --no-audit --no-fund

Write-Host "Windows: nsis + zip"
npx electron-builder --win nsis zip

Write-Host "Linux: unpacked, then repack tar.gz with correct modes"
npx electron-builder --linux dir
python scripts/pack-linux.py

Get-ChildItem release -File | Where-Object { $_.Name -like "MistMC-Launcher-*" -and $_.Extension -in ".exe", ".zip", ".gz" } |
    ForEach-Object { Write-Host ("{0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB)) }
