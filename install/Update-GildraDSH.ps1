$ErrorActionPreference = 'Stop'
$KitRoot = Split-Path -Parent $PSScriptRoot
$Node = Join-Path $KitRoot 'runtime\node\node.exe'
$Updater = Join-Path $KitRoot 'bin\gildra-update.mjs'
& $Node $Updater --apply --install-root $KitRoot
if ($LASTEXITCODE -ne 0) { throw "Обновление Gildra DSH завершилось с кодом $LASTEXITCODE." }
