# 语言插件（本 Fork）

## 中文说明

本 Fork 增加了插件化语言栈：

- `lang-core`
- `lang-zh-cn`
- `lang-en-us`
- `lang-ja-jp`

### 推荐配置（`~/.openclaw/openclaw.json`）

```json5
{
  plugins: {
    entries: {
      "lang-core": {
        enabled: true,
        config: {
          defaultLocale: "zh-CN",
          currentLocale: "zh-CN",
          allowedLocales: ["zh-CN", "en-US", "ja-JP"],
        },
      },
      "lang-zh-cn": { enabled: true },
      "lang-en-us": { enabled: true },
      "lang-ja-jp": { enabled: true },
    },
  },
}
```

### 运行时命令

- `/langs`：查看当前/默认/可用语言。
- `/lang set zh-CN|en-US|ja-JP`：切换当前语言。
- `/lang reset`：清空 `currentLocale`，回退到 `defaultLocale`。

### onboarding 向导语言

此 Fork 默认中文向导；当环境变量语言以 `en` 开头时自动使用英文。

强制英文示例：

```bash
OPENCLAW_LOCALE=en-US openclaw onboard
```

## English notes

This fork adds a plugin-style language stack:

- `lang-core`
- `lang-zh-cn`
- `lang-en-us`
- `lang-ja-jp`

### Suggested config (`~/.openclaw/openclaw.json`)

```json5
{
  plugins: {
    entries: {
      "lang-core": {
        enabled: true,
        config: {
          defaultLocale: "zh-CN",
          currentLocale: "zh-CN",
          allowedLocales: ["zh-CN", "en-US", "ja-JP"],
        },
      },
      "lang-zh-cn": { enabled: true },
      "lang-en-us": { enabled: true },
      "lang-ja-jp": { enabled: true },
    },
  },
}
```

### Runtime commands

- `/langs` shows active/default/allowed locales.
- `/lang set zh-CN|en-US|ja-JP` switches active locale.
- `/lang reset` clears `currentLocale` and falls back to `defaultLocale`.

### Wizard UI locale (onboarding prompts)

This fork defaults onboarding UI to Chinese unless env locale starts with `en`.

Force English:

```bash
OPENCLAW_LOCALE=en-US openclaw onboard
```
