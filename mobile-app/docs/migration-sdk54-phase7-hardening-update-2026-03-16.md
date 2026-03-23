# Fase 7 - Hardening update (permissoes e confiabilidade de release)

Data: 2026-03-16
Branch: codex/migracao-expo-sdk54-zero-debito

## Mudancas aplicadas

1. Hardening de permissao de audio (nao usamos gravacao)
- `app.config.js`:
  - plugin `expo-audio` alterado para:
    - `microphonePermission: false`
    - `recordAudioAndroid: false`
    - `enableBackgroundRecording: false`
- `ios/Leaf/Info.plist`:
  - removida chave `NSMicrophoneUsageDescription`.

2. Gate automatizado de permissao
- Novo script: `scripts/check-permissions-hardening.sh`.
- Novo comando: `npm run qa:permissions`.
- Validacoes automatizadas:
  - `expo-audio` com microfone desativado no `app.config.js`;
  - `AndroidManifest.xml` removendo `RECORD_AUDIO`;
  - `expo config --type prebuild` sem `NSMicrophoneUsageDescription`;
  - `expo config --type prebuild` sem `android.permission.RECORD_AUDIO`.

## Resultado da validacao

- Execucao: `npm run qa:permissions`
- Resultado: **PASS**

## Observacoes

- Foi iniciada validacao de `build:local:ios:simulator`, mas a execucao foi interrompida para nao bloquear a sessao em recompilacao pesada de Pods.
- O hardening de permissao foi validado no nivel de configuracao final do Expo (`expo config`), que e a fonte de verdade para prebuild nativo.

## Risco mitigado

- Reduzimos superficie de permissao sensivel (microfone) sem impacto funcional esperado para o produto atual.
