import type { OpenClawConfig } from "../config/config.js";

type PluginEntry = NonNullable<NonNullable<OpenClawConfig["plugins"]>["entries"]>[string];

function mergeLangCoreConfig(existing: unknown): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" ? { ...(existing as Record<string, unknown>) } : {};
  return {
    ...base,
    defaultLocale: typeof base.defaultLocale === "string" ? base.defaultLocale : "zh-CN",
    currentLocale: typeof base.currentLocale === "string" ? base.currentLocale : "zh-CN",
    allowedLocales: Array.isArray(base.allowedLocales)
      ? base.allowedLocales
      : ["zh-CN", "en-US", "ja-JP"],
  };
}

function mergePluginEntryDefaults(
  existing: PluginEntry | undefined,
  options?: { includeLangCoreDefaults?: boolean },
): PluginEntry {
  const base = existing ?? {};
  const next: PluginEntry = {
    ...base,
    enabled: typeof base.enabled === "boolean" ? base.enabled : true,
  };
  if (options?.includeLangCoreDefaults) {
    next.config = mergeLangCoreConfig(base.config);
  }
  return next;
}

function applyDefaultLanguagePlugins(baseConfig: OpenClawConfig): OpenClawConfig {
  const entries = baseConfig.plugins?.entries ?? {};
  return {
    ...baseConfig,
    plugins: {
      ...baseConfig.plugins,
      entries: {
        ...entries,
        "lang-core": mergePluginEntryDefaults(entries["lang-core"], {
          includeLangCoreDefaults: true,
        }),
        "lang-zh-cn": mergePluginEntryDefaults(entries["lang-zh-cn"]),
        "lang-en-us": mergePluginEntryDefaults(entries["lang-en-us"]),
        "lang-ja-jp": mergePluginEntryDefaults(entries["lang-ja-jp"]),
      },
    },
  };
}

export function applyOnboardingLocalWorkspaceConfig(
  baseConfig: OpenClawConfig,
  workspaceDir: string,
): OpenClawConfig {
  return applyDefaultLanguagePlugins({
    ...baseConfig,
    agents: {
      ...baseConfig.agents,
      defaults: {
        ...baseConfig.agents?.defaults,
        workspace: workspaceDir,
      },
    },
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
    },
  });
}
