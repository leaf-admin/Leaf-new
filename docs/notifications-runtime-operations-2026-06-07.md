# Leaf Notifications Runtime Operations - 2026-06-07

## Objetivo

Padronizar notificacoes push, notificacoes persistidas e observabilidade do ciclo de vida da corrida sem aumentar chamadas externas pagas.

## Fonte de verdade

- Backend: `leaf-websocket-backend/services/notification-orchestrator-service.js`
- FCM: `leaf-websocket-backend/services/fcm-service.js`
- API operacional: `/api/notifications`, `/api/notifications/stats`, `/api/notifications/orchestration/*`
- Dashboard: `/notifications`
- Mobile: `mobile-app/src/services/PersistentRideNotificationService.js`

O app nao decide sozinho politica critica de notificacao. Ele renderiza payloads recebidos, registra leitura/ack e usa runtime config como fallback conservador.

## Matriz operacional

Eventos de corrida possuem:

- `category`: dominio do evento, por exemplo `ride_lifecycle`.
- `channels`: push, persisted, smart_push ou dry-run.
- `ttlSeconds`: validade do evento para evitar notificacao antiga.
- `dedupeWindowSeconds`: janela para reduzir duplicidade.
- `persistentRideStatus`: indica se o evento alimenta notificacao persistida/timeline.

Eventos de smart push permanecem em `dryRun` ate haver dados suficientes e aprovacao operacional.

## Observabilidade

O dashboard `/notifications` mostra:

- tokens FCM ativos;
- envios, sucessos, falhas e taxa de sucesso;
- quantidade de pushes de status da corrida;
- matriz do ciclo de vida da corrida;
- historico recente do orquestrador;
- politica efetiva: envio direto, smart push e versao da matriz.

As leituras sao agregadas pelo backend/Redis. O browser nao chama Google, Woovi, Firebase ou outro provedor pago diretamente.

## Persistent ride notification

Payloads de ride status incluem:

- `notificationPolicyVersion`
- `notificationDataType=ride_status`
- `notificationCategoryId`
- `ttlSeconds`
- `dedupeWindowSeconds`
- `timelineMode=eta_progress`
- `etaKind`

Estados `completed`, `cancelled` e `canceled` devem limpar a notificacao ativa da corrida.

### Plataformas

- Android: usa slot nativo estavel `43001` quando `notificationPolicy.androidNativePersistentSlotEnabled=true`. O fallback Expo so entra se o modulo nativo nao estiver disponivel.
- iOS: o contrato de runtime ja esta preparado para `notificationPolicy.iosLiveActivityMode=live_activity`, usando o adapter nativo esperado `LeafRideActivity.startOrUpdate/end`.
- iOS permanece com `iosLiveActivityEnabled=false` por padrao. Enquanto o modulo nativo/Widget Extension nao existir, o app cai no fallback `expo-notifications` quando `iosNotificationFallbackEnabled=true`.

Esse desenho evita tentar simular notificacao persistente Android no iOS com remove/recreate. A experiencia premium no iOS deve ser implementada com Live Activity / ActivityKit.

## Criterios de smoke

Backend:

```bash
npm --prefix leaf-websocket-backend run test:unit -- --runInBand \
  tests/unit/services/fcm-service.unit.test.js \
  tests/unit/services/notification-orchestrator-service.unit.test.js \
  tests/unit/routes/notifications-routes-auth.unit.test.js
```

Mobile:

```bash
npm --prefix mobile-app run test:unit -- --runInBand \
  __tests__/persistent-ride-notification-service.test.js
npm --prefix mobile-app run qa:production-guards
```

Dashboard:

```bash
npm --prefix leaf-dashboard-js run lint
npm --prefix leaf-dashboard-js run build
```

Device:

- Android fisico: validar permissao, push foreground/background, status de corrida e limpeza no fim.
- iOS fisico: validar push com `GoogleService-Info.plist` correto, background/locked quando possivel e registrar limitacoes do sistema.

## Pendencias conhecidas

- UI nativa da Live Activity / Dynamic Island ainda exige frente iOS separada: criar Widget Extension, ActivityKit attributes/state, layout compacto/expandido e, se necessario, token de update remoto.
- Smart push/ML deve continuar `disabled` ou `dryRun` ate termos base real e aprovacao operacional.
- Smoke iOS final depende de device fisico com build que contenha o plist correto.
