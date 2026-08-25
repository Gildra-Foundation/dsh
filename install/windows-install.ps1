$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = Split-Path -Parent $ScriptDir
$ManifestPath = Join-Path $RepoDir 'config\kit.json'
$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json

$InstallRoot = [IO.Path]::GetFullPath($(if ($env:GILDRA_DSH_INSTALL_ROOT) { $env:GILDRA_DSH_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA 'GildraDSH' }))
if ($InstallRoot -eq [IO.Path]::GetPathRoot($InstallRoot) -or $InstallRoot -eq [Environment]::GetFolderPath('UserProfile')) {
  throw "Unsafe GILDRA_DSH_INSTALL_ROOT: $InstallRoot"
}
$RuntimeDir = Join-Path $InstallRoot 'runtime'
$DownloadDir = Join-Path $InstallRoot 'downloads'
New-Item -ItemType Directory -Force $RuntimeDir, $DownloadDir, (Join-Path $InstallRoot 'bin'), (Join-Path $InstallRoot 'vendor'), (Join-Path $InstallRoot 'config') | Out-Null

function Read-Marker([string]$Path) {
  if (Test-Path $Path) { return (Get-Content $Path -Raw).Trim() }
  return ''
}

function Expand-GitHubArchive([string]$Url, [string]$ZipPath, [string]$ExpandedName, [string]$Target) {
  Invoke-WebRequest $Url -OutFile $ZipPath
  $Expanded = Join-Path $DownloadDir $ExpandedName
  Remove-Item $Expanded, $Target -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $ZipPath $DownloadDir -Force
  Move-Item $Expanded $Target
}

$NodeVersion = $Manifest.runtime.nodeVersion
$NodeZip = Join-Path $DownloadDir "node-v$NodeVersion-win-x64.zip"
$NodeDir = Join-Path $RuntimeDir 'node'
$NodeMarker = Join-Path $NodeDir '.gildra-version'
if (-not (Test-Path (Join-Path $NodeDir 'node.exe')) -or (Read-Marker $NodeMarker) -ne $NodeVersion) {
  Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $NodeZip
  $ActualNodeHash = (Get-FileHash -Algorithm SHA256 $NodeZip).Hash.ToLowerInvariant()
  if ($ActualNodeHash -ne $Manifest.runtime.nodeSha256.winX64) { throw 'Node.js archive checksum mismatch.' }
  $Expanded = Join-Path $DownloadDir "node-v$NodeVersion-win-x64"
  Remove-Item $Expanded, $NodeDir -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $NodeZip $DownloadDir
  Move-Item $Expanded $NodeDir
  Set-Content -Path $NodeMarker -Value $NodeVersion -NoNewline
}
$env:Path = "$NodeDir;$env:Path"
& (Join-Path $NodeDir 'corepack.cmd') prepare "pnpm@$($Manifest.runtime.pnpmVersion)" --activate

$DshCommit = $Manifest.runtime.dshCommit
$KitVersion = $Manifest.distribution.version
$SourceDir = Join-Path $InstallRoot 'source'
$SourceMarker = Join-Path $SourceDir '.gildra-commit'
if (-not (Test-Path (Join-Path $SourceDir 'apps\cli\lib\bin.js')) -or (Read-Marker $SourceMarker) -ne $DshCommit) {
  $SourceZip = Join-Path $DownloadDir 'dsh.zip'
  $ExpandedSource = Join-Path $DownloadDir "deepseek-harness-$DshCommit"
  $SourceStage = Join-Path $InstallRoot ".source-stage-$PID"
  $SourceBackup = Join-Path $InstallRoot ".source-backup-$PID"
  Invoke-WebRequest "https://github.com/deepseek-ai/deepseek-harness/archive/$DshCommit.zip" -OutFile $SourceZip
  Remove-Item $ExpandedSource, $SourceStage, $SourceBackup -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $SourceZip $DownloadDir -Force
  Move-Item $ExpandedSource $SourceStage
  & (Join-Path $NodeDir 'corepack.cmd') pnpm --dir $SourceStage install --frozen-lockfile
  $env:DSH_CLIENT_COMMIT_HASH = $DshCommit
  & (Join-Path $NodeDir 'corepack.cmd') pnpm --dir $SourceStage run build
  if (Test-Path $SourceDir) { Move-Item $SourceDir $SourceBackup }
  try {
    Move-Item $SourceStage $SourceDir
  } catch {
    if (Test-Path $SourceBackup) { Move-Item $SourceBackup $SourceDir }
    throw
  }
  Set-Content -Path $SourceMarker -Value $DshCommit -NoNewline
  Remove-Item $SourceBackup -Recurse -Force -ErrorAction SilentlyContinue
}

$CodegraphCommit = $Manifest.runtime.codegraphCommit
$CodeGraphDir = Join-Path $InstallRoot 'vendor\codegraph'
$CodeGraphMarker = Join-Path $CodeGraphDir '.gildra-commit'
if (-not (Test-Path (Join-Path $CodeGraphDir 'index.js')) -or (Read-Marker $CodeGraphMarker) -ne $CodegraphCommit) {
  Expand-GitHubArchive "https://github.com/JohnXu22786/codegraph/archive/$CodegraphCommit.zip" `
    (Join-Path $DownloadDir 'codegraph.zip') "codegraph-$CodegraphCommit" $CodeGraphDir
  Set-Content -Path $CodeGraphMarker -Value $CodegraphCommit -NoNewline
}

Copy-Item (Join-Path $RepoDir 'install\dsh-gildra.ps1') (Join-Path $InstallRoot 'bin\dsh-gildra.ps1') -Force
Copy-Item (Join-Path $RepoDir 'install\Start-GildraDSH.ps1') (Join-Path $InstallRoot 'bin\Start-GildraDSH.ps1') -Force
Copy-Item (Join-Path $RepoDir 'install\Update-GildraDSH.ps1') (Join-Path $InstallRoot 'bin\Update-GildraDSH.ps1') -Force
Copy-Item (Join-Path $RepoDir 'install\Update-GildraDSH.cmd') (Join-Path $InstallRoot 'bin\Update-GildraDSH.cmd') -Force
Copy-Item (Join-Path $RepoDir 'scripts\gildra-update.mjs') (Join-Path $InstallRoot 'bin\gildra-update.mjs') -Force
Copy-Item $ManifestPath (Join-Path $InstallRoot 'config\kit.json') -Force

& (Join-Path $NodeDir 'node.exe') (Join-Path $RepoDir 'scripts\configure-profile.mjs') `
  --repo-dir $RepoDir `
  --install-root $InstallRoot

Set-Content -Path (Join-Path $InstallRoot '.gildra-kit-version') -Value $KitVersion -NoNewline

if ($env:GILDRA_DSH_NO_LAUNCH -eq '1') {
  Write-Host "Installed Gildra DSH runtime at $InstallRoot"
  exit 0
}

$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Gildra DSH.lnk'
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = 'powershell.exe'
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $InstallRoot 'bin\Start-GildraDSH.ps1')`""
$Shortcut.WorkingDirectory = $InstallRoot
$Shortcut.Save()

$UpdateShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Update Gildra DSH.lnk'
$UpdateShortcut = $Shell.CreateShortcut($UpdateShortcutPath)
$UpdateShortcut.TargetPath = 'powershell.exe'
$UpdateShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallRoot 'bin\Update-GildraDSH.ps1')`""
$UpdateShortcut.WorkingDirectory = $InstallRoot
$UpdateShortcut.Save()

& (Join-Path $InstallRoot 'bin\Start-GildraDSH.ps1')
Write-Host "Installed Gildra DSH. Desktop shortcut: $ShortcutPath"
