#!/usr/bin/env bash
# Implanta um commit como um "release" novo e troca o link `current`. Mantém os anteriores para retorno.
#   sudo -u johnyweb deploy/scripts/deploy.sh <sha-completo> [--migrar]
# NÃO executa migração sem --migrar. Com --migrar: backup obrigatório antes (aborta se falhar).
set -euo pipefail
SHA="${1:?uso: deploy.sh <sha-completo> [--migrar]}"
MIGRAR="${2:-}"
RAIZ=/srv/johnyweb
REPO="$RAIZ/repo"
REL="$RAIZ/releases/$SHA"
OPS=/etc/johnyweb/ops.env

[ -d "$REPO/.git" ] || { echo "Clone o repositório em $REPO antes (git clone … $REPO)."; exit 1; }
git -C "$REPO" fetch origin
git -C "$REPO" cat-file -e "$SHA^{commit}" || { echo "Commit $SHA não existe no repositório."; exit 1; }

if [ ! -d "$REL" ]; then
  git -C "$REPO" worktree add --detach "$REL" "$SHA"
  cd "$REL"
  # Instalação COMPLETA (o worker roda com tsx, que é dependência de desenvolvimento).
  npm ci
  npm run build
fi

if [ "$MIGRAR" = "--migrar" ]; then
  cd "$REL"
  set -a; . "$OPS"; set +a
  echo "· backup antes da migração (obrigatório)"
  npm run db:backup
  npm run db:supabase-preflight
  npm run db:migrate
  npm run db:supabase-endurecer
fi

ANTERIOR="$(readlink -f "$RAIZ/current" || true)"
ln -sfn "$REL" "$RAIZ/current.novo" && mv -T "$RAIZ/current.novo" "$RAIZ/current"
echo "$ANTERIOR" > "$RAIZ/anterior"   # para o retorno
sudo systemctl restart johnyweb-worker johnyweb-web
sleep 5
systemctl is-active johnyweb-web johnyweb-worker
echo "Release ativo: $SHA (anterior: ${ANTERIOR:-nenhum}). Verifique Configurações → Worker 'ativo' e rode: npm run medir"
