# Runtime Redis Adapter Canary - 2026-05-24

## Escopo

Validar o contrato do Socket.IO Redis Adapter com Redis real antes de qualquer troca de runtime em producao.

## Ambiente local

- Workspace: `/Users/izaakdias/Documents/Leaf-new`
- Script: `leaf-websocket-backend/scripts/tests/smoke-runtime-redis-adapter.cjs`
- Comando: `npm run smoke:runtime-redis-adapter`

Resultado:

- Redis real local subiu em porta efemera.
- Broadcast cross-instance via Socket.IO Redis Adapter passou.
- Runtime `server.vps.js` subiu com `/health/quick` saudavel.
- Runtime modular `server.js` subiu com `/health/quick` saudavel.
- Ambos reportaram:
  - `socketRedisAdapter.state = ready`
  - `socketRedisAdapter.enabled = true`
  - `socketRedisAdapter.required = true`
  - `socketRedisAdapter.runtimeRole = gateway`
- Ambos aceitaram conexao Socket.IO local.

Artefato local:

- `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-redis-adapter/runtime-redis-adapter-smoke-1779655571009.json`

## Ambiente Contabo

- Host: `62.169.31.231`
- Producao atual preservada: container `leaf-websocket` em `127.0.0.1:3001`.
- Canary paralelo usado: `/opt/leaf-runtime-canary`, porta local `127.0.0.1:3901`.
- Rede Docker reutilizada: `leaf-app_leaf-network`.
- Redis reutilizado: container `leaf-redis`, alias `redis:6379`.
- O canary foi desligado ao final.

Resultado:

- `/health/liveness` do canary respondeu `alive`.
- `/health/quick` do canary respondeu `healthy`.
- Adapter no canary respondeu:
  - `state = ready`
  - `enabled = true`
  - `required = true`
  - `runtimeRole = gateway`
- Handshake Engine.IO + Socket.IO via WebSocket bruto passou:
  - `engine.io+socket.io-connected`
  - namespace default respondeu pacote `40`.
- Diretorio temporario `/opt/leaf-runtime-canary` e pacote `/tmp/leaf-backend-canary.tar.gz` foram removidos apos a validacao para nao deixar copia extra de secrets.
- Container de producao continuou em execucao:
  - `leaf-websocket Up ... (healthy) 127.0.0.1:3001->3001/tcp`

## Observacoes

- O host Contabo nao tem Node instalado fora do Docker; validacoes remotas devem usar `docker exec`.
- A imagem de producao instala dependencias com `npm install --omit=dev`, entao `socket.io-client` nao esta disponivel no container. O smoke remoto usa `ws`, que e dependencia de producao, para validar handshake Socket.IO bruto.
- Antes do deploy principal, a producao antiga nao exibia `socketRedisAdapter` no `/health/quick`.
- O deploy principal foi feito na Contabo, nao em DigitalOcean.

## Automacao adicionada

- `leaf-websocket-backend/scripts/ops/run-contabo-runtime-canary.sh`

Esse script empacota o backend sem secrets, sobe um canary local-only na Contabo, valida liveness/readiness/socket e derruba o canary automaticamente.

## Deploy principal Contabo

Data/hora da janela: 2026-05-24.

Backups remotos antes da troca:

- App: `/opt/leaf-backups/leaf-app-pre-runtime-deploy-20260524225456.tar.gz`
- Env: `/opt/leaf-backups/env-pre-runtime-deploy-20260524230255.env`
- Compose: `/opt/leaf-backups/docker-compose-pre-runtime-env-20260524230516.yml`

Guardrails ajustados antes do restart:

- `BYPASS_GEOFENCE=false`
- `ENABLE_SOCKETIO_REDIS_ADAPTER=true`
- `REQUIRE_SOCKETIO_REDIS_ADAPTER=true`
- `WOOVI_WEBHOOK_PUBLIC_KEY` configurado com a chave publica oficial Woovi/OpenPix.
- `WOOVI_WEBHOOK_REQUIRE_SIGNATURE=true`
- `WOOVI_WEBHOOK_ALLOW_UNSIGNED=false`
- `WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED=true`

Validador de runtime:

- Comando remoto: `docker compose run --rm --no-deps websocket node scripts/deploy/validate-runtime-config.js`
- Resultado: `ok = true`
- Blockers: nenhum.
- Aviso restante: `NODE_ENV=production` ainda aponta para `WOOVI_ENVIRONMENT=sandbox`, coerente com o ambiente atual de pagamentos.

Troca controlada:

- Container anterior: `d63a305b9063`
- Container novo: `7278076ba5c2`
- Status final: `leaf-websocket Up ... (healthy) 127.0.0.1:3001->3001/tcp`

Validacoes pos-deploy:

- `http://127.0.0.1:3001/health/liveness`: `alive`
- `http://127.0.0.1:3001/health/quick`: `healthy`
- `https://api.62.169.31.231.sslip.io/health/liveness`: `alive`
- `https://api.62.169.31.231.sslip.io/health/quick`: `healthy`
- `https://socket.62.169.31.231.sslip.io/health/liveness`: `alive`
- `socketRedisAdapter.state = ready`
- `socketRedisAdapter.enabled = true`
- `socketRedisAdapter.required = true`
- `socketRedisAdapter.runtimeRole = gateway`
- Handshake Engine.IO + Socket.IO via WebSocket bruto passou com pacote `40`.

## Decisao Final

Producao foi substituida de forma controlada apos canary, backup, validacao de configuracao e health checks. O rollback permanece possivel usando os backups remotos listados acima.

## Canary modular pos-paridade

Apos zerar os eventos socket existentes somente no VPS no inventario estatico, o canary remoto foi executado novamente com a base local atual.

Resultado:

- Imagem paralela `leaf-runtime-canary-runtime-canary` buildou na Contabo.
- Container paralelo `leaf-runtime-canary` iniciou em porta local isolada.
- `/health/liveness`: `alive`.
- `/health/quick`: `healthy`.
- `socketRedisAdapter.state = ready`.
- `socketRedisAdapter.enabled = true`.
- `socketRedisAdapter.required = true`.
- Handshake Engine.IO + Socket.IO via WebSocket bruto passou com pacote `40`.
- Producao principal permaneceu ativa:
  - `leaf-websocket Up ... (healthy) 127.0.0.1:3001->3001/tcp`
- Canary encerrado automaticamente.

Revalidacao posterior com a base atual:

- Imagem paralela buildou novamente na Contabo.
- `/health/liveness`: `alive`.
- `/health/quick`: `healthy`.
- `socketRedisAdapter.state = ready`.
- Handshake Engine.IO + Socket.IO via WebSocket bruto passou com pacote `40`.
- Producao principal permaneceu ativa:
  - `leaf-websocket Up 53 minutes (healthy) 127.0.0.1:3001->3001/tcp`
- Canary encerrado automaticamente.

## Smoke funcional dos eventos criticos

Apos implementar no runtime modular os eventos que ainda existiam somente no VPS, foi adicionado e executado o smoke local `npm run smoke:runtime-critical-events`.

Esse smoke sobe Redis real local, inicializa `server.vps.js` e `server.js` em portas efemeras, autentica um passageiro de teste sem token via bypass QA restrito ao smoke e exercita os quatro eventos de contrato que tinham lacuna de paridade:

- `checkRideAvailability`
- `passengerLocationUpdate`
- `confirmBoardingStatus`
- `endTripEarlyByRider`

Resultado:

- Runtime VPS: `/health/quick` saudavel, `socketRedisAdapter.state = ready`, autenticação OK e todos os quatro eventos responderam nos canais esperados.
- Runtime modular: `/health/quick` saudavel, `socketRedisAdapter.state = ready`, autenticação OK e todos os quatro eventos responderam nos mesmos canais esperados.
- As mensagens de erro dos casos de validação ficaram alinhadas entre os dois runtimes para reduzir diferenca operacional.

Artefato:

- `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-critical-events/runtime-critical-events-smoke-1779659581625.json`

## Smoke funcional de corrida completa

Foi adicionado e executado o smoke local `npm run smoke:runtime-full-ride-flow`.

Esse smoke sobe Redis real local, inicializa `server.vps.js` e `server.js` em portas efemeras, autentica um passageiro e um motorista de teste, coloca o motorista online no Redis/geosearch e executa o ciclo principal da corrida:

- `createBooking`
- `confirmPayment` com pagamento mock controlado para nao acionar provedor externo
- `newRideRequest`
- `acceptRide`
- `notificationAction` com `arrived_at_pickup`
- `startTrip`
- `updateLocation`
- `completeTrip`
- `paymentDistributed`

Resultado:

- Runtime VPS: `/health/quick` saudavel, `socketRedisAdapter.state = ready`, corrida completa concluida.
- Runtime modular: `/health/quick` saudavel, `socketRedisAdapter.state = ready`, corrida completa concluida.
- Ambos emitiram eventos para passageiro e motorista nos pontos obrigatorios.
- Ambos registraram evento de localizacao para o passageiro durante a corrida.
- Ambos finalizaram o booking em Redis com `status=completed`, `paymentStatus=in_holding`, `finalFare=27.5`, `driverNetAmount=25.51` e viagem ativa limpa.

Tempos principais da ultima rodada:

| Runtime | Booking | Pagamento | Driver notificado | Aceite | Inicio | Fim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| VPS | 684ms | 694ms | 709ms | 2330ms | 2344ms | 3611ms |
| Modular | 1594ms | 2773ms | 2788ms | 3832ms | 4209ms | 5473ms |

Artefato:

- `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/runtime-full-ride-flow-smoke-1779665836495.json`

Observacao: o smoke usa pagamento mock controlado para validar contrato de runtime/socket/Redis sem chamadas externas pagas. Ele nao substitui o canary remoto com ambiente real, mas fecha a pendencia local de corrida completa antes do proximo canary modular.

## Recheck Contabo apos smoke local

Foi feita uma checagem read-only na Contabo apos a rodada local.

Resultado:

- `leaf-websocket` segue `Up ... (healthy)`.
- Porta publicada: `127.0.0.1:3001->3001/tcp`.
- `/health/quick`: `healthy`.
- Redis dedicado: `healthy`.
- `socketRedisAdapter.state = ready`.
- `socketRedisAdapter.enabled = true`.
- `socketRedisAdapter.required = true`.
- `socketRedisAdapter.runtimeRole = gateway`.

Observacao: o `docker compose ps` ainda mostra avisos de variaveis opcionais nao definidas no compose (`WOOVI_CLIENT_ID`, `WOOVI_CLIENT_SECRET`, `MAPBOX_API_KEY`, `LOCATIONIQ_API_KEY`, campos AWS KYC e `AWS_SESSION_TOKEN`). Isso nao impactou o health atual, mas deve entrar na limpeza futura do compose/env para reduzir ruido operacional.

## Canary remoto modular apos smoke funcional local

Apos o smoke funcional local passar nos dois runtimes, foi executado o canary remoto modular com `RUNTIME_MODE=modular bash leaf-websocket-backend/scripts/ops/run-contabo-runtime-canary.sh`.

Resultado:

- Pacote local enviado para a Contabo sem secrets.
- Runtime modular subiu em container paralelo `leaf-runtime-canary`.
- Porta publica nao foi exposta; canary ficou em porta local isolada.
- `/health/liveness`: `alive`.
- `/health/quick`: `healthy`.
- `socketRedisAdapter.state = ready`.
- `socketRedisAdapter.enabled = true`.
- `socketRedisAdapter.required = true`.
- `socketRedisAdapter.runtimeRole = gateway`.
- Handshake Engine.IO + Socket.IO via WebSocket bruto passou com pacote `40`.
- Producao principal permaneceu ativa:
  - `leaf-websocket Up 3 hours (healthy) 127.0.0.1:3001->3001/tcp`
- Canary encerrado automaticamente.

Ruidos observados:

- O build remoto repetiu avisos de dependencias antigas e `npm audit` com 36 vulnerabilidades no pacote atual. Isso ja existia na cadeia de dependencias e nao bloqueou o canary, mas deve entrar na trilha de limpeza de dependencias.
- O empacotamento local emitia muitos avisos `LIBARCHIVE.xattr.com.apple.provenance`; o script foi ajustado para usar `tar --no-xattrs` e reduzir esse ruido nas proximas execucoes.

## Canary remoto funcional de corrida completa

Foi executado `RUN_FULL_FLOW_CANARY=true RUNTIME_MODE=modular bash leaf-websocket-backend/scripts/ops/run-contabo-runtime-canary.sh`.

Esse modo sobe o runtime modular em container paralelo na Contabo, valida health/readiness/socket, roda o smoke de corrida completa dentro do proprio container canary e encerra o canary automaticamente. A producao nao e substituida.

Resultado:

- Runtime canary: `modular-contabo-canary`.
- `/health/liveness`: `alive`.
- `/health/quick`: `healthy`.
- `socketRedisAdapter.state = ready`.
- Handshake Engine.IO + Socket.IO bruto passou.
- Cliente usado pelo smoke dentro da imagem: `raw-ws`, porque `socket.io-client` nao faz parte das dependencias de producao.
- Autenticacao QA ficou restrita aos UIDs:
  - `runtime-full-passenger-modular-contabo-canary`
  - `runtime-full-driver-modular-contabo-canary`
- Corrida completa passou:
  - autenticacao passageiro + motorista
  - motorista online
  - booking criado
  - pagamento mock controlado confirmado
  - motorista notificado
  - corrida aceita
  - chegada no embarque
  - viagem iniciada
  - localizacao enviada ao passageiro
  - viagem concluida
  - pagamento distribuido
  - Redis final validado
- Booking validado: `booking_1779669131793_runtime-full-passenger-modular-contabo-canary`.
- Redis final: `status=completed`, `paymentStatus=in_holding`, `finalFare=27.5`, `driverNetAmount=25.51`, `tollFee=0`, viagem ativa limpa.
- Producao principal permaneceu ativa e saudavel:
  - `leaf-websocket Up ... (healthy) 127.0.0.1:3001->3001/tcp`

Tempos principais:

| Etapa | Tempo |
| --- | ---: |
| autenticacao | 103ms |
| booking criado | 2159ms |
| pagamento confirmado | 3625ms |
| motorista notificado | 3745ms |
| corrida aceita | 4574ms |
| chegada no embarque | 4598ms |
| viagem iniciada | 4923ms |
| localizacao enviada | 6177ms |
| viagem concluida | 6220ms |

Evidencias locais:

- Log: `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/contabo-modular-full-flow-canary-1779668996.log`
- JSON extraido: `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/contabo-modular-full-flow-canary-2026-05-25T00-32-16-480Z.json`

Observacoes:

- A primeira tentativa funcional revelou que o cliente raw podia perder o evento `connect` quando a conexao abria antes do listener. O smoke foi ajustado para respeitar `socket.connected` e evitar falso timeout.
- A primeira tentativa tambem evidenciou que canary remoto em `NODE_ENV=production` exige token; para o teste funcional foi usado bypass QA com whitelist fechada e somente dentro do container canary.

## Cutover Contabo para runtime modular

Data/hora da janela: 2026-05-25.

Depois do canary remoto funcional, o gateway de producao foi migrado de `server.vps.js` para o runtime modular (`server.js`) com baby steps e rollback preservado.

Backups remotos antes da troca:

- App: `/opt/leaf-backups/leaf-app-pre-modular-cutover-20260525024431.tar.gz`
- Env: `/opt/leaf-backups/env-pre-modular-cutover-20260525024431.env`
- Compose: `/opt/leaf-backups/docker-compose-pre-modular-cutover-20260525024431.yml`
- Inspect do container anterior: `/opt/leaf-backups/leaf-websocket-inspect-pre-modular-cutover-20260525024431.json`

Sequencia executada:

- Snapshot da producao antes do corte confirmou `leaf-websocket` saudavel e runtime `vps`.
- Pacote local do backend foi enviado para a Contabo sem `.env`, credentials, compose, logs ou artefatos sensiveis.
- `/opt/leaf-app` foi atualizado por `rsync`.
- A imagem `websocket` foi rebuildada.
- O container foi recriado ainda em `LEAF_SERVER_RUNTIME=vps`.
- Health e handshake foram validados ainda no runtime VPS.
- Apenas o servico `websocket` foi alterado para `LEAF_SERVER_RUNTIME=modular`.
- `sideeffects-worker` permaneceu em `LEAF_SERVER_RUNTIME=vps`.
- O container `leaf-websocket` foi recriado isoladamente com `docker compose up -d --no-deps websocket`.

Validacoes pos-cutover:

- `LEAF_SERVER_RUNTIME=modular` dentro do container `leaf-websocket`.
- `/health/quick`: `healthy`.
- Redis dedicado: `healthy`.
- `socketRedisAdapter.state = ready`.
- `socketRedisAdapter.enabled = true`.
- `socketRedisAdapter.required = true`.
- `socketRedisAdapter.runtimeRole = gateway`.
- Handshake Engine.IO + Socket.IO via WebSocket bruto passou com pacote `40`.
- Health publico:
  - `https://api.62.169.31.231.sslip.io/health/liveness`: `alive`.
  - `https://api.62.169.31.231.sslip.io/health/quick`: `healthy`.
  - `https://socket.62.169.31.231.sslip.io/health/liveness`: `alive`.
  - `https://socket.62.169.31.231.sslip.io/health/quick`: `healthy`.
- `node scripts/deploy/validate-runtime-config.js`: `ok=true`, sem blockers.
- Logs recentes observados sem erro.

Smoke funcional em producao:

O smoke completo foi executado contra o `leaf-websocket` de producao, usando tokens reais Firebase e pagamento prevalidado por cache interno para nao acionar cobrança externa Woovi.

Resultado:

- Booking: `booking_1779671486632_runtime-full-passenger-prod-modular`.
- Autenticacao: `307ms`.
- Motorista online: `816ms`.
- Booking criado: `1783ms`.
- Pagamento prevalidado: `1783ms`.
- Motorista notificado: `1841ms`.
- Corrida aceita: `3877ms`.
- Chegada ao embarque: `3904ms`.
- Viagem iniciada: `4230ms`.
- Localizacao enviada: `5485ms`.
- Viagem concluida: `5515ms`.

Eventos obrigatorios:

- `bookingCreated`
- `paymentConfirmed`
- `driverReceivedNewRideRequest`
- `driverRideAccepted`
- `passengerRideAccepted`
- `driverArrivedAtPickup`
- `passengerArrivedAtPickup`
- `driverTripStarted`
- `passengerTripStarted`
- `passengerLocationEvent`
- `driverTripCompleted`
- `passengerTripCompleted`
- `paymentDistributed`

Redis final:

- `status=completed`
- `paymentStatus=in_holding`
- `finalFare=27.5`
- `tollFee=0`
- `driverNetAmount=25.51`
- `activeBookingCleared=true`
- `activeDriverTripCleared=true`

Evidencia:

- `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/production-modular-cutover-full-flow-1779671491090.json`

Rollback imediato:

- Voltar o `websocket` em `/opt/leaf-app/docker-compose.yml` para `LEAF_SERVER_RUNTIME=vps`.
- Rodar `cd /opt/leaf-app && docker compose up -d --no-deps websocket`.

Observacoes:

- O host Contabo continua sem Node fora do Docker; validacoes remotas devem seguir via `docker exec`.
- O compose ainda emite warnings de variaveis opcionais ausentes (`WOOVI_CLIENT_ID`, `WOOVI_CLIENT_SECRET`, `MAPBOX_API_KEY`, `LOCATIONIQ_API_KEY`, campos AWS KYC e `AWS_SESSION_TOKEN`). Nao bloquearam health nem smoke, mas devem entrar na limpeza operacional.
- `NODE_ENV=production` segue com `WOOVI_ENVIRONMENT=sandbox` neste ambiente, o que o validador reporta como warning.

## Fechamento do sideeffects-worker dedicado

Data/hora da janela: 2026-05-25.

Depois do gateway modular entrar em producao, foi fechado o ultimo acoplamento operacional visivel com o runtime VPS no processo de side effects.

Achado:

- `leaf-sideeffects-worker` ja executava `workers/listener-worker.js`, nao `server.vps.js`.
- A env `LEAF_SERVER_RUNTIME=vps` no worker era uma label legada.
- O gateway modular ainda iniciava `WorkerManager` embutido apesar de `ENABLE_EMBEDDED_LISTENER_WORKERS=false`.
- O Redis Stream `ride_events` tinha dois consumers no grupo `listener-workers`:
  - `listener-worker-1`
  - `server-worker-1`
- Nao havia duplicidade de processamento porque Redis Consumer Group entrega cada evento uma vez, mas havia consumo nao deterministico.

Mudancas:

- `bootstrap/setup-eventbus-workers.js` agora respeita `enableEmbeddedListenerWorkers`.
- `server.js` passa `enableEmbeddedListenerWorkers` a partir de `ENABLE_EMBEDDED_LISTENER_WORKERS`, com default `false`.
- Novo entrypoint dedicado: `scripts/runtime/start-sideeffects-worker.sh`.
- `sideeffects-worker` na Contabo passou a usar:
  - `command: ["bash", "scripts/runtime/start-sideeffects-worker.sh"]`
  - `LEAF_SERVER_RUNTIME=modular`
  - `RUNTIME_ROLE=sideeffects`
- `validate-runtime-config.js` ficou role-aware:
  - gateway/billing seguem exigindo config de pagamento.
  - sideeffects nao exige secrets Woovi/Pix que nao usa.
  - flags perigosas seguem bloqueadas em producao para todos os roles.
- Consumer antigo `server-worker-1` foi removido com `XGROUP DELCONSUMER` somente depois de confirmar `pending=0`.

Backups remotos antes da troca:

- `/opt/leaf-backups/leaf-app-pre-sideeffects-dedicated-20260525014610.tar.gz`
- `/opt/leaf-backups/docker-compose-pre-sideeffects-dedicated-20260525014610.yml`
- `/opt/leaf-backups/leaf-websocket-inspect-pre-sideeffects-dedicated-20260525014610.json`
- `/opt/leaf-backups/leaf-sideeffects-inspect-pre-sideeffects-dedicated-20260525014610.json`

Validacoes locais:

- `node --check` em `server.js`, `bootstrap/setup-eventbus-workers.js`, `validate-runtime-config.js`, `assert-no-active-vps-runtime.cjs`.
- `bash -n` em `start-server.sh` e `start-sideeffects-worker.sh`.
- Jest focado:
  - `tests/unit/scripts/validate-runtime-config.unit.test.js`
  - `tests/unit/bootstrap/setup-eventbus-workers.unit.test.js`
  - 11 testes passando.
- `npm run check:runtime-parity`: VPS-only segue em zero.
- `npm run check:no-active-vps-runtime`: composes ativos sem `LEAF_SERVER_RUNTIME=vps`.
- `npm run smoke:runtime-critical-events`: passou em VPS e modular.
- `npm run smoke:runtime-full-ride-flow`: passou em VPS e modular.

Validacoes remotas:

- `leaf-websocket`: `LEAF_SERVER_RUNTIME=modular`, `RUNTIME_ROLE=gateway`, `ENABLE_EMBEDDED_LISTENER_WORKERS=false`.
- Log do gateway confirmou: `WorkerManager embutido desabilitado; side effects serão processados pelo worker dedicado`.
- `leaf-sideeffects-worker`: `LEAF_SERVER_RUNTIME=modular`, `RUNTIME_ROLE=sideeffects`, `WORKER_GROUP_NAME=listener-workers`.
- Log do worker confirmou validação de runtime, Redis Adapter, listeners registrados e `Worker iniciado`.
- Health publico `api` e `socket`: `healthy`.
- Redis Stream final:
  - consumers: somente `listener-worker-1`.
  - pending: `0`.

Smoke funcional de producao pos-fechamento:

- Runtime: `production-modular-sideeffects`.
- Booking: `booking_1779674637950_runtime-full-passenger-prod-sideeffects-20260525020351`.
- Autenticacao: `115ms`.
- Motorista online: `636ms`.
- Booking criado: `1413ms`.
- Pagamento prevalidado: `1413ms`.
- Motorista notificado: `1531ms`.
- Corrida aceita: `3520ms`.
- Chegada ao embarque: `3567ms`.
- Viagem iniciada: `3896ms`.
- Localizacao enviada: `5153ms`.
- Viagem concluida: `5220ms`.
- Eventos obrigatorios: todos presentes.
- Redis final: `status=completed`, `paymentStatus=in_holding`, `finalFare=27.5`, `tollFee=0`, `driverNetAmount=25.51`, viagens ativas limpas.

Evidencia:

- `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/production-modular-sideeffects-full-flow-1779674642560.json`

Higiene operacional pos-cutover:

- `docker-compose.hostinger.yml`, `docker-compose.local.yml`, `docker-compose.ops-workers.yml` e `docker-compose.realtime-secondary.yml` nao usam mais o atributo obsoleto `version`.
- Variaveis opcionais que geravam warning de interpolacao no compose agora usam default vazio:
  - `WOOVI_CLIENT_ID`
  - `WOOVI_CLIENT_SECRET`
  - `MAPBOX_API_KEY`
  - `LOCATIONIQ_API_KEY`
  - `KYC_AWS_LIVENESS_ASSUME_ROLE_EXTERNAL_ID`
  - `KYC_AWS_LIVENESS_S3_BUCKET`
  - `AWS_SESSION_TOKEN`
- O compose ativo da Contabo foi ajustado com backup previo:
  - `/opt/leaf-backups/docker-compose-pre-warning-cleanup-20260525042730.yml`
- `docker compose config --services` na Contabo passou sem warnings e retornou:
  - `redis`
  - `websocket`
  - `sideeffects-worker`
  - `billing-worker`
  - `nginx`
- O healthcheck do `nginx` foi corrigido para validar HTTPS local com `--no-check-certificate`, porque o endpoint HTTP redireciona para HTTPS.
- Durante o recreate do `nginx`, foi identificado que o compose ativo nao montava `/etc/letsencrypt`, apesar de `nginx.conf` referenciar esse caminho. A borda foi recuperada com mount de `certbot/conf` e certificado local de origem para o dominio `sslip.io`.
- Backups remotos dessa manutencao:
  - `/opt/leaf-backups/docker-compose-pre-nginx-healthcheck-20260525043319.yml`
  - `/opt/leaf-backups/docker-compose-pre-certbot-mount-20260525044323.yml`
  - `/opt/leaf-backups/nginx-conf-pre-certbot-mount-20260525044323.conf`
- Validacao final:
  - `api.leaf.app.br/health/liveness`: alive.
  - `socket.leaf.app.br/health/liveness`: alive.
  - `leaf-nginx`: healthy.
  - `leaf-websocket`: healthy.
  - `leaf-sideeffects-worker`: healthy.

Status:

- Gateway e sideeffects-worker estao modulares em producao.
- `server.vps.js` permanece somente como rollback temporario/manual.
- Novos usos ativos de `LEAF_SERVER_RUNTIME=vps` ficam bloqueados por `npm run check:no-active-vps-runtime`.
