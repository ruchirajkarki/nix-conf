#!/usr/bin/env bash
set -euo pipefail

if ! /usr/bin/pgrep -q oahd; then
  echo "Rosetta is not installed."
  exit 0
fi

echo "Removing Rosetta. This is unsupported by Apple and may be reinstalled automatically by macOS updates if a Rosetta-dependent app runs."
read -rp "Continue? [y/N] " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "Aborted."
  exit 1
fi

sudo launchctl bootout system/com.apple.oahd 2>/dev/null || true
sudo rm -rf /Library/Apple/usr/share/rosetta
sudo rm -f /Library/Apple/System/Library/LaunchDaemons/com.apple.oahd.plist
sudo rm -f /Library/Apple/usr/libexec/oahd-helper

echo "Rosetta removed."
