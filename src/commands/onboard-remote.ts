import type { OpenClawConfig } from "../config/config.js";
import type { GatewayBonjourBeacon } from "../infra/bonjour-discovery.js";
import { discoverGatewayBeacons } from "../infra/bonjour-discovery.js";
import { resolveWideAreaDiscoveryDomain } from "../infra/widearea-dns.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { detectBinary } from "./onboard-helpers.js";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
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

function pickHost(beacon: GatewayBonjourBeacon): string | undefined {
  // Security: TXT is unauthenticated. Prefer the resolved service endpoint host.
  return beacon.host || beacon.tailnetDns || beacon.lanHost;
}

function buildLabel(beacon: GatewayBonjourBeacon): string {
  const host = pickHost(beacon);
  // Security: Prefer the resolved service endpoint port.
  const port = beacon.port ?? beacon.gatewayPort ?? 18789;
  const title = beacon.displayName ?? beacon.instanceName;
  const hint = host ? `${host}:${port}` : tr({ zh: "主机未知", en: "host unknown" });
  return `${title} (${hint})`;
}

function ensureWsUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_GATEWAY_URL;
  }
  return trimmed;
}

export async function promptRemoteGatewayConfig(
  cfg: OpenClawConfig,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  let selectedBeacon: GatewayBonjourBeacon | null = null;
  let suggestedUrl = cfg.gateway?.remote?.url ?? DEFAULT_GATEWAY_URL;

  const hasBonjourTool = (await detectBinary("dns-sd")) || (await detectBinary("avahi-browse"));
  const wantsDiscover = hasBonjourTool
    ? await prompter.confirm({
        message: tr({
          zh: "在局域网中发现网关（Bonjour）？",
          en: "Discover gateway on LAN (Bonjour)?",
        }),
        initialValue: true,
      })
    : false;

  if (!hasBonjourTool) {
    await prompter.note(
      [
        tr({
          zh: "Bonjour 发现依赖 dns-sd（macOS）或 avahi-browse（Linux）。",
          en: "Bonjour discovery requires dns-sd (macOS) or avahi-browse (Linux).",
        }),
        tr({
          zh: "文档：https://docs.openclaw.ai/gateway/discovery",
          en: "Docs: https://docs.openclaw.ai/gateway/discovery",
        }),
      ].join("\n"),
      tr({ zh: "发现", en: "Discovery" }),
    );
  }

  if (wantsDiscover) {
    const wideAreaDomain = resolveWideAreaDiscoveryDomain({
      configDomain: cfg.discovery?.wideArea?.domain,
    });
    const spin = prompter.progress(tr({ zh: "正在搜索网关…", en: "Searching for gateways…" }));
    const beacons = await discoverGatewayBeacons({ timeoutMs: 2000, wideAreaDomain });
    spin.stop(
      beacons.length > 0
        ? tr({ zh: `已发现 ${beacons.length} 个网关`, en: `Found ${beacons.length} gateway(s)` })
        : tr({ zh: "未发现网关", en: "No gateways found" }),
    );

    if (beacons.length > 0) {
      const selection = await prompter.select({
        message: tr({ zh: "选择网关", en: "Select gateway" }),
        options: [
          ...beacons.map((beacon, index) => ({
            value: String(index),
            label: buildLabel(beacon),
          })),
          { value: "manual", label: tr({ zh: "手动输入 URL", en: "Enter URL manually" }) },
        ],
      });
      if (selection !== "manual") {
        const idx = Number.parseInt(String(selection), 10);
        selectedBeacon = Number.isFinite(idx) ? (beacons[idx] ?? null) : null;
      }
    }
  }

  if (selectedBeacon) {
    const host = pickHost(selectedBeacon);
    const port = selectedBeacon.port ?? selectedBeacon.gatewayPort ?? 18789;
    if (host) {
      const mode = await prompter.select({
        message: tr({ zh: "连接方式", en: "Connection method" }),
        options: [
          {
            value: "direct",
            label: tr({
              zh: `直连网关 WS（${host}:${port}）`,
              en: `Direct gateway WS (${host}:${port})`,
            }),
          },
          { value: "ssh", label: tr({ zh: "SSH 隧道（回环）", en: "SSH tunnel (loopback)" }) },
        ],
      });
      if (mode === "direct") {
        suggestedUrl = `ws://${host}:${port}`;
      } else {
        suggestedUrl = DEFAULT_GATEWAY_URL;
        await prompter.note(
          [
            tr({ zh: "使用 CLI 前请先建立隧道：", en: "Start a tunnel before using the CLI:" }),
            `ssh -N -L 18789:127.0.0.1:18789 <user>@${host}${
              selectedBeacon.sshPort ? ` -p ${selectedBeacon.sshPort}` : ""
            }`,
            tr({
              zh: "文档：https://docs.openclaw.ai/gateway/remote",
              en: "Docs: https://docs.openclaw.ai/gateway/remote",
            }),
          ].join("\n"),
          tr({ zh: "SSH 隧道", en: "SSH tunnel" }),
        );
      }
    }
  }

  const urlInput = await prompter.text({
    message: tr({ zh: "Gateway WebSocket URL", en: "Gateway WebSocket URL" }),
    initialValue: suggestedUrl,
    validate: (value) =>
      String(value).trim().startsWith("ws://") || String(value).trim().startsWith("wss://")
        ? undefined
        : tr({ zh: "URL 必须以 ws:// 或 wss:// 开头", en: "URL must start with ws:// or wss://" }),
  });
  const url = ensureWsUrl(String(urlInput));

  const authChoice = await prompter.select({
    message: tr({ zh: "网关鉴权", en: "Gateway auth" }),
    options: [
      { value: "token", label: tr({ zh: "Token（推荐）", en: "Token (recommended)" }) },
      { value: "off", label: tr({ zh: "无鉴权", en: "No auth" }) },
    ],
  });

  let token = cfg.gateway?.remote?.token ?? "";
  if (authChoice === "token") {
    token = String(
      await prompter.text({
        message: tr({ zh: "Gateway token", en: "Gateway token" }),
        initialValue: token,
        validate: (value) => (value?.trim() ? undefined : tr({ zh: "必填", en: "Required" })),
      }),
    ).trim();
  } else {
    token = "";
  }

  return {
    ...cfg,
    gateway: {
      ...cfg.gateway,
      mode: "remote",
      remote: {
        url,
        token: token || undefined,
      },
    },
  };
}
