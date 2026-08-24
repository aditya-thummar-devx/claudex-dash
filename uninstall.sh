#!/bin/bash
set -e

LABEL="com.claudex-dash"
UPDATER_LABEL="com.claudex-dash.updater"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$UPDATER_LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$UPDATER_LABEL.plist"

echo "✓ agent removed — it will not start on login any more."
echo "  (repo clone at ~/tools/claudex-dash left in place; delete it yourself if you want it gone)"
