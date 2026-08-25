#!/usr/bin/env bash
# Run on a fresh Ubuntu VPS as root:
#   bash deploy/vps/bootstrap.sh
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git docker.io docker-compose-v2 ufw
systemctl enable --now docker

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo
echo "Docker is installed. Next:"
echo "  1. cd /root && git clone <your-swaparc-repo-url> swaparc"
echo "  2. cd /root/swaparc"
echo "  3. cp deploy/vps/env.example .env && nano .env"
echo "  4. docker compose up -d --build"
echo
docker --version
docker compose version
