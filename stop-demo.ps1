$ErrorActionPreference = 'Stop'
$arenaPidFile = Join-Path $PSScriptRoot 'data\demo-processes.json'
if (-not (Test-Path -LiteralPath $arenaPidFile)) { Write-Output 'No recorded demo processes.'; exit 0 }
$arenaPids = Get-Content -LiteralPath $arenaPidFile -Raw | ConvertFrom-Json
foreach ($arenaPid in $arenaPids) {
    $arenaProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $arenaPid" -ErrorAction SilentlyContinue
    if ($arenaProcess -and ($arenaProcess.CommandLine -like '*arena_copilot.cli*' -or $arenaProcess.CommandLine -like '*arena_copilot\ui.py*' -or $arenaProcess.CommandLine -like '*lakehouse-copilot*node_modules\vite\bin\vite.js*')) {
        Stop-Process -Id $arenaPid -Force
        Write-Output "Stopped Arena process $arenaPid"
    }
}
