#!/bin/bash
# Install or remove the LaunchAgent that syncs COROS and republishes every 3 hours.
#   bash scripts/schedule.sh install | remove | status
SITE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="io.github.vedants-agrawal.site-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$SITE_ROOT/.local/logs"
case "$1" in
  install)
    cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$SITE_ROOT/scripts/runtime.sh</string><string>scripts/auto_sync.py</string></array>
  <key>StartInterval</key><integer>10800</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$SITE_ROOT/.local/logs/sync.log</string>
  <key>StandardErrorPath</key><string>$SITE_ROOT/.local/logs/sync.log</string>
</dict></plist>
PL
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
    launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "Scheduled every 3 hours. Automatic publishing starts after your first manual publish." ;;
  remove)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null; rm -f "$PLIST" "$SITE_ROOT/.local/auto-publish-enabled"; echo "Removed." ;;
  *) launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E 'state|last exit' || echo "Not scheduled."; tail -5 "$SITE_ROOT/.local/logs/sync.log" 2>/dev/null ;;
esac
