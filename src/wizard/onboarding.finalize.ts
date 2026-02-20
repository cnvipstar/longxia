import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_BOOTSTRAP_FILENAME } from "../agents/workspace.js";
import { formatCliCommand } from "../cli/command-format.js";
import {
  buildGatewayInstallPlan,
  gatewayInstallErrorHint,
} from "../commands/daemon-install-helpers.js";
import {
  DEFAULT_GATEWAY_DAEMON_RUNTIME,
  GATEWAY_DAEMON_RUNTIME_OPTIONS,
} from "../commands/daemon-runtime.js";
import { formatHealthCheckFailure } from "../commands/health-format.js";
import { healthCommand } from "../commands/health.js";
import {
  detectBrowserOpenSupport,
  formatControlUiSshHint,
  openUrl,
  probeGatewayReachable,
  waitForGatewayReachable,
  resolveControlUiLinks,
} from "../commands/onboard-helpers.js";
import type { OnboardOptions } from "../commands/onboard-types.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveGatewayService } from "../daemon/service.js";
import { isSystemdUserServiceAvailable } from "../daemon/systemd.js";
import { ensureControlUiAssetsBuilt } from "../infra/control-ui-assets.js";
import type { RuntimeEnv } from "../runtime.js";
import { restoreTerminalState } from "../terminal/restore.js";
import { runTui } from "../tui/tui.js";
import { resolveUserPath } from "../utils.js";
import { setupOnboardingShellCompletion } from "./onboarding.completion.js";
import type { GatewayWizardSettings, WizardFlow } from "./onboarding.types.js";
import type { WizardPrompter } from "./prompts.js";

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

type FinalizeOnboardingOptions = {
  flow: WizardFlow;
  opts: OnboardOptions;
  baseConfig: OpenClawConfig;
  nextConfig: OpenClawConfig;
  workspaceDir: string;
  settings: GatewayWizardSettings;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
};

export async function finalizeOnboardingWizard(
  options: FinalizeOnboardingOptions,
): Promise<{ launchedTui: boolean }> {
  const { flow, opts, baseConfig, nextConfig, settings, prompter, runtime } = options;
  const locale = resolveOnboardingLocale();

  const withWizardProgress = async <T>(
    label: string,
    options: { doneMessage?: string },
    work: (progress: { update: (message: string) => void }) => Promise<T>,
  ): Promise<T> => {
    const progress = prompter.progress(label);
    try {
      return await work(progress);
    } finally {
      progress.stop(options.doneMessage);
    }
  };

  const systemdAvailable =
    process.platform === "linux" ? await isSystemdUserServiceAvailable() : true;
  if (process.platform === "linux" && !systemdAvailable) {
    await prompter.note(
      tr(locale, {
        zh: "Systemd 用户服务不可用，将跳过 lingering 检查与服务安装。",
        en: "Systemd user services are unavailable. Skipping lingering checks and service install.",
      }),
      "Systemd",
    );
  }

  if (process.platform === "linux" && systemdAvailable) {
    const { ensureSystemdUserLingerInteractive } = await import("../commands/systemd-linger.js");
    await ensureSystemdUserLingerInteractive({
      runtime,
      prompter: {
        confirm: prompter.confirm,
        note: prompter.note,
      },
      reason: tr(locale, {
        zh: "Linux 默认使用 systemd 用户服务。未启用 lingering 时，注销/空闲会停止会话并杀掉 Gateway。",
        en: "Linux installs use a systemd user service by default. Without lingering, systemd stops the user session on logout/idle and kills the Gateway.",
      }),
      requireConfirm: false,
    });
  }

  const explicitInstallDaemon =
    typeof opts.installDaemon === "boolean" ? opts.installDaemon : undefined;
  let installDaemon: boolean;
  if (explicitInstallDaemon !== undefined) {
    installDaemon = explicitInstallDaemon;
  } else if (process.platform === "linux" && !systemdAvailable) {
    installDaemon = false;
  } else if (flow === "quickstart") {
    installDaemon = true;
  } else {
    installDaemon = await prompter.confirm({
      message: tr(locale, {
        zh: "是否安装 Gateway 服务（推荐）",
        en: "Install Gateway service (recommended)",
      }),
      initialValue: true,
    });
  }

  if (process.platform === "linux" && !systemdAvailable && installDaemon) {
    await prompter.note(
      tr(locale, {
        zh: "Systemd 用户服务不可用，跳过服务安装。请改用容器 supervisor 或 `docker compose up -d`。",
        en: "Systemd user services are unavailable; skipping service install. Use your container supervisor or `docker compose up -d`.",
      }),
      tr(locale, { zh: "网关服务", en: "Gateway service" }),
    );
    installDaemon = false;
  }

  if (installDaemon) {
    const daemonRuntime =
      flow === "quickstart"
        ? DEFAULT_GATEWAY_DAEMON_RUNTIME
        : await prompter.select({
            message: tr(locale, { zh: "Gateway 服务运行时", en: "Gateway service runtime" }),
            options: GATEWAY_DAEMON_RUNTIME_OPTIONS,
            initialValue: opts.daemonRuntime ?? DEFAULT_GATEWAY_DAEMON_RUNTIME,
          });
    if (flow === "quickstart") {
      await prompter.note(
        tr(locale, {
          zh: "快速开始默认使用 Node 作为 Gateway 服务运行时（稳定且官方支持）。",
          en: "QuickStart uses Node for the Gateway service (stable + supported).",
        }),
        tr(locale, { zh: "服务运行时", en: "Gateway service runtime" }),
      );
    }
    const service = resolveGatewayService();
    const loaded = await service.isLoaded({ env: process.env });
    if (loaded) {
      const action = await prompter.select({
        message: tr(locale, { zh: "Gateway 服务已安装", en: "Gateway service already installed" }),
        options: [
          { value: "restart", label: tr(locale, { zh: "重启", en: "Restart" }) },
          { value: "reinstall", label: tr(locale, { zh: "重装", en: "Reinstall" }) },
          { value: "skip", label: tr(locale, { zh: "跳过", en: "Skip" }) },
        ],
      });
      if (action === "restart") {
        await withWizardProgress(
          "Gateway service",
          { doneMessage: "Gateway service restarted." },
          async (progress) => {
            progress.update(
              tr(locale, { zh: "正在重启 Gateway 服务…", en: "Restarting Gateway service…" }),
            );
            await service.restart({
              env: process.env,
              stdout: process.stdout,
            });
          },
        );
      } else if (action === "reinstall") {
        await withWizardProgress(
          tr(locale, { zh: "Gateway 服务", en: "Gateway service" }),
          {
            doneMessage: tr(locale, {
              zh: "Gateway 服务已卸载。",
              en: "Gateway service uninstalled.",
            }),
          },
          async (progress) => {
            progress.update(
              tr(locale, { zh: "正在卸载 Gateway 服务…", en: "Uninstalling Gateway service…" }),
            );
            await service.uninstall({ env: process.env, stdout: process.stdout });
          },
        );
      }
    }

    if (!loaded || (loaded && !(await service.isLoaded({ env: process.env })))) {
      const progress = prompter.progress(tr(locale, { zh: "Gateway 服务", en: "Gateway service" }));
      let installError: string | null = null;
      try {
        progress.update(
          tr(locale, { zh: "正在准备 Gateway 服务…", en: "Preparing Gateway service…" }),
        );
        const { programArguments, workingDirectory, environment } = await buildGatewayInstallPlan({
          env: process.env,
          port: settings.port,
          token: settings.gatewayToken,
          runtime: daemonRuntime,
          warn: (message, title) => prompter.note(message, title),
          config: nextConfig,
        });

        progress.update(
          tr(locale, { zh: "正在安装 Gateway 服务…", en: "Installing Gateway service…" }),
        );
        await service.install({
          env: process.env,
          stdout: process.stdout,
          programArguments,
          workingDirectory,
          environment,
        });
      } catch (err) {
        installError = err instanceof Error ? err.message : String(err);
      } finally {
        progress.stop(
          installError
            ? tr(locale, { zh: "Gateway 服务安装失败。", en: "Gateway service install failed." })
            : tr(locale, { zh: "Gateway 服务已安装。", en: "Gateway service installed." }),
        );
      }
      if (installError) {
        await prompter.note(
          tr(locale, {
            zh: `Gateway 服务安装失败：${installError}`,
            en: `Gateway service install failed: ${installError}`,
          }),
          tr(locale, { zh: "网关", en: "Gateway" }),
        );
        await prompter.note(gatewayInstallErrorHint(), tr(locale, { zh: "网关", en: "Gateway" }));
      }
    }
  }

  if (!opts.skipHealth) {
    const probeLinks = resolveControlUiLinks({
      bind: nextConfig.gateway?.bind ?? "loopback",
      port: settings.port,
      customBindHost: nextConfig.gateway?.customBindHost,
      basePath: undefined,
    });
    // Daemon install/restart can briefly flap the WS; wait a bit so health check doesn't false-fail.
    await waitForGatewayReachable({
      url: probeLinks.wsUrl,
      token: settings.gatewayToken,
      deadlineMs: 15_000,
    });
    try {
      await healthCommand({ json: false, timeoutMs: 10_000 }, runtime);
    } catch (err) {
      runtime.error(formatHealthCheckFailure(err));
      await prompter.note(
        [
          "Docs:",
          "https://docs.openclaw.ai/gateway/health",
          "https://docs.openclaw.ai/gateway/troubleshooting",
        ].join("\n"),
        tr(locale, { zh: "健康检查帮助", en: "Health check help" }),
      );
    }
  }

  const controlUiEnabled =
    nextConfig.gateway?.controlUi?.enabled ?? baseConfig.gateway?.controlUi?.enabled ?? true;
  if (!opts.skipUi && controlUiEnabled) {
    const controlUiAssets = await ensureControlUiAssetsBuilt(runtime);
    if (!controlUiAssets.ok && controlUiAssets.message) {
      runtime.error(controlUiAssets.message);
    }
  }

  await prompter.note(
    [
      tr(locale, { zh: "可添加节点扩展能力：", en: "Add nodes for extra features:" }),
      tr(locale, {
        zh: "- macOS 应用（系统能力 + 通知）",
        en: "- macOS app (system + notifications)",
      }),
      tr(locale, { zh: "- iOS 应用（相机/canvas）", en: "- iOS app (camera/canvas)" }),
      tr(locale, { zh: "- Android 应用（相机/canvas）", en: "- Android app (camera/canvas)" }),
    ].join("\n"),
    tr(locale, { zh: "可选应用", en: "Optional apps" }),
  );

  const controlUiBasePath =
    nextConfig.gateway?.controlUi?.basePath ?? baseConfig.gateway?.controlUi?.basePath;
  const links = resolveControlUiLinks({
    bind: settings.bind,
    port: settings.port,
    customBindHost: settings.customBindHost,
    basePath: controlUiBasePath,
  });
  const authedUrl =
    settings.authMode === "token" && settings.gatewayToken
      ? `${links.httpUrl}#token=${encodeURIComponent(settings.gatewayToken)}`
      : links.httpUrl;
  const gatewayProbe = await probeGatewayReachable({
    url: links.wsUrl,
    token: settings.authMode === "token" ? settings.gatewayToken : undefined,
    password: settings.authMode === "password" ? nextConfig.gateway?.auth?.password : "",
  });
  const gatewayStatusLine = gatewayProbe.ok
    ? "Gateway: reachable"
    : `Gateway: not detected${gatewayProbe.detail ? ` (${gatewayProbe.detail})` : ""}`;
  const bootstrapPath = path.join(
    resolveUserPath(options.workspaceDir),
    DEFAULT_BOOTSTRAP_FILENAME,
  );
  const hasBootstrap = await fs
    .access(bootstrapPath)
    .then(() => true)
    .catch(() => false);

  await prompter.note(
    [
      `Web UI: ${links.httpUrl}`,
      settings.authMode === "token" && settings.gatewayToken
        ? `Web UI (with token): ${authedUrl}`
        : undefined,
      `Gateway WS: ${links.wsUrl}`,
      gatewayStatusLine,
      "Docs: https://docs.openclaw.ai/web/control-ui",
    ]
      .filter(Boolean)
      .join("\n"),
    "Control UI",
  );

  let controlUiOpened = false;
  let controlUiOpenHint: string | undefined;
  let seededInBackground = false;
  let hatchChoice: "tui" | "web" | "later" | null = null;
  let launchedTui = false;

  if (!opts.skipUi && gatewayProbe.ok) {
    if (hasBootstrap) {
      await prompter.note(
        [
          tr(locale, {
            zh: "这是定义你 Agent 风格的关键一步。",
            en: "This is the defining action that makes your agent you.",
          }),
          tr(locale, { zh: "请慢慢来。", en: "Please take your time." }),
          tr(locale, {
            zh: "你提供的信息越充分，后续体验越好。",
            en: "The more you tell it, the better the experience will be.",
          }),
          tr(locale, {
            zh: '系统将发送："Wake up, my friend!"',
            en: 'We will send: "Wake up, my friend!"',
          }),
        ].join("\n"),
        tr(locale, { zh: "启动 TUI（最佳选项）", en: "Start TUI (best option!)" }),
      );
    }

    await prompter.note(
      [
        tr(locale, {
          zh: "Gateway token：Gateway 与 Control UI 共用鉴权凭据。",
          en: "Gateway token: shared auth for the Gateway + Control UI.",
        }),
        tr(locale, {
          zh: "存储位置：~/.openclaw/openclaw.json (gateway.auth.token) 或 OPENCLAW_GATEWAY_TOKEN。",
          en: "Stored in: ~/.openclaw/openclaw.json (gateway.auth.token) or OPENCLAW_GATEWAY_TOKEN.",
        }),
        `${tr(locale, { zh: "查看 token", en: "View token" })}: ${formatCliCommand("openclaw config get gateway.auth.token")}`,
        `${tr(locale, { zh: "生成 token", en: "Generate token" })}: ${formatCliCommand("openclaw doctor --generate-gateway-token")}`,
        tr(locale, {
          zh: "Web UI 会在当前浏览器 localStorage 保存一份副本（openclaw.control.settings.v1）。",
          en: "Web UI stores a copy in this browser's localStorage (openclaw.control.settings.v1).",
        }),
        `${tr(locale, { zh: "随时打开仪表盘", en: "Open the dashboard anytime" })}: ${formatCliCommand("openclaw dashboard --no-open")}`,
        tr(locale, {
          zh: "若页面提示鉴权，请在 Control UI 设置里粘贴 token（或使用带 token 的 dashboard URL）。",
          en: "If prompted: paste the token into Control UI settings (or use the tokenized dashboard URL).",
        }),
      ].join("\n"),
      tr(locale, { zh: "Token", en: "Token" }),
    );

    hatchChoice = await prompter.select({
      message: tr(locale, {
        zh: "你希望如何启动你的机器人？",
        en: "How do you want to hatch your bot?",
      }),
      options: [
        {
          value: "tui",
          label: tr(locale, { zh: "在 TUI 中启动（推荐）", en: "Hatch in TUI (recommended)" }),
        },
        { value: "web", label: tr(locale, { zh: "打开 Web UI", en: "Open the Web UI" }) },
        { value: "later", label: tr(locale, { zh: "稍后再做", en: "Do this later" }) },
      ],
      initialValue: "tui",
    });

    if (hatchChoice === "tui") {
      restoreTerminalState("pre-onboarding tui", { resumeStdinIfPaused: true });
      await runTui({
        url: links.wsUrl,
        token: settings.authMode === "token" ? settings.gatewayToken : undefined,
        password: settings.authMode === "password" ? nextConfig.gateway?.auth?.password : "",
        // Safety: onboarding TUI should not auto-deliver to lastProvider/lastTo.
        deliver: false,
        message: hasBootstrap ? "Wake up, my friend!" : undefined,
      });
      launchedTui = true;
    } else if (hatchChoice === "web") {
      const browserSupport = await detectBrowserOpenSupport();
      if (browserSupport.ok) {
        controlUiOpened = await openUrl(authedUrl);
        if (!controlUiOpened) {
          controlUiOpenHint = formatControlUiSshHint({
            port: settings.port,
            basePath: controlUiBasePath,
            token: settings.authMode === "token" ? settings.gatewayToken : undefined,
          });
        }
      } else {
        controlUiOpenHint = formatControlUiSshHint({
          port: settings.port,
          basePath: controlUiBasePath,
          token: settings.authMode === "token" ? settings.gatewayToken : undefined,
        });
      }
      await prompter.note(
        [
          `Dashboard link (with token): ${authedUrl}`,
          controlUiOpened
            ? "Opened in your browser. Keep that tab to control Longxia."
            : "Copy/paste this URL in a browser on this machine to control Longxia.",
          controlUiOpenHint,
        ]
          .filter(Boolean)
          .join("\n"),
        "Dashboard ready",
      );
    } else {
      await prompter.note(
        `When you're ready: ${formatCliCommand("openclaw dashboard --no-open")}`,
        "Later",
      );
    }
  } else if (opts.skipUi) {
    await prompter.note(
      tr(locale, { zh: "已跳过 Control UI/TUI 交互。", en: "Skipping Control UI/TUI prompts." }),
      "Control UI",
    );
  }

  await prompter.note(
    [
      "Back up your agent workspace.",
      "Docs: https://docs.openclaw.ai/concepts/agent-workspace",
    ].join("\n"),
    "Workspace backup",
  );

  await prompter.note(
    tr(locale, {
      zh: "在本机运行 Agent 存在风险，请先完成安全加固：https://docs.openclaw.ai/security",
      en: "Running agents on your computer is risky — harden your setup: https://docs.openclaw.ai/security",
    }),
    tr(locale, { zh: "安全", en: "Security" }),
  );

  await setupOnboardingShellCompletion({ flow, prompter });

  const shouldOpenControlUi =
    !opts.skipUi &&
    settings.authMode === "token" &&
    Boolean(settings.gatewayToken) &&
    hatchChoice === null;
  if (shouldOpenControlUi) {
    const browserSupport = await detectBrowserOpenSupport();
    if (browserSupport.ok) {
      controlUiOpened = await openUrl(authedUrl);
      if (!controlUiOpened) {
        controlUiOpenHint = formatControlUiSshHint({
          port: settings.port,
          basePath: controlUiBasePath,
          token: settings.gatewayToken,
        });
      }
    } else {
      controlUiOpenHint = formatControlUiSshHint({
        port: settings.port,
        basePath: controlUiBasePath,
        token: settings.gatewayToken,
      });
    }

    await prompter.note(
      [
        `Dashboard link (with token): ${authedUrl}`,
        controlUiOpened
          ? "Opened in your browser. Keep that tab to control Longxia."
          : "Copy/paste this URL in a browser on this machine to control Longxia.",
        controlUiOpenHint,
      ]
        .filter(Boolean)
        .join("\n"),
      "Dashboard ready",
    );
  }

  const webSearchKey = (nextConfig.tools?.web?.search?.apiKey ?? "").trim();
  const webSearchEnv = (process.env.BRAVE_API_KEY ?? "").trim();
  const hasWebSearchKey = Boolean(webSearchKey || webSearchEnv);
  await prompter.note(
    hasWebSearchKey
      ? [
          "Web search is enabled, so your agent can look things up online when needed.",
          "",
          webSearchKey
            ? "API key: stored in config (tools.web.search.apiKey)."
            : "API key: provided via BRAVE_API_KEY env var (Gateway environment).",
          "Docs: https://docs.openclaw.ai/tools/web",
        ].join("\n")
      : [
          "If you want your agent to be able to search the web, you’ll need an API key.",
          "",
          "Longxia uses Brave Search for the `web_search` tool. Without a Brave Search API key, web search won’t work.",
          "",
          "Set it up interactively:",
          `- Run: ${formatCliCommand("openclaw configure --section web")}`,
          "- Enable web_search and paste your Brave Search API key",
          "",
          "Alternative: set BRAVE_API_KEY in the Gateway environment (no config changes).",
          "Docs: https://docs.openclaw.ai/tools/web",
        ].join("\n"),
    "Web search (optional)",
  );

  await prompter.note("What now: https://www.longxia.ren", "What now");

  await prompter.outro(
    controlUiOpened
      ? tr(locale, {
          zh: "向导完成。Dashboard 已打开，请保留该标签页以控制 Longxia。",
          en: "Onboarding complete. Dashboard opened; keep that tab to control Longxia.",
        })
      : seededInBackground
        ? tr(locale, {
            zh: "向导完成。Web UI 已在后台预热，可随时通过上方链接打开。",
            en: "Onboarding complete. Web UI seeded in the background; open it anytime with the dashboard link above.",
          })
        : tr(locale, {
            zh: "向导完成。请使用上方 Dashboard 链接控制 Longxia。",
            en: "Onboarding complete. Use the dashboard link above to control Longxia.",
          }),
  );

  return { launchedTui };
}
