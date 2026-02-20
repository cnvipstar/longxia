param(
  [string]$RepoUrl = $env:LONGXIA_REPO_URL,
  [string]$InstallDir = $env:LONGXIA_INSTALL_DIR,
  [string]$WslInstallDir = $env:LONGXIA_WSL_INSTALL_DIR,
  [string]$Branch = $env:LONGXIA_BRANCH,
  [string]$OnboardFlow = $env:LONGXIA_ONBOARD_FLOW,
  [ValidateSet("Auto", "Native", "WSL")]
  [string]$Mode = "Auto",
  [switch]$NoOnboard,
  [switch]$SkipNativeCheck
)

$ErrorActionPreference = "Stop"

if (-not $RepoUrl) { $RepoUrl = "https://github.com/cnvipstar/longxia.git" }
if (-not $InstallDir) { $InstallDir = Join-Path $HOME ".openclaw-longxia" }
if (-not $WslInstallDir) { $WslInstallDir = "~/.openclaw-longxia" }
if (-not $Branch) { $Branch = "main" }
if (-not $OnboardFlow) { $OnboardFlow = "quickstart" }

function Require-Command {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Test-WslAvailable {
  if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) {
    return $false
  }
  try {
    $distros = & wsl -l -q 2>$null
    return -not [string]::IsNullOrWhiteSpace(($distros | Out-String))
  } catch {
    return $false
  }
}

function Invoke-WslInstaller {
  Require-Command wsl
  $scriptWin = Join-Path $PSScriptRoot "install-cn.sh"
  if (-not (Test-Path $scriptWin)) {
    throw "install-cn.sh not found beside install-cn.ps1"
  }
  $scriptWsl = (& wsl -e wslpath -a "$scriptWin").Trim()
  if (-not $scriptWsl) {
    throw "Failed to resolve WSL path for install-cn.sh"
  }

  $noOnboardArg = if ($NoOnboard) { "--no-onboard" } else { "" }
  $cmd = "set -e; '$scriptWsl' --repo '$RepoUrl' --dir '$WslInstallDir' --branch '$Branch' --flow '$OnboardFlow' $noOnboardArg"
  Write-Host "Running WSL install path..."
  & wsl -e bash -lc $cmd
}

function Invoke-NativeInstaller {
  Require-Command git
  Require-Command node

  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    if (Get-Command corepack -ErrorAction SilentlyContinue) {
      corepack enable | Out-Null
      corepack prepare pnpm@10 --activate | Out-Null
    }
  }
  Require-Command pnpm

  $parent = Split-Path -Parent $InstallDir
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
  }

  $gitDir = Join-Path $InstallDir ".git"
  if (Test-Path $gitDir) {
    Write-Host "Updating existing checkout at $InstallDir"
    git -C $InstallDir fetch origin --prune
    git -C $InstallDir checkout $Branch
    git -C $InstallDir pull --ff-only origin $Branch
  } else {
    Write-Host "Cloning $RepoUrl to $InstallDir"
    git clone --depth=1 --branch $Branch $RepoUrl $InstallDir
  }

  Set-Location $InstallDir

  Write-Host "Installing dependencies..."
  pnpm install

  Write-Host "Building UI assets..."
  pnpm ui:build

  Write-Host "Building project..."
  pnpm build

  Write-Host "Linking CLI globally..."
  pnpm link --global

  Write-Host "Applying language defaults..."
  openclaw config set 'plugins.entries[lang-core].enabled' 'true' --json
  openclaw config set 'plugins.entries[lang-core].config.defaultLocale' '"zh-CN"' --json
  openclaw config set 'plugins.entries[lang-core].config.currentLocale' '"zh-CN"' --json
  openclaw config set 'plugins.entries[lang-core].config.allowedLocales' '["zh-CN","en-US","ja-JP"]' --json
  openclaw config set 'plugins.entries[lang-zh-cn].enabled' 'true' --json
  openclaw config set 'plugins.entries[lang-en-us].enabled' 'true' --json
  openclaw config set 'plugins.entries[lang-ja-jp].enabled' 'true' --json

  if (-not $NoOnboard) {
    Write-Host "Starting onboarding wizard..."
    openclaw onboard --flow $OnboardFlow --install-daemon
  } else {
    Write-Host "Onboarding skipped (-NoOnboard)."
  }

  if (-not $SkipNativeCheck -and $IsWindows) {
    Write-Host "Running native Windows health check (auto-fix enabled)..."
    & (Join-Path $InstallDir "windows-native-check.ps1") -Fix
  }
}

$effectiveMode = $Mode
if ($Mode -eq "Auto") {
  if ($IsWindows -and (Test-WslAvailable)) {
    $effectiveMode = "WSL"
  } else {
    $effectiveMode = "Native"
  }
}

Write-Host "Selected install mode: $effectiveMode"

if ($effectiveMode -eq "WSL") {
  if (-not $IsWindows) {
    throw "WSL mode is only valid when running from Windows PowerShell."
  }
  if (-not (Test-WslAvailable)) {
    throw "WSL mode requested, but no WSL distro is available."
  }
  Invoke-WslInstaller
  Write-Host "Done."
  exit 0
}

Invoke-NativeInstaller
Write-Host "Done."
