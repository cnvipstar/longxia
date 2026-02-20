# Language Plugins (local fork)

This fork adds a plugin-style language stack:

- `lang-core`
- `lang-zh-cn`
- `lang-en-us`
- `lang-ja-jp`

## Suggested config (`~/.openclaw/openclaw.json`)

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

## Runtime commands

- `/langs` shows active/default/allowed locales.
- `/lang set zh-CN|en-US|ja-JP` switches active locale.
- `/lang reset` clears `currentLocale` and falls back to `defaultLocale`.

## Wizard UI locale (onboarding prompts)

This fork defaults onboarding UI to Chinese unless env locale starts with `en`.

You can force English for onboarding:

```bash
OPENCLAW_LOCALE=en-US openclaw onboard
```
