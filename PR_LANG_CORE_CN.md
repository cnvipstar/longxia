# 阶段一 PR 说明（中文默认 + 多语言插件化 + Windows 增强）

## 目标

- 默认中文交互（`zh-CN`）。
- 保持插件化扩展，尽量不改核心逻辑。
- 为后续多语言扩展提供 `lang-core + lang-pack` 结构。
- 提供一键安装脚本与 Windows 原生诊断/修复入口。

## 主要变更

- 新增语言核心插件：
  - `extensions/lang-core/openclaw.plugin.json`
  - `extensions/lang-core/index.ts`
- 新增语言包插件：
  - `extensions/lang-zh-cn/*`
  - `extensions/lang-en-us/*`
  - `extensions/lang-ja-jp/*`
- onboarding 默认自动启用语言插件栈：
  - `src/commands/onboard-config.ts`
  - `src/commands/onboard-config.test.ts`
- onboarding 中文默认文案补齐：
  - `src/commands/onboard-channels.ts`
  - `src/commands/onboard-skills.ts`
  - `src/commands/onboard-custom.ts`
  - `src/commands/onboard-remote.ts`
  - `src/commands/onboard-hooks.ts`
  - `src/commands/onboard-helpers.ts`
  - `src/wizard/onboarding.ts`
  - `src/wizard/onboarding.gateway-config.ts`
  - `src/wizard/onboarding.finalize.ts`
- 一键安装与运维脚本：
  - `install-cn.sh`
  - `install-cn.ps1`
  - `windows-native-check.ps1`
  - `sync-upstream.sh`
- 文档：
  - `LANGUAGE_PLUGINS.md`
  - `WINDOWS_NATIVE.md`

## 行为说明

- 语言选择优先级：
  - `plugins.entries["lang-core"].config.currentLocale`
  - `defaultLocale`
  - 回退 `zh-CN`
- 默认允许语言：
  - `["zh-CN", "en-US", "ja-JP"]`
- 命令：
  - `/langs`
  - `/lang`
  - `/lang set <locale>`
  - `/lang reset`

## Windows 说明

- PowerShell 一键安装支持：
  - `-Mode Auto|Native|WSL`（默认 `Auto`）
  - `Auto` 优先 WSL，否则 Native
- 原生检查脚本支持：
  - 依赖检测
  - 网关服务/健康检查
  - 可选自动修复 `-Fix`
  - LAN 场景防火墙规则 `-EnsureFirewallForLan`

## 验证

- 通过：
  - `pnpm exec tsc -p tsconfig.json --noEmit`
  - `pnpm exec oxlint ...`
  - `pnpm vitest run src/commands/onboard-config.test.ts`
  - `pnpm vitest run src/wizard/onboarding.test.ts`
  - `pnpm vitest run src/wizard/onboarding.gateway-config.test.ts`

## 后续建议（阶段二）

- 增加更多语言包（插件形式，不改核心）。
- 完善 Windows 原生运行文档（服务化/开机启动/防火墙策略）。
- 增加脚本化集成测试（安装脚本 smoke test，Windows CI job）。
