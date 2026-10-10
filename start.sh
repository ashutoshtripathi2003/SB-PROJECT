#!/usr/bin/env bash
# Mac / Linux: double-click (Mac: right-click → Open the first time) or run ./start.sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js is not installed. Get the LTS version from https://nodejs.org"; exit 1; }
[ -x node_modules/.bin/concurrently ] || { echo "Installing RideSync. This takes a minute..."; npm install || exit 1; }
echo
echo "  RideSync is starting at http://localhost:5173"
echo "  Login codes appear in THIS window until email is set up."
echo "  Press Ctrl+C to stop."
echo
npm run dev
