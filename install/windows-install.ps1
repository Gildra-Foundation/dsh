$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = Split-Path -Parent $ScriptDir

$Versions = @{}
Get-Content (Join-Path $RepoDir 'config\versions.env') | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.+)$') { $Versions[$matches[1]] = $matches[2] }
}

$InstallRoot = if ($env:GILDRA_DSH_INSTALL_ROOT) { $env:GILDRA_DSH_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA 'GildraDSH' }
$RuntimeDir = Join-Path $InstallRoot 'runtime'
$DownloadDir = Join-Path $InstallRoot 'downloads'
$ProfileDir = Join-Path $InstallRoot 'home\profiles\web'
New-Item -ItemType Directory -Force $RuntimeDir, $DownloadDir, (Join-Path $InstallRoot 'bin'), (Join-Path $InstallRoot 'vendor') | Out-Null

$NodeZip = Join-Path $DownloadDir "node-v$($Versions.NODE_VERSION)-win-x64.zip"
$NodeDir = Join-Path $RuntimeDir 'node'
if (-not (Test-Path (Join-Path $NodeDir 'node.exe'))) {
  Invoke-WebRequest "https://nodejs.org/dist/v$($Versions.NODE_VERSION)/node-v$($Versions.NODE_VERSION)-win-x64.zip" -OutFile $NodeZip
  $Expanded = Join-Path $DownloadDir "node-v$($Versions.NODE_VERSION)-win-x64"
  Remove-Item $Expanded, $NodeDir -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $NodeZip $DownloadDir
  Move-Item $Expanded $NodeDir
}
$env:Path = "$NodeDir;$env:Path"
& (Join-Path $NodeDir 'corepack.cmd') prepare "pnpm@$($Versions.PNPM_VERSION)" --activate

function Expand-GitHubArchive([string]$Url, [string]$ZipPath, [string]$ExpandedName, [string]$Target) {
  if (Test-Path $Target) { return }
  Invoke-WebRequest $Url -OutFile $ZipPath
  Expand-Archive $ZipPath $DownloadDir -Force
  Move-Item (Join-Path $DownloadDir $ExpandedName) $Target
}

$SourceDir = Join-Path $InstallRoot 'source'
Expand-GitHubArchive "https://github.com/deepseek-ai/deepseek-harness/archive/$($Versions.DSH_COMMIT).zip" (Join-Path $DownloadDir 'dsh.zip') "deepseek-harness-$($Versions.DSH_COMMIT)" $SourceDir
& (Join-Path $NodeDir 'corepack.cmd') pnpm --dir $SourceDir install --frozen-lockfile
$env:DSH_CLIENT_COMMIT_HASH = $Versions.DSH_COMMIT
& (Join-Path $NodeDir 'corepack.cmd') pnpm --dir $SourceDir run build

$CodeGraphDir = Join-Path $InstallRoot 'vendor\codegraph'
Expand-GitHubArchive "https://github.com/JohnXu22786/codegraph/archive/$($Versions.CODEGRAPH_COMMIT).zip" (Join-Path $DownloadDir 'codegraph.zip') "codegraph-$($Versions.CODEGRAPH_COMMIT)" $CodeGraphDir

$CompactDir = Join-Path $InstallRoot 'vendor\gildra-dsh-ui-compact'
Remove-Item $CompactDir -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $RepoDir 'plugins\gildra-dsh-ui-compact') $CompactDir -Recurse
$SkillInstallerDir = Join-Path $InstallRoot 'vendor\gildra-skill-installer'
Remove-Item $SkillInstallerDir -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $RepoDir 'plugins\gildra-skill-installer') $SkillInstallerDir -Recurse
Copy-Item (Join-Path $RepoDir 'install\dsh-gildra.ps1') (Join-Path $InstallRoot 'bin\dsh-gildra.ps1')
Copy-Item (Join-Path $RepoDir 'install\Start-GildraDSH.ps1') (Join-Path $InstallRoot 'bin\Start-GildraDSH.ps1')

$env:DSH_HOME = Join-Path $InstallRoot 'home'
$Cli = Join-Path $SourceDir 'apps\cli\lib\bin.js'
function Add-Plugin([string]$Spec) { & (Join-Path $NodeDir 'node.exe') $Cli plugin --profile web add $Spec }

Add-Plugin 'dsh-plugin-subscriptions@0.5.2'
New-Item -ItemType Directory -Force $ProfileDir | Out-Null
Copy-Item (Join-Path $RepoDir 'config\profile\pnpm-workspace.yaml') (Join-Path $ProfileDir 'pnpm-workspace.yaml') -Force

$ProfilePackage = Join-Path $ProfileDir 'package.json'
if ((Test-Path $ProfilePackage) -and ((Get-Content $ProfilePackage -Raw) -match '"@dsh-external/dsh-automation"')) {
  & (Join-Path $NodeDir 'node.exe') $Cli plugin --profile web remove '@dsh-external/dsh-automation'
}

@(
  '@deepseek-ai/dsh-subagent-codex@0.1.1-rc.2',
  '@deepseek-ai/dsh-subagent-claude-code@0.1.1-rc.2',
  "github:kuaiyukuaikuai/dsh-agent-sync#$($Versions.AGENT_SYNC_COMMIT)",
  "@openma/dsh-agents-plugins-bridge@$($Versions.AGENT_PLUGINS_BRIDGE_VERSION)",
  "github:GooDAnDReaDY/dsh-russian-lang#$($Versions.RUSSIAN_LANG_COMMIT)",
  "@michengai/dsh-skills-manager@$($Versions.SKILLS_MANAGER_VERSION)",
  "link:$SkillInstallerDir",
  "@syncended/dsh-automations@$($Versions.AUTOMATIONS_VERSION)",
  'github:omdsh-dev/dsh-genui#d99c978d4b0b29ba2a6993f8544a24930fc7d25a',
  'github:omdsh-dev/dsh-security-audit#ae927be8c92e483a8c8739b32831c0a237c0ed01',
  'github:Zhenyu98/dsh-context-doctor#f45096dc7a7ad52cfa7cf32cdaccae717faa662d',
  'github:delef/dsh-free-web-search#94bd12880a8f4000374cd25629f5e97c9d5364fd',
  '@tt-a1i/archify-dsh@0.1.0',
  "github:GHJIVHIDD/dsh-plugin-canvas#$($Versions.CANVAS_COMMIT)",
  'dsh-at-file@0.6.3',
  'dsh-context@0.31.0',
  "link:$CompactDir"
) | ForEach-Object { Add-Plugin $_ }

if (Get-Command python -ErrorAction SilentlyContinue) { Add-Plugin "link:$CodeGraphDir" }
else { Write-Warning 'Python is not installed: CodeGraph is downloaded but disabled. Archify remains available.' }

$PresetDir = Join-Path $InstallRoot 'home\.agent-presets\engineering'
New-Item -ItemType Directory -Force $PresetDir | Out-Null
Copy-Item (Join-Path $RepoDir 'config\agent-presets\engineering\*') $PresetDir -Force
Copy-Item (Join-Path $RepoDir 'config\settings.yaml') (Join-Path $InstallRoot 'home\settings.yaml') -Force
Copy-Item (Join-Path $RepoDir 'config\profile\cordis.patch.yml') (Join-Path $ProfileDir 'cordis.patch.yml') -Force

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

& (Join-Path $InstallRoot 'bin\Start-GildraDSH.ps1')
Write-Host "Installed Gildra DSH. Desktop shortcut: $ShortcutPath"
