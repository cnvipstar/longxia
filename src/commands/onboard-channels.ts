import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { listChannelPluginCatalogEntries } from "../channels/plugins/catalog.js";
import { resolveChannelDefaultAccountId } from "../channels/plugins/helpers.js";
import { listChannelPlugins, getChannelPlugin } from "../channels/plugins/index.js";
import type { ChannelMeta } from "../channels/plugins/types.js";
import {
  formatChannelPrimerLine,
  formatChannelSelectionLine,
  listChatChannels,
} from "../channels/registry.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig } from "../config/config.js";
import { isChannelConfigured } from "../config/plugin-auto-enable.js";
import type { DmPolicy } from "../config/types.js";
import { enablePluginInConfig } from "../plugins/enable.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
import type { RuntimeEnv } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import type { WizardPrompter, WizardSelectOption } from "../wizard/prompts.js";
import type { ChannelChoice } from "./onboard-types.js";
import {
  ensureOnboardingPluginInstalled,
  reloadOnboardingPluginRegistry,
} from "./onboarding/plugin-install.js";
import {
  getChannelOnboardingAdapter,
  listChannelOnboardingAdapters,
} from "./onboarding/registry.js";
import type {
  ChannelOnboardingDmPolicy,
  ChannelOnboardingStatus,
  SetupChannelsOptions,
} from "./onboarding/types.js";

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

type ConfiguredChannelAction = "update" | "disable" | "delete" | "skip";

type ChannelStatusSummary = {
  installedPlugins: ReturnType<typeof listChannelPlugins>;
  catalogEntries: ReturnType<typeof listChannelPluginCatalogEntries>;
  statusByChannel: Map<ChannelChoice, ChannelOnboardingStatus>;
  statusLines: string[];
};

function formatAccountLabel(accountId: string): string {
  return accountId === DEFAULT_ACCOUNT_ID
    ? tr({ zh: "default（主账号）", en: "default (primary)" })
    : accountId;
}

async function promptConfiguredAction(params: {
  prompter: WizardPrompter;
  label: string;
  supportsDisable: boolean;
  supportsDelete: boolean;
}): Promise<ConfiguredChannelAction> {
  const { prompter, label, supportsDisable, supportsDelete } = params;
  const updateOption: WizardSelectOption<ConfiguredChannelAction> = {
    value: "update",
    label: tr({ zh: "修改配置", en: "Modify settings" }),
  };
  const disableOption: WizardSelectOption<ConfiguredChannelAction> = {
    value: "disable",
    label: tr({ zh: "禁用（保留配置）", en: "Disable (keeps config)" }),
  };
  const deleteOption: WizardSelectOption<ConfiguredChannelAction> = {
    value: "delete",
    label: tr({ zh: "删除配置", en: "Delete config" }),
  };
  const skipOption: WizardSelectOption<ConfiguredChannelAction> = {
    value: "skip",
    label: tr({ zh: "跳过（保持现状）", en: "Skip (leave as-is)" }),
  };
  const options: Array<WizardSelectOption<ConfiguredChannelAction>> = [
    updateOption,
    ...(supportsDisable ? [disableOption] : []),
    ...(supportsDelete ? [deleteOption] : []),
    skipOption,
  ];
  return await prompter.select({
    message: tr({
      zh: `${label} 已配置。你希望如何处理？`,
      en: `${label} already configured. What do you want to do?`,
    }),
    options,
    initialValue: "update",
  });
}

async function promptRemovalAccountId(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  label: string;
  channel: ChannelChoice;
}): Promise<string> {
  const { cfg, prompter, label, channel } = params;
  const plugin = getChannelPlugin(channel);
  if (!plugin) {
    return DEFAULT_ACCOUNT_ID;
  }
  const accountIds = plugin.config.listAccountIds(cfg).filter(Boolean);
  const defaultAccountId = resolveChannelDefaultAccountId({ plugin, cfg, accountIds });
  if (accountIds.length <= 1) {
    return defaultAccountId;
  }
  const selected = await prompter.select({
    message: tr({ zh: `${label} 账号`, en: `${label} account` }),
    options: accountIds.map((accountId) => ({
      value: accountId,
      label: formatAccountLabel(accountId),
    })),
    initialValue: defaultAccountId,
  });
  return normalizeAccountId(selected) ?? defaultAccountId;
}

async function collectChannelStatus(params: {
  cfg: OpenClawConfig;
  options?: SetupChannelsOptions;
  accountOverrides: Partial<Record<ChannelChoice, string>>;
}): Promise<ChannelStatusSummary> {
  const installedPlugins = listChannelPlugins();
  const installedIds = new Set(installedPlugins.map((plugin) => plugin.id));
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, resolveDefaultAgentId(params.cfg));
  const catalogEntries = listChannelPluginCatalogEntries({ workspaceDir }).filter(
    (entry) => !installedIds.has(entry.id),
  );
  const statusEntries = await Promise.all(
    listChannelOnboardingAdapters().map((adapter) =>
      adapter.getStatus({
        cfg: params.cfg,
        options: params.options,
        accountOverrides: params.accountOverrides,
      }),
    ),
  );
  const statusByChannel = new Map(statusEntries.map((entry) => [entry.channel, entry]));
  const fallbackStatuses = listChatChannels()
    .filter((meta) => !statusByChannel.has(meta.id))
    .map((meta) => {
      const configured = isChannelConfigured(params.cfg, meta.id);
      const statusLabel = configured
        ? tr({ zh: "已配置（插件已禁用）", en: "configured (plugin disabled)" })
        : tr({ zh: "未配置", en: "not configured" });
      return {
        channel: meta.id,
        configured,
        statusLines: [`${meta.label}: ${statusLabel}`],
        selectionHint: configured
          ? tr({ zh: "已配置 · 插件已禁用", en: "configured · plugin disabled" })
          : tr({ zh: "未配置", en: "not configured" }),
        quickstartScore: 0,
      };
    });
  const catalogStatuses = catalogEntries.map((entry) => ({
    channel: entry.id,
    configured: false,
    statusLines: [
      `${entry.meta.label}: ${tr({ zh: "需安装插件后启用", en: "install plugin to enable" })}`,
    ],
    selectionHint: tr({ zh: "插件 · 安装", en: "plugin · install" }),
    quickstartScore: 0,
  }));
  const combinedStatuses = [...statusEntries, ...fallbackStatuses, ...catalogStatuses];
  const mergedStatusByChannel = new Map(combinedStatuses.map((entry) => [entry.channel, entry]));
  const statusLines = combinedStatuses.flatMap((entry) => entry.statusLines);
  return {
    installedPlugins,
    catalogEntries,
    statusByChannel: mergedStatusByChannel,
    statusLines,
  };
}

export async function noteChannelStatus(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  options?: SetupChannelsOptions;
  accountOverrides?: Partial<Record<ChannelChoice, string>>;
}): Promise<void> {
  const { statusLines } = await collectChannelStatus({
    cfg: params.cfg,
    options: params.options,
    accountOverrides: params.accountOverrides ?? {},
  });
  if (statusLines.length > 0) {
    await params.prompter.note(
      statusLines.join("\n"),
      tr({ zh: "渠道状态", en: "Channel status" }),
    );
  }
}

async function noteChannelPrimer(
  prompter: WizardPrompter,
  channels: Array<{ id: ChannelChoice; blurb: string; label: string }>,
): Promise<void> {
  const channelLines = channels.map((channel) =>
    formatChannelPrimerLine({
      id: channel.id,
      label: channel.label,
      selectionLabel: channel.label,
      docsPath: "/",
      blurb: channel.blurb,
    }),
  );
  await prompter.note(
    [
      tr({
        zh: "DM 安全默认是 pairing；未知私信会收到配对码。",
        en: "DM security: default is pairing; unknown DMs get a pairing code.",
      }),
      `Approve with: ${formatCliCommand("openclaw pairing approve <channel> <code>")}`,
      tr({
        zh: '公开私信需配置 dmPolicy="open" 且 allowFrom=["*"]。',
        en: 'Public DMs require dmPolicy="open" + allowFrom=["*"].',
      }),
      tr({ zh: "多用户私信建议执行：", en: "Multi-user DMs: run: " }) +
        formatCliCommand('openclaw config set session.dmScope "per-channel-peer"') +
        tr({
          zh: '（多账号渠道可用 "per-account-channel-peer"）以隔离会话。',
          en: ' (or "per-account-channel-peer" for multi-account channels) to isolate sessions.',
        }),
      `Docs: ${formatDocsLink("/start/pairing", "start/pairing")}`,
      "",
      ...channelLines,
    ].join("\n"),
    tr({ zh: "渠道工作方式", en: "How channels work" }),
  );
}

function resolveQuickstartDefault(
  statusByChannel: Map<ChannelChoice, { quickstartScore?: number }>,
): ChannelChoice | undefined {
  let best: { channel: ChannelChoice; score: number } | null = null;
  for (const [channel, status] of statusByChannel) {
    if (status.quickstartScore == null) {
      continue;
    }
    if (!best || status.quickstartScore > best.score) {
      best = { channel, score: status.quickstartScore };
    }
  }
  return best?.channel;
}

async function maybeConfigureDmPolicies(params: {
  cfg: OpenClawConfig;
  selection: ChannelChoice[];
  prompter: WizardPrompter;
  accountIdsByChannel?: Map<ChannelChoice, string>;
}): Promise<OpenClawConfig> {
  const { selection, prompter, accountIdsByChannel } = params;
  const dmPolicies = selection
    .map((channel) => getChannelOnboardingAdapter(channel)?.dmPolicy)
    .filter(Boolean) as ChannelOnboardingDmPolicy[];
  if (dmPolicies.length === 0) {
    return params.cfg;
  }

  const wants = await prompter.confirm({
    message: tr({
      zh: "现在配置 DM 访问策略吗？（默认：pairing）",
      en: "Configure DM access policies now? (default: pairing)",
    }),
    initialValue: false,
  });
  if (!wants) {
    return params.cfg;
  }

  let cfg = params.cfg;
  const selectPolicy = async (policy: ChannelOnboardingDmPolicy) => {
    await prompter.note(
      [
        tr({
          zh: "默认：pairing（陌生私信需先配对码）。",
          en: "Default: pairing (unknown DMs get a pairing code).",
        }),
        `${tr({ zh: "批准命令", en: "Approve" })}: ${formatCliCommand(`openclaw pairing approve ${policy.channel} <code>`)}`,
        `${tr({ zh: "Allowlist 私信", en: "Allowlist DMs" })}: ${policy.policyKey}="allowlist" + ${policy.allowFromKey} ${tr({ zh: "列表项", en: "entries" })}.`,
        `${tr({ zh: "公开私信", en: "Public DMs" })}: ${policy.policyKey}="open" + ${policy.allowFromKey} ${tr({ zh: "包含", en: "includes" })} "*".`,
        tr({ zh: "多用户私信可执行：", en: "Multi-user DMs: run: " }) +
          formatCliCommand('openclaw config set session.dmScope "per-channel-peer"') +
          tr({
            zh: '（多账号渠道可用 "per-account-channel-peer"）隔离会话。',
            en: ' (or "per-account-channel-peer" for multi-account channels) to isolate sessions.',
          }),
        `${tr({ zh: "文档", en: "Docs" })}: ${formatDocsLink("/start/pairing", "start/pairing")}`,
      ].join("\n"),
      tr({ zh: `${policy.label} DM 访问`, en: `${policy.label} DM access` }),
    );
    return (await prompter.select({
      message: tr({ zh: `${policy.label} DM 策略`, en: `${policy.label} DM policy` }),
      options: [
        { value: "pairing", label: tr({ zh: "Pairing（推荐）", en: "Pairing (recommended)" }) },
        {
          value: "allowlist",
          label: tr({ zh: "Allowlist（仅指定用户）", en: "Allowlist (specific users only)" }),
        },
        {
          value: "open",
          label: tr({ zh: "Open（公开入站 DM）", en: "Open (public inbound DMs)" }),
        },
        {
          value: "disabled",
          label: tr({ zh: "Disabled（忽略 DM）", en: "Disabled (ignore DMs)" }),
        },
      ],
    })) as DmPolicy;
  };

  for (const policy of dmPolicies) {
    const current = policy.getCurrent(cfg);
    const nextPolicy = await selectPolicy(policy);
    if (nextPolicy !== current) {
      cfg = policy.setPolicy(cfg, nextPolicy);
    }
    if (nextPolicy === "allowlist" && policy.promptAllowFrom) {
      cfg = await policy.promptAllowFrom({
        cfg,
        prompter,
        accountId: accountIdsByChannel?.get(policy.channel),
      });
    }
  }

  return cfg;
}

// Channel-specific prompts moved into onboarding adapters.

export async function setupChannels(
  cfg: OpenClawConfig,
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
  options?: SetupChannelsOptions,
): Promise<OpenClawConfig> {
  let next = cfg;
  const forceAllowFromChannels = new Set(options?.forceAllowFromChannels ?? []);
  const accountOverrides: Partial<Record<ChannelChoice, string>> = {
    ...options?.accountIds,
  };
  if (options?.whatsappAccountId?.trim()) {
    accountOverrides.whatsapp = options.whatsappAccountId.trim();
  }

  const { installedPlugins, catalogEntries, statusByChannel, statusLines } =
    await collectChannelStatus({ cfg: next, options, accountOverrides });
  if (!options?.skipStatusNote && statusLines.length > 0) {
    await prompter.note(statusLines.join("\n"), tr({ zh: "渠道状态", en: "Channel status" }));
  }

  const shouldConfigure = options?.skipConfirm
    ? true
    : await prompter.confirm({
        message: tr({ zh: "现在配置聊天渠道吗？", en: "Configure chat channels now?" }),
        initialValue: true,
      });
  if (!shouldConfigure) {
    return cfg;
  }

  const corePrimer = listChatChannels().map((meta) => ({
    id: meta.id,
    label: meta.label,
    blurb: meta.blurb,
  }));
  const coreIds = new Set(corePrimer.map((entry) => entry.id));
  const primerChannels = [
    ...corePrimer,
    ...installedPlugins
      .filter((plugin) => !coreIds.has(plugin.id))
      .map((plugin) => ({
        id: plugin.id,
        label: plugin.meta.label,
        blurb: plugin.meta.blurb,
      })),
    ...catalogEntries
      .filter((entry) => !coreIds.has(entry.id as ChannelChoice))
      .map((entry) => ({
        id: entry.id as ChannelChoice,
        label: entry.meta.label,
        blurb: entry.meta.blurb,
      })),
  ];
  await noteChannelPrimer(prompter, primerChannels);

  const quickstartDefault =
    options?.initialSelection?.[0] ?? resolveQuickstartDefault(statusByChannel);

  const shouldPromptAccountIds = options?.promptAccountIds === true;
  const accountIdsByChannel = new Map<ChannelChoice, string>();
  const recordAccount = (channel: ChannelChoice, accountId: string) => {
    options?.onAccountId?.(channel, accountId);
    const adapter = getChannelOnboardingAdapter(channel);
    adapter?.onAccountRecorded?.(accountId, options);
    accountIdsByChannel.set(channel, accountId);
  };

  const selection: ChannelChoice[] = [];
  const addSelection = (channel: ChannelChoice) => {
    if (!selection.includes(channel)) {
      selection.push(channel);
    }
  };

  const resolveDisabledHint = (channel: ChannelChoice): string | undefined => {
    const plugin = getChannelPlugin(channel);
    if (!plugin) {
      if (next.plugins?.entries?.[channel]?.enabled === false) {
        return tr({ zh: "插件已禁用", en: "plugin disabled" });
      }
      if (next.plugins?.enabled === false) {
        return tr({ zh: "插件系统已禁用", en: "plugins disabled" });
      }
      return undefined;
    }
    const accountId = resolveChannelDefaultAccountId({ plugin, cfg: next });
    const account = plugin.config.resolveAccount(next, accountId);
    let enabled: boolean | undefined;
    if (plugin.config.isEnabled) {
      enabled = plugin.config.isEnabled(account, next);
    } else if (typeof (account as { enabled?: boolean })?.enabled === "boolean") {
      enabled = (account as { enabled?: boolean }).enabled;
    } else if (
      typeof (next.channels as Record<string, { enabled?: boolean }> | undefined)?.[channel]
        ?.enabled === "boolean"
    ) {
      enabled = (next.channels as Record<string, { enabled?: boolean }>)[channel]?.enabled;
    }
    return enabled === false ? tr({ zh: "已禁用", en: "disabled" }) : undefined;
  };

  const buildSelectionOptions = (
    entries: Array<{
      id: ChannelChoice;
      meta: { id: string; label: string; selectionLabel?: string };
    }>,
  ) =>
    entries.map((entry) => {
      const status = statusByChannel.get(entry.id);
      const disabledHint = resolveDisabledHint(entry.id);
      const hint = [status?.selectionHint, disabledHint].filter(Boolean).join(" · ") || undefined;
      return {
        value: entry.meta.id,
        label: entry.meta.selectionLabel ?? entry.meta.label,
        ...(hint ? { hint } : {}),
      };
    });

  const getChannelEntries = () => {
    const core = listChatChannels();
    const installed = listChannelPlugins();
    const installedIds = new Set(installed.map((plugin) => plugin.id));
    const workspaceDir = resolveAgentWorkspaceDir(next, resolveDefaultAgentId(next));
    const catalog = listChannelPluginCatalogEntries({ workspaceDir }).filter(
      (entry) => !installedIds.has(entry.id),
    );
    const metaById = new Map<string, ChannelMeta>();
    for (const meta of core) {
      metaById.set(meta.id, meta);
    }
    for (const plugin of installed) {
      metaById.set(plugin.id, plugin.meta);
    }
    for (const entry of catalog) {
      if (!metaById.has(entry.id)) {
        metaById.set(entry.id, entry.meta);
      }
    }
    const entries = Array.from(metaById, ([id, meta]) => ({
      id: id as ChannelChoice,
      meta,
    }));
    return {
      entries,
      catalog,
      catalogById: new Map(catalog.map((entry) => [entry.id as ChannelChoice, entry])),
    };
  };

  const refreshStatus = async (channel: ChannelChoice) => {
    const adapter = getChannelOnboardingAdapter(channel);
    if (!adapter) {
      return;
    }
    const status = await adapter.getStatus({ cfg: next, options, accountOverrides });
    statusByChannel.set(channel, status);
  };

  const ensureBundledPluginEnabled = async (channel: ChannelChoice): Promise<boolean> => {
    if (getChannelPlugin(channel)) {
      return true;
    }
    const result = enablePluginInConfig(next, channel);
    next = result.config;
    if (!result.enabled) {
      await prompter.note(
        `${tr({ zh: "无法启用", en: "Cannot enable" })} ${channel}: ${result.reason ?? tr({ zh: "插件已禁用", en: "plugin disabled" })}.`,
        tr({ zh: "渠道配置", en: "Channel setup" }),
      );
      return false;
    }
    const workspaceDir = resolveAgentWorkspaceDir(next, resolveDefaultAgentId(next));
    reloadOnboardingPluginRegistry({
      cfg: next,
      runtime,
      workspaceDir,
    });
    if (!getChannelPlugin(channel)) {
      await prompter.note(
        tr({ zh: `${channel} 插件不可用。`, en: `${channel} plugin not available.` }),
        tr({ zh: "渠道配置", en: "Channel setup" }),
      );
      return false;
    }
    await refreshStatus(channel);
    return true;
  };

  const configureChannel = async (channel: ChannelChoice) => {
    const adapter = getChannelOnboardingAdapter(channel);
    if (!adapter) {
      await prompter.note(
        tr({
          zh: `${channel} 暂不支持 onboarding 自动配置。`,
          en: `${channel} does not support onboarding yet.`,
        }),
        tr({ zh: "渠道配置", en: "Channel setup" }),
      );
      return;
    }
    const result = await adapter.configure({
      cfg: next,
      runtime,
      prompter,
      options,
      accountOverrides,
      shouldPromptAccountIds,
      forceAllowFrom: forceAllowFromChannels.has(channel),
    });
    next = result.cfg;
    if (result.accountId) {
      recordAccount(channel, result.accountId);
    }
    addSelection(channel);
    await refreshStatus(channel);
  };

  const handleConfiguredChannel = async (channel: ChannelChoice, label: string) => {
    const plugin = getChannelPlugin(channel);
    const adapter = getChannelOnboardingAdapter(channel);
    const supportsDisable = Boolean(
      options?.allowDisable && (plugin?.config.setAccountEnabled || adapter?.disable),
    );
    const supportsDelete = Boolean(options?.allowDisable && plugin?.config.deleteAccount);
    const action = await promptConfiguredAction({
      prompter,
      label,
      supportsDisable,
      supportsDelete,
    });

    if (action === "skip") {
      return;
    }
    if (action === "update") {
      await configureChannel(channel);
      return;
    }
    if (!options?.allowDisable) {
      return;
    }

    if (action === "delete" && !supportsDelete) {
      await prompter.note(
        tr({
          zh: `${label} 不支持删除配置条目。`,
          en: `${label} does not support deleting config entries.`,
        }),
        tr({ zh: "移除渠道", en: "Remove channel" }),
      );
      return;
    }

    const shouldPromptAccount =
      action === "delete"
        ? Boolean(plugin?.config.deleteAccount)
        : Boolean(plugin?.config.setAccountEnabled);
    const accountId = shouldPromptAccount
      ? await promptRemovalAccountId({
          cfg: next,
          prompter,
          label,
          channel,
        })
      : DEFAULT_ACCOUNT_ID;
    const resolvedAccountId =
      normalizeAccountId(accountId) ??
      (plugin ? resolveChannelDefaultAccountId({ plugin, cfg: next }) : DEFAULT_ACCOUNT_ID);
    const accountLabel = formatAccountLabel(resolvedAccountId);

    if (action === "delete") {
      const confirmed = await prompter.confirm({
        message: tr({
          zh: `删除 ${label} 账号 "${accountLabel}" 吗？`,
          en: `Delete ${label} account "${accountLabel}"?`,
        }),
        initialValue: false,
      });
      if (!confirmed) {
        return;
      }
      if (plugin?.config.deleteAccount) {
        next = plugin.config.deleteAccount({ cfg: next, accountId: resolvedAccountId });
      }
      await refreshStatus(channel);
      return;
    }

    if (plugin?.config.setAccountEnabled) {
      next = plugin.config.setAccountEnabled({
        cfg: next,
        accountId: resolvedAccountId,
        enabled: false,
      });
    } else if (adapter?.disable) {
      next = adapter.disable(next);
    }
    await refreshStatus(channel);
  };

  const handleChannelChoice = async (channel: ChannelChoice) => {
    const { catalogById } = getChannelEntries();
    const catalogEntry = catalogById.get(channel);
    if (catalogEntry) {
      const workspaceDir = resolveAgentWorkspaceDir(next, resolveDefaultAgentId(next));
      const result = await ensureOnboardingPluginInstalled({
        cfg: next,
        entry: catalogEntry,
        prompter,
        runtime,
        workspaceDir,
      });
      next = result.cfg;
      if (!result.installed) {
        return;
      }
      reloadOnboardingPluginRegistry({
        cfg: next,
        runtime,
        workspaceDir,
      });
      await refreshStatus(channel);
    } else {
      const enabled = await ensureBundledPluginEnabled(channel);
      if (!enabled) {
        return;
      }
    }

    const plugin = getChannelPlugin(channel);
    const label = plugin?.meta.label ?? catalogEntry?.meta.label ?? channel;
    const status = statusByChannel.get(channel);
    const configured = status?.configured ?? false;
    if (configured) {
      await handleConfiguredChannel(channel, label);
      return;
    }
    await configureChannel(channel);
  };

  if (options?.quickstartDefaults) {
    const { entries } = getChannelEntries();
    const choice = (await prompter.select({
      message: tr({ zh: "选择渠道（快速开始）", en: "Select channel (QuickStart)" }),
      options: [
        ...buildSelectionOptions(entries),
        {
          value: "__skip__",
          label: tr({ zh: "暂时跳过", en: "Skip for now" }),
          hint: tr({
            zh: `后续可用 \`${formatCliCommand("openclaw channels add")}\` 添加渠道`,
            en: `You can add channels later via \`${formatCliCommand("openclaw channels add")}\``,
          }),
        },
      ],
      initialValue: quickstartDefault,
    })) as ChannelChoice | "__skip__";
    if (choice !== "__skip__") {
      await handleChannelChoice(choice);
    }
  } else {
    const doneValue = "__done__" as const;
    const initialValue = options?.initialSelection?.[0] ?? quickstartDefault;
    while (true) {
      const { entries } = getChannelEntries();
      const choice = (await prompter.select({
        message: tr({ zh: "选择一个渠道", en: "Select a channel" }),
        options: [
          ...buildSelectionOptions(entries),
          {
            value: doneValue,
            label: tr({ zh: "完成", en: "Finished" }),
            hint:
              selection.length > 0
                ? tr({ zh: "已完成", en: "Done" })
                : tr({ zh: "暂时跳过", en: "Skip for now" }),
          },
        ],
        initialValue,
      })) as ChannelChoice | typeof doneValue;
      if (choice === doneValue) {
        break;
      }
      await handleChannelChoice(choice);
    }
  }

  options?.onSelection?.(selection);

  const selectionNotes = new Map<string, string>();
  const { entries: selectionEntries } = getChannelEntries();
  for (const entry of selectionEntries) {
    selectionNotes.set(entry.id, formatChannelSelectionLine(entry.meta, formatDocsLink));
  }
  const selectedLines = selection
    .map((channel) => selectionNotes.get(channel))
    .filter((line): line is string => Boolean(line));
  if (selectedLines.length > 0) {
    await prompter.note(
      selectedLines.join("\n"),
      tr({ zh: "已选择渠道", en: "Selected channels" }),
    );
  }

  if (!options?.skipDmPolicyPrompt) {
    next = await maybeConfigureDmPolicies({
      cfg: next,
      selection,
      prompter,
      accountIdsByChannel,
    });
  }

  return next;
}
