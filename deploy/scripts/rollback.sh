#!/usr/bin/env bash
# Volta para o release anterior (web e worker JUNTOS). Não toca no banco.
# ATENÇÃO: só para um commit listado como verificado em docs/COMPATIBILIDADE.md.
set -euo pipefail
RAIZ=/srv/johnyweb
ANTERIOR="$(cat "$RAIZ/anterior" 2>/dev/null || true)"
[ -n "$ANTERIOR" ] && [ -d "$ANTERIOR" ] || { echo "Não há release anterior registrado."; exit 1; }
echo "Voltando para $ANTERIOR (confirme em docs/COMPATIBILIDADE.md). Ctrl+C para abortar."; sleep 5
ln -sfn "$ANTERIOR" "$RAIZ/current.novo" && mv -T "$RAIZ/current.novo" "$RAIZ/current"
sudo systemctl restart johnyweb-worker johnyweb-web
systemctl is-active johnyweb-web johnyweb-worker
