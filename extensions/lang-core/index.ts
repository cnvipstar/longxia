import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";

type LangCoreConfig = {
  defaultLocale?: string;
  currentLocale?: string;
  allowedLocales?: string[];
};

const FALLBACK_DEFAULT_LOCALE = "zh-CN";
const FALLBACK_ALLOWED_LOCALES = ["zh-CN", "en-US", "ja-JP"];

const LOCALE_ALIASES: Record<string, string> = {
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  cn: "zh-CN",
  en: "en-US",
  "en-us": "en-US",
  ja: "ja-JP",
  jp: "ja-JP",
  "ja-jp": "ja-JP",
};

function normalizeLocale(value: string | undefined | null): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const fromAlias = LOCALE_ALIASES[trimmed.toLowerCase()];
  if (fromAlias) {
    return fromAlias;
  }
  return trimmed;
}

function readPluginConfig(cfg: OpenClawConfig, pluginId: string): LangCoreConfig {
  const value = cfg.plugins?.entries?.[pluginId]?.config;
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as LangCoreConfig;
}

function resolveAllowedLocales(cfg: LangCoreConfig): string[] {
  const fromConfig = Array.isArray(cfg.allowedLocales)
    ? cfg.allowedLocales
        .map((item) => normalizeLocale(item))
        .filter((item): item is string => Boolean(item))
    : [];
  const values = fromConfig.length > 0 ? fromConfig : FALLBACK_ALLOWED_LOCALES;
  return [...new Set(values)];
}

function resolveDefaultLocale(cfg: LangCoreConfig): string {
  const value = normalizeLocale(cfg.defaultLocale);
  return value ?? FALLBACK_DEFAULT_LOCALE;
}

function resolveActiveLocale(cfg: LangCoreConfig): string {
  const current = normalizeLocale(cfg.currentLocale);
  if (current) {
    return current;
  }
  return resolveDefaultLocale(cfg);
}

function isAllowedLocale(locale: string, allowedLocales: string[]): boolean {
  if (allowedLocales.length === 0) {
    return true;
  }
  return allowedLocales.includes(locale);
}

function renderLanguageInstruction(locale: string): string {
  if (locale === "zh-CN") {
    return [
      "Language policy:",
      "- Default response language: Simplified Chinese (zh-CN).",
      "- If the user explicitly asks for another language, follow the user's requested language.",
      "- Keep technical terms and code identifiers unchanged unless translation is requested.",
    ].join("\n");
  }
  if (locale === "ja-JP") {
    return [
      "Language policy:",
      "- Default response language: Japanese (ja-JP).",
      "- If the user explicitly asks for another language, follow the user's requested language.",
      "- Keep technical terms and code identifiers unchanged unless translation is requested.",
    ].join("\n");
  }
  return [
    "Language policy:",
    `- Default response language: ${locale}.`,
    "- If the user explicitly asks for another language, follow the user's requested language.",
    "- Keep technical terms and code identifiers unchanged unless translation is requested.",
  ].join("\n");
}

function renderLocaleSummary(params: {
  activeLocale: string;
  defaultLocale: string;
  allowedLocales: string[];
}): string {
  return [
    "Language status:",
    `- active: ${params.activeLocale}`,
    `- default: ${params.defaultLocale}`,
    `- allowed: ${params.allowedLocales.join(", ")}`,
    "",
    "Commands:",
    "- /langs",
    "- /lang",
    "- /lang set <locale>",
    "- /lang reset",
  ].join("\n");
}

export default function register(api: OpenClawPluginApi) {
  api.registerCommand({
    name: "langs",
    description: "List language locales managed by lang-core.",
    acceptsArgs: false,
    handler: async () => {
      const cfg = api.runtime.config.loadConfig();
      const pluginCfg = readPluginConfig(cfg, api.id);
      const activeLocale = resolveActiveLocale(pluginCfg);
      const defaultLocale = resolveDefaultLocale(pluginCfg);
      const allowedLocales = resolveAllowedLocales(pluginCfg);
      return { text: renderLocaleSummary({ activeLocale, defaultLocale, allowedLocales }) };
    },
  });

  api.registerCommand({
    name: "lang",
    description: "Get or set active language locale.",
    acceptsArgs: true,
    handler: async (ctx) => {
      const args = (ctx.args ?? "").trim();
      const cfg = api.runtime.config.loadConfig();
      const pluginCfg = readPluginConfig(cfg, api.id);

      const activeLocale = resolveActiveLocale(pluginCfg);
      const defaultLocale = resolveDefaultLocale(pluginCfg);
      const allowedLocales = resolveAllowedLocales(pluginCfg);

      if (!args || args.toLowerCase() === "status" || args.toLowerCase() === "list") {
        return { text: renderLocaleSummary({ activeLocale, defaultLocale, allowedLocales }) };
      }

      if (args.toLowerCase() === "reset") {
        const currentEntry = cfg.plugins?.entries?.[api.id] ?? {};
        const currentConfig = readPluginConfig(cfg, api.id);
        const { currentLocale: _drop, ...restConfig } = currentConfig;

        const next: OpenClawConfig = {
          ...cfg,
          plugins: {
            ...(cfg.plugins ?? {}),
            entries: {
              ...(cfg.plugins?.entries ?? {}),
              [api.id]: {
                ...currentEntry,
                config: restConfig,
              },
            },
          },
        };

        await api.runtime.config.writeConfigFile(next);
        return { text: `Locale reset. Active locale is now ${resolveDefaultLocale(restConfig)}.` };
      }

      const tokens = args.split(/\s+/).filter(Boolean);
      const setMode = tokens[0]?.toLowerCase() === "set";
      const rawLocale = setMode ? tokens.slice(1).join(" ") : args;
      const locale = normalizeLocale(rawLocale);
      if (!locale) {
        return { text: "Usage: /lang set <locale>  (example: /lang set zh-CN)" };
      }
      if (!isAllowedLocale(locale, allowedLocales)) {
        return {
          text: `Locale not allowed: ${locale}\nAllowed locales: ${allowedLocales.join(", ")}`,
        };
      }

      const currentEntry = cfg.plugins?.entries?.[api.id] ?? {};
      const currentConfig = readPluginConfig(cfg, api.id);
      const nextConfig: LangCoreConfig = {
        ...currentConfig,
        currentLocale: locale,
      };
      const next: OpenClawConfig = {
        ...cfg,
        plugins: {
          ...(cfg.plugins ?? {}),
          entries: {
            ...(cfg.plugins?.entries ?? {}),
            [api.id]: {
              ...currentEntry,
              config: nextConfig,
            },
          },
        },
      };

      await api.runtime.config.writeConfigFile(next);
      return { text: `Active locale set to ${locale}.` };
    },
  });

  api.on("before_prompt_build", async (_event, _ctx) => {
    const cfg = api.runtime.config.loadConfig();
    const pluginCfg = readPluginConfig(cfg, api.id);
    const locale = resolveActiveLocale(pluginCfg);
    return { prependContext: renderLanguageInstruction(locale) };
  });
}
