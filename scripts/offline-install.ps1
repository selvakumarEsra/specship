<#
.SYNOPSIS
  Offline / air-gapped install of SpecShip from a PRE-BUILT self-contained
  bundle (Windows). No npm, no compiler, no network.

.DESCRIPTION
  This is NOT a build-from-source flow. Point it at a release bundle for the
  target's platform — an extracted specship-<target>\ directory, or a
  specship-<target>.zip / .tar.gz archive — and it delegates to the installer
  baked inside that bundle (install.ps1), which adds the launcher to PATH and
  wires Claude Code via the vendored Node.

  Bundles come from the GitHub Releases page on a connected machine, or
  scripts/build-bundle.sh. Building from a source checkout is a different flow.

.PARAMETER Bundle
  Path to the bundle: an extracted directory or a .zip / .tar.gz archive.

.PARAMETER SkipClaude
  Install onto PATH only; leave Claude Code config untouched.

.PARAMETER Undo
  Reverse the install (remove the install directory and its PATH entry).

.EXAMPLE
  .\scripts\offline-install.ps1 .\specship-win32-x64.zip
  .\scripts\offline-install.ps1 .\specship-win32-x64\ -SkipClaude
  .\scripts\offline-install.ps1 -Undo

  Environment:
    SPECSHIP_INSTALL_DIR  install location (default: %LOCALAPPDATA%\specship)
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Bundle,
  [switch]$SkipClaude,
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
  if ($SkipClaude) { & $installer -SkipClaude } else { & $installer }
}
finally {
  if ($cleanup -and (Test-Path $cleanup)) { Remove-Item -Recurse -Force $cleanup }
}
