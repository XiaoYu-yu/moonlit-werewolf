[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$secretsFile = Join-Path $projectRoot ".runtime\provider-secrets.json"
$launcherStateFile = Join-Path $projectRoot ".runtime\local-dev.json"
$stopScript = Join-Path $PSScriptRoot "stop-local.ps1"

if (Test-Path -LiteralPath $secretsFile) {
  Remove-Item -LiteralPath $secretsFile -Force
  Write-Host "Protected local AI keys were removed." -ForegroundColor Green
}
else {
  Write-Host "No protected local AI keys were found."
}

if (Test-Path -LiteralPath $launcherStateFile) {
  Write-Host "Stopping local services so decrypted keys are removed from memory..."
  & $stopScript
}
