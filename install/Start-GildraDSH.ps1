$ErrorActionPreference = 'Stop'
$KitRoot = Split-Path -Parent $PSScriptRoot
$Node = Join-Path $KitRoot 'runtime\node\node.exe'
$Cli = Join-Path $KitRoot 'source\apps\cli\lib\bin.js'
$env:DSH_HOME = Join-Path $KitRoot 'home'
$env:Path = "$(Join-Path $KitRoot 'lsp\node_modules\.bin');$(Join-Path $KitRoot 'runtime\node');$env:Path"

$ManifestUrl = 'http://127.0.0.1:3080/manifest.webmanifest'
$Existing = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
if ($Existing) {
  try {
    $Manifest = Invoke-RestMethod -TimeoutSec 2 $ManifestUrl
    if ($Manifest.name -ne 'DeepSeek Harness' -or $Manifest.short_name -ne 'DSH') {
      throw 'unexpected manifest'
    }
  } catch {
    throw 'Порт 3080 занят другой программой. Закройте её перед запуском Gildra DSH.'
  }
} else {
  Start-Process -FilePath $Node -ArgumentList @($Cli, 'web', '--host', '127.0.0.1', '--port', '3080', '--no-open') -WindowStyle Hidden
  $Ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $Manifest = Invoke-RestMethod -TimeoutSec 1 $ManifestUrl
      if ($Manifest.name -eq 'DeepSeek Harness' -and $Manifest.short_name -eq 'DSH') {
        $Ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $Ready) { throw 'Gildra DSH не запустился за 30 секунд.' }
}

$Edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $Edge)) { $Edge = Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe' }
if (Test-Path $Edge) {
  Start-Process $Edge '--app=http://127.0.0.1:3080/'
} else {
  Start-Process 'http://127.0.0.1:3080/'
}
