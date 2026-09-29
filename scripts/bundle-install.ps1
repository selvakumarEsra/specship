<#
.SYNOPSIS
  SpecShip offline / air-gapped installer (Windows, bundled into the release zip).

.DESCRIPTION
  Runs from inside an extracted bundle. Installs SpecShip using ONLY files
  already in this bundle (the compiled app and the launcher) plus the machine's
  own Node. No package manager, no compiler, no network access.

  Requires Node >= 22.5.0 and < 25.0.0 on PATH — the bundle ships no runtime
  (REQ-OFFLINE-006).

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

# Resolve the machine's Node and gate its version (REQ-OFFLINE-006). The floor
# guarantees the built-in node:sqlite (FTS5); the ceiling matches the Node 25
# hard exit in the CLI. Run before anything is installed or wired, so an
# unsuitable machine is left untouched.
function Resolve-NodeExe {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Error "specship: Node.js is required (>= 22.5.0, < 25.0.0) but no 'node' was found on PATH. Install it from https://nodejs.org"
    exit 1
  }
  $exe = $cmd.Source
  $raw = (& $exe -v 2>$null | Select-Object -First 1)
  $parsed = $null
  if ($raw) { [void][version]::TryParse(($raw -replace '^v', '' -replace '-.*$', ''), [ref]$parsed) }
  if (-not $parsed -or $parsed -lt [version]'22.5.0' -or $parsed -ge [version]'25.0.0') {
    Write-Error "specship: Node.js >= 22.5.0 and < 25.0.0 is required (found $raw at $exe). Install a supported version from https://nodejs.org"
    exit 1
  }
  return $exe
}

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

# Gate on the machine's Node before touching anything (REQ-OFFLINE-006.A3):
# an unsupported machine gets no install dir, no PATH entry, and no wiring.
$nodeExe = Resolve-NodeExe

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

# 3. Wire Claude Code via the machine's resolved Node (no npm, no network).
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
  $cliJs = Join-Path $dest 'lib\dist\bin\specship.js'
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
