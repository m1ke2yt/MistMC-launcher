# Сборка Mist MC Launcher (Windows x64 + Linux x64)
# Запуск из папки launcher:  powershell -ExecutionPolicy Bypass -File .\build.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
# Сжатие NSIS/7z ест все ядра — работаем с пониженным приоритетом (дети наследуют),
# чтобы сборка не подвешивала систему
[System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = "BelowNormal"

Write-Host "== 1/5  Копирую клиентские моды Mist MC ==" -ForegroundColor Magenta
$modsSrc = Join-Path $PSScriptRoot "..\client-mods\mods"
$modsDst = Join-Path $PSScriptRoot "resources\mods"
New-Item -ItemType Directory -Force -Path $modsDst | Out-Null
if (Test-Path $modsSrc) {
    Copy-Item -Path (Join-Path $modsSrc "*.jar") -Destination $modsDst -Force
    Get-ChildItem $modsDst -Filter *.jar | ForEach-Object { Write-Host "   + $($_.Name)" }
} else {
    Write-Host "   ! Папка client-mods\mods не найдена — моды не добавлены" -ForegroundColor Yellow
}

Write-Host "== 2/6  Устанавливаю JRE 21: Temurin win/linux + Liberica win32 ==" -ForegroundColor Magenta
if (-not (Test-Path (Join-Path $PSScriptRoot "resources\jre-win\bin\javaw.exe"))) { node scripts/fetch-jre.mjs win } else { Write-Host "   win JRE на месте" }
if (-not (Test-Path (Join-Path $PSScriptRoot "resources\jre-linux\bin\java")))  { node scripts/fetch-jre.mjs linux } else { Write-Host "   linux JRE на месте" }
if (-not (Test-Path (Join-Path $PSScriptRoot "resources\jre-win32\bin\javaw.exe"))) { node scripts/fetch-jre.mjs win32 } else { Write-Host "   win32 JRE на месте" }

Write-Host "== 3/6  npm install ==" -ForegroundColor Magenta
npm install --no-audit --no-fund

Write-Host "== 4/6  Windows x64: electron-builder (nsis + zip) ==" -ForegroundColor Magenta
npx electron-builder --win nsis zip

Write-Host "== 5/6  Windows ia32 (32-бит): electron-builder -> release\ia32 ==" -ForegroundColor Magenta
npx electron-builder --win --config build/ia32.config.js

Write-Host "== 6/6  Linux: unpacked + перепаковка tar.gz с правами ==" -ForegroundColor Magenta
# electron-builder на Windows теряет бит +x, поэтому tar собираем сами (scripts/pack-linux.py)
npx electron-builder --linux dir
python scripts/pack-linux.py

Write-Host ""
Write-Host "Готово. Артефакты в .\release\ (32-бит — в .\release\ia32\)" -ForegroundColor Green
Get-ChildItem release -File | Where-Object { $_.Name -like "MistMC-Launcher-*" -and $_.Extension -in ".exe", ".zip", ".gz" } | ForEach-Object {
    Write-Host ("   {0}  ({1:N1} МБ)" -f $_.Name, ($_.Length / 1MB))
}
if (Test-Path release\ia32) {
    Get-ChildItem release\ia32 -File | Where-Object { $_.Name -like "MistMC-Launcher-*" -and $_.Extension -in ".exe", ".zip" } | ForEach-Object {
        Write-Host ("   ia32\{0}  ({1:N1} МБ)" -f $_.Name, ($_.Length / 1MB))
    }
}
