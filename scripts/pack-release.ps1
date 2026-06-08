param(
  [string]$OutputDir = ".\dist\loong-agent"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$target = Resolve-Path -Path (Split-Path -Parent $OutputDir) -ErrorAction SilentlyContinue
if (-not $target) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputDir) | Out-Null
}

if (Test-Path -LiteralPath $OutputDir) {
  Remove-Item -LiteralPath $OutputDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

Copy-Item -LiteralPath (Join-Path $root "src") -Destination (Join-Path $OutputDir "src") -Recurse
Copy-Item -LiteralPath (Join-Path $root "docs") -Destination (Join-Path $OutputDir "docs") -Recurse
Copy-Item -LiteralPath (Join-Path $root "package.json") -Destination $OutputDir
Copy-Item -LiteralPath (Join-Path $root ".env.example") -Destination $OutputDir
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination $OutputDir

Write-Host "Packed Loong Pi Agent to $OutputDir"
