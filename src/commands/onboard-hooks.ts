import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig } from "../config/config.js";
import { buildWorkspaceHookStatus } from "../hooks/hooks-status.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";

type OnboardingLocale = "zh-CN" | "en-US";

function resolveOnboardingLocale(): OnboardingLocale {
  const raw = (
    process.env.OPENCLAW_LOCALE ??
    process.env.LC_ALL ??
    process.env.LC_MESSAGES ??
    process.env.LANG ??
    ""
  )
    .trim()
    .toLowerCase();
  if (raw.startsWith("en")) {
    return "en-US";
  }
  return "zh-CN";
}

const ONBOARDING_LOCALE = resolveOnboardingLocale();

function tr(text: { zh: string; en: string }): string {
  return ONBOARDING_LOCALE === "zh-CN" ? text.zh : text.en;
}

export async function setupInternalHooks(
  cfg: OpenClawConfig,
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  await prompter.note(
    [
      tr({
        zh: "Hooks 可在 Agent 命令触发时自动执行动作。",
        en: "Hooks let you automate actions when agent commands are issued.",
      }),
      tr({
        zh: "示例：执行 /new 时自动把会话上下文写入 memory。",
        en: "Example: Save session context to memory when you issue /new.",
      }),
      "",
      tr({
        zh: "文档：https://docs.openclaw.ai/automation/hooks",
        en: "Learn more: https://docs.openclaw.ai/automation/hooks",
      }),
    ].join("\n"),
    tr({ zh: "Hooks", en: "Hooks" }),
  );

  // Discover available hooks using the hook discovery system
  const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
  const report = buildWorkspaceHookStatus(workspaceDir, { config: cfg });

  // Show every eligible hook so users can opt in during onboarding.
  const eligibleHooks = report.hooks.filter((h) => h.eligible);

  if (eligibleHooks.length === 0) {
    await prompter.note(
      tr({
        zh: "未发现可启用的 hooks。你可以稍后在配置文件中手动设置。",
        en: "No eligible hooks found. You can configure hooks later in your config.",
      }),
      tr({ zh: "无可用 Hooks", en: "No Hooks Available" }),
    );
    return cfg;
  }

  const toEnable = await prompter.multiselect({
    message: tr({ zh: "启用 hooks？", en: "Enable hooks?" }),
    options: [
      { value: "__skip__", label: tr({ zh: "暂时跳过", en: "Skip for now" }) },
      ...eligibleHooks.map((hook) => ({
        value: hook.name,
        label: `${hook.emoji ?? "🔗"} ${hook.name}`,
        hint: hook.description,
      })),
    ],
  });

  const selected = toEnable.filter((name) => name !== "__skip__");
  if (selected.length === 0) {
    return cfg;
  }

  // Enable selected hooks using the new entries config format
  const entries = { ...cfg.hooks?.internal?.entries };
  for (const name of selected) {
    entries[name] = { enabled: true };
  }

  const next: OpenClawConfig = {
    ...cfg,
    hooks: {
      ...cfg.hooks,
      internal: {
        enabled: true,
        entries,
      },
    },
  };

  await prompter.note(
    [
      tr({
        zh: `已启用 ${selected.length} 个 hook：${selected.join(", ")}`,
        en: `Enabled ${selected.length} hook${selected.length > 1 ? "s" : ""}: ${selected.join(", ")}`,
      }),
      "",
      tr({ zh: "后续可用以下命令管理 hooks：", en: "You can manage hooks later with:" }),
      `  ${formatCliCommand("openclaw hooks list")}`,
      `  ${formatCliCommand("openclaw hooks enable <name>")}`,
      `  ${formatCliCommand("openclaw hooks disable <name>")}`,
    ].join("\n"),
    tr({ zh: "Hooks 已配置", en: "Hooks Configured" }),
  );

  return next;
}
