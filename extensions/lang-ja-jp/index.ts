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
    if (resolveActiveLocale(api.runtime.config.loadConfig()).toLowerCase() !== "ja-jp") {
      return;
    }
    return {
      prependContext: [
        "ja-JP style pack:",
        "- Use practical, concise Japanese with professional tone.",
        "- Keep code blocks, command names, paths, and API fields as-is.",
        "- Prioritize concrete steps and avoid vague wording.",
      ].join("\n"),
    };
  });
}
