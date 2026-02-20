#!/usr/bin/env bash
set -euo pipefail

# Sync local main branch with upstream/main and push to origin/main.
# Usage:
#   ./sync-upstream.sh
#   ./sync-upstream.sh --branch main

BRANCH="main"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Sync fork with upstream.

Options:
  --branch <name>   Branch to sync (default: main)
EOF
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not inside a git repository." >&2
  exit 1
fi

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "Missing 'upstream' remote. Example:" >&2
  echo "  git remote add upstream https://github.com/openclaw/openclaw.git" >&2
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Missing 'origin' remote." >&2
  exit 1
fi

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  git checkout "$BRANCH"
fi

git fetch upstream --prune
git merge --ff-only "upstream/$BRANCH"
git push origin "$BRANCH"

echo "Synced $BRANCH with upstream/$BRANCH and pushed to origin/$BRANCH."
