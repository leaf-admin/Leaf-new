# Fase 6 - Device real sem Maestro (Xiaomi)

Data: 2026-03-16  
Branch: codex/migracao-expo-sdk54-zero-debito

## Contexto

- Em Android Xiaomi, o Maestro foi bloqueado pelo SO ao instalar o helper app via ADB:
  - `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`
- Decisao: seguir com validacao de device real sem dependência de Maestro nesse aparelho.

## Estrategia

1. Manter automacao tecnica:
- `npm run qa:run` (backend, socket, simulacao de corrida, gate de logs).

2. Executar validacao manual guiada no device real com evidencias:
- `npm run qa:phase6:manual`

## Comandos recomendados

Sessao interativa (encerra quando pressionar Enter):

```bash
ANDROID_SERIAL=irsgaiscr4j7cenv \
ADB_BIN=$HOME/Android/Sdk/platform-tools/adb \
npm run qa:phase6:manual
```

Sessao temporizada de 15 minutos:

```bash
ANDROID_SERIAL=irsgaiscr4j7cenv \
ADB_BIN=$HOME/Android/Sdk/platform-tools/adb \
SESSION_SECONDS=900 \
npm run qa:phase6:manual
```

## Evidencias geradas automaticamente

- `test-results/phase6_manual_device_<timestamp>/android-logcat.txt`
- `test-results/phase6_manual_device_<timestamp>/critical-log-lines.txt`
- `test-results/phase6_manual_device_<timestamp>/backend-health.json`
- `test-results/phase6_manual_device_<timestamp>/meminfo.txt`
- `test-results/phase6_manual_device_<timestamp>/manual-checklist.md`
- `test-results/phase6_manual_device_<timestamp>/summary.md`
- `test-results/phase6_manual_device_<timestamp>/session.mp4` (se `RECORD_SCREEN=true`)

## Criterio de aceite da Fase 6 (sem Maestro no Xiaomi)

- Checklist manual completo em Android real.
- Checklist manual completo em iOS real.
- `qa:run` com PASS e sem log critico novo.
- Sem regressao critica em:
  - login/persistencia,
  - corrida ativa (motorista e passageiro),
  - localizacao foreground/background,
  - push e finalizacao/pagamento.

## Risco e mitigacao

- Risco: menor cobertura automatizada de UI no Xiaomi.
- Mitigacao:
  - manter automacao de backend/socket/corrida (`qa:run`);
  - aumentar disciplina de evidencia manual (video + logcat + checklist);
  - manter regressao E2E automatizada em emulador/device sem bloqueio de SO.
