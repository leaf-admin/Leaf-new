# Estudo: fallback local para corrida com perda de internet ou bateria

## Objetivo

Definir onde faz sentido ter fallback local no aparelho do passageiro e do motorista sem enfraquecer o backend como fonte de verdade para pagamento, despacho, aceite, inicio, fim, tarifas e seguranca.

## Principio central

O app pode armazenar o ultimo estado conhecido e enfileirar intencoes locais, mas nao deve confirmar transacoes criticas sozinho.

Estados financeiros e transacionais continuam backend-canonicos:

- pagamento confirmado;
- motorista aceitou;
- motorista chegou;
- corrida iniciou;
- corrida finalizou;
- cancelamento com impacto financeiro;
- reembolso;
- split, taxa Leaf e liquido do motorista.

## Onde o fallback local faz sentido

### Passageiro durante corrida ativa

Manter localmente:

- booking id;
- status canonico mais recente;
- motorista, veiculo, placa e cor;
- endereco de embarque/destino;
- valor bruto pago;
- taxa/recibo quando ja recebido;
- ultima localizacao conhecida do motorista com timestamp;
- rota e polyline validas mais recentes;
- canal de suporte e instrucoes de seguranca.

Comportamento recomendado:

- Se ficar offline, mostrar estado atual com indicador claro de conexao perdida.
- Nao permitir nova corrida enquanto houver corrida ativa local nao reconciliada.
- Permitir abrir suporte, ligar para motorista e ver recibo ja recebido.
- Permitir criar uma intencao de cancelamento local, mas marcar como "pendente de sincronizacao" ate ack do backend.
- Se motorista ficar sem atualizar localizacao, exibir "ultima atualizacao ha X min" em vez de mover marcador de forma inventada.

### Motorista durante corrida ativa

Manter localmente:

- booking id;
- status canonico mais recente;
- passageiro e enderecos;
- valor liquido esperado;
- rota atual;
- checkpoints ja confirmados pelo backend;
- buffer de localizacao com timestamps.

Comportamento recomendado:

- Continuar gravando pontos de GPS em buffer local quando a internet cair.
- Ao reconectar, enviar lote de localizacoes com idempotency key, sequence number e timestamp.
- Acoes de chegada, inicio e finalizacao podem ser registradas localmente como intencao, mas so viram estado final apos ack do backend.
- Nao permitir aceite de nova corrida offline.
- Nao permitir alterar valor, taxa ou recibo offline.

### Perda de bateria

Nao existe fallback real no aparelho desligado. O sistema deve tratar por heartbeat backend:

- Se motorista para de enviar heartbeat durante corrida ativa, passageiro ve estado "sinal do motorista perdido" com tempo da ultima atualizacao.
- Backend pode acionar politica de seguranca/suporte apos TTL.
- Ao reabrir app, motorista e passageiro hidratam do backend pelo booking id ativo.
- Se o backend ja concluiu/cancelou a corrida, o app deve aceitar o estado mais novo e limpar estado local antigo.

## Onde o fallback local nao deve existir

- Confirmar Pix offline.
- Criar recibo final offline.
- Aceitar corrida offline.
- Iniciar/finalizar corrida como definitivo sem ack backend.
- Recalcular tarifa localmente para substituir a cotacao backend.
- Aplicar taxa, split, reembolso ou saldo de motorista localmente.
- Chamar provider pago diretamente pelo app.

## Modelo tecnico recomendado

### Local ride snapshot

Persistir um snapshot por usuario/dispositivo:

```json
{
  "bookingId": "booking_123",
  "role": "passenger",
  "canonicalStatus": "started",
  "serverVersion": 42,
  "lastServerEventAt": "2026-06-20T09:00:00.000Z",
  "lastLocalSeenAt": "2026-06-20T09:00:05.000Z",
  "financialSnapshot": {
    "grossAmount": 76.95,
    "leafFee": 2.93,
    "driverNet": 74.02,
    "currency": "BRL"
  },
  "routeSnapshot": {
    "polylineSource": "backend_routes",
    "trafficSegments": []
  }
}
```

### Outbox idempotente

Toda intencao local precisa de:

- `idempotencyKey`;
- `bookingId`;
- `userId`;
- `role`;
- `eventType`;
- `clientSequence`;
- `clientCreatedAt`;
- payload minimo;
- status `pending`, `acked` ou `rejected`.

O backend deve rejeitar evento fora de ordem ou incompatível com o estado canonico.

### Resolucao de conflito

- Backend sempre vence em estados canonicos.
- App pode mostrar "sincronizando" quando uma intencao local ainda nao foi aceita.
- Se backend rejeitar, app deve mostrar estado canonico atualizado e registrar erro tecnico no relatorio/telemetria.
- Eventos duplicados devem ser tratados como sucesso idempotente quando o idempotency key ja foi processado.

## TTLs sugeridos

- Localizacao do motorista: stale visual apos 30 segundos sem atualizacao.
- Alerta de conexao ruim: apos 10 segundos offline durante corrida ativa.
- Buffer de localizacao: reter ate 24 horas ou ate ack completo.
- Snapshot de corrida ativa: reter ate backend confirmar `completed`, `cancelled` ou expiracao operacional.
- Recibo local: pode permanecer cacheado apos finalizacao.

## Estado atual do projeto

Ja existem bases uteis no mobile:

- `LocationBufferService`: buffer local de localizacao.
- `OfflinePersistenceService`: fila offline e persistencia de estado.
- `BackgroundLocationService`: tarefa de localizacao em background.
- `FCMNotificationService`: fila de notificacoes em background.
- `IntelligentCacheService`: cache de eventos/conectividade.

O que ainda falta para producao:

- Unificar snapshot canonico de corrida para passageiro e motorista.
- Adicionar outbox idempotente especifica para eventos de corrida.
- Exigir `serverVersion` ou sequencia monotônica nos eventos de corrida.
- Criar UI explicita de estado offline em corrida ativa.
- Testar reconexao com eventos pendentes e rejeicao backend.
- Definir politica operacional para motorista sem heartbeat.

## Plano recomendado

### P0

- Criar `RideLocalSnapshotService` para persistir o ultimo estado canonico por booking.
- Criar `RideEventOutboxService` com idempotency key e retry exponencial.
- Backend validar idempotencia e ordem para eventos `arrived`, `started`, `completed` e `cancel_requested`.
- UI de corrida ativa mostrar conexao perdida sem regredir estado.
- Testes unitarios de conflito: evento local antigo nao pode sobrescrever estado backend mais novo.

### P1

- Flush de buffer de localizacao com lote e sequencia.
- Indicador de ultima localizacao do motorista para passageiro.
- Monitor backend de heartbeat ausente em corrida ativa.
- Playbook de suporte para corrida com motorista sem sinal.

### P2

- Simulacao automatizada de airplane mode no smoke Android.
- Painel dashboard para corridas com eventos offline pendentes/rejeitados.
- Alertas operacionais por taxa de reconexao, fila local e eventos rejeitados.

## Backlog executavel

| ID | Prioridade | Item | Dono | Dependencias | Criterio de aceite |
| --- | --- | --- | --- | --- | --- |
| OFF-P0-001 | P0 | `RideLocalSnapshotService` unico para passageiro e motorista. | Mobile | `AsyncStorage`, runtime de corrida atual, normalizador de lifecycle. | Implementado. Persiste um snapshot por `bookingId` com `role`, estado canonico, `serverVersion`/`lastServerEventAt`, timestamp local, financeiro sanitizado e rota mais recente. Rejeita regressao por lifecycle, versao ou timestamp; trata `customer/passenger` como o mesmo escopo; reconhece terminais `completed/canceled/no_drivers/rejected`; preserva taxas/net somente quando `authoritativeSnapshot=true` e `financialSnapshotSource=backend_final`. |
| OFF-P0-002 | P0 | `RideEventOutboxService` especifico para eventos de corrida. | Mobile/backend | Socket/API atual, idempotency key backend, lifecycle guard. | Enfileirar apenas intencoes permitidas (`arrived_intent`, `start_intent`, `complete_intent`, `cancel_request_intent`, `support_message_intent`) com `idempotencyKey`, `clientSequence`, `clientCreatedAt`, `bookingId`, `userId`, `role` e payload minimo. Nenhuma intencao aparece como confirmada sem ack backend. |
| OFF-P0-003 | P0 | Validador backend de idempotencia e ordem para outbox de corrida. | Backend | Estado canonico da booking, socket scope guard, Redis/RTDB idempotency index. | Implementado. `ride-offline-intent-validator` valida payloads de outbox/offline para `arrived_at_pickup`, `start_trip`, `complete_trip` e `cancel_ride`; exige `idempotencyKey`, `clientSequence`, `clientCreatedAt`, `bookingId`, ator e papel; rejeita eventos fora de escopo, de outro usuario, de booking terminal, estado incompatível ou sequencia antiga; guarda fingerprint/resultado em Redis e os handlers de socket de chegada, inicio, finalizacao e cancelamento so acionam a barreira quando o payload traz sinais de outbox/offline, preservando o fluxo online comum. |
| OFF-P0-004 | P0 | UI offline em corrida ativa sem regressao visual. | Mobile | `RideLocalSnapshotService`, indicadores existentes de sync local. | Implementado em runtime mobile para as superficies principais. Passageiro e motorista mantêm a trip screen/bottomsheet protegida em estados ativos, o backdrop/drag não derruba para mapa-only, disconnect/reabertura de app com corrida ativa marca `rideLocalSync=offline`, e as telas exibem um sync pill de ultimo estado conhecido/acao pendente sem esconder a corrida. Evidencia unitária cobre passenger/driver sync pill e bloqueio de regressao visual; falta smoke Android com airplane mode para evidencia de device. |
| OFF-P0-005 | P0 | Reconexao descarta snapshot antigo e aplica backend mais novo. | Mobile/backend | `activeRideSync`, lifecycle guard, terminal cleanup. | Implementado no runtime/replay local. Replay de outbox agora envia `offlineIntent`, `source=ride_event_outbox`, `eventType`, `clientSequence` e `clientCreatedAt` ate o socket/backend; `completed`, `canceled`, `no_drivers` e clear autoritativo via `activeRideSync` rejeitam intents pendentes da booking, limpam snapshot local incompatível e removem o estado ativo. Se o backend ainda estiver ativo, a tela canonica continua preservada. Falta smoke Android airplane-mode/reconnect e evidencia provider/device antes de considerar resiliencia offline pronta. |
| OFF-P1-001 | P1 | Flush de localizacao em lote com sequencia. | Mobile/backend | `LocationBufferService`, endpoint/socket de localizacao, active trip context. | Implementado. `LocationBufferService` agrupa pontos offline de motorista por corrida/contexto ativo, envia `bookingId`, `driverId`, `seq`, `capturedAt`, `source`, `tripStatus` e `isInTrip` por `updateLocationBatch`, e preserva o buffer quando o batch falha/rejeita. Backend aceita lote limitado, aplica a mesma elegibilidade/policy do evento unitario, deduplica por sequencia, preserva traffic route plan, emite `locationBatchUpdated` com aceitos/rejeitados e nao marca rejection como sucesso. Falta smoke Android airplane-mode/reconnect para evidencia de device. |
| OFF-P1-002 | P1 | Estado "sinal do motorista perdido" para passageiro. | Mobile/backend | Heartbeat/localizacao driver, `lastLocationAt`. | Implementado no mobile. O runtime marca `driverLocationHeartbeat` com `lastReceivedAt`, `ageSeconds` e `stale` por TTL local durante corrida ativa; a tela do passageiro exibe "Sinal do motorista instável" com "Última localização há X" sem mover marcador artificialmente, sem recalcular ETA e sem permitir regressão/fechamento da sheet. Falta prova em device com queda real de sinal. |
| OFF-P1-003 | P1 | Monitor backend para heartbeat ausente em corrida ativa. | Backend/support | Heartbeat service, support severity classifier, ride health monitor. | Implementado no ride health monitor e exposto no backoffice. `updateLocation`/`updateLocationBatch` alimentam `ride_health:driver_signal_active`; o monitor conta corridas ativas sem sinal recente, emite alerta `driver_signal_stale` por threshold, remove o indice quando a corrida entra em terminal, `/ops/alerts` agrega o alerta e `/observability` exibe o contador de sinal stale. Nao finaliza, cancela nem redispatcha automaticamente. Falta prova em device/ambiente real. |
| OFF-P1-004 | P1 | Playbook de suporte para corrida com evento offline pendente/rejeitado. | Suporte/dashboard | Support queue, dashboard freshness, audit logs. | Parcial. Backoffice agora mostra `driver_signal_stale` com booking afetado e resumo de ride health para triagem de motorista sem sinal. Ainda falta expor intencoes offline pendentes/rejeitadas por booking, ultimo estado canonico e acao recomendada especifica para fechar o playbook completo. |
| OFF-P2-001 | P2 | Smoke Android com airplane mode/reconnect. | QA | ADB/Maestro, app release/internal-test, backend sandbox. | Rodada automatizada prova que active ride nao regride, outbox sincroniza ao reconectar e eventos rejeitados aparecem como erro visivel. |
| OFF-P2-002 | P2 | Dashboard operacional de offline/outbox. | Dashboard/backend | Metricas de outbox, support queue, ride health. | Painel mostra taxa de reconexao, eventos pendentes/rejeitados e corridas com heartbeat ausente por severidade. |

## Ordem de implementacao recomendada

1. `OFF-P0-001` esta implementado e deve permanecer como precondicao para qualquer outbox.
2. `OFF-P0-002` e `OFF-P0-003` formam a base de intencoes offline: o mobile enfileira e o backend valida idempotencia/ordem antes de qualquer comando canonico.
3. `OFF-P0-004` e `OFF-P0-005` em seguida: a UI precisa mostrar ultimo estado conhecido sem assumir confirmacao.
4. `OFF-P1-001` pode reaproveitar `LocationBufferService`, mas so depois que a corrida ativa tem contexto/versao canonica.
5. `OFF-P1-002` a `OFF-P2-002` entram depois de validada a trilha ativa principal.

## Evidencia local

- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/ride-local-snapshot-service.test.js __tests__/ride-event-outbox-service.test.js` passou com 2 suites / 13 testes.
- O teste cobre avanço de lifecycle, rejeição de regressão local, terminais `no_drivers`, bloqueio de versão backend antiga, bloqueio de `lastServerEventAt` antigo, sanitização de financeiro sem `backend_final`, preservação de snapshot financeiro backend-final e limpeza de snapshot por escopo.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/ride-offline-intent-validator.unit.test.js tests/unit/bootstrap/register-socket-lifecycle-idempotency.unit.test.js tests/unit/bootstrap/register-socket-driver-control-handlers.unit.test.js` passou com 3 suites / 18 testes.
- `node --check` passou para `ride-offline-intent-validator.js` e para os handlers `register-socket-start-trip-handler.js`, `register-socket-complete-trip-handler.js`, `register-socket-cancel-ride-handler.js` e `register-socket-driver-control-handlers.js`.
- A prova backend cobre deteccao de payload offline sem afetar idempotencia online comum, normalizacao de aliases mobile, reserva de intencao valida, rejeicao por estado canonico incompatível, usuario fora do escopo, booking terminal, sequencia antiga, conflito de idempotency key, replay processado com resultado canonico e cancelamento offline de passageiro antes do inicio da viagem.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/ride-event-outbox-service.test.js __tests__/ride-lifecycle-outbox-replay-service.test.js __tests__/websocket-manager-create-booking.test.js __tests__/runtime-crash-recovery.test.js` passou com 4 suites / 24 testes.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` passou com 1 suite / 106 testes.
- A prova mobile cobre rejeicao local de intents pendentes em booking terminal, replay com metadata offline completa para o backend, WebSocketManager preservando metadata em comandos de lifecycle, crash recovery, sync pill em passenger/driver, sheets protegidas contra backdrop/drag, receipt/rating closure e mapas/rotas ativos acima da bottomsheet.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/bootstrap/register-socket-update-location-handler.unit.test.js` passou com 1 suite / 4 testes. A prova cobre driver inelegivel bloqueado no batch com `acceptedCount=0`, lote valido em corrida ativa com `seq/capturedAt`, stream unico para passageiro, dedupe/ordem e preservacao dos segmentos de trafego no route plan compartilhado.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/location-buffer-service.test.js __tests__/websocket-manager-create-booking.test.js` passou com 2 suites / 11 testes. A prova cobre flush ordenado do buffer offline por batch, heranca do contexto ativo da corrida, preservacao do buffer quando o envio falha e contrato Socket.IO de `updateLocationBatch`.
- `npm --prefix mobile-app run test:unit -- --runInBand __tests__/prototype-ride-screens.test.js` passou com 1 suite / 107 testes. A prova adicionada cobre o alerta visual de sinal instável do motorista no passageiro sem derrubar a tela ativa da corrida.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/ride-health-monitor.unit.test.js tests/unit/bootstrap/register-socket-update-location-handler.unit.test.js` passou com 2 suites / 10 testes. A prova cobre indexação do último sinal do motorista por booking, contagem/alerta de stale driver signal, limpeza do índice no terminal e alimentação do índice por batch de localização.
- `npm --prefix leaf-websocket-backend run test:unit -- --runInBand tests/unit/services/ops-overview-service.unit.test.js` passou com 1 suite / 1 teste. A prova cobre agregacao de `driver_signal_stale` em `/ops/alerts`.
- `npm --prefix leaf-dashboard-js run qa:backoffice` passou. A prova cobre lint, build e smoke do dashboard atual, incluindo `/observability` com `Sinal motorista stale`, alerta `driver_signal_stale` e `booking-signal-stale`, sem chamadas diretas do browser para Google, Woovi/OpenPix ou Firebase providers.

## Criterio de aceite

O fallback local so deve ser considerado pronto quando:

- uma corrida ativa nao some nem regride visualmente ao ficar offline;
- nenhum evento financeiro ou transacional e confirmado sem backend;
- reconexao sincroniza eventos idempotentes sem duplicar cobranca, recibo ou saldo;
- app relancado hidrata backend e descarta snapshot local mais antigo;
- passageiro e motorista sempre entendem se o dado exibido e atual ou ultimo conhecido.
