#!/usr/bin/env bash
# RideSync on an Oracle Cloud "Always Free" server (Ubuntu 22.04 / 24.04, Ampere A1 or AMD micro).
#
#   bash setup.sh ridesync-vit.duckdns.org            # your free DuckDNS name (recommended)
#   DUCKDNS_TOKEN=xxxx bash setup.sh ridesync-vit.duckdns.org   # also keeps DuckDNS pointed at this server
#   bash setup.sh                                     # no name: uses <your-ip>.sslip.io automatically
#
# Before running, copy your .env, data folder and firebase-key.json into ~/upload on the server
# (upload.bat does this from Windows). Safe to run again: it updates instead of starting over.
set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-https://github.com/mastermac123/SB-PROJECT.git}"
BRANCH="${BRANCH:-main}"
APP=/opt/ridesync
UPLOAD="$HOME/upload"
PORT=8787

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] && { echo "Run this as the normal 'ubuntu' user (it uses sudo itself)."; exit 1; }

say "Updating Ubuntu and installing tools"
sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
echo iptables-persistent iptables-persistent/autosave_v4 boolean true | sudo debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | sudo debconf-set-selections
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates gnupg sqlite3 iptables-persistent debian-keyring debian-archive-keyring apt-transport-https

# The 1 GB "micro" servers need swap to build the website.
if [ "$(free -m | awk '/Mem:/{print $2}')" -lt 3000 ] && ! swapon --show | grep -q swapfile; then
  say "Adding 2 GB of swap (small server)"
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

say "Installing Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<13)){console.error("Node "+process.versions.node+" is too old (need 22.13+)");process.exit(1)}'
echo "  Node $(node -v)"

say "Getting RideSync"
id ridesync >/dev/null 2>&1 || sudo useradd --system --create-home --home-dir /home/ridesync --shell /usr/sbin/nologin ridesync
if [ -d "$APP/.git" ]; then
  sudo -u ridesync git -C "$APP" fetch --depth 1 origin "$BRANCH"
  sudo -u ridesync git -C "$APP" reset --hard "origin/$BRANCH"
else
  sudo mkdir -p "$APP" && sudo chown ridesync:ridesync "$APP"
  sudo -u ridesync git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP"
fi

say "Copying your settings and data from ~/upload"
if [ -f "$UPLOAD/.env" ]; then sudo cp "$UPLOAD/.env" "$APP/.env"; else [ -f "$APP/.env" ] || { warn "No ~/upload/.env — starting with the example settings."; sudo cp "$APP/.env.example" "$APP/.env" 2>/dev/null || sudo touch "$APP/.env"; }; fi
[ -f "$UPLOAD/firebase-key.json" ] && sudo cp "$UPLOAD/firebase-key.json" "$APP/firebase-key.json"
if [ -d "$UPLOAD/data" ] && [ ! -f "$APP/data/.copied" ]; then
  sudo mkdir -p "$APP/data" && sudo cp -a "$UPLOAD/data/." "$APP/data/" && sudo touch "$APP/data/.copied"
  echo "  Database copied (your users, rides and payments come along)."
fi
sudo mkdir -p "$APP/data" "$APP/backups"
sudo chown -R ridesync:ridesync "$APP"
sudo chmod 600 "$APP/.env"; [ -f "$APP/firebase-key.json" ] && sudo chmod 600 "$APP/firebase-key.json"

# The server's address: your DuckDNS name, or <ip>.sslip.io (a free name that points at any IP).
IP="$(curl -fsS --max-time 10 https://api.ipify.org || curl -fsS --max-time 10 https://checkip.amazonaws.com || curl -fsS --max-time 10 https://ifconfig.me || true)"
IP="$(echo "$IP" | tr -d '[:space:]')"
if [ -z "$DOMAIN" ]; then
  [ -n "$IP" ] || { echo "Couldn't find this server's public IP. Run again with your DuckDNS name: bash setup.sh yourname.duckdns.org"; exit 1; }
  DOMAIN="$(echo "$IP" | tr . -).sslip.io"; warn "No name given — using $DOMAIN"
fi
setenv() { # setenv KEY VALUE  — set or replace a line in .env
  if sudo grep -q "^$1=" "$APP/.env"; then sudo sed -i "s|^$1=.*|$1=$2|" "$APP/.env"; else echo "$1=$2" | sudo tee -a "$APP/.env" >/dev/null; fi
}
setenv PUBLIC_URL "https://$DOMAIN"
setenv DEV_LOGIN false

if [ -n "${DUCKDNS_TOKEN:-}" ] && [[ "$DOMAIN" == *.duckdns.org ]]; then
  say "Pointing $DOMAIN at this server ($IP) and keeping it updated"
  SUB="${DOMAIN%.duckdns.org}"
  curl -fsS --max-time 15 "https://www.duckdns.org/update?domains=$SUB&token=$DUCKDNS_TOKEN&ip=" && echo || warn "DuckDNS didn't answer; it will retry every 10 minutes."
  echo "*/10 * * * * root curl -fsS 'https://www.duckdns.org/update?domains=$SUB&token=$DUCKDNS_TOKEN&ip=' >/dev/null 2>&1" | sudo tee /etc/cron.d/ridesync-duckdns >/dev/null
  sudo chmod 600 /etc/cron.d/ridesync-duckdns
fi

say "Installing packages and building the website (takes a few minutes)"
sudo -u ridesync bash -c "cd $APP && npm ci --no-audit --no-fund && npm run build"

say "Starting RideSync as a service (starts on boot, restarts if it crashes)"
sudo tee /etc/systemd/system/ridesync.service >/dev/null <<UNIT
[Unit]
Description=RideSync carpooling server
After=network-online.target
Wants=network-online.target

[Service]
User=ridesync
WorkingDirectory=$APP
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=$(command -v node) --import tsx server/prod.ts
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable ridesync >/dev/null
sudo systemctl restart ridesync

say "Opening ports 80 and 443 on the server's firewall"
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport $p -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p tcp --dport $p -m conntrack --ctstate NEW -j ACCEPT
done
sudo netfilter-persistent save >/dev/null

say "Installing Caddy (free HTTPS certificate, renewed automatically)"
if ! command -v caddy >/dev/null; then
  # Caddy's own repository (newest version); Ubuntu's package if that can't be reached.
  if curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null &&
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null; then
    sudo apt-get update -y
  else
    sudo rm -f /etc/apt/sources.list.d/caddy-stable.list
  fi
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
fi
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$DOMAIN {
	encode gzip
	# flush_interval -1: live updates (driver location, chat) are sent the moment they happen.
	reverse_proxy 127.0.0.1:$PORT {
		flush_interval -1
	}
}
CADDY
sudo systemctl enable caddy >/dev/null
sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy

say "Daily database backup (03:30, keeps 14 days)"
sudo tee /usr/local/bin/ridesync-backup >/dev/null <<'BACKUP'
#!/usr/bin/env bash
set -e
APP=/opt/ridesync
DB="$(grep -E '^DATABASE_PATH=' "$APP/.env" | cut -d= -f2-)"; DB="${DB:-./data/ridesync.db}"
case "$DB" in /*) ;; *) DB="$APP/${DB#./}" ;; esac
[ -f "$DB" ] || exit 0
sqlite3 "$DB" ".backup '$APP/backups/ridesync-$(date +%F).db'"
find "$APP/backups" -name 'ridesync-*.db' -mtime +14 -delete
BACKUP
sudo chmod 755 /usr/local/bin/ridesync-backup
echo "30 3 * * * ridesync /usr/local/bin/ridesync-backup" | sudo tee /etc/cron.d/ridesync-backup >/dev/null

say "Checking it works"
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/api/config" >/dev/null 2>&1 && break; sleep 2; done
if curl -fsS "http://127.0.0.1:$PORT/api/config" >/dev/null 2>&1; then echo "  Server: running"; else warn "Server didn't answer. See: sudo journalctl -u ridesync -n 50"; fi
sleep 5
if curl -fsS "https://$DOMAIN/api/config" >/dev/null 2>&1; then echo "  HTTPS: working"; else warn "HTTPS isn't answering yet. Check the Oracle ingress rules for ports 80 and 443 (guide step 3) and that $DOMAIN points to ${IP:-this server}. Caddy retries by itself."; fi

cat <<DONE

  RideSync is online:  https://$DOMAIN

  Next:
   - Open that link on your phone and sign in.
   - Phone app: enter https://$DOMAIN as the server link (or set it in GitHub, guide step 7).
   - Logs:     sudo journalctl -u ridesync -f
   - Update:   bash $APP/deploy/oracle/update.sh
DONE
