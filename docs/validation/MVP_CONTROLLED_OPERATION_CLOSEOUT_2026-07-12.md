# Leaf MVP Controlled Operation Closeout

Data de abertura: 2026-07-12
Branch: `codex/p0-p1-no-regression-hardening`
Meta: piloto controlado com ate 250 motoristas ativos por dia e ate 5.000 corridas por dia.

## Regra de aceite

Um item so pode ser marcado como `comprovado` quando a evidencia atual cobre o mesmo
escopo do requisito. Unitario nao substitui E2E, screenshot nao substitui transicao e
estado semeado nao substitui jornada integrada. Evidencia legado e invalida para o
produto atual.

Estados usados neste ledger:

- `comprovado`: requisito coberto por evidencia atual e proporcional ao risco;
- `em_correcao`: falha reproduzida e implementacao em andamento;
- `pendente_e2e`: codigo ou contrato existe, mas falta prova integrada atual;
- `bloqueado`: pre-condicao externa ou de produto impede prova honesta;
- `nao_atendido`: a superficie ou regra solicitada ainda nao existe no produto atual.

## Rodada visual candidata a aceite

- Run: `mobile-app/test-results/ux-lab/mvp-closeout-current-ios-sim-2026-07-12`
- Build: Debug iOS Simulator, gerada da arvore atual.
- Passageiro: iPhone 17 Pro, iOS 26.3, `9AB733E4-FCD7-456F-A02F-7AE7F1903566`.
- Motorista: iPhone 17e, iOS 26.3, `B4FA1BCF-8860-476F-AADF-40366A6C1F5F`.
- Inicio canonico: `leafapp://robotaxi/home`.
- Estados: 19/19 precisam de video, screenshot, observacao e teste logico correspondente.
- Estado atual: `18/19`; somente `payment_failed` segue sem falha integrada honesta.

## Status por requisito

| Area | Requisito | Status atual | Evidencia necessaria para aceite |
| --- | --- | --- | --- |
| UI/UX | Design consistente, uma acao dominante e secundarios progressivos | pendente_e2e | 19 estados atuais avaliados pela rubrica, sem P0/P1 aberto |
| Motion | Microinteracoes, animacoes e transicoes de estado | pendente_e2e | video continuo dos dois perfis e Reduced Motion |
| Lifecycle | Corrida completa passageiro e motorista | comprovado | duas corridas sandbox chegaram do Pix ao recibo atual; a repeticao terminal usou `booking_1783906524397_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2` sem seed intermediario |
| Mapa | Zoom, pan, fit, rota viaria, embarque e destino | pendente_e2e | video com gestos, GPS simulado e polyline canonica nos dois perfis |
| Tarifa | Calculo, quote lock e snapshot financeiro | comprovado | recibos atuais e runtime terminal preservaram snapshot backend autoritativo, bruto, taxas, liquido, distancia e duracao do mesmo booking |
| Pix | Pagamento sempre antecipado | comprovado | Pix sandbox foi criado, exibido, confirmado e somente entao abriu a busca/reserva em duas corridas integradas |
| Sandbox | Conta QA sem contaminar cobranca, ledger, saldo e metricas globais | parcial_bloqueado_lifecycle | contas e financeiro usam `qa-test-users-sandbox-durable`; chat/suporte estao isolados localmente, mas `rides` e `bookings` continuam colecoes globais, logo usuario sandbox ainda nao equivale a lifecycle totalmente isolado |
| Financeiro | Taxa Leaf, taxa Woovi, bruto, liquido e pedagio | pendente_e2e | mesmo `rideId` no provider, booking, ledger, recibos e dashboard |
| Chat | Entrega motorista-passageiro | corrigido_local_e2e_pendente_deploy | CURRENT usa `sandbox_chat_messages`, valida contexto selado e os dois participantes, e falha fechado sem classificacao; bateria integrada chat/tickets/sandbox passou `83/83`; falta deploy e evidencia bilateral real |
| Suporte | App abre ticket, dashboard responde, app le resposta | corrigido_local_e2e_pendente_deploy | CURRENT usa `sandbox_support_tickets`; dashboard exige `?scope=sandbox` e `support:sandbox`, sem fallback/eventos operacionais; `83/83` backend e contratos dashboard passaram; falta deploy e app-dashboard-app real |
| Rating | Motorista e passageiro avaliam uma vez | comprovado | passageiro e motorista enviaram avaliacao pelo recibo atual e receberam confirmacao do backend sandbox |
| Cancelamento | Politica e reembolso com taxa autoritativa | corrigido_local_e2e_pendente | backend ignora taxa do cliente, replay integral preserva o valor pago e UI separa Pix, reembolso e taxa; falta deploy e matriz integrada antes/depois do aceite/inicio |
| Interrupcao | Acidente ou pane com settlement seguro | comprovado | repeticao integrada nos dois apps confirmou telemetria, decisao, recibos, reembolso e liquido do motorista no mesmo booking |
| Cadastro | Cadastro completo dos dois perfis | corrigido_local_e2e_bloqueado | login/cadastro current possuem contratos locais aprovados; recovery OTP nao possui entrega real, a CNH inicial nao chega ao upload canonico e falta jornada integrada em aparelho |
| Aprovacao | Motorista enviado, revisado no dashboard e liberado | corrigido_local_e2e_pendente | revisao dashboard agora espelha o estado canonico e notifica o app localmente; ainda falta jornada app-dashboard-app sem seed direto de banco |
| Veiculos | Adicionar, excluir, trocar e selecionar | corrigido_local_e2e_pendente_deploy | CRUD current e guards passaram localmente; o runtime remoto ainda responde `404` em `/api/account/vehicles`, portanto falta app-backend-app real |
| Vehicle guard | Mesma placa em varias contas, online em apenas uma | corrigido_local_e2e_pendente | lease Redis por motorista/socket, transferencia no reconnect e desconexao antiga passaram localmente; falta integracao Redis remota |
| Perfil | Visualizar e editar dados atuais | comprovado | passageiro e motorista canonicos carregaram pela API; o passageiro salvou os mesmos dados no sandbox e o valor remoto reapareceu apos relaunch |
| Configuracoes | Somente acoes funcionais no piloto | comprovado_local_visual | controles sem consumidor foram retirados da UI; Privacidade, Sair, Excluir e Suporte permanecem current e a tela final foi validada no simulador |
| Historico | Historico canonico da conta | corrigido_local_e2e_pendente | listagem CURRENT agora le recibos persistidos no namespace financeiro resolvido, sem regenerar `bookings`; falta deploy e prova app-backend-app em novo relaunch |
| Menus | Todos os itens dos dois perfis | comprovado_simulador | inventario current/disabled/out_of_pilot passou em contrato; runners dedicados visitaram todos os destinos expostos no iPhone 17 Pro passageiro (1/1) e iPhone 17e motorista (1/1), sem mutacoes |
| Legado | Sem import, rota, deep link ou automacao no aceite atual | comprovado_local | manifesto current/compat/retired cobre as rotas; import e mirror RTDB de suporte agora sao opt-in locais, mas o runtime remoto ainda precisa receber e comprovar essa configuracao |
| Observabilidade | Health, readiness, socket, Redis, Firebase e trilha por corrida | bloqueado | readiness verde; scrape cobrindo todos os gateways/workers; dashboards e alertas exercitados; Firebase e trilha pelo mesmo `rideId` comprovadas sem confundir liveness com readiness |
| Capacidade | 250 motoristas ativos/dia e 5.000 corridas/dia | bloqueado | benchmark atual e reproduzivel, alinhado ao pico operacional, com artefato bruto, SHA/configuracao, SLOs, CPU, memoria, Redis, Firestore, workers e conexoes Socket.IO; evidencia atual e insuficiente |

## Bloqueadores P0 confirmados na abertura

1. O UX Lab ainda referenciava testIDs das telas standalone do motorista em vez do
   `DriverLiveRideOverlay` atual.
2. O suporte atual criava ticket, mas tentava abrir a rota legado `Support` para ler a
   resposta.
3. O CRUD de veiculos existe apenas em telas legado com acesso Firebase client-side.
4. Perfil e configuracoes atuais nao persistem; historico atual e somente local.
5. A taxa de cancelamento podia ser fornecida pelo cliente.
6. Quote e interrupcao ainda aceitam distancia/tempo declarados pelo cliente sem prova
   autoritativa suficiente.
7. O lock online por placa existe, mas o cadastro bloqueava compartilhar o mesmo veiculo
   entre contas, contrariando a regra do produto.
8. `/health/readiness` remoto esta degradado por `kycStrict`.
9. Nao existe artefato bruto atual que prove a meta de capacidade.
10. O primeiro ensaio foi interrompido por cautela antes do Pix; depois o usuario
    confirmou que as contas QA apontam para um ambiente sandbox isolado. O E2E foi
    retomado e concluiu duas corridas sem contaminacao da operacao real. O namespace
    financeiro sandbox adicional permanece como defesa em profundidade na arvore local.

## Evidencia integrada adicionada nesta rodada

- Corrida principal: `booking_1783904707108_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2`,
  passageiro com total de R$ 13,42, motorista com liquido de R$ 11,93, taxa Leaf e
  intermediacao de R$ 1,49 e pedagio de R$ 0,00.
- Repeticao terminal: `booking_1783906524397_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2`,
  total de R$ 17,69, liquido de R$ 16,20, taxas de R$ 1,49 e pedagio de R$ 0,00;
  recibo e avaliacao do motorista atuais comprovados sem `sessionTerminated`.
- Interrupcao operacional: `booking_1783907768062_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2`,
  pane do veiculo registrada com telemetria autoritativa, leg de 0,27 km/54 s,
  saldo reservado remanescente de R$ 16,85; o primeiro encerramento revelou e permitiu
  corrigir a reconciliacao mobile que misturava o Pix original com o settlement parcial.
- Repeticao da interrupcao: `booking_1783910326045_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2`,
  iniciada pela Home current e conduzida pela UI do motorista ate a pane. O recibo final
  preservou Pix original de R$ 13,42, reembolso estimado de R$ 12,24, valor final de
  R$ 1,18, taxas de R$ 1,18 e liquido do motorista de R$ 0,00.
- UX Lab: 18/19 estados observados; `no_drivers` e a interrupcao terminal passaram na
  repeticao integrada. Apenas `payment_failed` segue `not_run`: Pix-In sandbox oferece
  `ACTIVE`, `COMPLETED` e `EXPIRED`, mas nenhum gatilho deterministico de falha. A tela
  CURRENT representa principalmente erro de criacao da corrida depois do Pix confirmado;
  produzir isso exigiria falha/race controlada. O gate proibe contar deep link, mock,
  estado injetado ou `NO_DRIVERS_AVAILABLE` como E2E de falha de pagamento.
- A reauditoria para uma nova rodada local confirmou que `ride-persistence-service` grava
  a corrida em `rides` e que o pagamento/booking atualiza `bookings`, ambas globais. A
  classificacao sandbox protege provider e colecoes financeiras, mas nao transforma hoje
  toda a corrida em um namespace sandbox. Nenhuma nova corrida foi aberta depois desse
  achado.

## Auditoria de auth, onboarding e aprovacao - 2026-07-13

Status: **correcoes locais aprovadas; aceite E2E bloqueado/pendente**. A auditoria cobriu
somente o produto current e foi executada sem deploy, escrita remota, credencial de
producao ou mudanca de regra de negocio.

### Contrato current auditado

- A entrada publica canonica e `SplashScreen -> AuthFlow`. As rotas publicas antigas de
  login redirecionam para `Splash` e nao constituem evidencia separada de produto atual.
- Passageiro percorre telefone, OTP, selecao de perfil e dados pessoais. Motorista segue
  telefone, OTP, selecao, leitura da CNH, credenciais e e-mail.
- Perfil e papel sao persistidos por `PUT /api/account/profile`, autenticado por Firebase;
  aprovacao, documentos, KYC e veiculo nao podem ser promovidos pelo cliente.
- A ativacao do motorista usa `/api/drivers/me/activation/*`. O backend continua sendo a
  fonte de verdade para CNH, consentimento, veiculo, KYC, primeira liveness e permissao
  para ficar online.
- A revisao current do dashboard usa
  `POST /api/drivers/:driverId/documents/:documentType/review`. As mutacoes antigas de
  aprovacao integral permanecem desabilitadas.

### Correcoes locais aprovadas

- O valor do OTP nao e mais salvo no AsyncStorage nem no log de persistencia do
  onboarding.
- Reconstrucao e precedencia de perfis QA semeados agora exigem
  `allowTestUserTools()`. Uma identidade QA divergente nao substitui sessao Firebase
  real quando a flag esta desabilitada.
- Revisao manual de documento agora espelha atomicamente o resultado em
  `driver_activation`, recalcula a ativacao e emite `driverDocumentStatusUpdated` para
  o app. Aprovar somente o documento nao ignora veiculo, KYC ou liveness.
- `qa:production-guards` passou para `release-test`, `production`, `production-apk` e
  `production-review`; os bypasses de OTP de teste/review tambem estavam desabilitados
  no runtime publico consultado.

### Bloqueadores P0

1. Recovery de senha nao entrega o OTP. O endpoint gera e armazena o codigo no Redis,
   mas nao chama provedor de entrega; a UI informa "codigo enviado" sem evidencia de
   envio real. A correcao depende de provedor/configuracao externa aprovada.
2. `/health/readiness` permanece HTTP `503` por `kycStrict`. No runtime auditado,
   biometria de producao estava desabilitada e AWS liveness nao configurado. Liveness
   HTTP `200` nao comprova prontidao de KYC.

### Lacunas P1 e de evidencia

1. A CNH selecionada no cadastro inicial alimenta o OCR, mas o arquivo nao e submetido
   ao endpoint canonico de ativacao. O motorista precisa selecionar e enviar a CNH
   novamente depois do cadastro.
2. O E2E current canonico cobre apenas o smoke da home. Nao ha prova integrada atual de
   cadastro passageiro/motorista, recovery, upload documental, revisao dashboard,
   retorno ao app e KYC/liveness real.
3. `resolve-phone` e a diferenca das respostas de reset permitem inferir se um telefone
   esta cadastrado; os endpoints de resolucao/reset tambem precisam de rate limit
   especifico de auth/OTP.
4. A analise assincrona de documento ainda pode concorrer com uma revisao manual sem
   versao da submissao para impedir sobrescrita tardia.
5. O fallback custom OTP pode criar primeiro um perfil `customer` e conflitar com a
   imutabilidade de papel no cadastro de um novo motorista. O caminho principal de
   Firebase Phone Auth nao cria esse perfil default.

### Validacoes focadas

- Mobile auth/QA final: `5 suites / 21 testes` passaram; a rodada ampliada de
  auth/onboarding teve `8 suites / 39 testes` aprovados.
- Backend de auth, ativacao, dashboard e KYC: `9 suites / 75 testes` passaram.
- `npm run governance:check`, production guards, secret scan, hardcoded-secret guard,
  `node --check` e diff check do escopo passaram.
- `config:validate` local permaneceu bloqueado pelo perfil de lancamento `full` sem
  aprovacao ampla e por biometria de producao desabilitada; nao foi promovido a aceite.
- Nenhum E2E real foi executado porque recovery, KYC/provider, aparelho/sessao real e
  aprovacao dashboard integrada ainda nao atendem a regra de evidencia deste ledger.

## Auditoria de observabilidade e capacidade - 2026-07-13

Status: **P0 bloqueado**. Esta rodada foi read-only no runtime, sem deploy, escrita
remota, credenciais de producao ou chamada de API paga.

### Contratos atuais comprovados

- O runtime modular expoe `/health/liveness`, `/health/quick`, `/health/readiness` e
  `/health/runtime-flags` em `leaf-websocket-backend/routes/health.js`.
- Liveness prova apenas que o processo responde. Quick health cobre Redis e o estado do
  Socket.IO Redis Adapter. Readiness acrescenta dependencias obrigatorias por papel e
  deve ser o gate de trafego/aceite.
- Em `2026-07-13`, tanto `https://socket.leaf.app.br` quanto
  `https://api.leaf.app.br` responderam:
  - `/health/liveness`: HTTP `200`, `status=alive`;
  - `/health/quick`: HTTP `200`, Redis saudavel em `1-2 ms`, adapter
    `ready/enabled/required`;
  - `/health/readiness`: HTTP `503`, `status=not-ready`,
    `failedDependencies=["kycStrict"]`;
  - `/health/runtime-flags`: runtime `production`, Firebase configurado e Redis
    Adapter exigido; `realSandbox.ready=false` porque o runtime publico usa Woovi de
    producao, portanto esse campo nao substitui readiness.
- O scrape Prometheus publico permaneceu fechado: `/api/metrics/prometheus` respondeu
  HTTP `401` sem token/rede privada.
- O smoke publico leve, sem autenticacao e sem APIs pagas, passou com Redis Adapter
  pronto, reconexao valida, detector negativo de `Session ID unknown` e readiness
  multi-gateway. As `10/10` conexoes tiveram handshake medio de `930 ms`, p95/p99 de
  `965 ms`. Artefato:
  `test-results/socket-health/socket-health-smoke-1783912667712.json`.

### Metricas, alertas e lacunas P0

- O registry em `leaf-websocket-backend/utils/prometheus-metrics.js` define metricas de
  commands, eventos/listeners, Redis, corridas, hot paths, conexoes Socket.IO, event
  loop, workers, backlog, ride health e custo por corrida.
- As regras em `observability/prometheus/alert-rules.yml` cobrem processo down,
  CPU/memoria, erro/latencia Redis, falha de commands, Pix/FCM/geofence, backlog,
  listener lag, custo, workers, ride health e H3.
- A topologia ativa tem tres gateways atras de Nginx `least_conn` e workers separados,
  conforme `leaf-websocket-backend/docker-compose.gateway-scale.yml`,
  `leaf-websocket-backend/docker-compose.ops-workers.yml` e
  `leaf-websocket-backend/nginx.multi-gateway.conf`. Entretanto,
  `observability/prometheus/prometheus.yml` raspa somente
  `host.docker.internal:3001`. Assim, as series process-local nao representam o
  conjunto dos tres gateways e dos workers.
- `leaf_websocket_connections_current` e `leaf_event_loop_lag_*` possuem setters, mas
  nao ha chamada deles no runtime modular atual. Os alertas
  `High/CriticalWebSocketConnections` e `CriticalEventLoopLag` ficam sem sinal util.
- `leaf_workers_active`, `leaf_event_backlog` e `leaf_ride_health_stuck_total` sao
  atualizados em processos de worker, mas o target unico do gateway nao coleta esses
  registries. `NoActiveWorkers`, backlog e `RideHealthStuckDetected` nao constituem
  prova fim a fim da topologia ativa.
- Nao ha alerta Prometheus atual para readiness degradada, taxa de desconexao Socket.IO,
  p95 de `createBooking -> newRideRequest`, timeout de dispatch ou erro/latencia/quota
  de Firestore, embora esses sinais sejam necessarios para o SLO do piloto.
- `observability/grafana/dashboards/` contem apenas `.gitkeep`; os JSONs citados em
  `observability/README_DASHBOARDS.md` nao existem no checkout. O dashboard web possui
  uma pagina `/observability`, mas isso nao comprova provisionamento Grafana nem entrega
  externa de alerta.
- Continua faltando o teste de aceite obrigatorio descrito em `observability/README.md`:
  alerta critico sintetico avaliado pelo Prometheus, recebido pelo Alertmanager,
  entregue e reconhecido no canal externo mesmo com o receiver do backend indisponivel.

### Testes de carga existentes e limite da evidencia

- `leaf-websocket-backend/scripts/stress-test/no-paid-api-gateway-benchmark.cjs` mede
  health e handshake sem Firebase Auth, Woovi, Google ou criacao de corrida. Os
  artefatos locais de `2026-05-30` a `2026-06-06` ficam em
  `leaf-websocket-backend/reports/no-paid-api-gateway-benchmark-*.json`, sao ignorados
  pelo Git e nao provam o lifecycle nem a meta diaria.
- `leaf-websocket-backend/scripts/stress-test/sustained-active-rides-capacity.cjs`
  implementa o fluxo sustentado e
  `leaf-websocket-backend/scripts/tests/run-go-live-headroom-battery.cjs` define degraus
  de `250/300/350`, completion `>=99,5%`, p95/p99 de create/dispatch e timeout de
  dispatch `<0,5%`. Nenhum artefato bruto atual dessa bateria existe no checkout.
- `leaf-websocket-backend/docs/SOFT_RELEASE_RUNBOOK_ZONA_SUL_2026-04-09.md` relata
  ensaios de ate 250 corridas simultaneas, mas os tres JSONs referenciados nao existem
  em `leaf-websocket-backend/reports/`; os numeros historicos nao podem ser promovidos
  a evidencia atual.
- A meta de 5.000 corridas/dia equivale a media de aproximadamente `208,3/h` ou
  `3,47/min`, mas media diaria nao define pico, simultaneidade ou duracao de corrida.
  Falta aprovar o modelo de carga por hora, fator de pico e hold antes de executar a
  bateria. `250 motoristas ativos/dia` tambem nao e equivalente a `250 corridas ativas`
  simultaneas.

### Prova ainda obrigatoria para desbloquear

1. Corrigir a cobertura de scrape/agregacao para todos os gateways e workers e ligar
   as gauges hoje sem produtor no runtime.
2. Adicionar e validar os alertas dos SLOs do piloto, dashboards reais e teste sintetico
   de entrega/ack do canal externo.
3. Obter readiness HTTP `200` sem desabilitar o gate; qualquer excecao precisa de
   aprovacao formal e nao transforma liveness em readiness.
4. Aprovar o workload de 5.000 corridas/dia e executar a bateria em ambiente isolado,
   sem contaminar operacao real nem chamar providers pagos fora de sandbox.
5. Preservar no artefato bruto: commit SHA/configuracao, ramp/hold, concorrencia,
   sucesso/erro, p50/p95/p99 por etapa, conexoes/reconexoes, CPU e memoria por container,
   Redis latency/errors/memoria, Firestore reads/writes/quota, worker lag/DLQ e
   correlacao por `rideId`.

Validacoes focadas desta auditoria:

- `npm run observability:validate`: passou;
- `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime`: passou;
- `npm --prefix leaf-websocket-backend run check:runtime-parity`: passou, com `59`
  rotas HTTP e `123` eventos Socket.IO inventariados e nenhum contrato exclusivo do
  runtime VPS;
- unitarios focados de health/runtime flags/metricas Prometheus: `3 suites / 25 testes`
  passaram;
- `npm --prefix leaf-websocket-backend run smoke:socket-health:public`: passou.

## Gate de suporte antes do E2E remoto

- A arvore local desliga import e mirror RTDB de suporte por default; ambos exigem flag
  explicita com valor `true`.
- Tickets e mensagens agora sao serializados por papel. O proprietario recebe apenas o
  DTO publico, sem `adminNotes`, ownership operacional, `readBy`, `senderId` de agente ou
  mensagens `isInternal`; perfis autenticados de suporte preservam a visao completa.
- Eventos de ticket/chat nao usam mais broadcast global no namespace root. O dashboard
  recebe apenas no room `dashboard:authenticated` do namespace `/dashboard`, e o app
  apenas no room individual autenticado do proprietario.
- A tela `/support` local conecta ao namespace `/dashboard` e autentica com `jwtToken`,
  conforme o contrato do backend.
- Testes focados locais cobrem vazamento negativo, ownership cruzado, ausencia de
  broadcast global e opt-in legado. Nenhum deploy ou escrita remota foi feito.
- O namespace local foi formalizado como `sandbox_support_tickets`. Dashboard sandbox exige
  `?scope=sandbox` e permissao `support:sandbox`; nao usa chat legado, realtime operacional,
  auditoria ou orquestrador, e nao faz fallback para endpoints operacionais.
- Typo, sinais header/query conflitantes e scope do app divergente da classificacao
  autoritativa falham no backend antes de qualquer leitura/escrita. O E2E app-dashboard-app
  real continua pendente de deploy.

## Gate de chat antes do E2E remoto

- O motorista acessa o chat apenas pelas acoes expandidas do card current; o passageiro
  parte da corrida current. O retorno respeita o papel e nao reabre telas retiradas.
- O runtime reanexa listeners em socket novo/reconectado e faz catch-up da conversa ativa
  depois de `connect`, `reconnect` ou `authenticated`, sem reabrir corridas terminais.
- Remetente e destinatario agora sao derivados do papel autenticado. Estados terminais de
  encerramento antecipado e interrupcao operacional bloqueiam novas mensagens no backend.
- Chat CURRENT resolve a classificacao por `payment_runtime_profiles`, exige passageiro e
  motorista no mesmo contexto financeiro selado e persiste QA apenas em
  `sandbox_chat_messages`. Contexto ausente, divergente, adulterado ou lookup indisponivel
  bloqueia antes da escrita; `chat_messages` fica restrita ao namespace operacional.
- A bateria conjunta de chat/tickets/sandbox passou `10 suites / 83 testes`. O E2E bilateral
  remoto continua pendente de deploy; N0/legado, legacy socket bridge e criadores safety/KYC
  nao fazem parte desta garantia CURRENT.

## Correcao local do cancelamento

- A taxa continua exclusivamente autoritativa no `CancelRideCommand`; o payload do cliente
  nao consegue altera-la.
- Em repeticao idempotente de reembolso integral, `ALREADY_REFUNDED` agora recupera o total
  pago quando o provider nao repete o valor, evitando exibir R$ 0,00 indevidamente.
- O runtime preserva separadamente `originalPaidAmount`, `refundAmount` e
  `cancellationFee`; a tela terminal current apresenta esses valores em um resumo limpo.
- Testes focados de backend e mobile passaram. A prova integrada continua pendente porque
  a correcao de backend e local e nenhum deploy foi autorizado nesta rodada.

## Validacao current de conta, menus e waitlist

- O passageiro canonico carregou o perfil remoto, salvou novamente os mesmos dados no
  sandbox e recuperou o valor depois de terminar/reabrir o app. Evidencia visual:
  `mobile-app/test-results/ux-lab/mvp-closeout-current-ios-sim-2026-07-12/evidence/passenger/profile-current-sandbox-canonical-3teq.png`.
- O motorista persistido no iPhone 17e usa o UID QA historico `2w6...`; apos renovar apenas
  o ID token da mesma identidade, o perfil `Leaf Motorista Teste 2` carregou pela API.
  Evidencia: `evidence/driver/profile-current-sandbox-canonical-2w6.png` no mesmo run.
- Uma tentativa de aplicar ao iPhone 17e o token do UID `DV4...` foi recusada por
  `QA_UID_MISMATCH` antes de alterar a identidade persistida. O `ensure-users.json` e o
  simulador nao apontam hoje para o mesmo motorista QA; a automacao deve continuar usando
  a identidade persistida ou reinstalar/sementar explicitamente o app antes de trocar.
- Antes da introducao do guard, um token QA secundario `OjML...` chegou a ser usado para
  salvar um perfil de teste. Esse registro sandbox nao foi removido automaticamente; nao
  executar limpeza destrutiva sem aprovacao explicita.
- Configuracoes foi reduzida a quatro acoes current, sem badges repetidos ou toggles sem
  consumidor. Evidencia: `evidence/driver/settings-current-functional-only.png`.
- A Waitlist current removeu toda a copy de convites fora do piloto e trocou valores
  tecnicos como `ok` por `Ativa`, `Habilitada` e `Completos/Pendente`. Evidencia:
  `evidence/driver/waitlist-current-pilot-clean.png`.
- Veiculos current exibe erro limpo com uma unica acao de recuperacao, mas a API remota
  responde `404`; evidencia: `evidence/driver/vehicles-current-api-404.png`.
- Os menus CURRENT completos passaram em simuladores dedicados e autenticados: passageiro
  `menu-passenger-junit-rerun.xml` (`1/1`, 52 s) e motorista
  `menu-driver-junit-rerun4.xml` (`1/1`, 98 s). Os runners partem somente de
  `leafapp://robotaxi/home`, navegam pela UI e nao criam tickets, documentos, veiculos ou
  alteracoes de conta.

## Correcao local de historico e durabilidade de recibos

- `GET /api/receipts/user/:uid` deixou de consultar/regenerar a arvore RTDB `bookings` e
  agora pagina somente recibos persistidos em `receipts` ou `sandbox_receipts`, conforme o
  perfil financeiro efetivo do proprio usuario.
- Ownership de passageiro e motorista usa respectivamente `customer/id` e `driver/id`, com
  segunda validacao no DTO armazenado. Nao existe fallback entre namespaces; contexto
  operacional legado so permanece legivel dentro da colecao operacional.
- Falhas de escrita do recibo agora propagam `RECEIPT_PERSIST_FAILED` em vez de retornar
  sucesso parcial. O retry duravel permanece pendente: o outbox atual cobre snapshot final
  da corrida, nao recibo, e nao foi ampliado sem desenho/aceite para esse contrato.
- Testes focados locais cobrem namespace sandbox, bloqueio de cruzamento, ownership dos dois
  papeis, ordenacao/paginacao, DTO CURRENT e falha tipada. Nenhum deploy, backfill ou escrita
  remota foi executado.

## Escada de validacao final local - 2026-07-13

- Backend unit completo apos o isolamento de chat/suporte: `216 suites / 1.176 testes`
  aprovados.
- Mobile unit completo: `128 suites / 987 testes` aprovados e `1 suite / 1 teste`
  falhou. A falha monta `RobotaxiDriverTripScreen`, classificada no manifesto como componente
  legado/rota retired; o runtime CURRENT do motorista usa `DriverLiveRideOverlay`. O legado nao
  foi alterado para maquiar a bateria.
- Contratos focados adicionais desta iteracao: historico/namespace financeiro `31/31` e
  conta/menu/waitlist/configuracoes `37/37` aprovados.
- Contratos CURRENT de superficies/menu passaram `4 suites / 41 testes`; isolamento
  chat/tickets/sandbox passou `10 suites / 83 testes`; contratos realtime/sandbox do
  dashboard passaram.
- `qa:production-guards`, `governance:check`, secret scan, hardcoded-secret guard e
  `git diff --check` passaram.
- `config:validate` permaneceu vermelho por configuracao existente: perfil de lancamento
  `full` sem `LEAF_BROAD_LAUNCH_APPROVED=true`; tambem reportou biometria de producao
  desabilitada. Nenhuma flag foi afrouxada para fazer o comando passar.

## Gates obrigatorios antes do aceite final

1. Nenhum P0 ou P1 aberto na jornada principal.
2. `19/19` estados visuais cobertos e relatório do UX Lab sem erro de validação.
3. Corrida integrada nos dois perfis sem deep link intermediario ou seed de estado.
4. Pix sandbox confirmado pelo perfil QA antes de criar a reserva.
5. Reconciliacao financeira completa do mesmo `rideId`.
6. Chat da corrida, suporte/dashboard e rating comprovados nos dois sentidos.
7. Cadastro, aprovacao e veiculos comprovados sem telas legado.
8. Todos os itens de menu visitados e classificados como current, disabled ou fora do piloto.
9. Readiness verde ou excecao formalmente aprovada; liveness nao substitui readiness.
10. Benchmark reproduzivel para a meta operacional, com latencia, erro, CPU, memoria,
    Redis, Firestore e conexoes Socket.IO registrados.
