# Notification Orchestrator Runbook

Data: 2026-06-06  
Branch: `codex/runtime-config-rollout`  
Ticket: `LEA-93`

## Objetivo

Centralizar notificacoes automaticas do ciclo de vida do app em uma matriz versionada no backend, sem deixar o app mobile decidir sozinho quando comunicar usuario, motorista ou suporte.

O orquestrador cobre:

- eventos transacionais de conta, cadastro, documento e pagamento;
- eventos do ciclo de corrida;
- suporte/chat/chamados;
- campanhas persistidas;
- base futura para smart push/ML.

## Regra Operacional

1. O backend e a fonte de verdade.
2. O app renderiza notificacoes, registra ack/read/action e continua funcional mesmo se push falhar.
3. Smart push/ML fica em `dry_run` ate haver dados, aprovacao operacional e feature flag dedicada.
4. Dispatch manual pelo endpoint administrativo fica em `dry_run` por padrao.
5. Envio real pelo endpoint `/api/notifications/orchestration/dispatch` exige `ALLOW_NOTIFICATION_ORCHESTRATOR_DIRECT_SEND=true`.
6. Nenhuma rota do orquestrador chama Google, Woovi, Firebase client-side ou API externa paga para montar matriz, preview ou stats.

## Endpoints

| Endpoint | Auth | Uso |
| --- | --- | --- |
| `GET /api/notifications/orchestration/matrix` | JWT autenticado | Auditar matriz versionada de eventos, canais, dedupe e rate limit |
| `GET /api/notifications/orchestration/stats?date=YYYY-MM-DD` | JWT autenticado | Ler metricas agregadas no Redis |
| `POST /api/notifications/orchestration/preview` | admin/manager/dev | Gerar preview de copy/metadados sem persistir e sem enviar push |
| `POST /api/notifications/orchestration/dispatch` | admin/manager/dev | Executar dispatch orquestrado; dry-run por padrao |
| `GET /api/notifications/stats` | JWT autenticado | FCM + scheduler + metricas do orquestrador em um payload |

## Matriz Inicial

Eventos implementados em `leaf-websocket-backend/services/notification-orchestrator-service.js`:

- `account.signup_completed`
- `driver.document_pending`
- `driver.document_rejected`
- `driver.document_approved`
- `driver.approved_to_drive`
- `ride.requested`
- `ride.offer_received`
- `ride.accepted`
- `ride.driver_arrived`
- `ride.started`
- `ride.completed`
- `payment.pix_created`
- `payment.pix_approved`
- `payment.pix_failed`
- `payment.pix_expired`
- `receipt.available`
- `support.chat_message_received`
- `support.ticket_updated`
- `support.ticket_resolved`
- `campaign.available`
- `smart_push.driver_demand_recommendation`

Cada evento define:

- categoria;
- audiencia;
- canais;
- titulo e corpo;
- prioridade;
- canal Android/iOS;
- janela de dedupe;
- rate limit;
- quiet hours;
- opt-in quando marketing/comportamental.

## Idempotencia, Dedupe E Rate Limit

Idempotencia usa a melhor chave disponivel:

1. `idempotencyKey` explicita;
2. `bookingId`;
3. `rideId`;
4. `paymentId`;
5. `ticketId`;
6. `campaignId`;
7. hash estavel do contexto.

Redis:

- dedupe: `notification_orchestrator:dedupe:{hash}`;
- rate limit: `notification_orchestrator:rate:{date}:{eventType}:{userId}`;
- metricas: `notification_orchestrator_metrics:{date}`;
- historico: `notification_orchestrator:history:{recordId}`;
- lista diaria: `notification_orchestrator:history:{date}`.

TTL padrao de historico: 35 dias.

## Smart Push / ML

O evento `smart_push.driver_demand_recommendation` existe para preparar a ingestao futura:

- hoje roda sempre em `dry_run`;
- exige opt-in de marketing/comportamental;
- respeita quiet hours;
- limite padrao: 1 por motorista/dia;
- registra metricas e historico para aprender com supressoes/preview.

Para habilitar envio automatico no futuro, sera necessario:

1. modelo versionado;
2. criterio minimo de confianca;
3. janela operacional aprovada;
4. dashboard com preview e rollback;
5. feature flag separada;
6. teste com coorte pequena;
7. revisao de custo/opt-out.

## Custo

Esta camada nao aumenta custo de Google/Woovi/Firestore por si so.

Custos envolvidos:

- Redis: chaves pequenas com TTL;
- FCM: apenas quando houver push real;
- dashboard: leitura agregada via backend.

O browser do dashboard nao deve chamar Firebase, Google, Woovi ou qualquer provedor externo diretamente.

## Validacoes Executadas

Comandos:

```bash
node -c leaf-websocket-backend/services/notification-orchestrator-service.js
node -c leaf-websocket-backend/routes/notifications.js
npm --prefix leaf-websocket-backend run test:unit -- --runTestsByPath tests/unit/services/notification-orchestrator-service.unit.test.js tests/unit/routes/notifications-routes-auth.unit.test.js --runInBand
```

Resultado:

- 2 suites passaram.
- 16 testes passaram.
- Nenhuma chamada externa paga foi necessaria.

## Checklist De Operacao

Antes de liberar envio real:

- confirmar `ALLOW_NOTIFICATION_ORCHESTRATOR_DIRECT_SEND=false` em producao assistida;
- validar preview no backoffice;
- validar push real em coorte controlada;
- validar opt-out/quiet hours;
- validar historico e metricas no Redis;
- revisar copys com suporte/operacao;
- manter smart push em dry-run ate existir volume real e aprovacao operacional.
