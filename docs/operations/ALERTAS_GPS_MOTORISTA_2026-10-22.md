# Alertas de GPS do motorista durante corrida: o que existe, por que nada alertou e regra proposta

Data: 2026-10-22
Branch: feat/driver-passenger-wave (worktree /Users/izaakdias/Documents/leaf-wave)
Tipo: investigação somente leitura. Nenhum código, configuração ou servidor foi alterado. Único arquivo escrito: este.

## Objetivo

Entender por que, no teste de 2026-10-22, o motorista ficou até 4 min 22 s sem enviar GPS durante corrida em andamento (às vezes aparecendo offline) sem que Sentry nem PostHog alertassem, e definir a regra que deveria existir.

## Escopo concluído

- Mapeamento com `rg` de detecção e alerta no backend (`leaf-websocket-backend`) e no app (`mobile-app`).
- Leitura da configuração de Sentry e PostHog (código e docs).
- Consulta de leitura (somente GET) às APIs do Sentry e do PostHog, com as chaves de `~/.leaf-secrets/observability.env`. Nenhum valor de chave foi copiado para este relatório.

## Fora de escopo (não tocado)

- Edição de código, commit, deploy, SSH ou qualquer escrita em servidor.
- Criação, alteração ou remoção de regras, alertas, insights ou eventos no Sentry e no PostHog.
- Leitura do canal Discord de alertas (não acessível por esta investigação). Ver "Verificações pendentes".
- Logs do aparelho do motorista e logs do Santiago do dia 22 (não coletados; ver pendências).

## Arquivos alterados

- Criado: `/Users/izaakdias/Documents/leaf-wave/docs/operations/ALERTAS_GPS_MOTORISTA_2026-10-22.md` (este arquivo).

## Testes executados

- Nenhum teste automatizado. Tarefa somente leitura; os comandos de validação do AGENTS.md não se aplicam a um relatório.
- Chamadas GET às APIs de Sentry e PostHog (resultados na seção "Evidência externa").

---

## 1. O que existe hoje

### 1.1 Backend

| Mecanismo | Onde | O que faz | Limitação para este caso |
|---|---|---|---|
| Heartbeat do motorista (socket `driverHeartbeat`) | `leaf-websocket-backend/bootstrap/register-socket-driver-heartbeat-handler.js:53-68` | Renova `socket.lastHeartbeat`, presença e lease de corrida a cada ping | Só prova que o socket está vivo. Não prova que o GPS está atualizando. |
| Posição do motorista como heartbeat | `leaf-websocket-backend/bootstrap/register-socket-update-location-handler.js:290-294` | Toda posição válida também renova `lastHeartbeat` | Mesma limitação: "chegou pacote" conta como "vivo". |
| Carimbo de tempo da posição | `register-socket-update-location-handler.js:626-627`, `:688`; `mobile-app/src/services/WebSocketManager.js:4615-4622` | O app envia `timestamp: Date.now()` no momento do emit. O servidor usa esse valor como `capturedAt`. | O horário é o do envio, não o da leitura do GPS. Coordenada congelada com envio periódico parece fresca. |
| Índice de sinal do motorista por corrida | `leaf-websocket-backend/services/ride-health-monitor.js:7` (chave `ride_health:driver_signal_active`), `:291-303` (`syncDriverSignalForRide`), chamado em `register-socket-update-location-handler.js:839-848` | Guarda o último horário de posição aceita de cada corrida ativa | Só é atualizado quando a posição chega com `activeTripId` e depois das validações da própria rotina. Se o pacote nem chega, o índice só envelhece. |
| Alerta "motorista sem sinal em corrida ativa" | `ride-health-monitor.js:13-14` (90 s, 3 corridas para crítico), `:442-464` (`buildDriverSignalAlert`), `:516-550` (`evaluateRideOperationsAlerts`, envia por `alertClient.sendAlert`) | Única regra existente para este caso. Gera `driver_signal_stale`, severidade `warning` ou `critical` | Ver 1.4: entrega só pelo Discord, com cooldown global. |
| Worker que roda a regra | `leaf-websocket-backend/workers/ride-health-monitor-worker.js:10` (intervalo padrão 60 s), `:17` (`ENABLE_RIDE_HEALTH_MONITOR_WORKER`, padrão `false` no código, `true` no compose de ops), `:159` (`setInterval`), `:40-` (ciclo com líder) | Executa a avaliação a cada ciclo | Ativo somente se o container estiver no ar no host de produção. `docker-compose.santiago.yml:52-53` coloca o serviço no profile `primary`; `docker-compose.ops-workers.yml:213-214` define o padrão. Não verificado no Santiago. |
| Envio do alerta | `leaf-websocket-backend/services/alert-service.js:14-15` (webhooks), `:32` (cooldown de `ALERT_COOLDOWN_MINUTES`, padrão 30), `:45-60` (chave de cooldown `service_metric_severity`), `:136-141` (`sendToDiscord`) | Envia para Slack, Discord, e-mail, dashboard e log, se estiverem configurados | Não envia para Sentry, PostHog nem para o bot-event-service. |
| Queda de conexão (offline) | `leaf-websocket-backend/services/connection-cleanup-service.js:31-33` (varredura a cada 60 s, timeout de 120 s sem heartbeat), `:139-200` (fecha a sessão online com `STALE_HEARTBEAT` e emite `driverStatusUpdated` só para o socket do motorista) | Tira o motorista do ar após 2 min sem pacote | Não verifica corrida ativa e não gera alerta, log de alerta nem evento para bot. |
| Heartbeat de cobrança (offline) | `leaf-websocket-backend/services/heartbeat-service.js:7` (65 s), `leaf-websocket-backend/commands/CompleteTripCommand.js:104-114`, `:481-482` | Conta tempo offline para ajuste financeiro (`DRIVER_OFFLINE_DURING_ACTIVE_RIDE`) | É cálculo financeiro, não alerta. Não mexer sem aprovação (regra de negócio). |
| Sinal de salto de localização e GPS simulado | `leaf-websocket-backend/services/safety-signal-service.js:22-26` (tipos `location_jump`, `mock_location`, `kyc_biometric_rejected`), `:130-139` (evento `safety.signal`), `leaf-websocket-backend/services/trip-location-persistence-service.js:12`, `:459` | Registra e avisa o bot de Segurança | Não cobre ausência de posição nem buracos no stream. |
| Eventos para bots | `leaf-websocket-backend/services/bot-event-service.js:31-43` (`ROUTES`) | Entrega eventos aos agentes OpenBot | Não há nenhum tipo de evento de GPS ou de motorista offline. `BOT_EVENTS_ENABLED=false` por padrão (`leaf-websocket-backend/config/observability-alerting.env.example`). |
| Sentry no backend | `leaf-websocket-backend/utils/logger.js:185-200` (transporte Sentry para `level: 'error'`), `leaf-websocket-backend/utils/sentry.js:115-121` (`captureException` e `captureMessage`) | Erros viram issues no Sentry | Não há chamada de `captureMessage` com regra de GPS. Só entra quem for `logError`. |
| Repasse Sentry e UptimeRobot para bots | `leaf-websocket-backend/services/external-alert-relay-service.js:1-12`, `:91` (`sentry.issue_alert` para `operacao`) | Quando existe regra de alerta no Sentry, ela chega ao bot Operação | Depende de uma regra criada no console do Sentry. Ver 3.1. |
| Trilha `trip_location_events` | `leaf-websocket-backend/bootstrap/register-socket-update-location-handler.js:67`, `:900`, `:934`, `:947`; `leaf-websocket-backend/workers/worker-trip-location.js:5-32` | Stream e persistência de rota em chunks | Não há detecção de buraco (gap) nem de sequência faltando. `rg` por "gap" e "missing seq" em `trip-location-persistence-service` e no worker não encontrou nada. O health check do worker (`docker-compose.ops-workers.yml:89`) só confirma que o worker está vivo. |

### 1.2 App (mobile-app)

| Mecanismo | Onde | O que faz | Limitação |
|---|---|---|---|
| Envio periódico do motorista | `mobile-app/src/screens/prototype/prototypeRideRuntime.js:164` (5 s), `:18441-18465` (`pushDriverLocationNow`), `:18497-18508` (`setInterval`) | Envia a posição a cada 5 s | Envia `driverCoordinate` em cache (`getDriverLocationPayload`, `:18441`-), sem `capturedAt`. Se o GPS não atualizar, a coordenada repetida é enviada com horário novo. |
| Erro do envio periódico | `prototypeRideRuntime.js:18497-18508` (`catch` só grava `driverLocationHeartbeat.lastError` no estado) | Não há telemetria | Falha de envio fica invisível para Sentry e PostHog. |
| Watchdog de "sinal do motorista" | `prototypeRideRuntime.js:168-177` (30 s e verificação a cada 10 s), `:20696` (cálculo de `stale`), `mobile-app/src/screens/prototype/RobotaxiTripScreen.js:630`, `:747-763` | Mostra a idade do sinal na UI | É só visual. Não envia evento nem alerta. |
| Buffer de posição em segundo plano | `mobile-app/src/services/LocationBufferService.js:12` (presença a cada 5 s), `:296-310` (`sendDriverPresenceFromBackground`) | Envia presença em background | Se o socket não está conectado, retorna `socket_unavailable` sem bufferizar (`:306-309`). Essa posição não é guardada. |
| Falha no buffer de background | `mobile-app/src/services/BackgroundLocationService.js:41-42` | Só `Logger.warn` | Sem telemetria. |
| Observabilidade do app | `mobile-app/src/services/observability/AppObservability.js:20-21` (chaves), `:106-109` (`track`), `:140-142` (`captureError`) | Sentry e PostHog no app | `captureError` não tem nenhum chamador em `src/`. `track` só é usado em `mobile-app/src/components/auth/AuthFlow.js:231`, `:285`, `:574`, `:678` (cadastro e login). Nenhum evento de corrida ou de GPS. |

### 1.3 Documentação e regras existentes

- `docs/operations/LEAF_SAFETY_PLAYBOOK.md:26-27`: documenta `location_jump` e `mock_location`. Linha `:96` diz que o GPS simulado só é observado com corrida ativa.
- `docs/operations/BOT_EVENTS_RUNBOOK.md:41`: lista `safety.signal` (salto, GPS simulado, KYC). Não lista evento de GPS silencioso.
- `docs/observability/ride-cost-and-earnings.md`: custo e ganho, sem alerta de GPS.
- `leaf-websocket-backend/config/observability-alerting.env.example`: variáveis de Discord, Sentry, PostHog, bots e `SAFETY_JUMP_*`. Não há variável de limiar de GPS silencioso; o limiar de 90 s vem de `RIDE_HEALTH_DRIVER_SIGNAL_STALE_MS`.

### 1.4 Resumo do que existe para os quatro pontos da pergunta

| Condição | Detecção existe? | Canal de alerta | Observação |
|---|---|---|---|
| Motorista sem posição durante corrida ativa | Sim, parcial: `driver_signal_stale` com 90 s (`ride-health-monitor.js:13`, `:442`) | Só Discord (via `alert-service`), com cooldown global de 30 min | Depende de worker ativo e de webhook configurado. Não chega a Sentry, PostHog nem bot. |
| Motorista cai offline durante corrida | Parcial: `connection-cleanup` fecha a sessão em 120 s (`connection-cleanup-service.js:33`) | Nenhum | Silencioso. Só o motorista recebe `driverStatusUpdated`. |
| Buracos no stream `trip_location_events` | Não | Nenhum | Só há `location_jump` (salto) e `mock_location`. |
| Heartbeats | Sim, mas sem alerta | Nenhum | `heartbeat-service` alimenta cobrança; `ConnectionCleanup` derruba conexão. |

---

## 2. Por que nada alertou

Causas prováveis, em ordem de confiança. Nenhuma foi confirmada com logs do dia 22 (não coletados). Cada uma tem uma verificação indicada.

1. **O único alerta de GPS é do Discord e depende de três coisas.** O worker `ride-health-monitor-worker` precisa estar rodando no Santiago (profile `primary`, `docker-compose.santiago.yml:52-53`), `ENABLE_RIDE_HEALTH_MONITOR_WORKER` precisa estar `true`, e `DISCORD_ALERT_WEBHOOK_URL` precisa estar no ambiente do container. Nenhuma das três foi verificada no host. Verificação: ver seção 5, item 1.
2. **Cooldown global, não por corrida.** `alert-service.js:45-60` usa a chave `ride-health-monitor_driver_signal_stale_warning` (sem `bookingId`). Se outro alerta do mesmo tipo saiu nos últimos 30 min (`ALERT_COOLDOWN_MINUTES`, `:32`), o próximo é suprimido em silêncio (log `debug`). Um teste com mais de uma corrida ou um alerta recente pode ficar mudo.
3. **Alerta de "offline com corrida" não existe.** Quando o pacote para, `connection-cleanup-service.js:139-200` fecha a sessão online em 120 s e não gera nenhum alerta. Por isso o caso "aparecia offline" não tem canal. O motorista só recebe a mensagem `driverStatusUpdated` no próprio socket, que não chega se a conexão caiu.
4. **Sentry e PostHog não recebem nada dessa condição.** Sentry só recebe o que for `logError` (`logger.js:185-200`). Não há `captureMessage` de GPS. PostHog não tem nenhum cliente no backend, e no app não há evento de corrida. Ver seção 3.
5. **Heartbeat "com vida" mascara GPS parado.** A posição em cache é reenviada a cada 5 s (`prototypeRideRuntime.js:18441-18465`) e o servidor usa o horário do envio (`WebSocketManager.js:4622`, `register-socket-update-location-handler.js:688`). Um GPS travado com envio periódico parece saudável para o servidor. O alerta de 90 s só dispara quando não há pacote algum. Esse é um ponto de falha de detecção, não só de canal.
6. **Falha no app é silenciosa.** `prototypeRideRuntime.js:18497-18508` e `LocationBufferService.js:306-309` engolem erro ou retorno sem telemetria. Em background, sem socket, a posição é descartada sem registro.
7. **Possível causa do sumiço em si (hipótese, não confirmada):** em segundo plano o JavaScript do app pode ser suspenso. Nesse caso o `setInterval` de 5 s para, e a presença de background (`LocationBufferService.js:296-310`) só envia se o socket estiver autenticado. Isso explica "sem GPS por minutos" e "offline" depois de 120 s (`connection-cleanup`). Precisa de log do aparelho para confirmar.

---

## 3. Evidência externa (somente leitura)

Chamadas feitas somente com GET, usando as chaves de `~/.leaf-secrets/observability.env` (nomes: `SENTRY_READ_TOKEN`, `POSTHOG_PERSONAL_API_KEY`). Nenhum valor foi impresso ou gravado.

**Sentry** (organização `freedom-tecnologia-e-servicos`, projetos `leaf-backend` e `leaf-mobile`):
- Autenticação com o token de leitura: 200.
- Issues não resolvidas nos últimos 14 dias, backend: 5. Títulos: "Transição de estado inválida: refunded → distributed" (22 ocorrências); "Erro ao enviar notificação FCM" (45); "Erro ao calcular lag" (11, último em 2026-10-21, a verificar se é de localização); "AUDITORIA ERROR: rejectRide"; "Erro ao enviar notificação FCM interativa" (7). Nenhum sobre GPS, posição, socket ou heartbeat.
- Issues não resolvidas nos últimos 14 dias, mobile: 3. Uma delas é `OutOfMemoryError` (1 ocorrência, 2026-10-20). Nenhuma sobre GPS.
- Regras de alerta: os endpoints de regra retornaram 404 com este token (`/projects/{org}/{projeto}/rules/`, `/organizations/{org}/alert-rules/`, `/combined-rules/`). Não foi possível listar regras. Pode ser falta de escopo do token ou endpoint diferente. Verificar na interface do Sentry (ver seção 5).

**PostHog** (projeto `312230`, API `eu.posthog.com`):
- Alertas configurados: 0.
- Insights salvos: 8, todos genéricos (funil de visita, retenção, WAU, DAU, pageviews, sessões, referrers, usuários ativos). Nenhum sobre corrida, GPS ou motorista.

Conclusão da evidência: não existe regra em Sentry (que se consiga listar) nem em PostHog para este caso.

---

## 4. Regra proposta

Princípio: a regra é só de alerta. Ela não derruba o motorista, não dispara KYC e não altera a corrida (AGENTS.md, regras de negócio e de segurança). Nenhuma mudança de taxa, pagamento ou ajuste financeiro.

### Regra A: GPS silencioso durante corrida ativa (principal)

- **Condição:** para cada corrida em `ride_health:driver_signal_active`, a última posição aceita pelo servidor tem mais de X segundos.
- **Limiares propostos:** aviso em 30 s (seis pacotes de 5 s perdidos). Crítico em 60 s. O valor atual de 90 s (`RIDE_HEALTH_DRIVER_SIGNAL_STALE_MS`) é tarde demais para a operação. Menor que 30 s gera ruído com a rede móvel.
- **Coordenada congelada (opcional, fase 2):** se a coordenada não muda por 45 s com corrida em andamento e o motorista não está parado no pickup, marcar como `gps_frozen`. Isso cobre o caso da seção 2, item 5.
- **Onde implementar:** reaproveitar `buildDriverSignalAlert` e `evaluateRideOperationsAlerts` em `leaf-websocket-backend/services/ride-health-monitor.js` (`:442-550`). Ajustar só os padrões e a chave de cooldown. Trocar a chave global por `driver_signal_stale:<bookingId>` com cooldown próprio, para que cada corrida alerte uma vez.
- **Frequência:** o worker atual roda a cada 60 s (`RIDE_HEALTH_MONITOR_INTERVAL_MS`). Com esse intervalo, a detecção tem atraso de até 60 s. Para 30 s, reduzir o intervalo para 15 s no mesmo worker, por variável de ambiente. Verificar antes o mínimo aceito em `ride-health-monitor-worker.js:18-20`.
- **Destinos:**
  - Aviso: Discord (já existe, `alert-service.js:136-141`).
  - Crítico: também `logStructured('error', ...)` com tag `ride_gps_silent`, para o Sentry capturar (`utils/logger.js:185-200`). Uma regra de issue no Sentry (criada pelo console, ver seção 5) envia pelo relay existente para o bot Operação (`external-alert-relay-service.js:91`).
  - Bot: novo tipo `ride.driver_gps_silent` em `services/bot-event-service.js:31-43`, com `ROUTES` para `['operacao']` e severidade `N2` no crítico. Só é entregue se `BOT_EVENTS_ENABLED=true`.

### Regra B: motorista offline com corrida ativa

- **Condição:** `connection-cleanup-service.js` vai fechar a sessão online (`:139-200`) e a corrida está em `ride_health:driver_signal_active` ou no índice ativo.
- **Limiar:** manter 120 s (`:33`). Não mudar sem avaliação, porque o cleanup também limpa conexões fantasmas.
- **Onde implementar:** antes de `closeDriverOnlineSessionAt`, checar corrida ativa e chamar `botEventService.emit('ride.driver_offline_during_active', ...)` com `ROUTES` `['operacao', 'cto']` e severidade `N2`. Adicionar um `logStructured('error', ...)` para o Sentry.
- **Fora de escopo:** o ajuste financeiro `DRIVER_OFFLINE_DURING_ACTIVE_RIDE` (`CompleteTripCommand.js:104-114`) não muda. Regra de cobrança precisa de aprovação.

### Regra C: buracos no stream `trip_location_events`

- **Condição:** no `updateLocation`, guardar o `receivedAt` anterior por corrida e calcular o intervalo entre posições aceitas. Intervalo maior que 30 s com corrida ativa gera um registro `ride_gps_gap` com duração.
- **Onde implementar:** `register-socket-update-location-handler.js` perto de `:839-848`, com a chave por corrida no Redis. Não criar worker novo (AGENTS.md proíbe sem aprovação).
- **Destinos:** log estruturado e, no resumo da corrida, o maior intervalo. PostHog exige cliente no backend, que é nova dependência e precisa de aprovação. Sem essa aprovação, usar Sentry e dashboard.

### Regra D: app (fase 2, só com aprovação)

- Não tratar o app como fonte da verdade do alerta: ele é suspenso em segundo plano.
- Propor, como próximo passo, que o app envie `capturedAt` real da leitura do GPS (`WebSocketManager.js:4615-4622`) e um evento ao reconectar, com a duração da falha. Mudança em JS pode ser OTA, mas precisa de confirmação dos limites do AGENTS.md (mudança nativa exige aprovação).
- Capturar erro do envio periódico (`prototypeRideRuntime.js:18497-18508`) com `captureError`, que já existe e não tem chamador.

### Testes que provariam a regra (quando implementada)

- Unitário em `ride-health-monitor`: corrida com última posição a 35 s gera aviso; a 70 s gera crítico; mesma corrida não alerta duas vezes no cooldown.
- Unitário em `connection-cleanup-service`: fechamento com corrida ativa emite o evento de bot.
- Comandos do AGENTS.md: `npm --prefix leaf-websocket-backend run test:unit -- --runInBand` e `npm --prefix leaf-websocket-backend run config:validate`.
- Teste ao vivo com aparelho real e sessão real (AGENTS.md: sem mock como evidência).

### Riscos

- Limiar de 30 s pode gerar falso positivo em área de sinal ruim. O primeiro aviso é só Discord, sem bot.
- Regra B pode aumentar alertas em dias de queda de rede generalizada. Usar agregação por ciclo, como a regra atual de `driver_signal_stale` já faz.
- Evento de bot exige `BOT_EVENTS_ENABLED=true` e as URLs do OpenBot. Sem isso, a regra cai só no Discord.
- Criar regra no Sentry e configurar webhook são ações de console (AGENTS.md, stop conditions). Precisam do Izaak.

### Rollback

- Regra A: restaurar o valor de `RIDE_HEALTH_DRIVER_SIGNAL_STALE_MS` (90000) e o intervalo (60000) por variável de ambiente, sem deploy. Reverter o commit se o código mudar.
- Regra B e C: reverter o commit. Nenhum dado persistido novo além de chaves Redis com TTL.

---

## 5. Verificações pendentes (não feitas aqui)

1. **Santiago (host primário):** confirmar com o runbook (`docs/operations/SANTIAGO_CUTOVER_RUNBOOK.md`) se o `ride-health-monitor-worker` está de pé e se `DISCORD_ALERT_WEBHOOK_URL` está no container. Leitura apenas.
2. **Discord de alertas:** procurar mensagens `driver_signal_stale` ou "sem sinal recente do motorista" em 2026-10-22. Se houver, a detecção funcionou e o problema é de entrega ou de cooldown. Se não houver, é a causa 1 ou 2 da seção 2.
3. **Sentry (console):** conferir se existe regra de alerta. O token de leitura não listou regras (404). Essa conferência é só na interface.
4. **Logs do aparelho do motorista:** verificar se o JS foi suspenso e se o socket caiu. Sem isso, a causa 7 continua hipótese.
5. **Dados do teste:** o `trip_location_events` do período (hora de chegada das posições por corrida) permitiria medir o buraco real. Não consultado.

---

## Evidência

- Caminhos e linhas: ver seções 1 e 2.
- Chamadas GET: Sentry `GET /api/0/organizations/{org}/projects/` (200), `GET /api/0/projects/{org}/{leaf-backend}/issues/` (200), `GET /api/0/projects/{org}/{leaf-mobile}/issues/` (200). PostHog `GET /api/projects/312230/alerts/` (200, 0 resultados), `GET /api/projects/312230/insights/` (200, 8 resultados). Regras do Sentry: 404 em todos os endpoints testados.
- Nenhum valor de chave aparece neste arquivo.

## Riscos desta investigação

- Não houve acesso a logs do Santiago, ao Discord nem ao aparelho. As causas da seção 2 são ordenadas por confiança, não confirmadas.
- Os endpoints de regra do Sentry podem existir com outro escopo de token. Não foi possível concluir "não há regra" para o Sentry, só "não foi possível listar".

## Itens fora de escopo deixados intactos

- Regra financeira de offline com corrida (`CompleteTripCommand.js`).
- Limites de cobrança, taxa e ajuste de tempo offline.
- Código do app e do backend (nada foi editado).
