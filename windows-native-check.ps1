param(
  [switch]$Fix,
  [switch]$EnsureFirewallForLan,
  [int]$TimeoutMs = 12000
)

$ErrorActionPreference = "Stop"

function Write-Check {
  param([string]$Message)
  Write-Host "[check] $Message"
}

function Write-Warn {
  param([string]$Message)
  Write-Host "[warn]  $Message" -ForegroundColor Yellow
}

function Write-Fail {
  param([string]$Message)
  Write-Host "[fail]  $Message" -ForegroundColor Red
}

function Require-Command {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Test-NodeVersion {
  $raw = (& node --version).Trim()
  if (-not $raw) { return $false }
  $v = $raw.TrimStart("v")
  try {
    $ver = [Version]$v
  } catch {
    return $false
  }
  $need = [Version]"22.12.0"
  return ($ver -ge $need)
}

function Resolve-OpenClawTaskName {
  param([string]$Profile)
  if ([string]::IsNullOrWhiteSpace($Profile) -or $Profile -eq "default") {
    return "OpenClaw Gateway"
  }
  return "OpenClaw Gateway ($Profile)"
}

function Invoke-OpenClawStatusJson {
  param([int]$TimeoutMs)
  $json = & openclaw gateway status --json --timeout $TimeoutMs
  if (-not $json) {
    throw "openclaw gateway status --json returned empty output."
  }
  return ($json | ConvertFrom-Json -Depth 100)
}

function Ensure-FirewallRuleForGatewayPort {
  param([int]$Port)

  if (-not (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue)) {
    Write-Warn "NetFirewall cmdlets not available. Skip firewall rule check."
    return
  }

  $ruleName = "OpenClaw Gateway TCP $Port"
  try {
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if ($existing) {
      Write-Check "Firewall rule already present: $ruleName"
      return
    }
    New-NetFirewallRule `
      -DisplayName $ruleName `
      -Direction Inbound `
      -Protocol TCP `
      -LocalPort $Port `
      -Action Allow | Out-Null
    Write-Check "Firewall rule created: $ruleName"
  } catch {
    Write-Warn "Failed to create firewall rule (run elevated PowerShell if needed)."
  }
}

if (-not $IsWindows) {
  Write-Warn "This script is for native Windows only. Skipping."
  exit 0
}

Require-Command node
Require-Command openclaw

if (-not (Test-NodeVersion)) {
  Write-Fail "Node version is below 22.12.0. Please upgrade Node first."
  exit 1
}
Write-Check "Node version OK (>=22.12.0)."

$profile = $env:OPENCLAW_PROFILE
$taskName = Resolve-OpenClawTaskName -Profile $profile

if ($Fix) {
  Write-Check "Applying native service fix steps..."
  & openclaw gateway install --runtime node --force
  & openclaw gateway start
}

$status = Invoke-OpenClawStatusJson -TimeoutMs $TimeoutMs

$loaded = [bool]$status.service.loaded
$runtimeStatus = [string]$status.service.runtime.status
$bindMode = [string]$status.gateway.bindMode
$port = [int]$status.gateway.port
$rpcOk = $false
if ($null -ne $status.rpc) {
  $rpcOk = [bool]$status.rpc.ok
}
$portStatus = ""
if ($null -ne $status.port) {
  $portStatus = [string]$status.port.status
}

Write-Check ("Service loaded: " + $loaded)
Write-Check ("Runtime status: " + $runtimeStatus)
Write-Check ("Bind mode: " + $bindMode)
Write-Check ("Gateway port: " + $port)
Write-Check ("RPC probe ok: " + $rpcOk)
if ($portStatus) {
  Write-Check ("Port status: " + $portStatus)
}

if ($Fix -and $EnsureFirewallForLan -and $bindMode -eq "lan") {
  Ensure-FirewallRuleForGatewayPort -Port $port
}

$ok = $loaded -and $runtimeStatus -eq "running" -and $rpcOk
if ($ok) {
  Write-Host "[ok]    Native Windows gateway is healthy." -ForegroundColor Green
  exit 0
}

Write-Fail "Native Windows gateway is not healthy."
if (-not $loaded) {
  Write-Warn "Gateway service is not installed/loaded."
  Write-Host "       Run: openclaw gateway install --runtime node --force"
}
if ($runtimeStatus -ne "running") {
  Write-Warn "Gateway runtime is not running."
  Write-Host "       Run: openclaw gateway start"
}
if (-not $rpcOk) {
  Write-Warn "Gateway RPC probe failed."
  Write-Host "       Run: openclaw gateway status --json"
}
if ($runtimeStatus -eq "running" -and $portStatus -and $portStatus -ne "busy") {
  Write-Warn "Gateway process is running but port is not listening."
}
if ($bindMode -eq "lan" -and -not $EnsureFirewallForLan) {
  Write-Warn "Gateway bind mode is LAN. Consider adding firewall allow rule."
  Write-Host "       Re-run with: ./windows-native-check.ps1 -Fix -EnsureFirewallForLan"
}

Write-Host ""
Write-Host "Task Scheduler diagnostics:"
Write-Host "  schtasks /Query /TN `"$taskName`" /V /FO LIST"
Write-Host "  schtasks /Run /TN `"$taskName`""
Write-Host "  schtasks /End /TN `"$taskName`""

if (-not $Fix) {
  Write-Host ""
  Write-Host "Auto-fix command:"
  Write-Host "  ./windows-native-check.ps1 -Fix"
}

exit 1
