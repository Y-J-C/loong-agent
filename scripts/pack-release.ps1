param(
  [string]$OutputDir = ".\dist\loong-agent"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  node .\scripts\pack-release.js --out $OutputDir
}
finally {
  Pop-Location
}
