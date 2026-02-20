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
    const cfg = api.runtime.config.loadConfig();
    if (resolveActiveLocale(cfg).toLowerCase() !== "zh-cn") {
      return;
    }
    return {
      prependContext: [
        "zh-CN style pack:",
        "- Use concise, professional Simplified Chinese by default.",
        "- Keep code, file paths, CLI flags, and API fields in original language.",
        "- Prefer clear, direct statements and actionable next steps.",
      ].join("\n"),
    };
  });
}
