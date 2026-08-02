[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$runtimeRoot = Join-Path $projectRoot ".runtime"
$stateFile = Join-Path $runtimeRoot "local-dev.json"

try {
  $Host.UI.RawUI.WindowTitle = "Moonlit Werewolf - Stop"
}
catch {
  # Some non-interactive hosts do not expose RawUI.
}

function Test-ProcessAlive {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId
  )

  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-RecordedService {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,

    [Parameter(Mandatory = $true)]
    [long]$ExpectedStartTime
  )

  if (-not (Test-ProcessAlive -ProcessId $ProcessId)) {
    return $false
  }

  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
  if ($null -eq $processInfo -or
    [string]::IsNullOrWhiteSpace($processInfo.CommandLine) -or
    -not $processInfo.CommandLine.Contains("run-local-service.ps1") -or
    -not $processInfo.CommandLine.Contains($projectRoot) -or
    $process.StartTime.ToUniversalTime().ToFileTimeUtc() -ne $ExpectedStartTime) {
    throw "Refusing to stop PID $ProcessId because it is not owned by this launcher."
  }

  $taskkill = Start-Process -FilePath (Join-Path $env:SystemRoot "System32\taskkill.exe") `
    -ArgumentList "/PID $ProcessId /T /F" `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
  if ((Test-ProcessAlive -ProcessId $ProcessId) -and $taskkill.ExitCode -ne 0) {
    throw "Could not stop launcher-owned PID $ProcessId."
  }

  return $true
}

Write-Host ""
Write-Host "Stopping Moonlit Werewolf..." -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $stateFile)) {
  Write-Host "No launcher-managed game processes were found."
  exit 0
}

try {
  $state = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
  if ($state.version -ne 2 -or
    $null -eq $state.webStartTimeFileTimeUtc -or
    $null -eq $state.apiStartTimeFileTimeUtc) {
    throw "The launcher state is outdated or invalid. Start the game once to refresh it."
  }

  $webStopped = Stop-RecordedService `
    -ProcessId ([int]$state.webPid) `
    -ExpectedStartTime ([long]$state.webStartTimeFileTimeUtc)
  $apiStopped = Stop-RecordedService `
    -ProcessId ([int]$state.apiPid) `
    -ExpectedStartTime ([long]$state.apiStartTimeFileTimeUtc)
  Remove-Item -LiteralPath $stateFile -Force

  if ($webStopped -or $apiStopped) {
    Write-Host "The local game services have stopped." -ForegroundColor Green
  }
  else {
    Write-Host "The game services had already stopped."
  }

  exit 0
}
catch {
  Write-Host "Stop failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
