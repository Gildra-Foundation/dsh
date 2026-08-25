$ErrorActionPreference = 'Stop'
$KitRoot = Split-Path -Parent $PSScriptRoot
$Node = Join-Path $KitRoot 'runtime\node\node.exe'
$Cli = Join-Path $KitRoot 'source\apps\cli\lib\bin.js'
$env:DSH_HOME = Join-Path $KitRoot 'home'
$env:Path = "$(Join-Path $KitRoot 'lsp\node_modules\.bin');$(Join-Path $KitRoot 'runtime\node');$(Join-Path $KitRoot 'runtime\python');$env:Path"

$Existing = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
if (-not $Existing) {
  Start-Process -FilePath $Node -ArgumentList @($Cli, 'web', '--host', '127.0.0.1', '--port', '3080', '--no-open') -WindowStyle Hidden
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:3080/manifest.webmanifest' | Out-Null
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
}

$Edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $Edge)) { $Edge = Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe' }
if (Test-Path $Edge) {
  Start-Process $Edge '--app=http://127.0.0.1:3080/'
} else {
  Start-Process 'http://127.0.0.1:3080/'
}
