[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$runtimeRoot = Join-Path $projectRoot ".runtime"
$logsRoot = Join-Path $runtimeRoot "logs"
$stateFile = Join-Path $runtimeRoot "local-dev.json"
$providerSecretsFile = Join-Path $runtimeRoot "provider-secrets.json"
$dependencyStamp = Join-Path $runtimeRoot "dependencies.stamp"
$buildStamp = Join-Path $runtimeRoot "packages-build.stamp"
$apiBuildStamp = Join-Path $runtimeRoot "api-build.stamp"
$serviceRunner = Join-Path $PSScriptRoot "run-local-service.ps1"
$staleCleanupHelper = Join-Path $PSScriptRoot "stop-stale-local.ps1"
$gameUrl = "http://localhost:3000"
$expectedGameTitle = -join (@(
    0x72FC, 0x4EBA, 0x6740, 0x0020, 0x00B7, 0x0020,
    0x771F, 0x4EBA, 0x4E0E, 0x0020, 0x0041, 0x0049,
    0xFF0C, 0x5171, 0x8D74, 0x6708, 0x591C
  ) | ForEach-Object { [char]$_ })
# The API listens on IPv4. Windows PowerShell 5 may wait on localhost's IPv6
# address instead of falling back, so readiness uses the explicit loopback.
$apiHealthUrl = "http://127.0.0.1:3001/api/v1/health"

New-Item -ItemType Directory -Force -Path $logsRoot | Out-Null
Set-Location -LiteralPath $projectRoot

try {
  $Host.UI.RawUI.WindowTitle = "Moonlit Werewolf - Quick Start"
}
catch {
  # Some non-interactive hosts do not expose RawUI.
}

function Get-PackageRunner {
  $corepack = Get-Command "corepack.cmd" -ErrorAction SilentlyContinue
  if ($null -ne $corepack) {
    return [pscustomobject]@{
      File = $corepack.Source
      Prefix = @("pnpm")
    }
  }

  $pnpm = Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue
  if ($null -eq $pnpm) {
    $pnpm = Get-Command "pnpm" -ErrorAction SilentlyContinue
  }
  if ($null -eq $pnpm) {
    throw "Neither Corepack nor pnpm was found. Install Node.js 24 or newer first."
  }

  return [pscustomobject]@{
    File = $pnpm.Source
    Prefix = @()
  }
}

function Invoke-Pnpm {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$CommandArguments
  )

  $allArguments = @($script:packageRunner.Prefix) + $CommandArguments
  & $script:packageRunner.File @allArguments
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm command failed: pnpm $($CommandArguments -join ' ')"
  }
}

function Test-HttpReady {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  }
  catch {
    return $false
  }
}

function Test-ProcessAlive {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId
  )

  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Test-OwnedServiceProcess {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,

    [Parameter(Mandatory = $false)]
    [long]$ExpectedStartTime = 0
  )

  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
    if ($null -eq $processInfo -or [string]::IsNullOrWhiteSpace($processInfo.CommandLine)) {
      return $false
    }

    $startTimeMatches = $ExpectedStartTime -eq 0 -or
      $process.StartTime.ToUniversalTime().ToFileTimeUtc() -eq $ExpectedStartTime

    return $startTimeMatches -and
      $processInfo.CommandLine.Contains("run-local-service.ps1") -and
      $processInfo.CommandLine.Contains($projectRoot)
  }
  catch {
    return $false
  }
}

function Test-RecordedProcessIdentity {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,

    [Parameter(Mandatory = $true)]
    [long]$ExpectedStartTime
  )

  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    return $process.StartTime.ToUniversalTime().ToFileTimeUtc() -eq $ExpectedStartTime
  }
  catch {
    return $false
  }
}

function Stop-OwnedServiceProcess {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,

    [Parameter(Mandatory = $false)]
    [long]$ExpectedStartTime = 0
  )

  if (-not (Test-ProcessAlive -ProcessId $ProcessId)) {
    return
  }
  if (-not (Test-OwnedServiceProcess `
        -ProcessId $ProcessId `
        -ExpectedStartTime $ExpectedStartTime)) {
    throw "Could not verify launcher ownership for PID $ProcessId."
  }

  $taskkill = Start-Process -FilePath (Join-Path $env:SystemRoot "System32\taskkill.exe") `
    -ArgumentList "/PID $ProcessId /T /F" `
    -WindowStyle Hidden `
    -Wait `
    -PassThru

  if (Test-ProcessAlive -ProcessId $ProcessId) {
    throw "Could not stop launcher-owned PID $ProcessId (taskkill exit $($taskkill.ExitCode))."
  }
}

function Get-ListeningProcess {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  try {
    return Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
      Select-Object -First 1
  }
  catch {
    return $null
  }
}

function Get-ListeningProcesses {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  try {
    return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
  }
  catch {
    return @()
  }
}

function Test-StaleLocalGameFingerprint {
  param(
    [Parameter(Mandatory = $true)]
    [object]$WebListener,

    [Parameter(Mandatory = $true)]
    [object]$ApiListener
  )

  $webOwner = Get-Process -Id $WebListener.OwningProcess -ErrorAction SilentlyContinue
  $apiOwner = Get-Process -Id $ApiListener.OwningProcess -ErrorAction SilentlyContinue
  $loopbackAddresses = @("127.0.0.1", "::1")
  if ($null -eq $webOwner -or
    $null -eq $apiOwner -or
    $webOwner.ProcessName -ne "node" -or
    $apiOwner.ProcessName -ne "node" -or
    $loopbackAddresses -notcontains [string]$WebListener.LocalAddress -or
    $loopbackAddresses -notcontains [string]$ApiListener.LocalAddress) {
    return $false
  }

  try {
    $apiResponse = Invoke-WebRequest -UseBasicParsing -Uri $apiHealthUrl -TimeoutSec 3
    if ($apiResponse.StatusCode -ne 200) {
      return $false
    }
    $health = $apiResponse.Content | ConvertFrom-Json
    if ($health.status -ne "ok" -or
      $health.storage -ne "memory" -or
      $health.redis -ne "not-configured" -or
      $null -eq $health.uptimeSeconds) {
      return $false
    }

    $webResponse = Invoke-WebRequest -UseBasicParsing -Uri $gameUrl -TimeoutSec 3
    if ($webResponse.StatusCode -ne 200) {
      return $false
    }
    $escapedTitle = [Regex]::Escape($expectedGameTitle)
    return [Regex]::IsMatch(
      [string]$webResponse.Content,
      "<title>\s*$escapedTitle\s*</title>",
      [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
  }
  catch {
    return $false
  }
}

function Stop-StaleLocalGame {
  param(
    [Parameter(Mandatory = $true)]
    [object]$WebListener,

    [Parameter(Mandatory = $true)]
    [object]$ApiListener
  )

  if (-not (Test-Path -LiteralPath $staleCleanupHelper -PathType Leaf)) {
    throw "The verified stale-instance cleanup helper is missing."
  }

  $webProcess = Get-Process -Id $WebListener.OwningProcess -ErrorAction Stop
  $apiProcess = Get-Process -Id $ApiListener.OwningProcess -ErrorAction Stop
  $webStartTime = $webProcess.StartTime.ToUniversalTime().ToFileTimeUtc()
  $apiStartTime = $apiProcess.StartTime.ToUniversalTime().ToFileTimeUtc()
  $windowsPowerShell = Get-Command "powershell.exe" -ErrorAction Stop
  $cleanupArguments = @(
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    ('"{0}"' -f $staleCleanupHelper),
    "-WebProcessId",
    [string]$webProcess.Id,
    "-WebStartTimeFileTimeUtc",
    [string]$webStartTime,
    "-ApiProcessId",
    [string]$apiProcess.Id,
    "-ApiStartTimeFileTimeUtc",
    [string]$apiStartTime
  )

  Write-Host "      Windows will ask once for permission to replace the verified old instance."
  try {
    $cleanup = Start-Process `
      -FilePath $windowsPowerShell.Source `
      -ArgumentList $cleanupArguments `
      -Verb RunAs `
      -WindowStyle Hidden `
      -Wait `
      -PassThru
  }
  catch {
    throw "Administrator approval was cancelled; the verified old instance was left unchanged."
  }
  if ($cleanup.ExitCode -ne 0) {
    throw "The administrator cleanup refused or could not stop the verified old instance."
  }

  # The elevated helper already verifies the complete wrapper trees. Keep a
  # second ordinary-user port check before starting the replacement services.
  $deadline = [DateTime]::UtcNow.AddSeconds(12)
  $clearSince = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    $webListenerNow = Get-ListeningProcess -Port 3000
    $apiListenerNow = Get-ListeningProcess -Port 3001
    if ($null -eq $webListenerNow -and $null -eq $apiListenerNow) {
      if ($null -eq $clearSince) {
        $clearSince = [DateTime]::UtcNow
      }
      elseif (([DateTime]::UtcNow - $clearSince).TotalSeconds -ge 2) {
        return
      }
    }
    else {
      $clearSince = $null
    }

    Start-Sleep -Milliseconds 300
  }

  throw "The verified stale local game did not release ports 3000 and 3001."
}

function Open-Game {
  Start-Process -FilePath $gameUrl | Out-Null
}

function ConvertFrom-ProtectedSecret {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProtectedValue
  )

  $secure = ConvertTo-SecureString -String $ProtectedValue
  $pointer = [IntPtr]::Zero
  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    if ($pointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
}

function Import-LocalProviderSecrets {
  if (-not (Test-Path -LiteralPath $providerSecretsFile)) {
    return [pscustomobject]@{
      Kimi = -not [string]::IsNullOrWhiteSpace($env:KIMI_API_KEY)
      DeepSeek = -not [string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)
    }
  }

  try {
    # A protected file is authoritative. Do not accidentally merge a provider
    # key inherited from the parent shell with the explicitly saved selection.
    Clear-ProviderEnvironment
    $stored = Get-Content -Raw -LiteralPath $providerSecretsFile | ConvertFrom-Json
    if ($stored.version -ne 1) {
      throw "Unsupported protected-secret version."
    }

    $hasStoredKimi = -not [string]::IsNullOrWhiteSpace([string]$stored.kimi)
    $hasStoredDeepSeek = -not [string]::IsNullOrWhiteSpace([string]$stored.deepseek)
    if ($hasStoredKimi) {
      $env:KIMI_API_KEY = ConvertFrom-ProtectedSecret -ProtectedValue ([string]$stored.kimi)
      $env:KIMI_BASE_URL = "https://api.moonshot.cn/v1"
    }
    if ($hasStoredDeepSeek) {
      $env:DEEPSEEK_API_KEY = ConvertFrom-ProtectedSecret `
        -ProtectedValue ([string]$stored.deepseek)
      $env:DEEPSEEK_BASE_URL = "https://api.deepseek.com"
    }

    return [pscustomobject]@{
      Kimi = -not [string]::IsNullOrWhiteSpace($env:KIMI_API_KEY)
      DeepSeek = -not [string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)
    }
  }
  catch {
    throw "Protected AI keys could not be decrypted by this Windows account. Run Clear AI Keys, then configure again."
  }
}

function Clear-ProviderEnvironment {
  Remove-Item "Env:KIMI_API_KEY" -ErrorAction SilentlyContinue
  Remove-Item "Env:DEEPSEEK_API_KEY" -ErrorAction SilentlyContinue
}

function Wait-ForExistingLaunch {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ApiProcessId,

    [Parameter(Mandatory = $true)]
    [int]$WebProcessId
  )

  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (-not (Test-ProcessAlive -ProcessId $ApiProcessId) -or
      -not (Test-ProcessAlive -ProcessId $WebProcessId)) {
      return $false
    }

    if ((Test-HttpReady -Url $apiHealthUrl) -and (Test-HttpReady -Url $gameUrl)) {
      return $true
    }

    Start-Sleep -Milliseconds 700
  }

  return $false
}

Write-Host ""
Write-Host "Moonlit Werewolf quick launcher" -ForegroundColor Cyan
Write-Host "Project: $projectRoot"
Write-Host ""

if (Test-Path -LiteralPath $stateFile) {
  try {
    $existingState = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
    if ($existingState.version -ne 2 -or
      $null -eq $existingState.apiPid -or
      $null -eq $existingState.webPid -or
      $null -eq $existingState.apiStartTimeFileTimeUtc -or
      $null -eq $existingState.webStartTimeFileTimeUtc -or
      $null -eq $existingState.startedAt) {
      throw "The launcher state is incomplete or outdated."
    }

    $existingApiPid = [int]$existingState.apiPid
    $existingWebPid = [int]$existingState.webPid
    $existingApiStartTime = [long]$existingState.apiStartTimeFileTimeUtc
    $existingWebStartTime = [long]$existingState.webStartTimeFileTimeUtc
    $existingApiIdentityMatches = Test-RecordedProcessIdentity `
      -ProcessId $existingApiPid `
      -ExpectedStartTime $existingApiStartTime
    $existingWebIdentityMatches = Test-RecordedProcessIdentity `
      -ProcessId $existingWebPid `
      -ExpectedStartTime $existingWebStartTime
    $providerConfigurationChanged = $false
    if (Test-Path -LiteralPath $providerSecretsFile) {
      $existingStartedAt = [DateTime]::Parse([string]$existingState.startedAt).ToUniversalTime()
      $providerConfigurationChanged =
        (Get-Item -LiteralPath $providerSecretsFile).LastWriteTimeUtc -gt $existingStartedAt
    }

    if (-not $providerConfigurationChanged -and
      $existingApiIdentityMatches -and
      $existingWebIdentityMatches) {
      Write-Host "The game is already starting or running. Opening it now..."
      if (Wait-ForExistingLaunch -ApiProcessId $existingApiPid -WebProcessId $existingWebPid) {
        Open-Game
        Write-Host "Ready: $gameUrl" -ForegroundColor Green
        exit 0
      }
    }

    $existingWebOwned = Test-OwnedServiceProcess `
      -ProcessId $existingWebPid `
      -ExpectedStartTime $existingWebStartTime
    $existingApiOwned = Test-OwnedServiceProcess `
      -ProcessId $existingApiPid `
      -ExpectedStartTime $existingApiStartTime
    $requiresVerifiedRecovery =
      ($existingWebIdentityMatches -and -not $existingWebOwned) -or
      ($existingApiIdentityMatches -and -not $existingApiOwned)

    if ($requiresVerifiedRecovery) {
      $recordedWebListeners = @(Get-ListeningProcesses -Port 3000)
      $recordedApiListeners = @(Get-ListeningProcesses -Port 3001)
      if ($recordedWebListeners.Count -ne 1 -or
        $recordedApiListeners.Count -ne 1 -or
        -not (Test-StaleLocalGameFingerprint `
            -WebListener $recordedWebListeners[0] `
            -ApiListener $recordedApiListeners[0])) {
        throw "The recorded services are alive but cannot be safely verified for recovery."
      }

      Stop-StaleLocalGame `
        -WebListener $recordedWebListeners[0] `
        -ApiListener $recordedApiListeners[0]
    }
    else {
      Stop-OwnedServiceProcess -ProcessId $existingWebPid `
        -ExpectedStartTime $existingWebStartTime
      Stop-OwnedServiceProcess -ProcessId $existingApiPid `
        -ExpectedStartTime $existingApiStartTime
    }

    if ((Test-ProcessAlive -ProcessId $existingWebPid) -or
      (Test-ProcessAlive -ProcessId $existingApiPid) -or
      $null -ne (Get-ListeningProcess -Port 3000) -or
      $null -ne (Get-ListeningProcess -Port 3001)) {
      throw "The previous launcher instance did not stop completely."
    }

    Remove-Item -LiteralPath $stateFile -Force
  }
  catch {
    throw "The existing launcher state could not be safely recovered. $($_.Exception.Message)"
  }
}

$staleWebListeners = @(Get-ListeningProcesses -Port 3000)
$staleApiListeners = @(Get-ListeningProcesses -Port 3001)
if ($staleWebListeners.Count -eq 1 -and
  $staleApiListeners.Count -eq 1 -and
  (Test-StaleLocalGameFingerprint `
      -WebListener $staleWebListeners[0] `
      -ApiListener $staleApiListeners[0])) {
  Write-Host "Detected an older launcher instance without state. Replacing it safely..."
  Stop-StaleLocalGame `
    -WebListener $staleWebListeners[0] `
    -ApiListener $staleApiListeners[0]
}

foreach ($requiredPort in @(3000, 3001)) {
  $listener = Get-ListeningProcess -Port $requiredPort
  if ($null -ne $listener) {
    $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    $ownerName = if ($null -eq $owner) { "unknown process" } else { $owner.ProcessName }
    throw "Port $requiredPort is already used by $ownerName (PID $($listener.OwningProcess)). Close it and try again."
  }
}

$node = Get-Command "node.exe" -ErrorAction SilentlyContinue
if ($null -eq $node) {
  $node = Get-Command "node" -ErrorAction SilentlyContinue
}
if ($null -eq $node) {
  throw "Node.js was not found. Install Node.js 24 or newer first."
}

$rawNodeVersion = (& $node.Source --version).Trim().TrimStart("v")
$nodeVersion = [Version]$rawNodeVersion
if ($nodeVersion.Major -lt 24) {
  throw "Node.js 24 or newer is required. Found $rawNodeVersion."
}

$script:packageRunner = Get-PackageRunner
Write-Host "[1/5] Checking dependencies..."

$modulesManifest = Join-Path $projectRoot "node_modules\.modules.yaml"
$dependencyInputs = @(
  (Join-Path $projectRoot "pnpm-lock.yaml"),
  (Join-Path $projectRoot "pnpm-workspace.yaml"),
  (Join-Path $projectRoot "package.json")
) + @(
  Get-ChildItem -Path (Join-Path $projectRoot "apps"), (Join-Path $projectRoot "packages") `
    -Directory |
    ForEach-Object { Join-Path $_.FullName "package.json" } |
    Where-Object { Test-Path -LiteralPath $_ }
)

$needsInstall = -not (Test-Path -LiteralPath $modulesManifest) -or
  -not (Test-Path -LiteralPath $dependencyStamp)
if (-not $needsInstall) {
  $dependencyTimestamp = (Get-Item -LiteralPath $dependencyStamp).LastWriteTimeUtc
  $needsInstall = $null -ne (
    $dependencyInputs |
      Where-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc -gt $dependencyTimestamp } |
      Select-Object -First 1
  )
}

if ($needsInstall) {
  Write-Host "      Installing workspace dependencies (first launch may take a while)..."
  Invoke-Pnpm -CommandArguments @("install", "--frozen-lockfile", "--prefer-offline")
  Set-Content -LiteralPath $dependencyStamp `
    -Value ([DateTime]::UtcNow.ToString("O")) `
    -Encoding Ascii
}
else {
  Write-Host "      Dependencies are ready."
}

Write-Host "[2/5] Checking shared packages..."
$requiredDistDirectories = @(
  "packages\contracts\dist",
  "packages\game-core\dist",
  "packages\ai-gateway\dist",
  "packages\database\dist"
)
$needsPackageBuild = -not (Test-Path -LiteralPath $buildStamp)
if (-not $needsPackageBuild) {
  foreach ($distDirectory in $requiredDistDirectories) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $distDirectory))) {
      $needsPackageBuild = $true
      break
    }
  }
}

if (-not $needsPackageBuild) {
  $buildTimestamp = (Get-Item -LiteralPath $buildStamp).LastWriteTimeUtc
  $newerBuildInput = Get-ChildItem -Path (Join-Path $projectRoot "packages") -Recurse -File |
    Where-Object {
      $_.FullName -notmatch "[\\/](dist|node_modules)[\\/]" -and
      $_.Extension -in @(".ts", ".json", ".prisma")
    } |
    Where-Object { $_.LastWriteTimeUtc -gt $buildTimestamp } |
    Select-Object -First 1
  $needsPackageBuild = $null -ne $newerBuildInput
}

if ($needsPackageBuild) {
  Write-Host "      Building shared packages..."
  # Keep this as a single pnpm process. Some Windows Node installations expose
  # Corepack but do not install a pnpm.cmd shim, so a package script that starts
  # a second bare `pnpm` process fails when launched from Explorer.
  Invoke-Pnpm -CommandArguments @("--filter", "./packages/**", "--if-present", "build")
  Set-Content -LiteralPath $buildStamp -Value ([DateTime]::UtcNow.ToString("O")) -Encoding Ascii
}
else {
  Write-Host "      Shared packages are ready."
}

Write-Host "[3/5] Checking the API build..."
$apiEntryPoint = Join-Path $projectRoot "apps\api\dist\main.js"
$needsApiBuild = -not (Test-Path -LiteralPath $apiBuildStamp) -or
  -not (Test-Path -LiteralPath $apiEntryPoint)

if (-not $needsApiBuild) {
  $apiBuildTimestamp = (Get-Item -LiteralPath $apiBuildStamp).LastWriteTimeUtc
  $newerApiInput = @(
    Get-ChildItem -Path (Join-Path $projectRoot "apps\api\src") -Recurse -File
    Get-Item -LiteralPath (Join-Path $projectRoot "apps\api\package.json")
    Get-Item -LiteralPath (Join-Path $projectRoot "apps\api\tsconfig.json")
    Get-Item -LiteralPath $buildStamp
  ) |
    Where-Object { $_.LastWriteTimeUtc -gt $apiBuildTimestamp } |
    Select-Object -First 1
  $needsApiBuild = $null -ne $newerApiInput
}

if ($needsApiBuild) {
  Write-Host "      Building the Nest API with decorator metadata..."
  Invoke-Pnpm -CommandArguments @("--filter", "@werewolf/api", "build")
  Set-Content -LiteralPath $apiBuildStamp -Value ([DateTime]::UtcNow.ToString("O")) -Encoding Ascii
}
else {
  Write-Host "      API build is ready."
}

$powershell = Get-Command "powershell.exe" -ErrorAction Stop

function Start-LocalService {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("api", "web")]
    [string]$Service
  )

  $stdoutLog = Join-Path $logsRoot "$Service.out.log"
  $stderrLog = Join-Path $logsRoot "$Service.err.log"
  Remove-Item -LiteralPath $stdoutLog, $stderrLog -Force -ErrorAction SilentlyContinue

  $childArguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}" -Service {1} -ProjectRoot "{2}"' -f `
    $serviceRunner, $Service, $projectRoot

  return Start-Process -FilePath $powershell.Source `
    -ArgumentList $childArguments `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru
}

$apiProcess = $null
$webProcess = $null
$providerStatus = Import-LocalProviderSecrets

if ($providerStatus.Kimi -or $providerStatus.DeepSeek) {
  $configuredProviders = @(
    if ($providerStatus.Kimi) { "Kimi" }
    if ($providerStatus.DeepSeek) { "DeepSeek" }
  ) -join " + "
  if ($providerStatus.Kimi) {
    $env:AI_TAKEOVER_PROVIDER_ID = "kimi"
    $env:AI_TAKEOVER_MODEL_ID = "kimi-k2.6"
    if ($providerStatus.DeepSeek) {
      $env:AI_FALLBACK_PROVIDER_IDS = "kimi,deepseek"
    }
  }
  else {
    $env:AI_TAKEOVER_PROVIDER_ID = "deepseek"
    $env:AI_TAKEOVER_MODEL_ID = "deepseek-v4-flash"
  }
  $env:AI_PROVIDER_TIMEOUT_MS = "20000"
  Write-Host "      Real AI configured: $configuredProviders" -ForegroundColor Green
}
else {
  Write-Host "      Real AI keys are not configured; legal fallback remains available." `
    -ForegroundColor Yellow
}

try {
  Write-Host "[4/5] Starting API and Web..."
  # The double-click launcher is local-only even if its parent shell inherited
  # a broader API_HOST. The child process captures this explicit loopback bind.
  $env:API_HOST = "127.0.0.1"
  $apiProcess = Start-LocalService -Service "api"
  Remove-Item "Env:API_HOST" -ErrorAction SilentlyContinue
  # The API child has inherited the secrets. Remove them before starting Web so
  # the Next.js server process never receives provider credentials.
  Clear-ProviderEnvironment
  $webProcess = Start-LocalService -Service "web"

  [pscustomobject]@{
    version = 2
    projectRoot = $projectRoot
    startedAt = [DateTime]::UtcNow.ToString("O")
    apiPid = $apiProcess.Id
    apiStartTimeFileTimeUtc = $apiProcess.StartTime.ToUniversalTime().ToFileTimeUtc()
    webPid = $webProcess.Id
    webStartTimeFileTimeUtc = $webProcess.StartTime.ToUniversalTime().ToFileTimeUtc()
  } |
    ConvertTo-Json |
    Set-Content -LiteralPath $stateFile -Encoding UTF8

  Write-Host "[5/5] Waiting for the game page..."
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  $ready = $false

  while ([DateTime]::UtcNow -lt $deadline) {
    if ($apiProcess.HasExited) {
      throw "The API stopped during startup. Check .runtime\logs\api.err.log."
    }
    if ($webProcess.HasExited) {
      throw "The Web app stopped during startup. Check .runtime\logs\web.err.log."
    }

    if ((Test-HttpReady -Url $apiHealthUrl) -and (Test-HttpReady -Url $gameUrl)) {
      $ready = $true
      break
    }

    Start-Sleep -Milliseconds 700
  }

  if (-not $ready) {
    throw "Startup timed out. Check the logs under .runtime\logs."
  }

  Open-Game
  Write-Host ""
  Write-Host "Ready: $gameUrl" -ForegroundColor Green
  Write-Host "Create-room invite code: MOONLIT-DEV" -ForegroundColor Yellow
  Write-Host "Double-click Stop Werewolf to shut down the local services."
  exit 0
}
catch {
  Clear-ProviderEnvironment
  if ($null -ne $webProcess -and -not $webProcess.HasExited) {
    Stop-OwnedServiceProcess -ProcessId $webProcess.Id `
      -ExpectedStartTime ($webProcess.StartTime.ToUniversalTime().ToFileTimeUtc())
  }
  if ($null -ne $apiProcess -and -not $apiProcess.HasExited) {
    Stop-OwnedServiceProcess -ProcessId $apiProcess.Id `
      -ExpectedStartTime ($apiProcess.StartTime.ToUniversalTime().ToFileTimeUtc())
  }
  Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue

  Write-Host ""
  Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Logs: $logsRoot"
  exit 1
}
