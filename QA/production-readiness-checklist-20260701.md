# Checklist De Abertura Para Producao

Data: 2026-07-01
Produto: Leaf
Objetivo: decidir abertura controlada e depois abertura ampla em producao, sem regressao do ciclo de corrida.

## Estado Atual De Referencia

- Branch de trabalho: `codex/p0-p1-no-regression-hardening`
- OTA production publicada:
  - runtime: `1.0.4`
  - update group: `88335f5e-5e89-43fc-85aa-f93eb29970ec`
  - Android update ID: `019f1df3-4a03-732d-be7e-daf54f913cee`
  - iOS update ID: `019f1df3-4a03-7cfb-932d-d6ea84fc24e7`
- Condicao atual recomendada: GO apenas para producao assistida com cohort pequeno.
- Condicao para abertura ampla: todos os itens P0 abaixo fechados com evidencia.

## Regra De Decisao

- P0 aberto: NO-GO para abertura ampla.
- P1 aberto: permitido apenas em producao assistida se houver mitigacao documentada.
- P2 aberto: nao bloqueia producao, mas deve entrar no backlog de pos-lancamento.
- Qualquer divergencia financeira, tela vazia, regressao de estado de corrida, Pix sem despacho ou corrida sem rastreabilidade: P0 e pausa imediata.

## P0 - Release, Versionamento E Rastreabilidade

- [x] Worktree limpa ou dirty worktree completamente justificada em relatorio de release.
- [x] Commits atomicos criados para todo codigo/teste/config que entrou na RC.
- [x] Commit SHA da RC registrado.
- [x] Tag de release criada ou release candidate registrada com hash imutavel.
- [x] OTA group, runtime, canal e update IDs registrados em `QA/current-e2e` ou pasta de release.
- [ ] Builds instaladas nos devices conferidas contra runtime correto (`1.0.4`).
- [x] Rollback documentado: EAS rollback/republish do grupo anterior e responsavel definido.
- [x] Nenhuma mudanca de regra financeira, pagamento, taxa, split, pedagio, refund ou KYC sem aprovacao explicita.

Evidencia do congelamento: `QA/release-candidates/2026-07-07-rc1/manifest.md`.

## P0 - Baseline Tecnico Obrigatorio

- [x] `git diff --check`
- [x] `npm run governance:check`
- [x] `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`
- [x] `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`
- [x] `npm --prefix mobile-app run qa:production-guards`
- [x] `npm --prefix leaf-websocket-backend run config:validate`
- [x] `npm --prefix mobile-app run test:unit -- --runInBand leaf-native-navigation-banner.test.js leaf-native-navigation-engine.test.js driver-online-toggle.test.js`
- [x] `npm --prefix mobile-app run test:unit -- --runInBand prototype-ride-screens.test.js`
- [x] Backend unit direcionado executado se houver qualquer diff backend na RC.

Evidencia do bloco 2: `QA/release-candidates/2026-07-07-rc2/block-2-validation.md`.
Evidencia do bloco 3: `QA/release-candidates/2026-07-07-rc3/block-3-live-activities-push-validation.md`.

## P0 - Runtime, OTA E App Instalado

- [ ] Android real recebeu OTA production `1.0.4`.
- [ ] iOS real recebeu OTA production `1.0.4`.
- [x] App abre hidratado sem tela vazia.
- [x] Passageiro sem corrida ativa abre na home limpa.
- [x] Motorista sem corrida ativa abre na home limpa.
- [x] Estado pre-corrida nao persiste cotacao/pagamento expirado.
- [ ] Estado em corrida persiste corretamente ao fechar/reabrir.
- [x] Nenhuma tela fica apenas com mapa e rota sem card/acao.
- [x] Banner "Fora da rota" nao aparece na UI.
- [x] Banner superior oferece "Navegar com Waze ou Google Maps" quando aplicavel.
- [x] Hot link externo abre Waze/Google Maps/Apple Maps conforme plataforma.

Evidencia parcial do bloco Runtime/OTA em iOS fisico:
`qa-artifacts/runtime-ota/iphone-home-runtime-ota-20260708T191811Z.png`,
`qa-artifacts/runtime-ota/iphone-home-clean-after-rating-20260708T191929Z.png`,
`qa-artifacts/runtime-ota/iphone-home-clean-after-kill-relaunch-valid-20260708T192527Z.png`,
`qa-artifacts/runtime-ota/iphone-driver-home-clean-after-login-relaunch-valid-20260708T194615Z.png`.
Device iOS conferido com `Leaf / br.com.leaf.ride / 1.0.4 / build 30`.
Pendente: Android real e prova explicita de OTA production recebida.
Credencial de review motorista provisionada pelo script oficial
`leaf-websocket-backend/scripts/ops/provision-store-review-password-credentials.js`; login, kill e relaunch no iPhone fisico
mantiveram a home limpa do motorista offline, sem corrida ativa.
Validacao de pre-corrida expirada: passageiro review criou cotacao para `BarraShopping`, aguardou mais de 120s,
app foi encerrado e relancado no iPhone fisico; abriu na home limpa, sem categoria, preco ou Pix pendente.
Evidencia visual: `qa-artifacts/runtime-ota/iphone-passenger-home-clean-after-expired-prebooking-window-20260708T2002.png`.
Testes focados: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-runtime-session-sanitize.test.js`;
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/ride-payment-session-service.test.js __tests__/payment-service-quote-lock.test.js`;
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/woovi-payment-modal.test.js -t expired`.
Estado em corrida: testes automatizados confirmam preservacao de contexto ativo ao reabrir
(`npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-runtime-session-sanitize.test.js`;
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js -t 'keeps driver active trip visible'`;
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js -t 'keeps the started passenger trip compact'`;
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js -t 'hydrates accepted passenger vehicle'`).
Ainda pendente no iPhone fisico: tentativa sintetica falhou por ausencia de quote lock/canonical route
(`qa-artifacts/runtime-ota/active-ride-persistence-setup-2026-07-08T201227324Z.json`,
`qa-artifacts/runtime-ota/active-ride-persistence-setup-2026-07-08T201430678Z.json`) e a tentativa via app
gerou tela de Pix, mas `mobile-app/scripts/qa/simulate-latest-ride-payment.sh` nao encontrou um novo
`payment_intents` ativo para o passageiro dentro do timeout; log do motorista em
`qa-artifacts/runtime-ota/driver-dispatch-bot-active-persistence-20260708T2016.log`.
Contrato anti mapa-solto validado por testes: lifecycle surfaces exigem card/acao com `testID` concreto e
a trip sheet ativa nao pode fechar para um estado apenas com mapa/rota. Comandos:
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js -t 'keeps implemented ride surfaces covered by the card contract'`;
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js -t 'keeps the active passenger trip sheet from dismissing back to map-only state'`.
Banner "Fora da rota" removido da superficie atual de navegacao superior; quando o motor sinaliza
`isOffRoute`, o banner nao renderiza. Teste:
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/leaf-native-navigation-banner.test.js`.
Banner superior agora expoe acao discreta "Navegar" com label acessivel
"Navegar com Waze ou Google Maps" e reaproveita `openDriverExternalNavigation`.
Testes: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/leaf-native-navigation-banner.test.js`;
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/DriverExternalNavigationService.test.js`.
Hot link externo validado por plataforma: iOS oferece Apple Maps, Google Maps e Waze; Android oferece
Google Maps e Waze, sem Apple Maps. Teste:
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/DriverExternalNavigationService.test.js`.

## P0 - Backend, Socket E Pagamento

- [x] Backend produtivo esta no mesmo estado logico esperado pela RC.
- [x] Socket.IO produtivo ativo com Redis adapter obrigatorio.
- [x] Sem polling como mecanismo principal de estado de corrida.
- [x] Sem bypass de pagamento em producao.
- [x] Usuarios reais usam Woovi production.
- [x] Usuarios de teste usam Woovi sandbox por flag/user profile.
- [x] Webhook Woovi confirmado e validado.
- [x] Criacao de Pix falha de forma recuperavel, com retry controlado e sem tela vazia.
- [x] Pagamento confirmado dispara criacao/dispatch da corrida apenas uma vez.
- [x] Idempotencia garantida para charge, booking, dispatch, aceite, cancelamento, fim e recibo.
- [x] Se Pix expirar, app mostra alerta e retorna para home limpa de cotacao, sem reabrir modal expirado.

Evidencia Backend/Socket/Pagamento:
`npm --prefix leaf-websocket-backend run config:validate` passou com `ok=true`, `nodeEnv=production`,
`wooviEnv=production`, guards de pagamento obrigatorios ativos e bypasses de pagamento `false`.
`curl https://api.leaf.app.br/health/quick` retornou `status=healthy`, Redis dedicado saudavel e
`socketRedisAdapter.state=ready`, `enabled=true`, `required=true`, `runtimeRole=gateway`.
`curl https://api.leaf.app.br/health/runtime-flags` confirmou runtime production/gateway, Woovi production,
Firebase/maps configurados, Google direto no cliente desabilitado, `requirePaymentBeforeBooking=true`,
`verifyPaymentBeforeBooking=true`, `paymentBypassOnWooviFailure=false`, `paymentForceBypass=false`.
`npm --prefix leaf-websocket-backend run smoke:socket-health:public` passou contra
`https://socket.leaf.app.br`; artefato gerado em
`test-results/socket-health/socket-health-smoke-1783556674898.json`.
Estado principal de corrida usa Socket.IO websocket-only: `mobile-app/src/config/WebSocketConfig.js`,
`mobile-app/src/services/WebSocketManager.js` e `mobile-app/src/services/SocketService.js` usam
`transports: ["websocket"]`; smoke publico tambem conecta com websocket-only. Teste:
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/socket-service-transports.test.js`.
Runtime payment profiles por usuario: leitura default de `https://api.leaf.app.br/api/app/runtime-config`
registrada em `qa-artifacts/backend-payment/runtime-config-default-20260708T2125.json` mostra
`defaultEnvironment=production`, `effectiveProfile.profileId=env-default`, `globalSandboxEnabled=false`.
Canary do passageiro de teste `3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2` / telefone `21102938475` passou com
`effectiveEnvironment=sandbox`, `profileId=qa-test-users-sandbox-durable`, `contextMatched=true`.
Artefato: `qa-artifacts/backend-payment/runtime-config-test-passenger-20260708T2125.json`.
Webhook Woovi validado por config estrita (`WOOVI_WEBHOOK_REQUIRE_SIGNATURE=true`,
`WOOVI_WEBHOOK_ALLOW_UNSIGNED=false`, provider verification required) e teste focado:
`npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/routes/woovi-webhook-guards.unit.test.js`.
Falha recuperavel de criacao Pix validada: modal reexecuta erro transiente com a mesma sessao/ride/quote lock,
backend reusa o mesmo advance payment intent em retries e tela de falha mantem acoes visiveis.
Testes: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/woovi-payment-modal.test.js -t 'retries transient Pix creation failures'`;
`npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/payment-service.payment-status-cache.unit.test.js -t 'reuses the same advance payment intent on Pix charge retries'`;
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-payment-failed-screen.test.js`.
Dispatch pos-pagamento validado para nao duplicar busca ativa: `triggerDispatchAfterPayment` aciona
`startGradualSearch` no primeiro pagamento confirmado e retorna `SEARCH_ALREADY_ACTIVE` sem novo dispatch no replay.
Teste: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/payment-dispatch-service.unit.test.js`.
Idempotencia automatizada validada em camadas: base Redis/cache, chave canonica de createBooking por charge,
dispatch pos-pagamento, aceite legado sem broadcast global indevido, cancelamento/finalizacao com replay em socket,
rating replay e recibo backend-final. Testes:
`npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/idempotency-service.unit.test.js tests/unit/services/create-booking-idempotency-service.unit.test.js tests/unit/services/payment-dispatch-service.unit.test.js`;
`npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-lifecycle-idempotency.unit.test.js tests/unit/bootstrap/register-socket-rating-handler.unit.test.js tests/unit/bootstrap/register-socket-complete-trip-receipt.unit.test.js`;
`npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-driver-response-handler.unit.test.js`;
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js -t 'idempotent replay'`.
Pix expirado validado: modal mostra alerta de timeout apenas uma vez, nao reabre alerta stale apos fechar,
descarta cobranca Pix local expirada em vez de ressuscitar estado antigo e sanitizacao de runtime remove
artefatos pre-corrida expirados. Testes:
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/woovi-payment-modal.test.js -t 'shows the Pix timeout alert only once'`;
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/woovi-payment-modal.test.js -t 'does not show a stale Pix timeout alert after the modal closes'`;
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/woovi-payment-modal.test.js -t 'does not resurrect a locally expired persisted Pix charge'`;
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-runtime-session-sanitize.test.js`.
Evidencia visual complementar: `qa-artifacts/runtime-ota/iphone-passenger-home-clean-after-expired-prebooking-window-20260708T2002.png`.

## P0 - Motoristas, Geofence E Disponibilidade

- [x] Regiao piloto definida e documentada.
- [ ] Geofence ativa/expandida para a regiao do piloto.
- [x] Raio operacional de motorista elegivel confirmado: 5 km geografico.
- [x] Sem motorista elegivel antes do Pix bloqueia pagamento.
- [ ] Motorista tester/real com KYC valido, CNH/CRLV/liveness/face compare aprovados.
- [x] Motorista consegue ficar online sem tela "Bem vindo" reaparecendo.
- [x] Timer online cumulativo dentro da janela de 24h.
- [x] Ao atingir 12h online, motorista fica offline e recebe mensagem de limite diario.
- [x] Ao cancelar pelo passageiro antes do aceite, card some do motorista com estado "corrida cancelada".

Evidencia Motoristas/Geofence/Disponibilidade:
`bash scripts/validation/run-wave2-eligibility.sh --label production-readiness-p0-wave2` passou.
Artefatos: `reports/validation-runs/20260708_213456_production-readiness-p0-wave2/wave2/summary.md`,
`reports/validation-runs/20260708_213456_production-readiness-p0-wave2/wave2/mobile-wave2.log` e
`reports/validation-runs/20260708_213456_production-readiness-p0-wave2/wave2/backend-wave2.log`.
Runtime publico de cidades ativas: `curl https://api.leaf.app.br/api/geofence/cities/active`
retornou `Rio de Janeiro` e `Niteroi` ativos em `RJ`.
Gap mantido aberto: `curl https://api.leaf.app.br/api/geofence/check?lat=-22.9830&lng=-43.3659`
e `curl https://api.leaf.app.br/api/geofence/check?lat=-23.5505&lng=-46.6333` retornaram
`Geofence desativado (sem região configurada)`, portanto a cidade/regiao esta definida, mas a geofence
poligonal produtiva ainda precisa ser configurada/validada operacionalmente.
Raio 5 km e pool de motorista elegivel validados em
`npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/payment-driver-availability-guard.unit.test.js`;
o teste confirma `georadius(..., 5, 'km', ..., 'COUNT', 12)` e rejeita pool vazio com `NO_DRIVERS_AVAILABLE`.
Bloqueio antes do Pix validado em backend e mobile:
`npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/routes/payment-advance-availability.unit.test.js`;
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-payment-availability.test.js`.
Online do motorista, ausencia de regressao para "Bem vindo", timer diario e limite de 12h validados por:
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/driver-home-overlay.test.js __tests__/driver-online-toggle.test.js`;
`npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/driver-online-time-policy-service.unit.test.js tests/unit/bootstrap/register-socket-driver-heartbeat-handler.unit.test.js`.
Cancelamento antes do aceite validado por
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/driver-offer-state.test.js __tests__/driver-active-status-alerts.test.js`.
KYC real de motorista tester/real permanece aberto ate haver evidencia de provider/sessao real com
CNH/CRLV/liveness/face compare aprovados.

## P0 - E2E De Corrida Obrigatorio

- [x] Passageiro seleciona partida e destino.
- [x] Rota canonica renderiza uma vez, sem linha reta intermediaria.
- [x] Polyline usa segmentos de trafego quando disponiveis.
- [x] Categoria mostra preco canonico.
- [ ] Breakdown mostra tarifa base, adicional de embarque, pedagio quando houver, taxas e total.
- [x] Sem motorista elegivel: pagamento fica bloqueado antes do Pix.
- [x] Com motorista elegivel: Pix e criado em Woovi correto.
- [x] Pagamento confirmado.
- [ ] Passageiro entra em busca de motorista sem estado confuso "criando corrida".
- [ ] Motorista recebe offer card com passageiro, partida, destino, distancia, tempo, rota e valor liquido correto.
- [x] Motorista aceita.
- [ ] Passageiro ve motorista a caminho com rota ate embarque.
- [ ] Motorista ve rota ate embarque.
- [x] Chegada ao embarque nao exige codigo inexistente.
- [x] Inicio da corrida atualiza ambos os lados.
- [ ] Durante a corrida, rota aparece para passageiro e motorista.
- [ ] Camera de navegacao nao oscila zoom sem motivo.
- [ ] Passageiro nao consegue regredir estado tocando no mapa/bottomsheet.
- [ ] Motorista nao consegue regredir estado tocando no mapa/bottomsheet.
- [x] Corrida finaliza.
- [ ] Recibo do passageiro aparece com valor bruto correto.
- [ ] Recibo do motorista aparece com liquido correto.
- [x] Avaliacao funciona.
- [x] Apos avaliacao, app volta para home limpa.

Evidencia E2E/Fluxo Obrigatorio:
Evidencia automatizada de rota/UI: `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-map-route.test.js __tests__/prototype-route-viewport.test.js __tests__/prototype-map-layer-viewport.test.js`
passou com 28 testes; `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js`
passou com 155 testes cobrindo card contract, rota canonica, segmentos de trafego, protecao contra regressao por
mapa/sheet, busca, recibo, avaliacao e retorno para mapa.
Backend lifecycle completo validado por
`CONFIRM_SANDBOX_PAYMENT_VIA_APP=true node leaf-websocket-backend/scripts/tests/smoke-normal-ride-vps.cjs`.
O runner foi atualizado para pedir `/api/pricing/quote` antes do Pix, enviar `quoteSessionId/quoteLockId`,
geometria de rota e confirmar sandbox pelo endpoint app `/api/woovi/test-confirm-sandbox-payment-app`.
Rodada aprovada em `leaf-websocket-backend/reports/normal-ride-smoke-vps-1783561765338.json`, booking
`booking_1783561786944_OjML1wSzdNRaynjqMRlSW1Y0LVy2`: quote canonico `quoteLockId=ql_1976bcab2b7b63b3cd9a48d4468725b2`,
`estimatedFare=8.5`, `amountInCents=850`, `routeDistanceKm=1.31`, `routeDurationSecs=168`,
`driverAvailability.status=available`, `eligible=1`, Pix sandbox `chargeId=ed563c46b37847ea86284b94572d15b4`,
`paymentIntentId=advance_393649f0f7f76f545546f176dee60350`, oferta `newRideRequest`, aceite,
chegada ao embarque, inicio, finalizacao e avaliacao no mesmo `bookingId`. `completionPayload` usou o valor travado
`fare=8.5`, `distance=1.31`, `duration=168`; `fareBreakdown` final retornou `totalFare=8.5`, `tollFee=0`,
`operationalFee=0.79`, `paymentIntermediationFee=0.5`, `totalFees=1.29`, `driverNetAmount=7.21`,
`financialSnapshot.balanced=true`.
Observacao: antes da rodada aprovada, `leaf-websocket-backend/reports/normal-ride-smoke-vps-1783561550416.json`
limpou uma corrida de teste presa em `IN_PROGRESS` via `driver_complete_trip`; novas tentativas antes do TTL minimo
Woovi de 300s ainda retornaram `NO_DRIVERS_AVAILABLE`, como esperado para reserva pre-Pix ativa.
Mobile wave3 permanece bloqueada por ambiente:
`reports/validation-runs/20260708_213824_production-readiness-p0-wave3/wave3/mobile-lifecycle/stdout.log`
registrou `App not found in Release or Debug simulator build products`.
Validacao visual no iPhone via Espelhamento em 2026-07-08 23:07-23:10:
tela inicial abriu no app real, busca de destino aceitou `Barra`, autocomplete exibiu resultados e toque em
`Barra Shopping` abriu a tela de categoria com mapa/rota, card `Sua viagem`, selecao horizontal Plus/Elite/Moto,
valor grande por categoria e botao desabilitado `Sem motorista disponivel`. Evidencias locais:
`qa-artifacts/visual-device/iphone-mirroring-home-focused-20260708T230714.png` e
`qa-artifacts/visual-device/iphone-category-20260708T230946.png`.
Achados mantidos abertos: tela inicial ainda mostra `Partida/Destino`, seta no campo de destino e card
`Bem vindo(a) a Leaf`; busca ainda usa icones de pin genericos e permite bairro generico `Barra da Tijuca`;
erro dev/console apareceu durante a validacao (`Erro ao registrar token FCM via WebSocket: Register FCM token timeout`
e `[Axios] Timeout na requisicao`); o ciclo visual pos-confirmacao nao avancou porque o app real mostrou
`Sem motorista disponivel`.
Consistencia financeira/unitaria validada por
`npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-runtime-financial-snapshot.test.js __tests__/trip-financial-summary.test.js __tests__/driver-offer-pricing-snapshot.test.js __tests__/driver-receipt-screen.test.js`;
`npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/ride-financial-contract.unit.test.js tests/unit/utils/trip-completion-payload.unit.test.js tests/unit/commands/CompleteTripCommand.unit.test.js`;
`npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-update-location-handler.unit.test.js tests/unit/bootstrap/register-socket-create-booking-handler.unit.test.js tests/unit/bootstrap/register-socket-complete-trip-receipt.unit.test.js tests/unit/bootstrap/register-socket-rating-handler.unit.test.js`.

## P0 - Validacao De Integridade Transacional

- [ ] Valor da cotacao = valor do Pix = recibo passageiro.
- [ ] Valor liquido motorista = bruto - taxas aprovadas - pass-throughs aplicaveis.
- [ ] Pedagio aparece explicitamente quando rota passa por praca conhecida.
- [ ] Leaf fee usa politica aprovada, sem regra nova.
- [ ] Refund em cancelamento pos-pagamento e registrado e rastreavel.
- [ ] Dashboard Leaf mostra o mesmo bruto da corrida.
- [ ] Woovi mostra cobranca no ambiente correto.
- [ ] IDs registrados: quote, charge, booking, receipt, ledger/refund quando houver.

## P0 - Suporte, Dashboard E Operacao Assistida

- [ ] Dashboard mostra usuarios, motoristas, corridas, pagamentos e recibos corretamente.
- [ ] Operador consegue acompanhar corrida em tempo real.
- [ ] Suporte abre chamado com ride/payment/user context.
- [ ] Orquestrador de suporte classifica severidade.
- [ ] Chat em tempo real funciona em corrida ativa.
- [ ] Falha de chat mostra erro claro, nao tela vazia.
- [ ] Logs backend correlacionam sessao, booking, payment e socket.
- [ ] Woovi dashboard monitorado durante rodada assistida.
- [ ] Runbook de pausa: como parar convites, bloquear regiao, rollback OTA e acionar suporte.

## P0 - Seguranca, KYC E Compliance

- [ ] Politica de seguranca publicada e acessivel.
- [ ] Termos, privacidade, reembolso e exclusao de conta publicados.
- [ ] Usuario real nao acessa ferramentas de teste.
- [ ] Cliente mobile nao chama Google paid provider diretamente fora das APIs Leaf.
- [ ] Firebase/Google configurados sem warning critico.
- [ ] Warning de KYC biometrico estrito aceito formalmente ou resolvido antes de expansao ampla.
- [ ] Motorista sem KYC valido nao consegue ficar ativo.
- [ ] Nenhuma credencial ou segredo novo versionado.

## P1 - Experiencia E Polimento Para Escala

- [ ] Card de busca de motorista mostra valor, timer, partida e chegada com ETA.
- [ ] Preferencias da viagem em modal limpo, sem card confuso.
- [ ] Offer card do motorista nao usa labels genericos como "Local combinado" ou "Motorista".
- [ ] Live/dynamic island revisada para nao duplicar informacao inutil.
- [ ] Modal de falha de pagamento sem botao branco com texto branco.
- [ ] Mapa da tela "motorista a caminho" enquadra rota ate embarque.
- [ ] Placa, modelo e cor aparecem consistentes no app e recibo.
- [ ] Polyline e camera calibradas nos principais estados da corrida.

## P1 - Monitoramento E Limites Operacionais

- [ ] Alertas de erro de Pix, webhook, dispatch, socket disconnect e refund.
- [ ] Alertas de divergencia financeira.
- [ ] Alertas de tela vazia/estado invalido via eventos ou logs.
- [ ] Dashboard de motorista online e disponibilidade por regiao.
- [ ] Dashboard de funil: destino, quote, Pix, pagamento, busca, aceite, inicio, fim, avaliacao.
- [ ] Limite de motoristas online 12h/dia monitorado.

## Plano De Producao Assistida

- [ ] Cohort bilateral minimo: 1 passageiro real controlado.
- [ ] Cohort bilateral minimo: 1 motorista real/validado.
- [ ] Segundo motorista somente na rodada especifica de concorrencia de aceite ou redundancia operacional.
- [ ] 1 operador acompanhando dashboard, backend logs, Woovi e suporte.
- [ ] 1 rodada sem motorista elegivel para validar bloqueio pre-Pix.
- [ ] 1 rodada com cancelamento pelo passageiro antes do aceite.
- [ ] 1 rodada completa ponta a ponta.
- [ ] Evidencia coletada: screenshots, logs, IDs, valores, recibos e resultado financeiro.
- [ ] Janela de teste com rollback pronto.

## Gate Para Abertura Ampla

- [ ] 3 corridas reais assistidas completas sem P0.
- [ ] 1 cancelamento/refund assistido sem divergencia.
- [ ] 1 caso sem motorista bloqueado antes do Pix.
- [ ] 24h sem alerta critico de pagamento/socket/estado.
- [ ] Integridade transacional validada em 100% das corridas assistidas.
- [ ] Suporte apto a responder incidentes com contexto de corrida.
- [ ] Decisao final GO assinada por produto/operacao/engenharia.

## Decisao

- [ ] NO-GO
- [ ] GO para producao assistida
- [ ] GO para abertura ampla

Responsavel pela decisao:
Data/hora:
Observacoes:
