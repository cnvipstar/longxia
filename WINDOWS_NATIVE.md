# Windows 原生支持（Fork 说明）

## 中文说明

本 Fork 仍然将 **WSL2 作为优先推荐路径**（兼容性和稳定性更好），
同时补充了 Windows 原生运行的检查/修复流程，便于直接在 Windows 上运行。

### 为什么

上游当前主要推荐 Windows 走 WSL2，以保持工具链一致性和运行稳定性。

### 原生检查脚本

执行：

```powershell
./windows-native-check.ps1
```

自动修复模式：

```powershell
./windows-native-check.ps1 -Fix
```

自动修复 + 当 `gateway.bind=lan` 时添加防火墙规则：

```powershell
./windows-native-check.ps1 -Fix -EnsureFirewallForLan
```

检查项：

- Node 版本 >= `22.12.0`
- `openclaw` 命令可用性
- Gateway 服务加载状态（`schtasks`）
- Gateway 运行状态
- Gateway RPC 探活

`-Fix` 会执行：

- `openclaw gateway install --runtime node --force`
- `openclaw gateway start`
- 然后使用 `openclaw gateway status --json` 复检

### 一键安装脚本集成

`install-cn.ps1` 默认在安装后执行一次 native health check（带 `-Fix`）。

如需跳过：

```powershell
./install-cn.ps1 -SkipNativeCheck
```

### 安装模式

`install-cn.ps1` 支持：

- `-Mode Auto`（默认）：可用则优先 WSL，否则走 Native。
- `-Mode WSL`：强制走 WSL（调用 `install-cn.sh`）。
- `-Mode Native`：强制 Windows 原生安装。

示例：

```powershell
./install-cn.ps1 -Mode Auto
./install-cn.ps1 -Mode WSL
./install-cn.ps1 -Mode Native
```

## English notes

This fork keeps **WSL2 as the recommended path** for production stability, but
adds a native Windows hardening/check flow for users who run directly on Windows.

### Why

Upstream currently recommends Windows via WSL2 for toolchain consistency and
better runtime compatibility.

### Native helper script

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

### One-click installer integration

`install-cn.ps1` now runs native health check with `-Fix` by default after install.

Skip it if needed:

```powershell
./install-cn.ps1 -SkipNativeCheck
```

### Installer modes

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
