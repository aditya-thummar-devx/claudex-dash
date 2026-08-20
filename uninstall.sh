#!/bin/bash
set -e

LABEL="com.claudex-dash"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"

echo "✓ agent removed — it will not start on login any more."
echo "  (repo clone at ~/tools/claudex-dash left in place; delete it yourself if you want it gone)"
