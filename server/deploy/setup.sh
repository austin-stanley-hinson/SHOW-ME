#!/usr/bin/env bash
# One-time setup of the session relay on a fresh Ubuntu 24.04 VPS (run as root).
#   scp server/relay.js server/deploy/* root@IP:/root/relay-setup/
#   ssh root@IP 'bash /root/relay-setup/setup.sh <ip-with-dashes>.sslip.io https://your-app.vercel.app'
# HTTPS comes from Caddy + Let's Encrypt on the sslip.io name (no domain needed).
set -euo pipefail
HOST="${1:?usage: setup.sh <host> [allowed-origins]}"
ORIGINS="${2:-*}"
DIR="$(cd "$(dirname "$0")" && pwd)"

apt-get update -y
apt-get install -y nodejs debian-keyring debian-archive-keyring apt-transport-https curl gnupg ufw
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

id relay >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin relay
install -d -o relay -g relay /opt/relay
install -m 0644 "$DIR/relay.js" /opt/relay/relay.js
printf '{"type":"module"}\n' > /opt/relay/package.json

sed "s|__ORIGINS__|$ORIGINS|" "$DIR/relay.service" > /etc/systemd/system/relay.service
sed "s|__HOST__|$HOST|" "$DIR/Caddyfile" > /etc/caddy/Caddyfile

ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
systemctl daemon-reload
systemctl enable --now relay
systemctl restart caddy
sleep 2
curl -fsS "https://$HOST/health" && echo " <- relay is live at https://$HOST"
