[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("api", "web")]
  [string]$Service,

  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $ProjectRoot

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
    throw "Neither Corepack nor pnpm is available."
  }

  return [pscustomobject]@{
    File = $pnpm.Source
    Prefix = @()
  }
}

$runner = Get-PackageRunner
$serviceArguments = if ($Service -eq "api") {
  $env:NODE_ENV = "development"
  $env:DEV_INVITE_CODE = "MOONLIT-DEV"
  $env:CORS_ORIGINS = "http://localhost:3000"
  $env:API_PORT = "3001"

  # The double-click launcher is intentionally infrastructure-free. If a parent
  # shell happens to define Redis, do not let the API wait for an absent Worker.
  Remove-Item "Env:REDIS_URL" -ErrorAction SilentlyContinue

  # Nest relies on TypeScript decorator metadata. The tsx development
  # transformer does not emit design:paramtypes, so the launcher runs the
  # tsc-built API instead.
  @("--filter", "@werewolf/api", "start")
}
else {
  # Defense in depth: the browser-facing Next.js process never needs provider
  # credentials, even though only NEXT_PUBLIC_* variables enter its bundle.
  Remove-Item "Env:KIMI_API_KEY" -ErrorAction SilentlyContinue
  Remove-Item "Env:DEEPSEEK_API_KEY" -ErrorAction SilentlyContinue
  $env:NEXT_TELEMETRY_DISABLED = "1"
  $env:NEXT_PUBLIC_API_URL = "http://localhost:3001/api/v1"
  $env:NEXT_PUBLIC_SOCKET_URL = "http://localhost:3001"

  @(
    "--filter",
    "@werewolf/web",
    "exec",
    "next",
    "dev",
    "--hostname",
    "localhost",
    "--port",
    "3000"
  )
}

$commandArguments = @($runner.Prefix) + $serviceArguments
& $runner.File @commandArguments
$serviceExitCode = $LASTEXITCODE
if ($null -eq $serviceExitCode) {
  $serviceExitCode = 1
}

exit $serviceExitCode
