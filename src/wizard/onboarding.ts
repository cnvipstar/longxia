import { formatCliCommand } from "../cli/command-format.js";
import type {
  GatewayAuthChoice,
  OnboardMode,
  OnboardOptions,
  ResetScope,
} from "../commands/onboard-types.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  DEFAULT_GATEWAY_PORT,
  readConfigFileSnapshot,
  resolveGatewayPort,
  writeConfigFile,
} from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { resolveUserPath } from "../utils.js";
import type { QuickstartGatewayDefaults, WizardFlow } from "./onboarding.types.js";
import { WizardCancelledError, type WizardPrompter } from "./prompts.js";

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

function tr(locale: OnboardingLocale, text: { zh: string; en: string }): string {
  return locale === "zh-CN" ? text.zh : text.en;
}

async function requireRiskAcknowledgement(params: {
  opts: OnboardOptions;
  prompter: WizardPrompter;
  locale: OnboardingLocale;
}) {
  if (params.opts.acceptRisk === true) {
    return;
  }

  await params.prompter.note(
    tr(params.locale, {
      zh: [
        "安全警告，请先阅读。",
        "",
        "OpenClaw 是业余项目，仍处于 Beta 阶段。",
        "开启工具后，机器人可以读取文件并执行操作。",
        "恶意提示词可能诱导其执行不安全行为。",
        "",
        "如果你不熟悉基础安全和访问控制，请不要直接运行 OpenClaw。",
        "建议先请有经验的人协助后，再启用工具或对外暴露。",
        "",
        "推荐最小安全基线：",
        "- 配对/白名单 + 提及门控。",
        "- 沙箱 + 最小权限工具。",
        "- 将密钥和敏感文件隔离到 Agent 不可达路径。",
        "- 面向不可信输入时优先使用更强模型。",
        "",
        "请定期执行：",
        "openclaw security audit --deep",
        "openclaw security audit --fix",
        "",
        "必读文档：https://docs.openclaw.ai/gateway/security",
      ].join("\n"),
      en: [
        "Security warning — please read.",
        "",
        "OpenClaw is a hobby project and still in beta. Expect sharp edges.",
        "This bot can read files and run actions if tools are enabled.",
        "A bad prompt can trick it into doing unsafe things.",
        "",
        "If you’re not comfortable with basic security and access control, don’t run OpenClaw.",
        "Ask someone experienced to help before enabling tools or exposing it to the internet.",
        "",
        "Recommended baseline:",
        "- Pairing/allowlists + mention gating.",
        "- Sandbox + least-privilege tools.",
        "- Keep secrets out of the agent’s reachable filesystem.",
        "- Use the strongest available model for any bot with tools or untrusted inboxes.",
        "",
        "Run regularly:",
        "openclaw security audit --deep",
        "openclaw security audit --fix",
        "",
        "Must read: https://docs.openclaw.ai/gateway/security",
      ].join("\n"),
    }),
    tr(params.locale, { zh: "安全", en: "Security" }),
  );

  const ok = await params.prompter.confirm({
    message: tr(params.locale, {
      zh: "我理解该系统能力强且天然有风险。是否继续？",
      en: "I understand this is powerful and inherently risky. Continue?",
    }),
    initialValue: false,
  });
  if (!ok) {
    throw new WizardCancelledError("risk not accepted");
  }
}

export async function runOnboardingWizard(
  opts: OnboardOptions,
  runtime: RuntimeEnv = defaultRuntime,
  prompter: WizardPrompter,
) {
  const locale = resolveOnboardingLocale();
  const onboardHelpers = await import("../commands/onboard-helpers.js");
  onboardHelpers.printWizardHeader(runtime);
  await prompter.intro(tr(locale, { zh: "OpenClaw 初始配置", en: "OpenClaw onboarding" }));
  await requireRiskAcknowledgement({ opts, prompter, locale });

  const snapshot = await readConfigFileSnapshot();
  let baseConfig: OpenClawConfig = snapshot.valid ? snapshot.config : {};

  if (snapshot.exists && !snapshot.valid) {
    await prompter.note(
      onboardHelpers.summarizeExistingConfig(baseConfig),
      tr(locale, { zh: "配置无效", en: "Invalid config" }),
    );
    if (snapshot.issues.length > 0) {
      await prompter.note(
        [
          ...snapshot.issues.map((iss) => `- ${iss.path}: ${iss.message}`),
          "",
          "Docs: https://docs.openclaw.ai/gateway/configuration",
        ].join("\n"),
        tr(locale, { zh: "配置问题", en: "Config issues" }),
      );
    }
    await prompter.outro(
      tr(locale, {
        zh: `配置无效。请先执行 \`${formatCliCommand("openclaw doctor")}\` 修复，再重新运行向导。`,
        en: `Config invalid. Run \`${formatCliCommand("openclaw doctor")}\` to repair it, then re-run onboarding.`,
      }),
    );
    runtime.exit(1);
    return;
  }

  const quickstartHint = tr(locale, {
    zh: `细节可稍后通过 ${formatCliCommand("openclaw configure")} 配置。`,
    en: `Configure details later via ${formatCliCommand("openclaw configure")}.`,
  });
  const manualHint = tr(locale, {
    zh: "手动配置端口、网络、Tailscale 与鉴权选项。",
    en: "Configure port, network, Tailscale, and auth options.",
  });
  const explicitFlowRaw = opts.flow?.trim();
  const normalizedExplicitFlow = explicitFlowRaw === "manual" ? "advanced" : explicitFlowRaw;
  if (
    normalizedExplicitFlow &&
    normalizedExplicitFlow !== "quickstart" &&
    normalizedExplicitFlow !== "advanced"
  ) {
    runtime.error(
      tr(locale, {
        zh: "无效 --flow（可选 quickstart、manual、advanced）。",
        en: "Invalid --flow (use quickstart, manual, or advanced).",
      }),
    );
    runtime.exit(1);
    return;
  }
  const explicitFlow: WizardFlow | undefined =
    normalizedExplicitFlow === "quickstart" || normalizedExplicitFlow === "advanced"
      ? normalizedExplicitFlow
      : undefined;
  let flow: WizardFlow =
    explicitFlow ??
    (await prompter.select({
      message: tr(locale, { zh: "配置模式", en: "Onboarding mode" }),
      options: [
        {
          value: "quickstart",
          label: tr(locale, { zh: "快速开始", en: "QuickStart" }),
          hint: quickstartHint,
        },
        { value: "advanced", label: tr(locale, { zh: "手动", en: "Manual" }), hint: manualHint },
      ],
      initialValue: "quickstart",
    }));

  if (opts.mode === "remote" && flow === "quickstart") {
    await prompter.note(
      tr(locale, {
        zh: "快速开始仅支持本地网关，将切换为手动模式。",
        en: "QuickStart only supports local gateways. Switching to Manual mode.",
      }),
      tr(locale, { zh: "快速开始", en: "QuickStart" }),
    );
    flow = "advanced";
  }

  if (snapshot.exists) {
    await prompter.note(
      onboardHelpers.summarizeExistingConfig(baseConfig),
      tr(locale, { zh: "检测到现有配置", en: "Existing config detected" }),
    );

    const action = await prompter.select({
      message: tr(locale, { zh: "如何处理现有配置", en: "Config handling" }),
      options: [
        { value: "keep", label: tr(locale, { zh: "保留现有值", en: "Use existing values" }) },
        { value: "modify", label: tr(locale, { zh: "更新配置", en: "Update values" }) },
        { value: "reset", label: tr(locale, { zh: "重置", en: "Reset" }) },
      ],
    });

    if (action === "reset") {
      const workspaceDefault =
        baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE;
      const resetScope = (await prompter.select({
        message: tr(locale, { zh: "重置范围", en: "Reset scope" }),
        options: [
          { value: "config", label: tr(locale, { zh: "仅配置", en: "Config only" }) },
          {
            value: "config+creds+sessions",
            label: tr(locale, {
              zh: "配置 + 凭据 + 会话",
              en: "Config + creds + sessions",
            }),
          },
          {
            value: "full",
            label: tr(locale, {
              zh: "完全重置（配置 + 凭据 + 会话 + 工作区）",
              en: "Full reset (config + creds + sessions + workspace)",
            }),
          },
        ],
      })) as ResetScope;
      await onboardHelpers.handleReset(resetScope, resolveUserPath(workspaceDefault), runtime);
      baseConfig = {};
    }
  }

  const quickstartGateway: QuickstartGatewayDefaults = (() => {
    const hasExisting =
      typeof baseConfig.gateway?.port === "number" ||
      baseConfig.gateway?.bind !== undefined ||
      baseConfig.gateway?.auth?.mode !== undefined ||
      baseConfig.gateway?.auth?.token !== undefined ||
      baseConfig.gateway?.auth?.password !== undefined ||
      baseConfig.gateway?.customBindHost !== undefined ||
      baseConfig.gateway?.tailscale?.mode !== undefined;

    const bindRaw = baseConfig.gateway?.bind;
    const bind =
      bindRaw === "loopback" ||
      bindRaw === "lan" ||
      bindRaw === "auto" ||
      bindRaw === "custom" ||
      bindRaw === "tailnet"
        ? bindRaw
        : "loopback";

    let authMode: GatewayAuthChoice = "token";
    if (
      baseConfig.gateway?.auth?.mode === "token" ||
      baseConfig.gateway?.auth?.mode === "password"
    ) {
      authMode = baseConfig.gateway.auth.mode;
    } else if (baseConfig.gateway?.auth?.token) {
      authMode = "token";
    } else if (baseConfig.gateway?.auth?.password) {
      authMode = "password";
    }

    const tailscaleRaw = baseConfig.gateway?.tailscale?.mode;
    const tailscaleMode =
      tailscaleRaw === "off" || tailscaleRaw === "serve" || tailscaleRaw === "funnel"
        ? tailscaleRaw
        : "off";

    return {
      hasExisting,
      port: resolveGatewayPort(baseConfig),
      bind,
      authMode,
      tailscaleMode,
      token: baseConfig.gateway?.auth?.token,
      password: baseConfig.gateway?.auth?.password,
      customBindHost: baseConfig.gateway?.customBindHost,
      tailscaleResetOnExit: baseConfig.gateway?.tailscale?.resetOnExit ?? false,
    };
  })();

  if (flow === "quickstart") {
    const formatBind = (value: "loopback" | "lan" | "auto" | "custom" | "tailnet") => {
      if (value === "loopback") {
        return tr(locale, { zh: "回环 (127.0.0.1)", en: "Loopback (127.0.0.1)" });
      }
      if (value === "lan") {
        return "LAN";
      }
      if (value === "custom") {
        return tr(locale, { zh: "自定义 IP", en: "Custom IP" });
      }
      if (value === "tailnet") {
        return tr(locale, { zh: "Tailnet (Tailscale IP)", en: "Tailnet (Tailscale IP)" });
      }
      return tr(locale, { zh: "自动", en: "Auto" });
    };
    const formatAuth = (value: GatewayAuthChoice) => {
      if (value === "token") {
        return tr(locale, { zh: "Token（默认）", en: "Token (default)" });
      }
      return tr(locale, { zh: "密码", en: "Password" });
    };
    const formatTailscale = (value: "off" | "serve" | "funnel") => {
      if (value === "off") {
        return tr(locale, { zh: "关闭", en: "Off" });
      }
      if (value === "serve") {
        return tr(locale, { zh: "Serve", en: "Serve" });
      }
      return tr(locale, { zh: "Funnel", en: "Funnel" });
    };
    const quickstartLines = quickstartGateway.hasExisting
      ? [
          tr(locale, { zh: "沿用当前网关设置：", en: "Keeping your current gateway settings:" }),
          `${tr(locale, { zh: "网关端口", en: "Gateway port" })}: ${quickstartGateway.port}`,
          `${tr(locale, { zh: "网关绑定", en: "Gateway bind" })}: ${formatBind(quickstartGateway.bind)}`,
          ...(quickstartGateway.bind === "custom" && quickstartGateway.customBindHost
            ? [
                `${tr(locale, { zh: "网关自定义 IP", en: "Gateway custom IP" })}: ${quickstartGateway.customBindHost}`,
              ]
            : []),
          `${tr(locale, { zh: "网关鉴权", en: "Gateway auth" })}: ${formatAuth(quickstartGateway.authMode)}`,
          `${tr(locale, { zh: "Tailscale 暴露", en: "Tailscale exposure" })}: ${formatTailscale(quickstartGateway.tailscaleMode)}`,
          tr(locale, { zh: "下一步直接进入渠道配置。", en: "Direct to chat channels." }),
        ]
      : [
          `${tr(locale, { zh: "网关端口", en: "Gateway port" })}: ${DEFAULT_GATEWAY_PORT}`,
          `${tr(locale, { zh: "网关绑定", en: "Gateway bind" })}: ${tr(locale, { zh: "回环 (127.0.0.1)", en: "Loopback (127.0.0.1)" })}`,
          `${tr(locale, { zh: "网关鉴权", en: "Gateway auth" })}: ${tr(locale, { zh: "Token（默认）", en: "Token (default)" })}`,
          `${tr(locale, { zh: "Tailscale 暴露", en: "Tailscale exposure" })}: ${tr(locale, { zh: "关闭", en: "Off" })}`,
          tr(locale, { zh: "下一步直接进入渠道配置。", en: "Direct to chat channels." }),
        ];
    await prompter.note(
      quickstartLines.join("\n"),
      tr(locale, { zh: "快速开始", en: "QuickStart" }),
    );
  }

  const localPort = resolveGatewayPort(baseConfig);
  const localUrl = `ws://127.0.0.1:${localPort}`;
  const localProbe = await onboardHelpers.probeGatewayReachable({
    url: localUrl,
    token: baseConfig.gateway?.auth?.token ?? process.env.OPENCLAW_GATEWAY_TOKEN,
    password: baseConfig.gateway?.auth?.password ?? process.env.OPENCLAW_GATEWAY_PASSWORD,
  });
  const remoteUrl = baseConfig.gateway?.remote?.url?.trim() ?? "";
  const remoteProbe = remoteUrl
    ? await onboardHelpers.probeGatewayReachable({
        url: remoteUrl,
        token: baseConfig.gateway?.remote?.token,
      })
    : null;

  const mode =
    opts.mode ??
    (flow === "quickstart"
      ? "local"
      : ((await prompter.select({
          message: tr(locale, { zh: "你要配置哪种模式？", en: "What do you want to set up?" }),
          options: [
            {
              value: "local",
              label: tr(locale, {
                zh: "本地网关（本机）",
                en: "Local gateway (this machine)",
              }),
              hint: localProbe.ok
                ? `Gateway reachable (${localUrl})`
                : `No gateway detected (${localUrl})`,
            },
            {
              value: "remote",
              label: tr(locale, {
                zh: "远程网关（仅连接信息）",
                en: "Remote gateway (info-only)",
              }),
              hint: !remoteUrl
                ? "No remote URL configured yet"
                : remoteProbe?.ok
                  ? `Gateway reachable (${remoteUrl})`
                  : `Configured but unreachable (${remoteUrl})`,
            },
          ],
        })) as OnboardMode));

  if (mode === "remote") {
    const { promptRemoteGatewayConfig } = await import("../commands/onboard-remote.js");
    const { logConfigUpdated } = await import("../config/logging.js");
    let nextConfig = await promptRemoteGatewayConfig(baseConfig, prompter);
    nextConfig = onboardHelpers.applyWizardMetadata(nextConfig, { command: "onboard", mode });
    await writeConfigFile(nextConfig);
    logConfigUpdated(runtime);
    await prompter.outro(
      tr(locale, { zh: "远程网关配置已完成。", en: "Remote gateway configured." }),
    );
    return;
  }

  const workspaceInput =
    opts.workspace ??
    (flow === "quickstart"
      ? (baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE)
      : await prompter.text({
          message: tr(locale, { zh: "工作区目录", en: "Workspace directory" }),
          initialValue: baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE,
        }));

  const workspaceDir = resolveUserPath(workspaceInput.trim() || onboardHelpers.DEFAULT_WORKSPACE);

  const { applyOnboardingLocalWorkspaceConfig } = await import("../commands/onboard-config.js");
  let nextConfig: OpenClawConfig = applyOnboardingLocalWorkspaceConfig(baseConfig, workspaceDir);

  const { ensureAuthProfileStore } = await import("../agents/auth-profiles.js");
  const { promptAuthChoiceGrouped } = await import("../commands/auth-choice-prompt.js");
  const { promptCustomApiConfig } = await import("../commands/onboard-custom.js");
  const { applyAuthChoice, resolvePreferredProviderForAuthChoice, warnIfModelConfigLooksOff } =
    await import("../commands/auth-choice.js");
  const { applyPrimaryModel, promptDefaultModel } = await import("../commands/model-picker.js");

  const authStore = ensureAuthProfileStore(undefined, {
    allowKeychainPrompt: false,
  });
  const authChoiceFromPrompt = opts.authChoice === undefined;
  const authChoice =
    opts.authChoice ??
    (await promptAuthChoiceGrouped({
      prompter,
      store: authStore,
      includeSkip: true,
    }));

  if (authChoice === "custom-api-key") {
    const customResult = await promptCustomApiConfig({
      prompter,
      runtime,
      config: nextConfig,
    });
    nextConfig = customResult.config;
  } else {
    const authResult = await applyAuthChoice({
      authChoice,
      config: nextConfig,
      prompter,
      runtime,
      setDefaultModel: true,
      opts: {
        tokenProvider: opts.tokenProvider,
        token: opts.authChoice === "apiKey" && opts.token ? opts.token : undefined,
      },
    });
    nextConfig = authResult.config;
  }

  if (authChoiceFromPrompt && authChoice !== "custom-api-key") {
    const modelSelection = await promptDefaultModel({
      config: nextConfig,
      prompter,
      allowKeep: true,
      ignoreAllowlist: true,
      includeVllm: true,
      preferredProvider: resolvePreferredProviderForAuthChoice(authChoice),
    });
    if (modelSelection.config) {
      nextConfig = modelSelection.config;
    }
    if (modelSelection.model) {
      nextConfig = applyPrimaryModel(nextConfig, modelSelection.model);
    }
  }

  await warnIfModelConfigLooksOff(nextConfig, prompter);

  const { configureGatewayForOnboarding } = await import("./onboarding.gateway-config.js");
  const gateway = await configureGatewayForOnboarding({
    flow,
    baseConfig,
    nextConfig,
    localPort,
    quickstartGateway,
    prompter,
    runtime,
  });
  nextConfig = gateway.nextConfig;
  const settings = gateway.settings;

  if (opts.skipChannels ?? opts.skipProviders) {
    await prompter.note(
      tr(locale, { zh: "跳过渠道配置。", en: "Skipping channel setup." }),
      tr(locale, { zh: "渠道", en: "Channels" }),
    );
  } else {
    const { listChannelPlugins } = await import("../channels/plugins/index.js");
    const { setupChannels } = await import("../commands/onboard-channels.js");
    const quickstartAllowFromChannels =
      flow === "quickstart"
        ? listChannelPlugins()
            .filter((plugin) => plugin.meta.quickstartAllowFrom)
            .map((plugin) => plugin.id)
        : [];
    nextConfig = await setupChannels(nextConfig, runtime, prompter, {
      allowSignalInstall: true,
      forceAllowFromChannels: quickstartAllowFromChannels,
      skipDmPolicyPrompt: flow === "quickstart",
      skipConfirm: flow === "quickstart",
      quickstartDefaults: flow === "quickstart",
    });
  }

  await writeConfigFile(nextConfig);
  const { logConfigUpdated } = await import("../config/logging.js");
  logConfigUpdated(runtime);
  await onboardHelpers.ensureWorkspaceAndSessions(workspaceDir, runtime, {
    skipBootstrap: Boolean(nextConfig.agents?.defaults?.skipBootstrap),
  });

  if (opts.skipSkills) {
    await prompter.note(
      tr(locale, { zh: "跳过技能配置。", en: "Skipping skills setup." }),
      tr(locale, { zh: "技能", en: "Skills" }),
    );
  } else {
    const { setupSkills } = await import("../commands/onboard-skills.js");
    nextConfig = await setupSkills(nextConfig, workspaceDir, runtime, prompter);
  }

  // Setup hooks (session memory on /new)
  const { setupInternalHooks } = await import("../commands/onboard-hooks.js");
  nextConfig = await setupInternalHooks(nextConfig, runtime, prompter);

  nextConfig = onboardHelpers.applyWizardMetadata(nextConfig, { command: "onboard", mode });
  await writeConfigFile(nextConfig);

  const { finalizeOnboardingWizard } = await import("./onboarding.finalize.js");
  const { launchedTui } = await finalizeOnboardingWizard({
    flow,
    opts,
    baseConfig,
    nextConfig,
    workspaceDir,
    settings,
    prompter,
    runtime,
  });
  if (launchedTui) {
    return;
  }
}
