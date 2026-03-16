# Fase 2 - Upgrade controlado SDK 52 -> 53

Data: 2026-03-16
Branch: codex/migracao-expo-sdk54-zero-debito

## Objetivo da fase

Atualizar para Expo SDK 53 com alinhamento de dependencias suportadas e prebuild valido em Android/iOS.

## Mudancas executadas

1. Expo e runtime base
- `expo`: `~52.0.49` -> `^53.0.0`
- `react`: `18.3.1` -> `19.0.0`
- `react-native`: `0.76.9` -> `0.79.6`

2. Alinhamento oficial (`expo install --fix`)
- Atualizados pacotes Expo para a matriz do SDK 53 (`expo-camera`, `expo-notifications`, `expo-updates`, etc.).
- Atualizados `babel-preset-expo` para `~13.0.0` e `jest-expo` para `~53.0.14`.

3. Correcao de quebra encontrada no iOS prebuild
- Falha inicial: plugin `@react-native-firebase/app` sem suporte ao AppDelegate Swift na serie antiga.
- Correcao: upgrade coordenado da suite RN Firebase para `23.8.8`:
  - `@react-native-firebase/app`
  - `@react-native-firebase/auth`
  - `@react-native-firebase/database`
  - `@react-native-firebase/firestore`
  - `@react-native-firebase/messaging`
  - `@react-native-firebase/storage`

4. Ajuste de workspace para resolver plugin hoisted
- Adicionado `expo@^53.0.27` em `devDependencies` do root para garantir resolucao de `expo/config-plugins` por plugins hoisted no monorepo.

## Validacoes da fase

- `expo-doctor`: 17/17 checks passed.
- `expo prebuild --platform android --no-install --clean`: sucesso.
- `expo prebuild --platform ios --no-install --clean`: sucesso.
- Smoke de inicializacao (`expo start --offline`): Metro subiu e ficou aguardando conexao.

## Observacoes tecnicas

- O plugin custom `withGradleNodeFix` nao encontrou mais o alvo antigo em `expo-dev-launcher/android/build.gradle` no SDK 53; isso indica mudanca do upstream e demanda reavaliacao do plugin na limpeza de debito (Fase 4).
- A validacao de execucao em dispositivo (Android/iOS dev-client com fluxo minimo) permanece pendente nesta fase.
