#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ "${CONFIRM_HISTORY_REWRITE:-}" != "YES" ]]; then
  echo "[purge-secrets] Operação destrutiva bloqueada."
  echo "[purge-secrets] Use: CONFIRM_HISTORY_REWRITE=YES bash scripts/maintenance/purge-secret-history.sh"
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[purge-secrets] Repositório git não encontrado em $ROOT_DIR"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "[purge-secrets] Working tree não está limpa. Commit/stash antes de reescrever histórico."
  exit 1
fi

if ! git filter-repo --help >/dev/null 2>&1; then
  echo "[purge-secrets] git-filter-repo não disponível."
  echo "[purge-secrets] Instale (macOS): brew install git-filter-repo"
  exit 1
fi

echo "[purge-secrets] Reescrevendo histórico para remover caminhos sensíveis..."
git filter-repo --force --invert-paths \
  --path "config/firebase/gradle.properties"

cat <<'EOF'
[purge-secrets] Histórico reescrito.

Próximos passos obrigatórios:
1) Rotacionar TODOS os segredos que já vazaram (keystore, JWT, Redis, Woovi/OpenPix, etc).
2) Forçar push coordenado:
   git push --force-with-lease --all
   git push --force-with-lease --tags
3) Invalidar clones locais antigos da equipe (novo clone recomendado).
EOF
