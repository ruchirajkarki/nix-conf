#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -m)" != "arm64" ]; then
  echo "Not on Apple Silicon, Rosetta is not needed."
  exit 0
fi

if /usr/bin/pgrep -q oahd; then
  echo "Rosetta is already installed."
  exit 0
fi

sudo softwareupdate --install-rosetta --agree-to-license
