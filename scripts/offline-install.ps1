<#
.SYNOPSIS
  Offline / air-gapped install of SpecShip from a PRE-BUILT bundle (Windows).
  No npm, no compiler, no network — but the target must already have Node
  >= 22.5 < 25 on PATH; the bundle ships no runtime.

.DESCRIPTION
  This is NOT a build-from-source flow. Point it at a release bundle for the
  target's platform — an extracted specship-<target>\ directory, or a
  specship-<target>.zip / .tar.gz archive — and it delegates to the installer
  baked inside that bundle (install.ps1), which adds the launcher to PATH and
  wires the chosen coding agent via the machine's Node. With no -Target the
  bundle installer picks the agent whose shell runs it (GEMINI_CLI=1 means
  Gemini CLI), else Claude Code, and reinstalls every agent already recorded
  as installed first.

  Bundles come from the GitHub Releases page on a connected machine, or
  scripts/build-bundle.sh. Building from a source checkout is a different flow.

.PARAMETER Bundle
  Path to the bundle: an extracted directory or a .zip / .tar.gz archive.

.PARAMETER Target
  The coding agent to wire: claude or gemini. Forwarded to the bundle's
  install.ps1 as -Target.

.PARAMETER SkipClaude
  Install onto PATH only; leave the agent's config untouched (alias: -SkipWire).

.PARAMETER Global
  Wire the agent globally (all projects) without asking.

.PARAMETER Path
  Wire the agent for a specific repo (project-local; indexes that repo).

.PARAMETER Undo
  Reverse the install (remove the install directory and its PATH entry).

.EXAMPLE
  .\scripts\offline-install.ps1 .\specship-win32-x64.zip
  .\scripts\offline-install.ps1 .\specship-win32-x64.zip -Target gemini -Global
  .\scripts\offline-install.ps1 .\specship-win32-x64\ -SkipWire
  .\scripts\offline-install.ps1 -Undo

  Environment:
    SPECSHIP_INSTALL_DIR  install location (default: %LOCALAPPDATA%\specship)
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Bundle,
  [ValidateSet('claude', 'gemini')]
  [string]$Target,
  [Alias('SkipWire')]
  [switch]$SkipClaude,
  [switch]$Global,
  [string]$Path,
  [switch]$Undo
)

$ErrorActionPreference = 'Stop'

$installDir = if ($env:SPECSHIP_INSTALL_DIR) { $env:SPECSHIP_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'specship' }

# --- undo --------------------------------------------------------------------
if ($Undo) {
  $installed = Join-Path (Join-Path $installDir 'current') 'install.ps1'
  if (Test-Path $installed) {
    & $installed -Uninstall
  } elseif (Test-Path $installDir) {
    Remove-Item -Recurse -Force $installDir
    Write-Host "SpecShip uninstalled (removed $installDir)."
  }
  exit 0
}

if (-not $Bundle) {
  Write-Error @"
offline-install: need a pre-built bundle (no npm, no compiler required).

Point this at a release bundle for the target machine:
  .\scripts\offline-install.ps1 .\specship-<target>.zip
  .\scripts\offline-install.ps1 .\specship-<target>\        # extracted dir

Bundles come from the GitHub Releases page, or scripts/build-bundle.sh on a
connected machine.
"@
  exit 1
}

# --- resolve the bundle dir (extract if it's an archive) ---------------------
$cleanup = $null
if (Test-Path $Bundle -PathType Container) {
  $bundleDir = (Resolve-Path $Bundle).Path
} elseif ($Bundle -match '\.zip$') {
  $cleanup = Join-Path $env:TEMP ('cg-off-' + [guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Force -Path $cleanup | Out-Null
  Expand-Archive -Path $Bundle -DestinationPath $cleanup -Force
  $bundleDir = (Get-ChildItem $cleanup -Directory -Filter 'specship-*' | Select-Object -First 1).FullName
  if (-not $bundleDir) { $bundleDir = $cleanup }
} else {
  Write-Error "offline-install: '$Bundle' is not a directory or a .zip bundle."
  exit 1
}

try {
  if (-not (Test-Path (Join-Path $bundleDir 'install.ps1'))) {
    Write-Error "offline-install: '$bundleDir' is not a SpecShip bundle (missing install.ps1)."
    exit 1
  }

  Write-Host "[offline-install] installing from bundle: $bundleDir"
  $installer = Join-Path $bundleDir 'install.ps1'
  # Forward the agent choice and wiring flags to the bundle's installer.
  $fwd = @{}
  if ($Target) { $fwd['Target'] = $Target }
  if ($SkipClaude) { $fwd['SkipClaude'] = $true }
  if ($Global) { $fwd['Global'] = $true }
  if ($Path) { $fwd['Path'] = $Path }
  & $installer @fwd
}
finally {
  if ($cleanup -and (Test-Path $cleanup)) { Remove-Item -Recurse -Force $cleanup }
}
