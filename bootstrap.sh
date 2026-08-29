#!/bin/bash
set -e

REPO="https://github.com/aditya-thummar-devx/claudex-dash.git"
DIR="$HOME/tools/claudex-dash"
PORT="${PORT:-4400}"

# `command -v bun` is not enough on its own: an nvm-installed npm `bun` shim resolves fine and then
# fails when actually run, which would surface later as a confusing error from `bun run`.
if ! bun --version &>/dev/null; then
  echo "Bun not found — installing (https://bun.sh)..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# Running from inside a clone (a dev re-running this) reuses it; piping from curl clones fresh.
if [ ! -f "server.ts" ]; then
  if [ ! -d "$DIR/.git" ]; then
    echo "Cloning claudex-dash into $DIR..."
    git clone "$REPO" "$DIR"
  fi
  cd "$DIR"
fi

if [ -d ".git" ]; then
  echo "Pulling latest changes..."
  git pull --ff-only origin main || echo "⚠ Couldn't update (local changes?) — using it as-is."
fi

# No `bun install`: this project has no dependencies.
# No claudex preflight either — the dashboard checks for it itself and shows claudex's own error
# with a Retry button, which beats exiting here on a message nobody can act on from a pipe.

LABEL="com.claudex-dash"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BUN="$(command -v bun)"
ROOT="$PWD"

# launchd gets a near-empty PATH, so the bun path and working directory are baked in absolute.
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN</string>
    <string>run</string>
    <string>server.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict><key>PORT</key><string>$PORT</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ROOT/launchd.log</string>
  <key>StandardErrorPath</key><string>$ROOT/launchd.log</string>
</dict>
</plist>
PLIST_EOF

# Boot out any previous agent first: two agents on one port means the loser restart-loops forever.
launchctl bootout "gui/$(id -u)/$LABEL" &>/dev/null || true
launchctl load "$PLIST"

echo
echo "claudex-dash → http://127.0.0.1:$PORT"
echo "  starts on login, restarts if it crashes.  logs: $ROOT/launchd.log"
echo "  manual update: bun run update  (or Settings → Check for updates)"
echo "  stop for good:  bun run uninstall     restart:  bun run restart"
(sleep 2 && open "http://127.0.0.1:$PORT") &>/dev/null &
