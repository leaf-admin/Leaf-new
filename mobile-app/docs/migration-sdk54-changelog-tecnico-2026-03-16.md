# Changelog tecnico - Migracao para Expo SDK 54

Data: 2026-03-16
Branch: codex/migracao-expo-sdk54-zero-debito

## Plataforma e runtime

- Upgrade de `expo` para linha SDK 54.
- Alinhamento de pacotes com `expo install --fix`.
- Projeto em RN `0.81.5` na matriz do SDK 54.

## Build e CI local (sem dependencia de EAS cloud)

- Consolidado fluxo local de build Android:
  - `build:local:android:debug`
  - `build:local:android:release`
  - `build:local:android:aab`
- Consolidado fluxo local de build iOS:
  - `build:local:ios:simulator`
  - `build:local:ios:archive`
  - `build:local:ios:ipa` (novo)
- Export iOS assinado validado localmente:
  - `ios/build/export-appstore/Leaf.ipa`
  - Team `DTA8W5KA5D`
  - build number `5`

## Assinatura iOS

- `DEVELOPMENT_TEAM` aplicado no projeto iOS.
- Ajustado fluxo para lidar com archive sem assinatura e export assinado.
- `env:local:doctor` atualizado para localizar provisioning profile em:
  - `~/Library/MobileDevice/Provisioning Profiles`
  - `~/Library/Developer/Xcode/UserData/Provisioning Profiles`

## Hardening de rede e runtime

- Android com cleartext global bloqueado no `main` e allowlist minima por host.
- Gate de runtime para bloquear endpoints locais indevidos (`qa:runtime:endpoints`).
- Reducao de fallbacks localhost em camadas de runtime criticas.

## Hardening de permissoes

- `expo-audio` configurado sem permissao de microfone/gravação.
- Removido `NSMicrophoneUsageDescription` do iOS.
- Novo gate `qa:permissions` para prevenir regressao de permissoes.

## Qualidade e validacao

- `expo-doctor`: checks da matriz SDK 54 em conformidade.
- QA automatizado local validado com `qa:run` e `qa:asserts`.
- E2E principal (Maestro stable) validado.
- Baseline de performance coletada (Android e iOS simulator).

## Pendencias para fechamento total

- Fase 6 completa em device real (Android e iOS) com evidencias ponta a ponta.
- Fase 7 crash-free em distribuicao interna com janela de observacao.
- Fase 8 com rollout gradual e criterio formal de rollback.
