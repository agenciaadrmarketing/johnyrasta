#!/usr/bin/env bash
# Prepara uma VPS Ubuntu 22.04/24.04 NOVA (como root). Idempotente. Não mexe em DNS nem em serviços de terceiros.
set -euo pipefail
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx git curl ca-certificates ufw postgresql-client
# Node 22 LTS (NodeSource). Confira a versão instalada: node -v
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
id johnyweb >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash johnyweb
install -d -o johnyweb -g johnyweb /srv/johnyweb /srv/johnyweb/releases /var/backups/johnyweb
install -d -o root -g johnyweb -m 750 /etc/johnyweb
echo 'johnyweb ALL=(root) NOPASSWD: /usr/bin/systemctl restart johnyweb-worker johnyweb-web' > /etc/sudoers.d/johnyweb
chmod 440 /etc/sudoers.d/johnyweb
# Swap de 2 GB: o `next build` chega perto de 2 GB de RAM.
if ! swapon --show | grep -q swapfile; then fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi
# Firewall: só SSH, HTTP e HTTPS. A porta 3000 fica em loopback.
ufw allow OpenSSH; ufw allow 'Nginx Full'; ufw --force enable
# Limite do journal (logs dos serviços ficam no systemd): 500 MB, 30 dias.
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=500M\nMaxRetentionSec=30day\nStorage=persistent\n' > /etc/systemd/journald.conf.d/johnyweb.conf
systemctl restart systemd-journald
cp -n /srv/johnyweb/repo/deploy/systemd/*.service /etc/systemd/system/ 2>/dev/null || true
systemctl daemon-reload
echo "Pronto. Próximos passos no roteiro (docs/IMPLANTACAO-VPS-SUPABASE.md): clonar o repo em /srv/johnyweb/repo, preencher /etc/johnyweb/*.env, nginx, certbot, deploy.sh."
