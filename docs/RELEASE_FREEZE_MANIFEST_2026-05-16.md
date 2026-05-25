# Release Freeze Manifest - 2026-05-16

## Rollback disponível

- Branch: `codex/checkpoint-20260516-pre-cleanup-current-state`
- Commit: `bacbd41`
- Tag: `checkpoint/pre-cleanup-20260516-current-state`

Para voltar ao checkpoint, criar uma branch nova a partir da tag:

```bash
git switch -c rollback/pre-cleanup-20260516 checkpoint/pre-cleanup-20260516-current-state
```

## Observação sobre build aprovada

Este checkpoint preserva o estado local antes da limpeza, incluindo as alterações de exclusão de conta que estavam na worktree. Ele não confirma sozinho o artefato exato da iOS build 22 aprovada.

Evidência local encontrada antes da limpeza:

- `mobile-app/ios/build/export-appstore/Leaf.ipa`: `versionNumber` 1.0.1, `buildNumber` 21.
- `mobile-app/android/app/build/outputs/apk/release/app-release.apk`: `versionCode` 108, `versionName` 1.0.3.
- `mobile-app/builds/release/leaf-android-production-v108-20260515.aab`: `119M`, timestamp local 2026-05-15 11:29.
- `mobile-app/config/AppConfig.js` no checkpoint atual aponta para `ios_build_number: '23'` e `android_app_version: 110`.

Conclusão: antes de nova submissão, confirmar no App Store Connect/Play Console qual artefato foi aprovado/submetido e registrar hash + build number em um manifesto específico de release.
