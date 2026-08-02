[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$WebProcessId,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 9223372036854775807)]
  [long]$WebStartTimeFileTimeUtc,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$ApiProcessId,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 9223372036854775807)]
  [long]$ApiStartTimeFileTimeUtc
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$projectRootCandidate = Join-Path $PSScriptRoot ".."
$projectRoot = [System.IO.Path]::GetFullPath(
  (Resolve-Path -LiteralPath $projectRootCandidate -ErrorAction Stop).ProviderPath
)
$serviceRunner = [System.IO.Path]::GetFullPath(
  (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "run-local-service.ps1") `
      -ErrorAction Stop).ProviderPath
)
$apiHealthUrl = "http://127.0.0.1:3001/api/v1/health"
$gameUrl = "http://localhost:3000"
$expectedGameTitle = -join (@(
    0x72FC, 0x4EBA, 0x6740, 0x0020, 0x00B7, 0x0020,
    0x771F, 0x4EBA, 0x4E0E, 0x0020, 0x0041, 0x0049,
    0xFF0C, 0x5171, 0x8D74, 0x6708, 0x591C
  ) | ForEach-Object { [char]$_ })

if (-not [System.IO.Path]::IsPathRooted($projectRoot) -or
  -not (Test-Path -LiteralPath $projectRoot -PathType Container)) {
  throw "Refusing cleanup because the derived project root is invalid."
}

$windowsIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$windowsPrincipal = New-Object Security.Principal.WindowsPrincipal($windowsIdentity)
if (-not $windowsPrincipal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )) {
  throw "Administrator rights are required for verified stale-instance cleanup."
}

if ($WebProcessId -eq $ApiProcessId) {
  throw "Refusing cleanup because the Web and API process IDs are identical."
}

if (-not ("WerewolfCommandLineNative" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WerewolfCommandLineNative
{
    [DllImport("shell32.dll", SetLastError = true)]
    public static extern IntPtr CommandLineToArgvW(
        [MarshalAs(UnmanagedType.LPWStr)] string commandLine,
        out int argumentCount);

    [DllImport("kernel32.dll")]
    public static extern IntPtr LocalFree(IntPtr memory);
}
'@
}

function ConvertTo-CommandLineArguments {
  param(
    [Parameter(Mandatory = $true)]
    [string]$CommandLine
  )

  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    throw "A required process command line is unavailable."
  }

  $argumentCount = 0
  $argumentPointer = [WerewolfCommandLineNative]::CommandLineToArgvW(
    $CommandLine,
    [ref]$argumentCount
  )
  if ($argumentPointer -eq [IntPtr]::Zero -or $argumentCount -lt 1) {
    throw "A required process command line could not be parsed."
  }

  try {
    $arguments = New-Object System.Collections.Generic.List[string]
    for ($index = 0; $index -lt $argumentCount; $index++) {
      $itemPointer = [Runtime.InteropServices.Marshal]::ReadIntPtr(
        $argumentPointer,
        $index * [IntPtr]::Size
      )
      $arguments.Add(
        [Runtime.InteropServices.Marshal]::PtrToStringUni($itemPointer)
      )
    }

    return $arguments.ToArray()
  }
  finally {
    [void][WerewolfCommandLineNative]::LocalFree($argumentPointer)
  }
}

function Get-ExactArgumentValue {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [Parameter(Mandatory = $true)]
    [string]$ArgumentName
  )

  $matches = New-Object System.Collections.Generic.List[int]
  for ($index = 0; $index -lt $Arguments.Count; $index++) {
    if ([string]::Equals(
        $Arguments[$index],
        $ArgumentName,
        [StringComparison]::OrdinalIgnoreCase
      )) {
      $matches.Add($index)
    }
  }

  if ($matches.Count -ne 1) {
    return $null
  }

  $matchIndex = $matches[0]
  if ($matchIndex + 1 -ge $Arguments.Count) {
    return $null
  }

  return $Arguments[$matchIndex + 1]
}

function Get-ProcessSnapshot {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId
  )

  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  $processInfo = Get-CimInstance Win32_Process `
    -Filter "ProcessId = $ProcessId" `
    -ErrorAction Stop
  if ($null -eq $processInfo) {
    throw "A required process disappeared during verification."
  }

  return [pscustomobject]@{
    ProcessId = [int]$processInfo.ProcessId
    ParentProcessId = [int]$processInfo.ParentProcessId
    ProcessName = [string]$process.ProcessName
    ExecutableName = [string]$processInfo.Name
    StartTimeFileTimeUtc =
      [long]$process.StartTime.ToUniversalTime().ToFileTimeUtc()
    CommandLine = [string]$processInfo.CommandLine
  }
}

function Assert-LeafProcess {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,

    [Parameter(Mandatory = $true)]
    [long]$ExpectedStartTime
  )

  $snapshot = Get-ProcessSnapshot -ProcessId $ProcessId
  if (-not [string]::Equals(
      $snapshot.ProcessName,
      "node",
      [StringComparison]::OrdinalIgnoreCase
    ) -or
    -not [string]::Equals(
      $snapshot.ExecutableName,
      "node.exe",
      [StringComparison]::OrdinalIgnoreCase
    ) -or
    $snapshot.StartTimeFileTimeUtc -ne $ExpectedStartTime) {
    throw "Refusing cleanup because a listener process identity changed."
  }

  return $snapshot
}

function Assert-PortOwner {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port,

    [Parameter(Mandatory = $true)]
    [int]$ExpectedProcessId
  )

  $listeners = @(
    Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop
  )
  if ($listeners.Count -ne 1) {
    throw "Refusing cleanup because a required listener is missing."
  }

  $loopbackAddresses = @("127.0.0.1", "::1")
  foreach ($listener in $listeners) {
    if ([int]$listener.OwningProcess -ne $ExpectedProcessId -or
      $loopbackAddresses -notcontains [string]$listener.LocalAddress) {
      throw "Refusing cleanup because a listener owner changed."
    }
  }
}

function Assert-ApiFingerprint {
  $response = Invoke-WebRequest `
    -UseBasicParsing `
    -Uri $apiHealthUrl `
    -TimeoutSec 3 `
    -ErrorAction Stop
  if ($response.StatusCode -ne 200) {
    throw "Refusing cleanup because the API fingerprint did not match."
  }

  $health = $response.Content | ConvertFrom-Json -ErrorAction Stop
  $propertyNames = @($health.PSObject.Properties.Name)
  foreach ($requiredProperty in @(
      "status",
      "storage",
      "redis",
      "uptimeSeconds"
    )) {
    if ($requiredProperty -notin $propertyNames) {
      throw "Refusing cleanup because the API fingerprint did not match."
    }
  }

  $uptimeSeconds = 0.0
  if ($health.status -ne "ok" -or
    $health.storage -ne "memory" -or
    $health.redis -ne "not-configured" -or
    -not [double]::TryParse(
      [string]$health.uptimeSeconds,
      [Globalization.NumberStyles]::Float,
      [Globalization.CultureInfo]::InvariantCulture,
      [ref]$uptimeSeconds
    ) -or
    $uptimeSeconds -lt 0) {
    throw "Refusing cleanup because the API fingerprint did not match."
  }
}

function Assert-WebFingerprint {
  $response = Invoke-WebRequest `
    -UseBasicParsing `
    -Uri $gameUrl `
    -TimeoutSec 3 `
    -ErrorAction Stop
  if ($response.StatusCode -ne 200) {
    throw "Refusing cleanup because the Web fingerprint did not match."
  }

  $titleMatches = [Regex]::Matches(
    [string]$response.Content,
    "<title(?:\s[^>]*)?>(.*?)</title>",
    [Text.RegularExpressions.RegexOptions]::IgnoreCase -bor
      [Text.RegularExpressions.RegexOptions]::Singleline
  )
  if ($titleMatches.Count -ne 1) {
    throw "Refusing cleanup because the Web fingerprint did not match."
  }

  $actualTitle = [Net.WebUtility]::HtmlDecode(
    $titleMatches[0].Groups[1].Value
  ).Trim()
  if (-not [string]::Equals(
      $actualTitle,
      $expectedGameTitle,
      [StringComparison]::Ordinal
    )) {
    throw "Refusing cleanup because the Web fingerprint did not match."
  }
}

function Test-ServiceWrapper {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Snapshot,

    [Parameter(Mandatory = $true)]
    [ValidateSet("api", "web")]
    [string]$Service
  )

  if (-not [string]::Equals(
      $Snapshot.ExecutableName,
      "powershell.exe",
      [StringComparison]::OrdinalIgnoreCase
    )) {
    return $false
  }

  $arguments = ConvertTo-CommandLineArguments `
    -CommandLine $Snapshot.CommandLine
  $fileArgument = Get-ExactArgumentValue `
    -Arguments $arguments `
    -ArgumentName "-File"
  $serviceArgument = Get-ExactArgumentValue `
    -Arguments $arguments `
    -ArgumentName "-Service"
  $rootArgument = Get-ExactArgumentValue `
    -Arguments $arguments `
    -ArgumentName "-ProjectRoot"

  return [string]::Equals(
      $fileArgument,
      $serviceRunner,
      [StringComparison]::OrdinalIgnoreCase
    ) -and
    [string]::Equals(
      $serviceArgument,
      $Service,
      [StringComparison]::OrdinalIgnoreCase
    ) -and
    [string]::Equals(
      $rootArgument,
      $projectRoot,
      [StringComparison]::OrdinalIgnoreCase
    )
}

function Get-VerifiedServiceTree {
  param(
    [Parameter(Mandatory = $true)]
    [object]$LeafSnapshot,

    [Parameter(Mandatory = $true)]
    [ValidateSet("api", "web")]
    [string]$Service
  )

  $snapshots = New-Object System.Collections.Generic.List[object]
  $snapshots.Add($LeafSnapshot)
  $seen = @{}
  $seen[$LeafSnapshot.ProcessId] = $true
  $child = $LeafSnapshot

  for ($depth = 0; $depth -lt 64; $depth++) {
    if ($child.ParentProcessId -le 0 -or
      $seen.ContainsKey($child.ParentProcessId)) {
      break
    }

    $parent = Get-ProcessSnapshot -ProcessId $child.ParentProcessId
    if ($parent.StartTimeFileTimeUtc -gt $child.StartTimeFileTimeUtc) {
      throw "Refusing cleanup because a process tree timestamp is invalid."
    }

    $snapshots.Add($parent)
    $seen[$parent.ProcessId] = $true
    if (Test-ServiceWrapper -Snapshot $parent -Service $Service) {
      return [pscustomobject]@{
        Service = $Service
        Root = $parent
        Snapshots = $snapshots.ToArray()
      }
    }

    $child = $parent
  }

  throw "Refusing cleanup because the expected service wrapper was not found."
}

function Assert-ServiceTreeUnchanged {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Tree
  )

  foreach ($expected in $Tree.Snapshots) {
    $actual = Get-ProcessSnapshot -ProcessId $expected.ProcessId
    if ($actual.ParentProcessId -ne $expected.ParentProcessId -or
      $actual.StartTimeFileTimeUtc -ne $expected.StartTimeFileTimeUtc -or
      -not [string]::Equals(
        $actual.ExecutableName,
        $expected.ExecutableName,
        [StringComparison]::OrdinalIgnoreCase
      )) {
      throw "Refusing cleanup because a verified process tree changed."
    }
  }

  if (-not (Test-ServiceWrapper -Snapshot $Tree.Root -Service $Tree.Service)) {
    throw "Refusing cleanup because a service wrapper changed."
  }
}

function Stop-VerifiedTree {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Tree
  )

  $taskkillPath = Join-Path $env:SystemRoot "System32\taskkill.exe"
  $taskkill = Start-Process `
    -FilePath $taskkillPath `
    -ArgumentList "/PID $($Tree.Root.ProcessId) /T /F" `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
  if ($taskkill.ExitCode -ne 0 -and
    $null -ne (Get-Process -Id $Tree.Root.ProcessId -ErrorAction SilentlyContinue)) {
    throw "A verified stale service tree could not be stopped."
  }
}

function Wait-ForPortsToRemainClear {
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  $clearSince = $null

  while ([DateTime]::UtcNow -lt $deadline) {
    $webListener = Get-NetTCPConnection `
      -State Listen `
      -LocalPort 3000 `
      -ErrorAction SilentlyContinue
    $apiListener = Get-NetTCPConnection `
      -State Listen `
      -LocalPort 3001 `
      -ErrorAction SilentlyContinue
    if ($null -eq $webListener -and $null -eq $apiListener) {
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

    Start-Sleep -Milliseconds 200
  }

  throw "Verified stale services stopped, but ports 3000 and 3001 did not remain clear."
}

Write-Host "Verifying the stale Moonlit Werewolf instance..."

$webLeaf = Assert-LeafProcess `
  -ProcessId $WebProcessId `
  -ExpectedStartTime $WebStartTimeFileTimeUtc
$apiLeaf = Assert-LeafProcess `
  -ProcessId $ApiProcessId `
  -ExpectedStartTime $ApiStartTimeFileTimeUtc
Assert-PortOwner -Port 3000 -ExpectedProcessId $WebProcessId
Assert-PortOwner -Port 3001 -ExpectedProcessId $ApiProcessId
Assert-ApiFingerprint
Assert-WebFingerprint

$webTree = Get-VerifiedServiceTree -LeafSnapshot $webLeaf -Service "web"
$apiTree = Get-VerifiedServiceTree -LeafSnapshot $apiLeaf -Service "api"
if ($webTree.Root.ProcessId -eq $apiTree.Root.ProcessId) {
  throw "Refusing cleanup because the Web and API wrappers are identical."
}

Assert-ServiceTreeUnchanged -Tree $webTree
Assert-ServiceTreeUnchanged -Tree $apiTree
Assert-PortOwner -Port 3000 -ExpectedProcessId $WebProcessId
Assert-PortOwner -Port 3001 -ExpectedProcessId $ApiProcessId

Write-Host "The stale instance is verified. Stopping its two service trees..."
Stop-VerifiedTree -Tree $webTree
Stop-VerifiedTree -Tree $apiTree
Wait-ForPortsToRemainClear

Write-Host "The verified stale instance has stopped."
exit 0
