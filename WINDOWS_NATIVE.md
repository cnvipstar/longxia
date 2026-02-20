# Windows Native Support (Fork Notes)

This fork keeps **WSL2 as the recommended path** for production stability, but
adds a native Windows hardening/check flow for users who run directly on Windows.

## Why

Upstream currently recommends Windows via WSL2 for toolchain consistency and
better runtime compatibility.

## Native helper script

Use:

```powershell
./windows-native-check.ps1
```

Auto-fix mode:

```powershell
./windows-native-check.ps1 -Fix
```

Auto-fix + firewall rule when `gateway.bind=lan`:

```powershell
./windows-native-check.ps1 -Fix -EnsureFirewallForLan
```

What it checks:

- Node version >= `22.12.0`
- `openclaw` command availability
- Gateway service loaded state (`schtasks`)
- Gateway runtime state
- Gateway RPC probe success

What `-Fix` does:

- `openclaw gateway install --runtime node --force`
- `openclaw gateway start`
- then re-checks health via `openclaw gateway status --json`

## One-click installer integration

`install-cn.ps1` now runs native health check with `-Fix` by default after install.

Skip it if needed:

```powershell
./install-cn.ps1 -SkipNativeCheck
```

## Installer modes

`install-cn.ps1` supports:

- `-Mode Auto` (default): prefers WSL when available, otherwise Native.
- `-Mode WSL`: force install via WSL (`install-cn.sh`).
- `-Mode Native`: force native Windows install path.

Examples:

```powershell
./install-cn.ps1 -Mode Auto
./install-cn.ps1 -Mode WSL
./install-cn.ps1 -Mode Native
```
