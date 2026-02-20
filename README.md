# 🦞 Longxia

<p align="center">
  <img src="assets/brand/logo.jpg" alt="Longxia Logo" width="220">
</p>

<p align="center">
  <strong>Longxia：基于 OpenClaw 官方项目打造的全新中文发行版</strong>
</p>

<p align="center">
  <a href="https://github.com/cnvipstar/longxia"><img src="https://img.shields.io/badge/GitHub-cnvipstar%2Flongxia-black?style=for-the-badge" alt="GitHub"></a>
  <a href="https://www.longxia.ren"><img src="https://img.shields.io/badge/Website-www.longxia.ren-0A7BFF?style=for-the-badge" alt="Website"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

[中文 README](README.md) · [English README](README.en.md) · [官网](https://www.longxia.ren)

## 项目定位

**Longxia** 是在 **OpenClaw 官方项目**基础上进行深度本地化改造的发行版，核心目标是：

- 默认中文交互与中文 onboarding 体验。
- 以插件化方式扩展多语言能力，减少核心改动。
- 提供更友好的一键安装流程（macOS/Linux/Windows）。
- 强化 Windows 原生运行检查与修复路径。

> 品牌说明：本项目对外品牌为 **Longxia**。CLI 默认命令为 `longxia`，同时保留 `openclaw` 兼容别名。

## 我们做了什么（与上游差异）

### 1) 全链路中文默认

- onboarding 默认中文（环境变量以 `en` 开头时自动英文）。
- 关键提示、交互文案与引导信息已按中文优先改造。

### 2) 多语言插件化（非硬改核心）

新增语言插件栈：

- `lang-core`
- `lang-zh-cn`
- `lang-en-us`
- `lang-ja-jp`

可通过命令切换语言：

- `/langs`
- `/lang`
- `/lang set <locale>`
- `/lang reset`

详细说明见：[`LANGUAGE_PLUGINS.md`](LANGUAGE_PLUGINS.md)

### 3) 一键安装

- macOS/Linux：`install-cn.sh`
- Windows PowerShell：`install-cn.ps1`

支持克隆、构建、链接 CLI、写入中文默认配置，并可直接进入 onboarding。

### 4) Windows 原生增强

- 增加 `windows-native-check.ps1`：原生依赖检查、服务状态检查、RPC 探活。
- 支持 `-Fix` 自动修复。
- 安装模式支持 `Auto|WSL|Native`。

详细说明见：[`WINDOWS_NATIVE.md`](WINDOWS_NATIVE.md)

## 快速开始

### 运行环境

- Node.js `>= 22`
- 推荐 `pnpm`

### 方式 A：一键安装（推荐）

#### macOS / Linux

```bash
./install-cn.sh
```

#### Windows PowerShell

```powershell
./install-cn.ps1 -Mode Auto
```

常见参数：

- `-Mode Auto`：优先 WSL，可用则走 WSL，否则 Native。
- `-Mode WSL`：强制 WSL 安装。
- `-Mode Native`：强制 Windows 原生安装。
- `-SkipNativeCheck`：跳过原生健康检查。

### 方式 B：从源码安装

```bash
git clone https://github.com/cnvipstar/longxia.git
cd longxia
pnpm install
pnpm ui:build
pnpm build
pnpm link --global
longxia onboard --install-daemon
```

## 与上游同步（Fork 维护）

建议长期保持与上游同步，减少未来升级冲突。

```bash
./sync-upstream.sh
```

默认同步 `main` 分支（要求本地已配置 `upstream` 与 `origin`）。

## 文档索引

- 语言插件：[`LANGUAGE_PLUGINS.md`](LANGUAGE_PLUGINS.md)
- Windows 原生支持：[`WINDOWS_NATIVE.md`](WINDOWS_NATIVE.md)
- PR 模板（中文）：[`PR_LANG_CORE_CN.md`](PR_LANG_CORE_CN.md)
- 发布检查清单：[`RELEASE_CHECKLIST_CN.md`](RELEASE_CHECKLIST_CN.md)

## 开源协议与合规

- 本项目基于上游开源项目 OpenClaw 进行二次开发。
- 沿用上游开源协议：**MIT License**（见 [`LICENSE`](LICENSE)）。
- 你可以用于学习、研究、内部使用与二次分发；若用于商业场景，请自行完成合规与风险评估。

## 说明

- 本仓库会持续推进中文化与易用性增强。
- 若你发现仍有未中文化区域，欢迎提交 Issue 或 PR。
