<#
.SYNOPSIS
  SpecShip offline / air-gapped installer (Windows, bundled into the release zip).

.DESCRIPTION
  Runs from inside an extracted self-contained bundle. Installs SpecShip using
  ONLY files already in this bundle: the vendored Node runtime, the compiled
  app, and the launcher. No package manager, no compiler, no network access.

.PARAMETER SkipClaude
  Install onto PATH only; leave Claude Code config untouched.

.PARAMETER Uninstall
  Remove the install directory and its PATH entry.

.EXAMPLE
  .\install.ps1
  .\install.ps1 -SkipClaude
  .\install.ps1 -Uninstall

  Environment:
    SPECSHIP_INSTALL_DIR   install location (default: %LOCALAPPDATA%\specship)
#>
[CmdletBinding()]
param(
  [switch]$SkipClaude,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

# Bundle root = the directory holding this script.
$bundle = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = if ($env:SPECSHIP_INSTALL_DIR) { $env:SPECSHIP_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'specship' }
$dest   = Join-Path $installDir 'current'
$binDir = Join-Path $dest 'bin'

if ($Uninstall) {
  if (Test-Path $installDir) { Remove-Item -Recurse -Force $installDir }
  # Drop the bin dir from the user PATH.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath) {
    $kept = ($userPath -split ';') | Where-Object { $_ -and $_ -ne $binDir }
    [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
  }
  Write-Host "SpecShip uninstalled (removed $installDir)."
  exit 0
}

# 1. Relocate the bundle into a stable install dir (overwritten on upgrade),
#    unless this script is already running from that location.
if ($bundle -ne $dest) {
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Copy-Item -Recurse -Force (Join-Path $bundle '*') $dest
}

Write-Host "Installed to $dest"

# 2. Add bin\ to the user PATH (idempotent). The launcher there is specship.cmd.
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $userPath) { $userPath = '' }
if (($userPath -split ';') -notcontains $binDir) {
  [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $binDir), 'User')
  Write-Host "Added $binDir to your user PATH (open a new terminal to pick it up)."
}

# 3. Wire Claude Code via the vendored Node (no system Node, no network).
if (-not $SkipClaude) {
  Write-Host "Wiring Claude Code..."
  & (Join-Path $dest 'node.exe') --liftoff-only (Join-Path $dest 'lib\dist\bin\specship.js') install --target claude -y
}

Write-Host ""
Write-Host "Done. Open a new terminal and run: specship --help"
