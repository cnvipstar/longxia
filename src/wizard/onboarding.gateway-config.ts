import {
  normalizeGatewayTokenInput,
  randomToken,
  validateGatewayPasswordInput,
} from "../commands/onboard-helpers.js";
import type { GatewayAuthChoice } from "../commands/onboard-types.js";
import type { GatewayBindMode, GatewayTailscaleMode, OpenClawConfig } from "../config/config.js";
import {
  TAILSCALE_DOCS_LINES,
  TAILSCALE_EXPOSURE_OPTIONS,
  TAILSCALE_MISSING_BIN_NOTE_LINES,
} from "../gateway/gateway-config-prompts.shared.js";
import { findTailscaleBinary } from "../infra/tailscale.js";
import type { RuntimeEnv } from "../runtime.js";
import { validateIPv4AddressInput } from "../shared/net/ipv4.js";
import type {
  GatewayWizardSettings,
  QuickstartGatewayDefaults,
  WizardFlow,
} from "./onboarding.types.js";
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

// These commands are "high risk" (privacy writes/recording) and should be
// explicitly armed by the user when they want to use them.
//
// This only affects what the gateway will accept via node.invoke; the iOS app
// still prompts for OS permissions (camera/photos/contacts/etc) on first use.
const DEFAULT_DANGEROUS_NODE_DENY_COMMANDS = [
  "camera.snap",
  "camera.clip",
  "screen.record",
  "calendar.add",
  "contacts.add",
  "reminders.add",
];

type ConfigureGatewayOptions = {
  flow: WizardFlow;
  baseConfig: OpenClawConfig;
  nextConfig: OpenClawConfig;
  localPort: number;
  quickstartGateway: QuickstartGatewayDefaults;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
};

type ConfigureGatewayResult = {
  nextConfig: OpenClawConfig;
  settings: GatewayWizardSettings;
};

export async function configureGatewayForOnboarding(
  opts: ConfigureGatewayOptions,
): Promise<ConfigureGatewayResult> {
  const { flow, localPort, quickstartGateway, prompter } = opts;
  const locale = resolveOnboardingLocale();
  let { nextConfig } = opts;

  const port =
    flow === "quickstart"
      ? quickstartGateway.port
      : Number.parseInt(
          String(
            await prompter.text({
              message: tr(locale, { zh: "网关端口", en: "Gateway port" }),
              initialValue: String(localPort),
              validate: (value) =>
                Number.isFinite(Number(value))
                  ? undefined
                  : tr(locale, { zh: "端口无效", en: "Invalid port" }),
            }),
          ),
          10,
        );

  let bind: GatewayWizardSettings["bind"] =
    flow === "quickstart"
      ? quickstartGateway.bind
      : await prompter.select<GatewayWizardSettings["bind"]>({
          message: tr(locale, { zh: "网关绑定", en: "Gateway bind" }),
          options: [
            {
              value: "loopback",
              label: tr(locale, { zh: "回环 (127.0.0.1)", en: "Loopback (127.0.0.1)" }),
            },
            { value: "lan", label: tr(locale, { zh: "局域网 (0.0.0.0)", en: "LAN (0.0.0.0)" }) },
            {
              value: "tailnet",
              label: tr(locale, { zh: "Tailnet（Tailscale IP）", en: "Tailnet (Tailscale IP)" }),
            },
            {
              value: "auto",
              label: tr(locale, { zh: "自动 (回环 → LAN)", en: "Auto (Loopback → LAN)" }),
            },
            { value: "custom", label: tr(locale, { zh: "自定义 IP", en: "Custom IP" }) },
          ],
        });

  let customBindHost = quickstartGateway.customBindHost;
  if (bind === "custom") {
    const needsPrompt = flow !== "quickstart" || !customBindHost;
    if (needsPrompt) {
      const input = await prompter.text({
        message: tr(locale, { zh: "自定义 IP 地址", en: "Custom IP address" }),
        placeholder: "192.168.1.100",
        initialValue: customBindHost ?? "",
        validate: validateIPv4AddressInput,
      });
      customBindHost = typeof input === "string" ? input.trim() : undefined;
    }
  }

  let authMode =
    flow === "quickstart"
      ? quickstartGateway.authMode
      : ((await prompter.select({
          message: tr(locale, { zh: "网关鉴权", en: "Gateway auth" }),
          options: [
            {
              value: "token",
              label: tr(locale, { zh: "Token", en: "Token" }),
              hint: tr(locale, {
                zh: "推荐默认（本地 + 远程都适用）",
                en: "Recommended default (local + remote)",
              }),
            },
            { value: "password", label: tr(locale, { zh: "密码", en: "Password" }) },
          ],
          initialValue: "token",
        })) as GatewayAuthChoice);

  const tailscaleMode: GatewayWizardSettings["tailscaleMode"] =
    flow === "quickstart"
      ? quickstartGateway.tailscaleMode
      : await prompter.select<GatewayWizardSettings["tailscaleMode"]>({
          message: tr(locale, { zh: "Tailscale 暴露", en: "Tailscale exposure" }),
          options: [...TAILSCALE_EXPOSURE_OPTIONS],
        });

  // Detect Tailscale binary before proceeding with serve/funnel setup.
  if (tailscaleMode !== "off") {
    const tailscaleBin = await findTailscaleBinary();
    if (!tailscaleBin) {
      await prompter.note(
        TAILSCALE_MISSING_BIN_NOTE_LINES.join("\n"),
        tr(locale, { zh: "Tailscale 警告", en: "Tailscale Warning" }),
      );
    }
  }

  let tailscaleResetOnExit = flow === "quickstart" ? quickstartGateway.tailscaleResetOnExit : false;
  if (tailscaleMode !== "off" && flow !== "quickstart") {
    await prompter.note(
      TAILSCALE_DOCS_LINES.join("\n"),
      tr(locale, { zh: "Tailscale", en: "Tailscale" }),
    );
    tailscaleResetOnExit = Boolean(
      await prompter.confirm({
        message: tr(locale, {
          zh: "退出时是否重置 Tailscale serve/funnel？",
          en: "Reset Tailscale serve/funnel on exit?",
        }),
        initialValue: false,
      }),
    );
  }

  // Safety + constraints:
  // - Tailscale wants bind=loopback so we never expose a non-loopback server + tailscale serve/funnel at once.
  // - Funnel requires password auth.
  if (tailscaleMode !== "off" && bind !== "loopback") {
    await prompter.note(
      tr(locale, {
        zh: "Tailscale 要求 bind=loopback，已自动调整为 loopback。",
        en: "Tailscale requires bind=loopback. Adjusting bind to loopback.",
      }),
      tr(locale, { zh: "提示", en: "Note" }),
    );
    bind = "loopback";
    customBindHost = undefined;
  }

  if (tailscaleMode === "funnel" && authMode !== "password") {
    await prompter.note(
      tr(locale, {
        zh: "Tailscale funnel 需要密码鉴权，已自动调整为 Password。",
        en: "Tailscale funnel requires password auth.",
      }),
      tr(locale, { zh: "提示", en: "Note" }),
    );
    authMode = "password";
  }

  let gatewayToken: string | undefined;
  if (authMode === "token") {
    if (flow === "quickstart") {
      gatewayToken = quickstartGateway.token ?? randomToken();
    } else {
      const tokenInput = await prompter.text({
        message: tr(locale, {
          zh: "网关 Token（留空则自动生成）",
          en: "Gateway token (blank to generate)",
        }),
        placeholder: tr(locale, {
          zh: "多设备或非 loopback 访问时需要",
          en: "Needed for multi-machine or non-loopback access",
        }),
        initialValue: quickstartGateway.token ?? "",
      });
      gatewayToken = normalizeGatewayTokenInput(tokenInput) || randomToken();
    }
  }

  if (authMode === "password") {
    const password =
      flow === "quickstart" && quickstartGateway.password
        ? quickstartGateway.password
        : await prompter.text({
            message: tr(locale, { zh: "网关密码", en: "Gateway password" }),
            validate: validateGatewayPasswordInput,
          });
    nextConfig = {
      ...nextConfig,
      gateway: {
        ...nextConfig.gateway,
        auth: {
          ...nextConfig.gateway?.auth,
          mode: "password",
          password: String(password ?? "").trim(),
        },
      },
    };
  } else if (authMode === "token") {
    nextConfig = {
      ...nextConfig,
      gateway: {
        ...nextConfig.gateway,
        auth: {
          ...nextConfig.gateway?.auth,
          mode: "token",
          token: gatewayToken,
        },
      },
    };
  }

  nextConfig = {
    ...nextConfig,
    gateway: {
      ...nextConfig.gateway,
      port,
      bind: bind as GatewayBindMode,
      ...(bind === "custom" && customBindHost ? { customBindHost } : {}),
      tailscale: {
        ...nextConfig.gateway?.tailscale,
        mode: tailscaleMode as GatewayTailscaleMode,
        resetOnExit: tailscaleResetOnExit,
      },
    },
  };

  // If this is a new gateway setup (no existing gateway settings), start with a
  // denylist for high-risk node commands. Users can arm these temporarily via
  // /phone arm ... (phone-control plugin).
  if (
    !quickstartGateway.hasExisting &&
    nextConfig.gateway?.nodes?.denyCommands === undefined &&
    nextConfig.gateway?.nodes?.allowCommands === undefined &&
    nextConfig.gateway?.nodes?.browser === undefined
  ) {
    nextConfig = {
      ...nextConfig,
      gateway: {
        ...nextConfig.gateway,
        nodes: {
          ...nextConfig.gateway?.nodes,
          denyCommands: [...DEFAULT_DANGEROUS_NODE_DENY_COMMANDS],
        },
      },
    };
  }

  return {
    nextConfig,
    settings: {
      port,
      bind: bind as GatewayBindMode,
      customBindHost: bind === "custom" ? customBindHost : undefined,
      authMode,
      gatewayToken,
      tailscaleMode: tailscaleMode as GatewayTailscaleMode,
      tailscaleResetOnExit,
    },
  };
}
