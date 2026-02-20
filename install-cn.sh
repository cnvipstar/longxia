#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${LONGXIA_REPO_URL:-https://github.com/cnvipstar/longxia.git}"
INSTALL_DIR="${LONGXIA_INSTALL_DIR:-$HOME/.openclaw-longxia}"
BRANCH="${LONGXIA_BRANCH:-main}"
ONBOARD_FLOW="${LONGXIA_ONBOARD_FLOW:-quickstart}"
RUN_ONBOARD=1

print_help() {
  cat <<'EOF'
Longxia one-click installer (CN defaults)

Usage:
  ./install-cn.sh [options]

Options:
  --repo <url>         Git repo URL (default: https://github.com/cnvipstar/longxia.git)
  --dir <path>         Install/update directory (default: ~/.openclaw-longxia)
  --branch <name>      Git branch (default: main)
  --flow <name>        Onboarding flow (default: quickstart)
  --no-onboard         Skip onboarding wizard
  -h, --help           Show help
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_URL="$2"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --flow)
      ONBOARD_FLOW="$2"
      shift 2
      ;;
    --no-onboard)
      RUN_ONBOARD=0
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      print_help
      exit 1
      ;;
  esac
done

require_cmd git
require_cmd node

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@10 --activate
  fi
fi
require_cmd pnpm

mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "Updating existing checkout at $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch origin --prune
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
else
  echo "Cloning $REPO_URL to $INSTALL_DIR"
  git clone --depth=1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

echo "Installing dependencies..."
pnpm install

echo "Building UI assets..."
pnpm ui:build

echo "Building project..."
pnpm build

echo "Linking CLI globally..."
pnpm link --global

echo "Applying language defaults..."
openclaw config set 'plugins.entries[lang-core].enabled' 'true' --json
openclaw config set 'plugins.entries[lang-core].config.defaultLocale' '"zh-CN"' --json
openclaw config set 'plugins.entries[lang-core].config.currentLocale' '"zh-CN"' --json
openclaw config set 'plugins.entries[lang-core].config.allowedLocales' '["zh-CN","en-US","ja-JP"]' --json
openclaw config set 'plugins.entries[lang-zh-cn].enabled' 'true' --json
openclaw config set 'plugins.entries[lang-en-us].enabled' 'true' --json
openclaw config set 'plugins.entries[lang-ja-jp].enabled' 'true' --json

if [[ "$RUN_ONBOARD" -eq 1 ]]; then
  echo "Starting onboarding wizard..."
  openclaw onboard --flow "$ONBOARD_FLOW" --install-daemon
else
  echo "Onboarding skipped (--no-onboard)."
fi

echo "Done."
