import { describe, expect, it } from "vitest";
import { applyOnboardingLocalWorkspaceConfig } from "./onboard-config.js";

describe("applyOnboardingLocalWorkspaceConfig", () => {
  it("applies local defaults and enables language plugins", () => {
    const cfg = applyOnboardingLocalWorkspaceConfig({}, "/tmp/workspace");

    expect(cfg.agents?.defaults?.workspace).toBe("/tmp/workspace");
    expect(cfg.gateway?.mode).toBe("local");

    expect(cfg.plugins?.entries?.["lang-core"]?.enabled).toBe(true);
    expect(cfg.plugins?.entries?.["lang-core"]?.config).toEqual({
      defaultLocale: "zh-CN",
      currentLocale: "zh-CN",
      allowedLocales: ["zh-CN", "en-US", "ja-JP"],
    });
    expect(cfg.plugins?.entries?.["lang-zh-cn"]?.enabled).toBe(true);
    expect(cfg.plugins?.entries?.["lang-en-us"]?.enabled).toBe(true);
    expect(cfg.plugins?.entries?.["lang-ja-jp"]?.enabled).toBe(true);
  });

  it("preserves existing language config and enable flags", () => {
    const cfg = applyOnboardingLocalWorkspaceConfig(
      {
        plugins: {
          entries: {
            "lang-core": {
              enabled: false,
              config: {
                defaultLocale: "en-US",
                currentLocale: "ja-JP",
                allowedLocales: ["ja-JP", "en-US"],
              },
            },
            "lang-en-us": { enabled: false },
          },
        },
      },
      "/tmp/workspace",
    );

    expect(cfg.plugins?.entries?.["lang-core"]?.enabled).toBe(false);
    expect(cfg.plugins?.entries?.["lang-core"]?.config).toEqual({
      defaultLocale: "en-US",
      currentLocale: "ja-JP",
      allowedLocales: ["ja-JP", "en-US"],
    });
    expect(cfg.plugins?.entries?.["lang-en-us"]?.enabled).toBe(false);
    expect(cfg.plugins?.entries?.["lang-zh-cn"]?.enabled).toBe(true);
    expect(cfg.plugins?.entries?.["lang-ja-jp"]?.enabled).toBe(true);
  });
});
