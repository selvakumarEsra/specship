<#
.SYNOPSIS
  SpecShip offline / air-gapped installer (Windows, bundled into the release zip).

.DESCRIPTION
  Runs from inside an extracted self-contained bundle. Installs SpecShip using
  ONLY files already in this bundle: the vendored Node runtime, the compiled
  app, and the launcher. No package manager, no compiler, no network access.

.PARAMETER SkipClaude
  Install onto PATH only; leave Claude Code config untouched.

.PARAMETER Global
  Wire Claude Code globally (all projects) without asking.

.PARAMETER Path
  Wire Claude Code for a specific repo (project-local; indexes that repo).

.PARAMETER Uninstall
  Remove the install directory and its PATH entry.

.EXAMPLE
  .\install.ps1
  .\install.ps1 -Global
  .\install.ps1 -Path C:\dev\my-repo
  .\install.ps1 -SkipClaude
  .\install.ps1 -Uninstall

  Environment:
    SPECSHIP_INSTALL_DIR   install location (default: %LOCALAPPDATA%\specship)
#>
[CmdletBinding()]
param(
  [switch]$SkipClaude,
  [switch]$Global,
  [string]$Path,
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
#    REQ-OFFLINE-005: the wiring target is asked, never assumed — a blind
#    project-local install from here would land in the bundle directory.
if (-not $SkipClaude) {
  if (-not $Global -and -not $Path) {
    if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
      Write-Host ""
      Write-Host "Wire Claude Code:"
      Write-Host "  [1] globally  - SpecShip loads in every project (~/.claude.json)"
      Write-Host "  [2] one repo  - project-local, indexes that repo (./.mcp.json)"
      Write-Host "  [s] skip      - wire later with: specship install"
      $choice = Read-Host "Choice [1/2/s] (default 1)"
      switch ($choice) {
        '2' { $Path = Read-Host "Repo path" }
        's' { $SkipClaude = $true }
        default { $Global = $true }
      }
    } else {
      # No interactive console, no flags: global is the only safe default —
      # never local into the bundle directory (REQ-OFFLINE-005.A2).
      $Global = $true
    }
  }
}

if (-not $SkipClaude) {
  $nodeExe = Join-Path $dest 'node.exe'
  $cliJs   = Join-Path $dest 'lib\dist\bin\specship.js'
  if ($Path) {
    if (-not (Test-Path $Path -PathType Container)) {
      Write-Error "specship: -Path '$Path' is not a directory"
      exit 1
    }
    Write-Host "Wiring Claude Code for $Path ..."
    Push-Location $Path
    try { & $nodeExe --liftoff-only $cliJs install --target claude -y --location local }
    finally { Pop-Location }
  } else {
    Write-Host "Wiring Claude Code globally..."
    & $nodeExe --liftoff-only $cliJs install --target claude -y --location global --skip-index
  }
}

Write-Host ""
Write-Host "Done. Open a new terminal and run: specship --help"
