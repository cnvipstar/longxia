# 发布前检查清单（Fork）

适用分支：`codex/lang-core`

## A. 代码与测试

- [x] TypeScript 编译通过  
      命令：`pnpm exec tsc -p tsconfig.json --noEmit`
- [x] 关键 onboarding 单元测试通过  
      命令：
  - `pnpm vitest run src/commands/onboard-config.test.ts`
  - `pnpm vitest run src/wizard/onboarding.test.ts`
  - `pnpm vitest run src/wizard/onboarding.gateway-config.test.ts`
- [x] onboarding e2e（文案兼容）通过  
      命令：  
      `pnpm vitest run --config vitest.e2e.config.ts src/commands/onboard-hooks.e2e.test.ts src/commands/onboard-skills.e2e.test.ts src/commands/onboard-channels.e2e.test.ts`

## B. 脚本与权限

- [x] Shell 脚本可执行权限正确
  - `install-cn.sh` => `-rwxr-xr-x`
  - `sync-upstream.sh` => `-rwxr-xr-x`
- [x] PowerShell 脚本存在
  - `install-cn.ps1`
  - `windows-native-check.ps1`
- [ ] 在 Windows 原生机上实跑 `install-cn.ps1` 与 `windows-native-check.ps1`
      说明：当前环境为 macOS，未进行原生 Windows 执行验证。

## C. 文档一致性

- [x] README 包含 Fork 快速开始入口
  - 一键安装命令（`install-cn.sh` / `install-cn.ps1 -Mode Auto`）
  - 语言文档与 Windows 文档链接
  - `sync-upstream.sh` 同步说明
- [x] `LANGUAGE_PLUGINS.md` 与 `WINDOWS_NATIVE.md` 为中英双语且参数一致
- [x] PR 说明文档就绪
  - `PR_LANG_CORE_CN.md`

## D. Git 与发布动作

- [x] 分支已推送到远端：`origin/codex/lang-core`
- [ ] 创建/更新 PR 描述（建议直接使用 `PR_LANG_CORE_CN.md`）
- [ ] 合并前再跑一次完整 CI（若仓库有必跑流水线）
