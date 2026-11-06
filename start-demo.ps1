$ErrorActionPreference = 'Stop'
$arenaRoot = $PSScriptRoot
$arenaPython = Join-Path $arenaRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $arenaPython)) {
    $arenaPython = Join-Path (Split-Path $arenaRoot -Parent) '.arena-venv\Scripts\python.exe'
}
if (-not (Test-Path -LiteralPath $arenaPython)) {
    throw 'Create .venv with Python 3.11 and install this project first; see docs/development.md.'
}
$arenaData = Join-Path $arenaRoot 'data'
New-Item -ItemType Directory -Path $arenaData -Force | Out-Null
$arenaProcesses = @()
foreach ($arenaPort in @(8000,5173)) {
    if (Get-NetTCPConnection -LocalPort $arenaPort -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $arenaPort is occupied. Stop the existing service before starting this demo."
    }
}
$arenaNode = (Get-Command node -ErrorAction Stop).Source
$arenaWeb = Join-Path $arenaRoot 'web'
$arenaVite = Join-Path $arenaWeb 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $arenaVite)) {
    Push-Location $arenaWeb
    try { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } } finally { Pop-Location }
}
Push-Location $arenaRoot
try {
    & $arenaPython 'scripts/export_web_snapshot.py'
    if ($LASTEXITCODE -ne 0) { throw 'Snapshot export failed' }
    & $arenaPython 'scripts/export_openfootball.py'
    if ($LASTEXITCODE -ne 0) { throw 'OpenFootball research export failed' }
} finally { Pop-Location }
$arenaProcesses += Start-Process -FilePath $arenaPython -ArgumentList @('-m','arena_copilot.cli','serve') -WorkingDirectory $arenaRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $arenaData 'api.log') -RedirectStandardError (Join-Path $arenaData 'api-error.log')
$arenaProcesses += Start-Process -FilePath $arenaNode -ArgumentList @(('"' + $arenaVite + '"'),'--host','127.0.0.1','--port','5173') -WorkingDirectory $arenaWeb -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $arenaData 'web.log') -RedirectStandardError (Join-Path $arenaData 'web-error.log')
$arenaProcesses.Id | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $arenaData 'demo-processes.json')
Write-Output 'Arena web: http://127.0.0.1:5173'
Write-Output 'API docs: http://127.0.0.1:8000/docs'
Write-Output ('Started process IDs: ' + ($arenaProcesses.Id -join ', '))
