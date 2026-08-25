$ErrorActionPreference = 'Stop'
$KitRoot = Split-Path -Parent $PSScriptRoot
$env:DSH_HOME = Join-Path $KitRoot 'home'
$env:Path = "$(Join-Path $KitRoot 'runtime\node');$(Join-Path $KitRoot 'runtime\python');$env:Path"
& (Join-Path $KitRoot 'runtime\node\node.exe') (Join-Path $KitRoot 'source\apps\cli\lib\bin.js') @args
exit $LASTEXITCODE
