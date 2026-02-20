# PR 标题建议

`feat: zh-default multilingual onboarding, plugin language packs, and windows install flow`

## PR 摘要（可直接粘贴）

本 PR 在尽量不改核心架构的前提下，完成了本 Fork 的阶段一目标：

- 默认中文（`zh-CN`）的 onboarding 与关键交互提示。
- 插件化多语言能力（`lang-core + lang-pack`），支持按语言包扩展。
- 一键安装脚本（macOS/Linux + Windows）与 Windows 原生增强检查。
- 测试层改造成中英文案兼容，降低后续 CI 因文案切换导致的脆弱性。

## 变更范围

### 1) 语言插件（插件式 i18n）

- 新增：
  - `extensions/lang-core/openclaw.plugin.json`
  - `extensions/lang-core/index.ts`
  - `extensions/lang-zh-cn/openclaw.plugin.json`
  - `extensions/lang-zh-cn/index.ts`
  - `extensions/lang-en-us/openclaw.plugin.json`
  - `extensions/lang-en-us/index.ts`
  - `extensions/lang-ja-jp/openclaw.plugin.json`
  - `extensions/lang-ja-jp/index.ts`
- 能力：
  - `/langs`、`/lang`、`/lang set <locale>`、`/lang reset`
  - 默认语言回退：`zh-CN`
  - 可配置：`defaultLocale/currentLocale/allowedLocales`

### 2) onboarding 中文默认（保留英文回退）

- 主要覆盖文件：
  - `src/commands/onboard-channels.ts`
  - `src/commands/onboard-skills.ts`
  - `src/commands/onboard-custom.ts`
  - `src/commands/onboard-remote.ts`
  - `src/commands/onboard-hooks.ts`
  - `src/commands/onboard-helpers.ts`
  - `src/wizard/onboarding.ts`
  - `src/wizard/onboarding.gateway-config.ts`
  - `src/wizard/onboarding.finalize.ts`
- 逻辑：
  - 默认中文
  - 当 `OPENCLAW_LOCALE/LC_*/LANG` 以 `en` 开头时切换英文

### 3) onboarding 默认启用语言栈

- 修改：
  - `src/commands/onboard-config.ts`
- 新增测试：
  - `src/commands/onboard-config.test.ts`

### 4) 一键安装与 Windows 原生增强

- 新增：
  - `install-cn.sh`
  - `install-cn.ps1`
  - `windows-native-check.ps1`
  - `sync-upstream.sh`
- Windows 支持：
  - `install-cn.ps1 -Mode Auto|WSL|Native`
  - `windows-native-check.ps1 -Fix [-EnsureFirewallForLan]`

### 5) 文档

- 新增/更新：
  - `README.md`（Fork quick start 区块）
  - `LANGUAGE_PLUGINS.md`（中英双语）
  - `WINDOWS_NATIVE.md`（中英双语）

### 6) 测试稳定性增强（中英文案兼容）

- 修改：
  - `src/commands/onboard-channels.e2e.test.ts`
  - `src/commands/onboard-hooks.e2e.test.ts`
  - `src/commands/onboard-skills.e2e.test.ts`

## 验证记录

已执行并通过：

- `pnpm exec tsc -p tsconfig.json --noEmit`
- `pnpm exec oxlint ...`
- `pnpm vitest run src/commands/onboard-config.test.ts`
- `pnpm vitest run src/wizard/onboarding.test.ts`
- `pnpm vitest run src/wizard/onboarding.gateway-config.test.ts`
- `pnpm vitest run --config vitest.e2e.config.ts src/commands/onboard-hooks.e2e.test.ts src/commands/onboard-skills.e2e.test.ts src/commands/onboard-channels.e2e.test.ts`

## 兼容性与风险

- 对核心运行逻辑改动较少，优先通过插件与 onboarding 文案层扩展。
- 新增文案默认中文，可能影响依赖英文字符串的外部自动化脚本；测试已在仓内改为中英兼容。
- Windows PowerShell 脚本在当前 macOS 开发环境无法做原生运行验证，已提供参数与健康检查路径。

## 后续计划（阶段二建议）

- 增加更多语言包（继续插件化，不侵入核心）。
- 增加 Windows CI job（原生路径 smoke test）。
- 为 `install-cn.ps1/install-cn.sh` 增补自动化安装回归测试。
