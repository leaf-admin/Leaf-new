# Baseline Tecnica - Migracao Expo SDK 54

Data: 2026-03-16  
Branch: `codex/migracao-expo-sdk54-zero-debito`  
Commit base: `a01b8f7`

## Objetivo

Registrar o estado tecnico inicial do projeto antes de iniciar alteracoes de versao.

## Resultado dos checks executados

- `expo-doctor`: `17/17 checks passed. No issues detected.`
- `expo config --json`: executado com sucesso.

## Evidencias de build existentes no repositorio

- Android (SDK 52): `ERRORED` com `EAS_BUILD_UNKNOWN_GRADLE_ERROR`.
- iOS (SDK 52): `ERRORED` com `XCODE_BUILD_ERROR`.

Arquivos de referencia:

- `mobile-app/android_build_summary.json`
- `mobile-app/ios_build_summary.json`

## Notas de ambiente local desta sessao

- Node executado via NVM path: `~/.nvm/versions/node/v24.14.0/bin`.
- `npm` e `npx` disponiveis apenas apos export do `PATH`.

## Proximo passo

Executar baseline de build controlado (Android/iOS) nesta branch, com logs organizados, antes de alterar dependencias.
