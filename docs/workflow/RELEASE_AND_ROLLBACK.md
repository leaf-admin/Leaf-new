# Release And Rollback

## Freeze

Antes de release:

1. Confirmar branch e commit.
2. Registrar versoes iOS/Android.
3. Registrar hashes dos artefatos locais ou links EAS/App Store/Play Console.
4. Rodar matriz de release.
5. Criar tag de release quando o artefato estiver confirmado.

## Build aprovada atual

O checkpoint local preserva o estado antes da limpeza, mas nao prova sozinho o artefato exato aprovado pela Apple.

Referencia:

- [Release Freeze Manifest](../RELEASE_FREEZE_MANIFEST_2026-05-16.md)

## Rollback

Para voltar ao checkpoint pre-limpeza:

```bash
git switch -c rollback/pre-cleanup-20260516 checkpoint/pre-cleanup-20260516-current-state
```

Nao usar `git reset --hard` em branch compartilhada. Rollback deve ser branch nova e auditavel.
