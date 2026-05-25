#!/usr/bin/env bash

set -euo pipefail

BASE_BRANCH="${LEAF_BASE_BRANCH:-codex/clean-workbase-20260516}"
BRANCH_PREFIX="${LEAF_BRANCH_PREFIX:-codex}"

usage() {
  cat <<'USAGE'
Uso:
  npm run branch:task -- LIN-123 nome-curto
  npm run branch:task -- nome-curto

Variaveis opcionais:
  LEAF_BASE_BRANCH      Branch base. Default: codex/clean-workbase-20260516
  LEAF_BRANCH_PREFIX    Prefixo da branch. Default: codex
USAGE
}

slugify() {
  printf '%s' "$*" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 1 ]]; then
  usage
  exit 0
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Worktree suja. Commit, stash ou descarte mudancas antes de criar branch."
  exit 1
fi

if ! git rev-parse --verify --quiet "$BASE_BRANCH" >/dev/null; then
  echo "Branch base nao encontrada: $BASE_BRANCH"
  exit 1
fi

ticket=""
slug_parts=("$@")

if [[ "$1" =~ ^[A-Za-z]+-[0-9]+$ ]]; then
  ticket="$(slugify "$1")"
  shift
  slug_parts=("$@")
fi

slug="$(slugify "${slug_parts[*]}")"
if [[ -z "$slug" ]]; then
  echo "Nome curto invalido."
  exit 1
fi

if [[ -n "$ticket" ]]; then
  branch="${BRANCH_PREFIX}/${ticket}-${slug}"
else
  branch="${BRANCH_PREFIX}/${slug}"
fi

if git rev-parse --verify --quiet "$branch" >/dev/null; then
  echo "Branch ja existe: $branch"
  exit 1
fi

git switch "$BASE_BRANCH"
git switch -c "$branch"
echo "Branch criada: $branch"
