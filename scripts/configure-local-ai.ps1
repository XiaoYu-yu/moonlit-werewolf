[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$runtimeRoot = Join-Path $projectRoot ".runtime"
$secretsFile = Join-Path $runtimeRoot "provider-secrets.json"

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

function Read-ExistingSecrets {
  if (-not (Test-Path -LiteralPath $secretsFile)) {
    return [pscustomobject]@{
      version = 1
      kimi = $null
      deepseek = $null
    }
  }

  try {
    $stored = Get-Content -Raw -LiteralPath $secretsFile | ConvertFrom-Json
    if ($stored.version -ne 1) {
      throw "Unsupported protected-secret version."
    }
    return $stored
  }
  catch {
    throw "The protected AI configuration is invalid. Clear it and configure again."
  }
}

function Assert-ProviderKey {
  param(
    [Parameter(Mandatory = $true)]
    [Security.SecureString]$SecureValue,

    [Parameter(Mandatory = $true)]
    [string]$ProviderName
  )

  $pointer = [IntPtr]::Zero
  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($plain) -or
      -not $plain.StartsWith("sk-") -or
      $plain.Length -lt 20) {
      throw "$ProviderName API key does not have the expected format."
    }
  }
  finally {
    if ($pointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    Remove-Variable plain -ErrorAction SilentlyContinue
  }
}

function Protect-ProviderKey {
  param(
    [Parameter(Mandatory = $true)]
    [Security.SecureString]$SecureValue
  )

  # On Windows this uses DPAPI CurrentUser. The encrypted text can only be
  # decrypted by the same Windows account on this machine.
  return ConvertFrom-SecureString -SecureString $SecureValue
}

Write-Host ""
Write-Host "Moonlit Werewolf - protected AI configuration" -ForegroundColor Cyan
Write-Host "Input is hidden. Keys are protected with Windows DPAPI for the current user."
Write-Host ""

$existing = Read-ExistingSecrets
$kimiStatus = if ([string]::IsNullOrWhiteSpace([string]$existing.kimi)) {
  "not configured"
} else {
  "already configured"
}
$deepseekStatus = if ([string]::IsNullOrWhiteSpace([string]$existing.deepseek)) {
  "not configured"
} else {
  "already configured"
}

Write-Host "Kimi: $kimiStatus"
$kimiInput = Read-Host "Paste Kimi API key, or press Enter to keep the current value" -AsSecureString
Write-Host "DeepSeek: $deepseekStatus"
$deepseekInput = Read-Host "Paste DeepSeek API key, or press Enter to keep the current value" -AsSecureString

$kimiProtected = [string]$existing.kimi
$deepseekProtected = [string]$existing.deepseek

if ($kimiInput.Length -gt 0) {
  Assert-ProviderKey -SecureValue $kimiInput -ProviderName "Kimi"
  $kimiProtected = Protect-ProviderKey -SecureValue $kimiInput
}
if ($deepseekInput.Length -gt 0) {
  Assert-ProviderKey -SecureValue $deepseekInput -ProviderName "DeepSeek"
  $deepseekProtected = Protect-ProviderKey -SecureValue $deepseekInput
}

if ([string]::IsNullOrWhiteSpace($kimiProtected) -and
  [string]::IsNullOrWhiteSpace($deepseekProtected)) {
  throw "Configure at least one provider key."
}

[pscustomobject]@{
  version = 1
  configuredAt = [DateTime]::UtcNow.ToString("O")
  kimi = if ([string]::IsNullOrWhiteSpace($kimiProtected)) { $null } else { $kimiProtected }
  deepseek = if ([string]::IsNullOrWhiteSpace($deepseekProtected)) {
    $null
  } else {
    $deepseekProtected
  }
} |
  ConvertTo-Json |
  Set-Content -LiteralPath $secretsFile -Encoding UTF8

Write-Host ""
Write-Host "Protected provider configuration saved." -ForegroundColor Green
Write-Host "Double-click the game launcher again to restart services and apply it."
