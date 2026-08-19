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

echo
echo "claudex-dash → http://127.0.0.1:$PORT   (Ctrl-C to stop)"
(sleep 2 && open "http://127.0.0.1:$PORT") &>/dev/null &

exec bun run server.ts
