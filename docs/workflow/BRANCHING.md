# Branching

## Branches fixas

- `codex/checkpoint-20260516-pre-cleanup-current-state`: checkpoint local antes da limpeza.
- `checkpoint/pre-cleanup-20260516-current-state`: tag de rollback.
- `codex/project-cleanup-20260516`: branch auditavel da limpeza.
- `codex/clean-workbase-20260516`: base limpa para novos trabalhos.

## Branches de tarefa

Formato recomendado:

```text
codex/<linear-id>-<slug>
```

Exemplos:

```text
codex/lin-123-trip-share-link
codex/lin-124-common-local-profile-migration
codex/release-android-build-110-validation
```

## Criar branch

Use o helper:

```bash
npm run branch:task -- LIN-123 trip-share-link
```

Ou sem Linear:

```bash
npm run branch:task -- trip-share-link
```

O helper exige worktree limpa antes de trocar de branch.

## Regras

- Nao trabalhar direto em `codex/clean-workbase-20260516`.
- Uma branch deve resolver uma tarefa clara.
- Mudanca de runtime e limpeza estrutural devem ficar separadas.
- Branch de release deve sair de uma base validada e registrar build/artefato.
- Rollback deve criar branch nova a partir da tag, nunca reescrever historico.
