# Fase 3 - Upgrade controlado SDK 53 -> 54

Data: 2026-03-16
Branch: codex/migracao-expo-sdk54-zero-debito

## Objetivo da fase

Atualizar Expo SDK 53 para 54 com alinhamento de matriz oficial e estabilidade de runtime/build.

## Mudancas executadas

1. Base do SDK
- `expo`: `^53.0.0` -> `^54.0.0`
- `react`: `19.0.0` -> `19.1.0`
- `react-native`: `0.79.6` -> `0.81.5`

2. Alinhamento `expo install --fix` (SDK 54)
- Atualizados pacotes Expo da stack nativa (`expo-camera`, `expo-notifications`, `expo-updates`, etc.) para a faixa recomendada do SDK 54.
- Atualizados `babel-preset-expo` para `~54.0.10` e `jest-expo` para `~54.0.17`.

3. Correcao de quebras durante validacao
- `expo-doctor` (Metro config): ajuste em `metro.config.js` para remover import interno nao exportado (`metro-config/src/defaults/exclusionList`) e usar `blockList` por regex.
- `expo-doctor` (duplicidade de nativos): alinhado `expo` no root para 54 para evitar duplicidade entre workspace root e `mobile-app`.

4. Ambiente de build
- `eas.json` atualizado para pinagem Android `sdk-54` em todos os perfis Android utilizados.

## Validacoes da fase

- `expo-doctor`: 17/17 checks passed.
- `expo prebuild --platform android --no-install --clean`: sucesso.
- `expo prebuild --platform ios --no-install --clean`: sucesso.
- Smoke de runtime (`expo start --offline`): Metro iniciou sem erro.

## Pendencias apos esta fase

- Validar build remota Android SDK 54 (preview/internal).
- Validar build remota iOS SDK 54 (preview/internal).
- Validacao funcional em device/dev-client segue pendente para fases de validacao ponta a ponta.
