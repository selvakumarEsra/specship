<#
.SYNOPSIS
  Offline / air-gapped install of SpecShip from this source folder (Windows).

.DESCRIPTION
  Assumes the client workstation has:
    - Node.js (>=18 <25) and npm on PATH
    - npm configured against a registry it CAN reach (e.g. a private mirror)
    - No git, no public GitHub access required

  Does NOT call git, does NOT download anything from github.com. Dependencies
  are pulled from whatever registry npm is already pointed at.

.PARAMETER SkipClaude
  Skip wiring Claude Code at the end.

.PARAMETER Undo
  Unlink the global `specship` symlink and exit.

.EXAMPLE
  .\scripts\offline-install.ps1
  .\scripts\offline-install.ps1 -SkipClaude
  .\scripts\offline-install.ps1 -Undo
#>
[CmdletBinding()]
param(
  [switch]$SkipClaude,
  [switch]$Undo
)

$ErrorActionPreference = 'Stop'

# Resolve repo root from this script's location (no git).
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Repo

$Pkg     = node -p "require('./package.json').name"
$Version = node -p "require('./package.json').version"

if ($Undo) {
  Write-Host "[offline-install] unlinking $Pkg"
  & npm unlink -g $Pkg 2>$null
  Write-Host "[offline-install] done"
  exit 0
}

# --- Node version gate ---------------------------------------------------
# Tighter than package.json engines (>=18 <25): the runtime needs node:sqlite
# (Node 22.5+) AND that SQLite must have FTS5 compiled in. SpecShip's own
# release bundle pins v24.16.0 for that reason; older Node builds either lack
# node:sqlite entirely or ship SQLite without FTS5.
$NodeMajor = [int](node -p "process.versions.node.split('.')[0]")
$NodeMinor = [int](node -p "process.versions.node.split('.')[1]")
if ($NodeMajor -lt 22 -or
    ($NodeMajor -eq 22 -and $NodeMinor -lt 5) -or
    $NodeMajor -ge 25) {
  $nv = node --version
  Write-Error "[offline-install] Node $nv is unsupported. Requires >=22.5 <25 (Node 24.x recommended)."
  exit 1
}

# --- FTS5 capability probe ---------------------------------------------
# Fail fast with a clear remediation message instead of letting `specship init`
# die with a cryptic "no such module: fts5" deep inside indexing. node:sqlite
# is present from 22.5+, but FTS5 is only enabled in newer Node builds —
# Node 22.x typically ships SQLite without it.
$probeScript = @'
try {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE VIRTUAL TABLE t USING fts5(x)");
  console.log('OK');
} catch (e) {
  console.log('FAIL:' + e.message);
}
'@
$probe = (node -e $probeScript 2>$null)
if ($probe -eq 'OK') {
  # FTS5 ok
} elseif ($probe -like 'FAIL:*') {
  $msg = $probe.Substring(5)
  $nv  = node --version
  Write-Error @"
[offline-install] SQLite probe failed: $msg

SpecShip requires Node.js whose bundled SQLite has FTS5 enabled. Your Node
($nv) does not. Install Node 24.x and re-run this script. SpecShip's
release bundle pins v24.16.0 as the known-good version.
"@
  exit 1
} else {
  Write-Error "[offline-install] unable to probe node:sqlite. Need Node >=22.5 (24.x recommended)."
  exit 1
}

$Registry = npm config get registry
Write-Host "[offline-install] repo:     $Repo"
Write-Host "[offline-install] package:  $Pkg@$Version"
Write-Host "[offline-install] node:     $(node --version)"
Write-Host "[offline-install] registry: $Registry"

# --- install deps --------------------------------------------------------
if (Test-Path 'package-lock.json') {
  Write-Host "[offline-install] npm ci"
  & npm ci
} else {
  Write-Host "[offline-install] npm install"
  & npm install
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# --- build ---------------------------------------------------------------
Write-Host "[offline-install] npm run build"
& npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# --- link as global specship -------------------------------------------
Write-Host "[offline-install] npm link"
& npm link
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Avoid PS 7+ null-conditional (?.) — locked-down Windows clients often ship
# only Windows PowerShell 5.1, where ?. fails to parse.
$cmd    = Get-Command specship -ErrorAction SilentlyContinue
$Linked = if ($cmd) { $cmd.Source } else { '(not on PATH)' }
Write-Host "[offline-install] specship -> $Linked"

# --- wire Claude Code (non-interactive) ---------------------------------
# Invoke the just-built binary directly instead of relying on `specship` being
# visible on PATH in this PowerShell session — `npm link`'s shim may not be
# picked up until the user opens a new shell.
if (-not $SkipClaude) {
  Write-Host "[offline-install] wiring Claude Code"
  & node (Join-Path $Repo 'dist/bin/specship.js') install --target claude -y
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host ""
Write-Host "[OK] SpecShip $Version installed offline from source."
Write-Host "  binary: $Linked"
Write-Host "  source: $Repo"
Write-Host ""
Write-Host "Next:"
Write-Host "  specship --version"
Write-Host "  cd <your-project>; specship init; specship index"
Write-Host ""
Write-Host "To uninstall:"
Write-Host "  .\scripts\offline-install.ps1 -Undo"
