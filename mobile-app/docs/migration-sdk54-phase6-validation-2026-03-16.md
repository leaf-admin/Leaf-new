# Fase 6 - Validacao funcional ponta a ponta (execucao parcial)

Data: 2026-03-16
Branch: codex/migracao-expo-sdk54-zero-debito

## Escopo executado nesta sessao

- Build Android local (release) + instalacao em emulador: OK.
- Execucao `qa:run` completa no Android emulator: PASS.
- Gate de endpoints de runtime (`qa:runtime:endpoints`) integrado ao `qa:run`: PASS.
- Build iOS local (simulator): OK.
- Smoke de abertura no iOS simulator (instalacao e launch do app): OK.
- Simulacao automatizada de corrida real via backend/websocket: OK.

## Evidencias

1. QA completo no Android emulator
- Comando: `REQUIRE_EXPO=false OPEN_APP=true SEED_TEST_USERS=true BACKEND_URL=http://147.182.204.181:3001 npm run qa:run`
- Artefatos:
  - `mobile-app/test-results/qa_run_20260316_175248`
  - `mobile-app/test-results/qa_run_20260316_180559`
  - `mobile-app/test-results/qa_run_20260316_183417`
  - `mobile-app/test-results/qa_run_20260316_184727`
  - `mobile-app/test-results/qa_run_20260316_185118`
- Resultado: `PASS`
- Indicadores:
  - Backend `/health`: true
  - Socket handshake: true
  - Corridas completadas: 1
  - Erros backend: 0
  - Taxa de sucesso: 100%
  - Logs criticos Android: 0

1.1 Hardening do pipeline de QA local
- Ajustes aplicados:
  - `qa-run.sh`: autodetecta `node/nodejs`, autodetecta `adb` em paths locais comuns e extrai `FIREBASE_API_KEY` de `google-services.json` quando ausente no ambiente.
  - `qa-asserts.sh`: passa a usar `NODE_BIN` para evitar falha de PATH.
  - Novo gate: `scripts/check-runtime-endpoints.sh` (bloqueia hardcode local em código de runtime monitorado).
- Evidencia:
  - `qa_run_20260316_184320`: falha inicial por `firebase_api_key_missing`.
  - Correcao aplicada e `qa_run_20260316_184727`: `PASS`.
  - Revalidacao sem `NODE_BIN` manual (`auto-detect`): `qa_run_20260316_185118` `PASS`.

2. Smoke iOS simulator
- Comando: `xcrun simctl install` + `xcrun simctl launch br.com.leaf.ride`
- Resultado: app iniciou no simulador (`PID` retornado).

3. Simulacao de corrida real (driver + passenger)
- Comando: `node scripts/qa-simulate-ride-flow.cjs --url http://147.182.204.181:3001 --out ...`
- Resultado: `ok: true`.
- Booking (ultima execucao): `booking_1773697908652_iDiAKrLjeDWbIOYFEqkHLS3JBGN2`.
- Duracao (ultima execucao): `82532 ms`.
- Etapas validadas:
  - signin_ok
  - websocket_auth_ok
  - booking_created
  - payment_confirmed
  - ride_accepted
  - trip_started
  - trip_completed

4. Build iOS simulator
- Comando: `npm run build:local:ios:simulator`
- Resultado: `BUILD SUCCEEDED`
- Output: `mobile-app/ios/build`

5. Build iOS archive (validação técnica sem assinatura)
- Comando: `xcodebuild ... archive CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`
- Resultado: `ARCHIVE SUCCEEDED`
- Artefato: `mobile-app/ios/build/Leaf-unsigned.xcarchive`

6. QA completo no Android fisico (USB)
- Device: `24117RN76L` (`serial: irsgaiscr4j7cenv`)
- Comando: `ANDROID_SERIAL=irsgaiscr4j7cenv ADB_BIN=$HOME/Android/Sdk/platform-tools/adb npm run qa:run`
- Artefato:
  - `mobile-app/test-results/qa_run_20260316_204510`
- Resultado: `PASS`

7. Regressao E2E Maestro no Android fisico (tentativa controlada)
- Comando: `ANDROID_SERIAL=irsgaiscr4j7cenv ADB_BIN=$HOME/Android/Sdk/platform-tools/adb npm run test:e2e:stable`
- Resultado: `FAIL` por bloqueio do SO Xiaomi na instalacao do app auxiliar do Maestro:
  - `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`
- Artefato:
  - `mobile-app/.maestro/results/stable_guarded_20260316_204756`
- Mitigacao definida:
  - manter `qa:run` + simulacao backend/websocket como automacao primaria;
  - executar Fase 6 em device real com checklist manual guiado e coleta automatica de evidencias:
    - `npm run qa:phase6:manual`
  - smoke do fallback executado com sucesso:
    - `mobile-app/test-results/phase6_manual_device_20260316_205330`

## Limites da validacao desta sessao

- Fluxo de UI real completo (passageiro e motorista) em dispositivo fisico segue pendente.
- Validacoes de notificacao push, upload de documentos e OTA em dispositivo real seguem pendentes.
- E2E Maestro em Xiaomi segue bloqueado por politica do fabricante (instalacao de helper app via ADB).

## Conclusao

- A trilha automatizada backend + websocket + ciclo de corrida passou em repeticao com gate de logs Android zerado.
- Android e iOS estao buildando localmente apos ajustes de compatibilidade.
- A Fase 6 segue aberta para fechamento manual guiado em device real (Android + iOS), sem dependencia de Maestro no Xiaomi.
