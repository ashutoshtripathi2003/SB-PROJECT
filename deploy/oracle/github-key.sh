#!/usr/bin/env bash
# Lets this server keep downloading RideSync updates after the GitHub repository is made private.
#
#   bash /opt/ridesync/deploy/oracle/github-key.sh
#
# 1st run: makes a read-only "deploy key" for the server and prints it. Add it on GitHub:
#          repository → Settings → Deploy keys → Add deploy key (leave "Allow write access" OFF).
# 2nd run: checks GitHub accepts the key and switches update.sh to use it. Safe to run again.
set -euo pipefail
APP=/opt/ridesync
REPO_SSH="${REPO_SSH:-git@github.com:ashutoshtripathi2003/SB-PROJECT.git}"
HOME_DIR=/home/ridesync
KEY="$HOME_DIR/.ssh/github_deploy"
as() { sudo -u ridesync "$@"; }

as mkdir -p "$HOME_DIR/.ssh"
as chmod 700 "$HOME_DIR/.ssh"
[ -f "$KEY" ] || as ssh-keygen -t ed25519 -N '' -C 'ridesync-server (read-only)' -f "$KEY" -q

# GitHub's published SSH host key (docs.github.com → "GitHub's SSH key fingerprints"), so the server
# only ever talks to the real GitHub.
GH='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'
as touch "$HOME_DIR/.ssh/known_hosts"
as grep -qF "$GH" "$HOME_DIR/.ssh/known_hosts" || echo "$GH" | as tee -a "$HOME_DIR/.ssh/known_hosts" >/dev/null
if ! as grep -q 'github_deploy' "$HOME_DIR/.ssh/config" 2>/dev/null; then
  printf 'Host github.com\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$KEY" | as tee -a "$HOME_DIR/.ssh/config" >/dev/null
  as chmod 600 "$HOME_DIR/.ssh/config"
fi

# GitHub answers "successfully authenticated" (and exit code 1, as it gives no shell) when the key is added.
if as ssh -o BatchMode=yes -T git@github.com 2>&1 | grep -q 'successfully authenticated'; then
  as git -C "$APP" remote set-url origin "$REPO_SSH"
  as git -C "$APP" fetch --depth 1 origin main >/dev/null
  echo
  echo "Done. The server now downloads updates with its own key — you can make the repository private."
  echo "Updates work the same as before: bash /opt/ridesync/deploy/oracle/update.sh"
else
  echo
  echo "Add this key on GitHub (it's the PUBLIC half — safe to copy):"
  echo
  as cat "$KEY.pub"
  echo
  echo "  1. Open https://github.com/${REPO_SSH#git@github.com:}" | sed 's/\.git$//'
  echo "  2. Settings → Deploy keys → Add deploy key"
  echo "  3. Title: RideSync server · Key: paste the line above · leave 'Allow write access' OFF → Add key"
  echo "  4. Then run this again: bash /opt/ridesync/deploy/oracle/github-key.sh"
fi
