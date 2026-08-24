#!/bin/bash
set -e

LABEL="com.claudex-dash"
DEFAULT_DIR="$HOME/tools/claudex-dash"

# When run directly (bun run update / bash update.sh), $0 is the script path and
# dirname resolves to the repo root. When piped via curl (curl ... | bash), $0 is
# "bash" so dirname is "." — fall back to the default install location in that case.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -d "$SCRIPT_DIR/.git" ]; then
  DIR="$SCRIPT_DIR"
elif [ -d "$DEFAULT_DIR/.git" ]; then
  DIR="$DEFAULT_DIR"
else
  echo "✗ Could not find claudex-dash repo (tried $SCRIPT_DIR and $DEFAULT_DIR)."
  echo "  Install it first: curl -fsSL https://raw.githubusercontent.com/aditya-thummar-devx/claudex-dash/main/bootstrap.sh | bash"
  exit 1
fi

echo "Pulling latest claudex-dash changes..."
if ! git -C "$DIR" pull --ff-only origin main; then
  echo "⚠ Couldn't pull (local changes or network error) — skipping update."
  exit 0
fi

echo "Restarting claudex-dash..."
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null \
  || echo "⚠ Agent not loaded — skipping restart (server not running via launchd)."

echo "✓ claudex-dash updated."
