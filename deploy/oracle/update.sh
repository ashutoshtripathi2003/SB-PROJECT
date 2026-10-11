#!/usr/bin/env bash
# Update RideSync on the server to the latest version on GitHub (backs up the database first).
set -euo pipefail
APP=/opt/ridesync
BRANCH="${BRANCH:-main}"
echo "==> Backing up the database"
sudo -u ridesync /usr/local/bin/ridesync-backup || true
echo "==> Downloading the latest version"
sudo -u ridesync git -C "$APP" fetch --depth 1 origin "$BRANCH"
sudo -u ridesync git -C "$APP" reset --hard "origin/$BRANCH"
echo "==> Building"
sudo -u ridesync bash -c "cd $APP && npm ci --no-audit --no-fund && npm run build"
echo "==> Restarting"
sudo systemctl restart ridesync
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8787/api/config >/dev/null 2>&1 && { echo "Updated and running."; exit 0; }; sleep 2; done
echo "The server didn't come back. See: sudo journalctl -u ridesync -n 50"; exit 1
