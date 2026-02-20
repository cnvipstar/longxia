import { installSkill } from "../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../agents/skills-status.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { normalizeSecretInput } from "../utils/normalize-secret-input.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { detectBinary, resolveNodeManagerOptions } from "./onboard-helpers.js";

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

function summarizeInstallFailure(message: string): string | undefined {
  const cleaned = message.replace(/^Install failed(?:\s*\([^)]*\))?\s*:?\s*/i, "").trim();
  if (!cleaned) {
    return undefined;
  }
  const maxLen = 140;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

function formatSkillHint(skill: {
  description?: string;
  install: Array<{ label: string }>;
}): string {
  const desc = skill.description?.trim();
  const installLabel = skill.install[0]?.label?.trim();
  const combined = desc && installLabel ? `${desc} — ${installLabel}` : desc || installLabel;
  if (!combined) {
    return "install";
  }
  const maxLen = 90;
  return combined.length > maxLen ? `${combined.slice(0, maxLen - 1)}…` : combined;
}

function upsertSkillEntry(
  cfg: OpenClawConfig,
  skillKey: string,
  patch: { apiKey?: string },
): OpenClawConfig {
  const entries = { ...cfg.skills?.entries };
  const existing = (entries[skillKey] as { apiKey?: string } | undefined) ?? {};
  entries[skillKey] = { ...existing, ...patch };
  return {
    ...cfg,
    skills: {
      ...cfg.skills,
      entries,
    },
  };
}

export async function setupSkills(
  cfg: OpenClawConfig,
  workspaceDir: string,
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  const report = buildWorkspaceSkillStatus(workspaceDir, { config: cfg });
  const eligible = report.skills.filter((s) => s.eligible);
  const unsupportedOs = report.skills.filter(
    (s) => !s.disabled && !s.blockedByAllowlist && s.missing.os.length > 0,
  );
  const missing = report.skills.filter(
    (s) => !s.eligible && !s.disabled && !s.blockedByAllowlist && s.missing.os.length === 0,
  );
  const blocked = report.skills.filter((s) => s.blockedByAllowlist);

  await prompter.note(
    [
      `Eligible: ${eligible.length}`,
      `Missing requirements: ${missing.length}`,
      `Unsupported on this OS: ${unsupportedOs.length}`,
      `Blocked by allowlist: ${blocked.length}`,
    ].join("\n"),
    tr({ zh: "技能状态", en: "Skills status" }),
  );

  const shouldConfigure = await prompter.confirm({
    message: tr({ zh: "现在配置技能吗？（推荐）", en: "Configure skills now? (recommended)" }),
    initialValue: true,
  });
  if (!shouldConfigure) {
    return cfg;
  }

  const installable = missing.filter(
    (skill) => skill.install.length > 0 && skill.missing.bins.length > 0,
  );
  let next: OpenClawConfig = cfg;
  if (installable.length > 0) {
    const toInstall = await prompter.multiselect({
      message: tr({ zh: "安装缺失的技能依赖", en: "Install missing skill dependencies" }),
      options: [
        {
          value: "__skip__",
          label: tr({ zh: "暂时跳过", en: "Skip for now" }),
          hint: tr({
            zh: "不安装依赖，继续后续步骤",
            en: "Continue without installing dependencies",
          }),
        },
        ...installable.map((skill) => ({
          value: skill.name,
          label: `${skill.emoji ?? "🧩"} ${skill.name}`,
          hint: formatSkillHint(skill),
        })),
      ],
    });

    const selected = toInstall.filter((name) => name !== "__skip__");

    const selectedSkills = selected
      .map((name) => installable.find((s) => s.name === name))
      .filter((item): item is (typeof installable)[number] => Boolean(item));

    const needsBrewPrompt =
      process.platform !== "win32" &&
      selectedSkills.some((skill) => skill.install.some((option) => option.kind === "brew")) &&
      !(await detectBinary("brew"));

    if (needsBrewPrompt) {
      await prompter.note(
        [
          tr({
            zh: "很多技能依赖通过 Homebrew 分发。",
            en: "Many skill dependencies are shipped via Homebrew.",
          }),
          tr({
            zh: "如果没有 brew，需要手动源码构建或下载发行版。",
            en: "Without brew, you'll need to build from source or download releases manually.",
          }),
        ].join("\n"),
        tr({ zh: "推荐 Homebrew", en: "Homebrew recommended" }),
      );
      const showBrewInstall = await prompter.confirm({
        message: tr({ zh: "显示 Homebrew 安装命令吗？", en: "Show Homebrew install command?" }),
        initialValue: true,
      });
      if (showBrewInstall) {
        await prompter.note(
          [
            tr({ zh: "执行：", en: "Run:" }),
            '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
          ].join("\n"),
          tr({ zh: "Homebrew 安装", en: "Homebrew install" }),
        );
      }
    }

    const needsNodeManagerPrompt = selectedSkills.some((skill) =>
      skill.install.some((option) => option.kind === "node"),
    );
    if (needsNodeManagerPrompt) {
      const nodeManager = (await prompter.select({
        message: tr({
          zh: "技能安装优先使用的 Node 管理器",
          en: "Preferred node manager for skill installs",
        }),
        options: resolveNodeManagerOptions(),
      })) as "npm" | "pnpm" | "bun";
      next = {
        ...next,
        skills: {
          ...next.skills,
          install: {
            ...next.skills?.install,
            nodeManager,
          },
        },
      };
    }

    for (const name of selected) {
      const target = installable.find((s) => s.name === name);
      if (!target || target.install.length === 0) {
        continue;
      }
      const installId = target.install[0]?.id;
      if (!installId) {
        continue;
      }
      const installLabel = tr({ zh: `安装 ${name}…`, en: `Installing ${name}…` });
      const spin = prompter.progress(installLabel);
      const result = await installSkill({
        workspaceDir,
        skillName: target.name,
        installId,
        config: next,
      });
      const warnings = result.warnings ?? [];
      if (result.ok) {
        spin.stop(
          warnings.length > 0
            ? tr({ zh: `已安装 ${name}（有警告）`, en: `Installed ${name} (with warnings)` })
            : tr({ zh: `已安装 ${name}`, en: `Installed ${name}` }),
        );
        for (const warning of warnings) {
          runtime.log(warning);
        }
        continue;
      }
      const code = result.code == null ? "" : ` (exit ${result.code})`;
      const detail = summarizeInstallFailure(result.message);
      spin.stop(
        `${tr({ zh: "安装失败", en: "Install failed" })}: ${name}${code}${detail ? ` - ${detail}` : ""}`,
      );
      for (const warning of warnings) {
        runtime.log(warning);
      }
      if (result.stderr) {
        runtime.log(result.stderr.trim());
      } else if (result.stdout) {
        runtime.log(result.stdout.trim());
      }
      runtime.log(
        tr({
          zh: `提示：可执行 \`${formatCliCommand("openclaw doctor")}\` 检查技能与依赖状态。`,
          en: `Tip: run \`${formatCliCommand("openclaw doctor")}\` to review skills + requirements.`,
        }),
      );
      runtime.log(
        tr({
          zh: "文档：https://docs.openclaw.ai/skills",
          en: "Docs: https://docs.openclaw.ai/skills",
        }),
      );
    }
  }

  for (const skill of missing) {
    if (!skill.primaryEnv || skill.missing.env.length === 0) {
      continue;
    }
    const wantsKey = await prompter.confirm({
      message: tr({
        zh: `为 ${skill.name} 设置 ${skill.primaryEnv} 吗？`,
        en: `Set ${skill.primaryEnv} for ${skill.name}?`,
      }),
      initialValue: false,
    });
    if (!wantsKey) {
      continue;
    }
    const apiKey = String(
      await prompter.text({
        message: tr({ zh: `请输入 ${skill.primaryEnv}`, en: `Enter ${skill.primaryEnv}` }),
        validate: (value) => (value?.trim() ? undefined : tr({ zh: "必填", en: "Required" })),
      }),
    );
    next = upsertSkillEntry(next, skill.skillKey, { apiKey: normalizeSecretInput(apiKey) });
  }

  return next;
}
