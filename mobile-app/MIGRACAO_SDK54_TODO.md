# Migracao Expo SDK 54 - Checklist de Execucao

Data de inicio: 2026-03-16  
Branch de trabalho: `codex/migracao-expo-sdk54-zero-debito`  
Commit base (rollback): `a01b8f7`  
Tag de seguranca: `backup-pre-sdk54-20260316`

Objetivo: migrar de Expo SDK 52 para SDK 54, mantendo funcionamento geral do app e zerando debito tecnico relacionado a runtime, build e deprecacoes criticas.

## Regras da jornada

- [ ] Executar em passos pequenos e com validacao ao final de cada bloco.
- [ ] Nao avancar de fase com build quebrado.
- [ ] Registrar causa raiz e correcao de cada quebra relevante.
- [ ] Manter rollback rapido para o commit/tag base.
- [ ] Atualizar este checklist ao final de cada sessao.

## Fase 0 - Seguranca e baseline

- [x] Criar branch dedicada para migracao.
- [x] Criar tag de backup antes da migracao.
- [x] Confirmar que o workspace esta limpo antes de iniciar mudancas de dependencias.
- [x] Coletar baseline funcional do SDK 52.
- [x] Analisar logs das ultimas falhas EAS (Android/iOS) antes de novas execucoes.
- [x] Gerar baseline de build Android (dev/preview).
- [x] Gerar baseline de build iOS (dev/preview).
- [x] Consolidar baseline em um relatorio curto (`docs/migration-sdk54-baseline.md`).

## Fase 1 - Saneamento de debito tecnico pre-upgrade

- [x] Remover `overrides` globais de `react-native`/`metro` no root ou isolar para nao travar o mobile.
- [x] Corrigir dependencia faltante `expo-linear-gradient` ou remover imports nao usados.
- [x] Revisar `postinstall` (`scripts/fix-firebase-kotlin.js`) e remover chamada vazia.
- [x] Revisar plugins customizados e marcar quais sao realmente necessarios:
- [x] `withExpoModulesCoreFix` (necessario no SDK 52 pelo erro `components.release`; reavaliar remocao apos upgrade para 54)
- [x] `withGradleNodeFix` (necessario em monorepo para resolver `react-native` no `expo-dev-launcher`)
- [x] `withBoringSSLFix` (necessario no iOS/Xcode 26.2 para remover flags `-G*` em pods)
- [x] `withNetworkSecurityConfig` (necessario para trafego HTTP de homologacao/dev; revisar endurecimento na Fase 7)
- [x] Congelar imagens EAS para evitar variacao de ambiente (`latest` -> imagem explicita).
- [x] Rodar smoke de inicializacao apos saneamento.

## Fase 2 - Upgrade controlado SDK 52 -> SDK 53

- [x] Atualizar `expo` para SDK 53.
- [x] Rodar `expo install --fix` para alinhar pacotes suportados.
- [x] Atualizar `jest-expo` e `babel-preset-expo` para linha do SDK 53.
- [x] Validar `expo prebuild` sem erro (Android/iOS).
- [x] Corrigir quebras de compilacao.
- [x] Rodar app em Android (dev-client) e validar fluxo minimo (`docs/migration-sdk54-phase2-devclient-android-2026-03-16.md`).
- [x] Rodar app em iOS (dev-client) e validar fluxo minimo.
- [x] Registrar diff de dependencias e mudancas de codigo desta fase (`docs/migration-sdk53-phase2-2026-03-16.md`).

## Fase 3 - Upgrade controlado SDK 53 -> SDK 54

- [x] Atualizar `expo` para SDK 54.
- [x] Rodar `expo install --fix` para alinhar matriz oficial do SDK 54.
- [x] Atualizar novamente `jest-expo` e `babel-preset-expo` para linha do SDK 54.
- [x] Validar `expo prebuild` sem erro (Android/iOS).
- [x] Corrigir eventuais quebras de runtime e build.
- [x] Validar build Android (preview/internal).
- [x] Validar build iOS (preview/internal).

## Fase 4 - Limpeza de deprecacoes (zero debito tecnico)

- [x] Migrar uso de `expo-av` para `expo-audio`/`expo-video` quando aplicavel.
- [x] Enderecar APIs legadas de `expo-file-system` (migrar ou isolar em camada de compatibilidade).
- [x] Atualizar handler de notificacao para opcoes modernas de apresentacao no iOS.
- [x] Revisar warnings do `expo doctor` e zerar warnings bloqueantes.
- [x] Remover excecoes antigas de `reactNativeDirectoryCheck` que nao forem mais necessarias (removida excecao de `expo-av`).

## Fase 5 - Dependencias nativas fora da matriz Expo

- [x] Levantar status de versoes e risco das libs nativas criticas (`docs/migration-sdk54-phase5-risk-assessment-2026-03-16.md`).
- [x] Validar compatibilidade da suite `@react-native-firebase` com RN do SDK 54 (upgrade para `23.8.8` + prebuild Android/iOS OK).
- [x] Validar `@react-native-google-signin/google-signin`.
- [x] Validar `expo-text-recognition` (manutencao/compatibilidade real).
- [x] Atualizar `@gorhom/bottom-sheet` para linha compativel com `react-native-reanimated@4` (v5.2.8), eliminando crash de runtime no Android.
- [x] Validar libs nativas de maior risco:
- [x] `react-native-pdf`
- [x] `react-native-blob-util`
- [x] `react-native-elements`
- [x] `react-native-vector-icons`
- [x] `react-native-gifted-chat`
- [ ] Substituir ou atualizar bibliotecas sem manutencao comprovada.

## Fase 6 - Validacao funcional ponta a ponta

- [ ] Login e persistencia de sessao.
- [ ] Fluxo passageiro completo (origem -> corrida -> pagamento -> recibo).
- [ ] Fluxo motorista completo (online -> aceitar -> iniciar -> finalizar).
- [ ] Localizacao foreground/background.
- [ ] Push notifications (foreground, background, cold start).
- [ ] Upload de documentos (camera, galeria, PDF).
- [ ] Chat e websocket.
- [ ] Pagamentos e comprovantes.
- [ ] OTA (`expo-updates`) validado.
- [x] Executar validacao automatizada parcial (backend + websocket + corrida simulada) e registrar evidencias (`docs/migration-sdk54-phase6-validation-2026-03-16.md`).
- [x] Executar `qa:run` completo no Android emulator (app release instalado localmente) com gate de logs criticos em `0`.
- [ ] Executar validacao manual guiada em device real sem dependência de Maestro no Xiaomi (`docs/migration-sdk54-phase6-device-manual-no-maestro-2026-03-16.md`).

## Fase 7 - Hardening para producao

- [x] Rodar regressao E2E principal.
- [x] Auditar performance basica (tempo de abertura, uso de memoria, travamentos).
- [ ] Auditar crash-free em testes internos.
- [x] Revisar seguranca de permissao e network config (`docs/migration-sdk54-phase7-hardening-update-2026-03-16.md`).
- [x] Gerar changelog tecnico da migracao (`docs/migration-sdk54-changelog-tecnico-2026-03-16.md`).
- [x] Mapear riscos iniciais de hardening (rede/performance/logs) com recomendacoes (`docs/migration-sdk54-phase7-hardening-initial-2026-03-16.md`).

## Fase 8 - Go-live e rollback

- [ ] Publicar build interno final para QA/Stakeholders.
- [ ] Aprovar go-live com checklist de risco assinado.
- [ ] Publicar em producao de forma gradual.
- [ ] Monitorar 24-72h (crash, ANR, falhas de login, notificacao, localizacao).
- [ ] Definir criterio objetivo de rollback.
- [ ] Encerrar jornada com relatorio final.

## Criterios de conclusao (Definition of Done)

- [ ] Android e iOS buildando no SDK 54 sem workaround fragil.
- [ ] Fluxos criticos validados em dispositivo real.
- [ ] Sem deprecacoes criticas pendentes para SDK 55.
- [ ] Sem dependencia quebrada ou sem dono tecnico.
- [ ] Plano de rollback testado e documentado.

## Backlog de continuidade (proxima sessao)

- [x] Configurar assinatura local iOS (Development Team + provisioning) e validar export assinado local (`Leaf.ipa`) sem dependência de EAS cloud.
- [ ] Opcional: acompanhar builds EAS em fila (Android `9ff0a20e-b223-4c58-b3b1-815eb853bfad`, iOS `b97c9e79-8547-45c0-9b13-3f58a2d84915`) para comparativo com builds locais.
- [ ] Fechar validacao de device real na Fase 2/3 (fluxo minimo Android e iOS com dev-client).
- [ ] Concluir Fase 5 com validacao dirigida das libs nativas de risco e registrar decisao (manter, atualizar, substituir).
- [ ] Executar Fase 6 ponta a ponta com evidencias por fluxo critico (motorista, passageiro, notificacoes, localizacao, chat, pagamentos).
- [ ] Executar Fase 6 no Android fisico via `qa:phase6:manual` e repetir no iOS fisico.
- [ ] Executar Fase 7 com hardening (regressao, performance, crash-free, seguranca de permissao/rede).
- [x] Endurecer `network_security_config` para producao (sem cleartext global) e validar por ambiente.
- [x] Remover/limitar probes de localhost fora de dev-client para reduzir ruido de logs (fallbacks de runtime removidos + gate automatico `qa:runtime:endpoints`).
- [x] Preparar Fase 8 com plano de go-live gradual e criterio objetivo de rollback (`docs/migration-sdk54-phase8-go-live-gradual-2026-03-16.md`).
- [ ] Revalidar modelo de custo unitario de corrida considerando navegacao externa (Waze/Google Maps) + tracking continuo no app.

## Evidencias desta sessao (2026-03-16)

- Android local:
- `npm run build:local:android:release` OK (`app-release.apk`).
- `npm run build:local:android:aab` OK (`app-release.aab`).
- `npm run qa:run` PASS em `test-results/qa_run_20260316_175248` (health/socket OK, corrida simulada 100%, logs criticos Android = 0).
- `npm run qa:run` PASS em `test-results/qa_run_20260316_180559` apos hardening de `network_security_config` (logs criticos Android = 0).
- `npm run qa:run` PASS em `test-results/qa_run_20260316_183417` apos remover fallbacks localhost de runtime (logs criticos Android = 0).
- `npm run build:local:android:release` OK apos hardening de scripts locais (`NODE_BIN`/`ADB_BIN`).
- `npm run qa:run` PASS em `test-results/qa_run_20260316_184727` com gate de endpoints runtime ativo.
- `npm run qa:run` PASS em `test-results/qa_run_20260316_185118` validando auto-deteccao de `node`/`adb` sem env manual.
- `npm run build:local:android:debug` OK (dev-client).
- Smoke dev-client Android OK: app iniciou em `expo.modules.devlauncher.launcher.DevLauncherActivity`, PID ativo e sem logs fatais (`test-results/devclient_smoke_20260316_android.log`).
- `npm run test:e2e:stable` PASS (`.maestro/results/stable_guarded_20260316_185940`, 2 fluxos/0 falhas).
- `npm run qa:run` PASS no Android fisico (`irsgaiscr4j7cenv`) em `test-results/qa_run_20260316_204510`.
- `npm run test:e2e:stable` FAIL no Android fisico por bloqueio de instalacao do helper app do Maestro em Xiaomi (`INSTALL_FAILED_USER_RESTRICTED`) em `.maestro/results/stable_guarded_20260316_204756`.
- Mitigacao adotada: fallback oficial para Fase 6 sem Maestro no Xiaomi (`npm run qa:phase6:manual`) com runbook em `docs/migration-sdk54-phase6-device-manual-no-maestro-2026-03-16.md`.
- `npm run qa:phase6:manual` smoke no Android fisico em `test-results/phase6_manual_device_20260316_205330` (coleta de evidencias OK, `critical-log-lines=0`).
- Auditoria de performance basica Android (5 cold starts): media `2504ms`, min `2338ms`, max `2826ms` (`test-results/perf_android_startup_20260316.txt`).
- Auditoria de memoria Android: `TOTAL PSS 170104 KB` no cenário de smoke (`test-results/perf_android_startup_20260316.txt`).
- Auditoria de startup iOS simulator (5 launches): media `289ms`, min `223ms`, max `520ms` (`test-results/perf_ios_sim_startup_20260316.txt`).
- iOS local:
- `npm run build:local:ios:simulator` OK.
- `xcrun simctl install/launch` OK para `br.com.leaf.ride` (smoke de abertura).
- `xcodebuild ... archive CODE_SIGNING_ALLOWED=NO` OK (gerado `ios/build/Leaf-unsigned.xcarchive` para validacao tecnica de release sem credenciais Apple locais).
- `npm run build:local:ios:archive` atualizado para fallback automatico sem assinatura quando não houver identidade Apple local.
- `npm run build:local:ios:ipa` PASS (novo script para export assinado local, sem depender de plist manual em `/tmp`).
- `xcodebuild -exportArchive ... -allowProvisioningUpdates` OK com assinatura `Apple Distribution` (Team `DTA8W5KA5D`), gerando `ios/build/export-appstore/Leaf.ipa` (build `5`) e profile `iOS Team Store Provisioning Profile: br.com.leaf.ride`.
- Qualidade:
- `npx expo-doctor`: `17/17 checks passed`.
- `npm run env:local:doctor`: `15 checks OK, 0 alertas, 0 falharam` (checagem atualizada para profiles em `MobileDevice` e `Xcode/UserData`).
- `npm run qa:runtime:endpoints`: PASS (sem hardcode `localhost/127.0.0.1/10.0.2.2` em codigo de runtime monitorado).
- `npm run qa:permissions`: PASS (hardening de permissões: sem `NSMicrophoneUsageDescription` e sem `RECORD_AUDIO` na config final).
- Mobile Jest: `2 suites`, `3 testes`, tudo OK.
- Backend Jest (unit+integration): `9 suites`, `59 testes`, tudo OK.
- Fase 6 (automacao):
- Simulacao de corrida real: `ok: true` (booking criado, pagamento confirmado, corrida aceita/iniciada/finalizada).
- `qa-asserts`: `PASS` em `test-results/qa_manual_20260316_173624`.
- Fase 7 (hardening inicial):
- Baseline cold start iOS simulator: `0.48s`.
- Mitigacao aplicada: cleartext global removido no Android (`main` com `usesCleartextTraffic=false` e `base-config=false`, com allowlist minima por host).
- Mitigacao aplicada (parcial): removidos fallbacks `localhost` em `MapScreen` e `SyncService` para evitar chamadas locais fora de dev.
- Mitigacao aplicada: `qa-run`/`qa-asserts` endurecidos para ambiente local (detecção automatica de `node`/`adb` e chave Firebase via `google-services.json`).
- Runtime fix validado: upgrade de `@gorhom/bottom-sheet` removeu crash `TypeError: undefined is not a function` em auth flow (compatibilidade com Reanimated 4).
- Hardening de permissao de audio: `expo-audio` sem gravacao/microfone e gate automatizado `qa:permissions` (`docs/migration-sdk54-phase7-hardening-update-2026-03-16.md`).
- Playbook de execução da Fase 6 (simulador x device real x distribuição interna): `docs/migration-sdk54-phase6-execution-playbook-2026-03-16.md`.
- Plano de go-live gradual (soft release): `docs/migration-sdk54-phase8-go-live-gradual-2026-03-16.md`.
