# Fase 7 - Hardening inicial (achados)

Data: 2026-03-16
Branch: codex/migracao-expo-sdk54-zero-debito

## Checks executados

1. Cold start baseline (iOS simulator)
- Comando: `time xcrun simctl launch br.com.leaf.ride`
- Resultado observado: `real 0.48s` (simulador, nao dispositivo real).

2. Log review rapido apos launch (iOS)
- Coletado via `log show` no processo `Leaf`.
- Achado: erros de conexao para `localhost` (`Connection refused`) em portas de dev (ex.: 8081/8082/8084/8085).
- Impacto: baixo em producao, mas gera ruido de log em ambiente de teste.

3. Gate de logs no Android (QA automatizado)
- Execucao: `npm run qa:run` com app release no emulator.
- Resultado: `Logs criticos Android: 0` (PASS).
- Observacao: crash anterior no auth flow foi removido apos upgrade de `@gorhom/bottom-sheet` para v5.2.8.

4. Revisao de seguranca de rede (Android)
- `AndroidManifest.xml` com:
  - `android:usesCleartextTraffic="false"` no `main`
  - `android:networkSecurityConfig="@xml/network_security_config"`
- `network_security_config.xml` por source set:
  - `main`: `base-config cleartextTrafficPermitted="false"` + allowlist HTTP explicita de hosts backend
  - `debug` e `debugOptimized`: allowlist HTTP para hosts de dev/homolog
- Revalidado com `npm run build:local:android:release` + `npm run qa:run`: PASS.

5. Revisao ATS/permissions (iOS)
- `Info.plist` contem chaves de localizacao foreground/background, camera, galeria e `UIBackgroundModes`.
- Sem crash bloqueante identificado neste recorte.

6. Hardening de pipeline QA local (ambiente sem PATH global)
- `qa-run.sh` atualizado para:
  - detectar `node/nodejs` automaticamente;
  - detectar `adb` em paths locais comuns (`$HOME/Android/Sdk`, etc.);
  - carregar `FIREBASE_API_KEY` automaticamente de `google-services.json` quando ausente no ambiente.
- `qa-asserts.sh` atualizado para usar `NODE_BIN`.
- Novo gate `qa:runtime:endpoints` incorporado ao `qa:run` para bloquear hardcode local em runtime.
- Revalidacao:
  - execucao intermediaria `qa_run_20260316_184320` falhou por `firebase_api_key_missing`;
  - apos ajuste, `qa_run_20260316_184727` passou com `Logs criticos Android: 0`;
  - revalidacao sem `NODE_BIN`/`ADB_BIN` manual: `qa_run_20260316_185118` tambem `PASS`.

7. Regressao E2E principal (Maestro)
- Maestro instalado localmente e validado com Java 17 local.
- Script `run-e2e-stable-guarded.sh` endurecido para autodeteccao de `adb` (mesmo padrão do `qa-run`).
- Execucao: `npm run test:e2e:stable`.
- Resultado: `PASS` (`.maestro/results/stable_guarded_20260316_185940`, 2 fluxos executados, 0 falhas).

8. Auditoria basica de performance (startup/memoria)
- Android (emulator, dev-client debug):
  - 5 cold starts via `adb am start -W`.
  - Resultado: media `2504ms`, min `2338ms`, max `2826ms`.
  - Memoria (dumpsys meminfo): `TOTAL PSS 170104 KB`.
  - Evidencia: `test-results/perf_android_startup_20260316.txt`.
- iOS (simulator):
  - 5 launches via `xcrun simctl launch`.
  - Resultado: media `289ms`, min `223ms`, max `520ms`.
  - Evidencia: `test-results/perf_ios_sim_startup_20260316.txt`.

## Riscos e recomendacoes

1. HTTP ainda permitido para hosts backend por IP em producao
- Risco: apesar do bloqueio global, manter HTTP para IPs especificos ainda nao oferece criptografia em transito.
- Acao recomendada: migrar backend para HTTPS (dominio + certificado), remover excecoes HTTP do `main` e manter HTTP apenas em `debug`.

2. Drift entre plugin e arquivos nativos gerados
- Risco: se o plugin nao for a fonte unica da verdade, um `expo prebuild` futuro pode reintroduzir politica permissiva.
- Acao recomendada: manter o hardening versionado no plugin (`withNetworkSecurityConfig`) e revalidar apos cada prebuild.

3. Ruido de conexao localhost no iOS
- Risco: mascara sinais relevantes de erro em QA.
- Acao aplicada (parcial): removidos fallbacks `localhost` no código de negócio (`MapScreen` geofence e `SyncService`), forçando backend público por padrão.
- Acao aplicada adicional: gate `qa:runtime:endpoints` para prevenir regressão de hardcode local em runtime monitorado.
- Acao pendente: reduzir probes de `expo-dev-client` em builds que não são dev-client (ruído de portas 808x/1900x observado em debug simulator).
- Revalidacao apos ajuste de fallbacks + gate: `npm run build:local:android:release` + `npm run qa:run` => `PASS` (`qa_run_20260316_185118`, logs criticos = 0).

4. Assinatura iOS ainda bloqueada sem dispositivo provisionado no Team
- Tentativa de archive assinado com `DEVELOPMENT_TEAM=DTA8W5KA5D` e `-allowProvisioningUpdates` falhou.
- Erros chave:
  - `Your team has no devices from which to generate a provisioning profile.`
  - `No profiles for 'br.com.leaf.ride' were found.`
- Mitigacao: conectar iPhone real no Team (ou cadastrar UDID no portal), gerar profile de Development e repetir archive assinado.

## Conclusao

- Hardening inicial executado e riscos principais mapeados.
- Validacao de estabilidade melhorou apos correcao de compatibilidade de runtime no Android (Bottom Sheet x Reanimated).
- Hardening de rede Android evoluiu de cleartext global para bloqueio por padrao com allowlist minima por ambiente.
- A Fase 7 ainda depende de regressao E2E principal, performance em dispositivo real e revisao final de seguranca por ambiente.
