import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";

function resolveActiveLocale(cfg: OpenClawConfig): string {
  const langCoreConfig = cfg.plugins?.entries?.["lang-core"]?.config;
  if (!langCoreConfig || typeof langCoreConfig !== "object") {
    return "zh-CN";
  }
  const obj = langCoreConfig as { currentLocale?: string; defaultLocale?: string };
  return (obj.currentLocale ?? obj.defaultLocale ?? "zh-CN").trim() || "zh-CN";
}

export default function register(api: OpenClawPluginApi) {
  api.on("before_prompt_build", async () => {
    if (resolveActiveLocale(api.runtime.config.loadConfig()).toLowerCase() !== "en-us") {
      return;
    }
    return {
      prependContext: [
        "en-US style pack:",
        "- Use clear, plain US English with concise technical phrasing.",
        "- Keep code, paths, flags, and schema keys unchanged.",
        "- Favor direct execution guidance over long narrative explanations.",
      ].join("\n"),
    };
  });
}
