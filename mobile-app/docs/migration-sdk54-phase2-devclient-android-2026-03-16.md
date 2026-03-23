# Fase 2 - Validação Android dev-client (fluxo mínimo)

Data: 2026-03-16  
Branch: codex/migracao-expo-sdk54-zero-debito

## Objetivo

Validar execução mínima do app em build `debug` com `expo-dev-client` após migração para SDK 54.

## Execução

1. Build debug local:

```bash
npm run build:local:android:debug
```

Resultado: `BUILD SUCCESSFUL` e APK gerado em:
`mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`

2. Instalação e launch no emulator:

```bash
adb uninstall br.com.leaf.ride || true
adb install mobile-app/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n br.com.leaf.ride/.MainActivity
```

3. Verificação de saúde mínima:
- Processo ativo (`pidof br.com.leaf.ride`): OK.
- Atividade dev-client aberta: `expo.modules.devlauncher.launcher.DevLauncherActivity`.
- Sem crashes fatais no log (`FATAL EXCEPTION`, `TypeError`, `SIGABRT`, `No bundle URL present`).

## Evidência

- Log completo: `mobile-app/test-results/devclient_smoke_20260316_android.log`

## Observação

- Em build debug/dev-client sem Metro ativo, é esperado retry de websocket do dev support em `ws://10.0.2.2:8081`.
- Não houve crash fatal relacionado ao app durante a validação mínima.
