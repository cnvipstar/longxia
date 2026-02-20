# 🦞 Longxia

<p align="center">
  <img src="assets/brand/logo.jpg" alt="Longxia Logo" width="220">
</p>

Longxia is a Chinese-first distribution built on top of the official OpenClaw project.

Primary goals:

- Chinese-by-default onboarding and UX.
- Plugin-based multilingual support with minimal core changes.
- One-click installers for macOS/Linux/Windows.
- Better Windows native diagnostics and auto-fix flow.

Official website: [www.longxia.ren](https://www.longxia.ren)

## Quick Start

### One-click install

macOS / Linux:

```bash
./install-cn.sh
```

Windows PowerShell:

```powershell
./install-cn.ps1 -Mode Auto
```

### From source

```bash
git clone https://github.com/cnvipstar/longxia.git
cd longxia
pnpm install
pnpm ui:build
pnpm build
pnpm link --global
openclaw onboard --install-daemon
```

## Extra Docs

- Language plugins: [LANGUAGE_PLUGINS.md](LANGUAGE_PLUGINS.md)
- Windows native support: [WINDOWS_NATIVE.md](WINDOWS_NATIVE.md)

## Notes

- Branding is Longxia, while CLI command names remain `openclaw` for compatibility.
- License remains MIT (see [LICENSE](LICENSE)).
