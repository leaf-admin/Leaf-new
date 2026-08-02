# Devkit Tecnico Leaf - 2026-05-23

Este documento e a visao geral tecnica para onboarding de desenvolvedores Leaf. Ele foi montado a partir do estado local do repositorio em `2026-05-23`, no caminho `/Users/izaakdias/Documents/Leaf-new`.

Importante: este devkit nao contem valores de segredos. Arquivos `.env`, chaves Firebase, keystores Android/iOS e credenciais de producao devem ficar fora de Git e fora de qualquer pacote enviado a fornecedores.

## 1. Resumo executivo

Leaf e um monorepo de mobilidade urbana com:

- App mobile React Native/Expo para passageiro e motorista.
- Backend Node.js/Express/Socket.IO para corridas em tempo real, pagamentos, KYC, suporte, dashboard, metricas, workers e integracoes.
- Dashboard administrativo Next.js para operacao, suporte, usuarios, motoristas, campanhas, financeiro, mapas e observabilidade.
- Landing page estatica para marketing/legal/waitlist.
- Servicos auxiliares: orquestrador de suporte N1/N2/N3, KYC Python, observabilidade com Tempo/Grafana/Prometheus/Alertmanager.

O projeto esta em transicao controlada: existe legado vivo no mobile e backend, mas ha docs canonicos de limpeza e regras claras para nao quebrar a build aprovada.

## 2. Estado do repositorio

- Branch atual no momento da analise: `codex/stabilize-leaf-runtime-campaigns`.
- Worktree atual contem muitas mudancas locais nao commitadas em mobile, backend e dashboard. Trate o estado atual como "work in progress".
- Arquivos rastreados: `3437`.
- Maiores diretorios locais:
  - `mobile-app`: cerca de `20G`, principalmente builds/artefatos locais.
  - `reports`: cerca de `1.9G`, evidencias e resultados locais.
  - `leaf-websocket-backend`: cerca de `184M`.
  - `leaf-dashboard-js`: cerca de `255M`.
  - repo completo: cerca de `35G`.
- Contagem de arquivos rastreados por area:
  - `mobile-app`: `1280`
  - `leaf-websocket-backend`: `1080`
  - `docs`: `521`
  - `scripts`: `212`
  - `landing-page`: `151`
  - `leaf-dashboard-js`: `60`
  - `services`: `47`

## 3. Fontes de verdade

Leia nesta ordem:

1. `README.md`
2. `CONTRIBUTING.md`
3. `docs/README.md`
4. `docs/PROJECT_STATE_2026-05-16.md`
5. `docs/MIGRATION_CLEANUP_PLAN_2026-05-16.md`
6. `docs/TEST_EXECUTION_CANONICAL_PROFILE.md`
7. `docs/VALIDATION_EVIDENCE_2026-05-16.md`
8. `docs/RELEASE_FREEZE_MANIFEST_2026-05-16.md`
9. `docs/support/LEAF_SUPPORT_PLAYBOOK.md`
10. `docs/security/P0-SECRETS-CONFIG-AUDIT-2026-05-21.md`

Docs historicos ficam em `docs/archive/` e nao devem ser usados como fonte primaria para novas tarefas.

## 4. Workspaces ativos

O `package.json` raiz usa `npm workspaces` com:

- `leaf-websocket-backend`
- `leaf-dashboard-js`
- `mobile-app`

Comandos raiz principais:

```bash
npm run bootstrap
npm run dev:backend
npm run dev:dashboard
npm run dev:mobile
npm run dev:orchestrator
npm run build:dashboard
npm run lint:dashboard
npm run test:mobile
npm run test:backend
npm run test:backend:all
npm run test:all
npm run security:scan
npm run prelaunch:audit
npm run branch:task -- LIN-123 nome-curto
```

## 5. Stack e versoes relevantes

Raiz:

- npm workspaces.
- Dependencias compartilhadas: `axios`, `express`, `socket.io`, `firebase-admin`, `ioredis`, `cors`, `helmet`, `dotenv`.

Mobile (`mobile-app/package.json`):

- Expo `^54.0.0`
- React `19.1.0`
- React Native `0.81.5`
- Jest `~29.7.0`
- Principais libs: React Navigation, Firebase RN, Expo Location/Notifications/Camera/Updates, Socket.IO client, React Native Maps, Mapbox polyline, H3, Reanimated, Gesture Handler, AsyncStorage.

Backend (`leaf-websocket-backend/package.json`):

- Node `>=20.19.0`
- Express `^4.18.2`
- Socket.IO `^4.7.2`
- Firebase Admin `^12.7.0`
- Redis/ioredis
- GraphQL/Apollo, OpenTelemetry, Prometheus, AWS Rekognition, Sharp, Tesseract, PDF/XLSX utilities.

Dashboard (`leaf-dashboard-js/package.json`):

- Next `16.1.0`
- React `19.2.3`
- TypeScript `^5.9.3`
- Tailwind/PostCSS
- Socket.IO client
- Google Maps React API

Support Orchestrator:

- Node `>=20.19.0`
- Express `^5.1.0`
- ioredis, socket.io-client, helmet, cors.

KYC Python:

- Python `3.9+`
- FastAPI, Uvicorn, OpenCV, MediaPipe, Redis, Celery, Pillow, NumPy, Pydantic, HTTPX.

## 6. Mapa de diretorios

Raiz:

- `mobile-app/`: app mobile ativo.
- `leaf-websocket-backend/`: backend em tempo real, REST, workers, dashboard APIs e integracoes.
- `leaf-dashboard-js/`: dashboard admin atual.
- `landing-page/`: site estatico, politicas legais, exclusao de conta e paginas de marketing.
- `services/support-agent-orchestrator/`: copiloto/orquestrador de suporte.
- `services/kyc-service/`: KYC facial Python legado, mantido temporariamente para decisao de migracao.
- `services/face-compare-service/`: comparacao facial atual usada pelo backend.
- `observability/`: Tempo, Prometheus, Grafana, Alertmanager.
- `scripts/`: workflow, deploy, validacao, prelaunch, manutencao.
- `tests/`: harness antigo de testes WebSocket.
- `reports/`: evidencias locais e resultados de validacao, geralmente ignorado.
- `.github/`: workflows e template de PR.
- `config/`: configuracoes externas, principalmente Firebase/Nginx.
- `web-app/`: diretorio local nao ativo no Git; nao faz parte do workspace atual.

## 7. Arquitetura de alto nivel

Fluxo principal:

1. App mobile autentica via Firebase/Auth ou rotas OTP/password.
2. App abre Socket.IO contra `https://socket.leaf.app.br` ou ambiente de teste.
3. Backend autentica socket, coloca usuario em rooms `customer_{uid}` ou `driver_{uid}`.
4. Passageiro cria booking via evento `createBooking`.
5. Backend valida pagamento/preco/geofence/disponibilidade, grava estado em Redis/Firestore e publica eventos.
6. Dispatcher busca motoristas por geohash/H3/preferencias e emite ofertas.
7. Motorista responde `acceptRide`/`rejectRide`.
8. Lifecycle segue por `confirmPayment`, `startTrip`, `updateTripLocation`, `completeTrip`, avaliacao e recibo.
9. Dashboard consome APIs REST e WebSocket autenticados com JWT admin.
10. Workers processam side effects, notificacoes, billing, baseline de pricing e health de corridas.

Dependencias operacionais centrais:

- Redis: estado quente, filas, streams, locks, geospatial cache.
- Firebase Auth: identidade usuario/mobile.
- Firestore/Realtime Database/Storage: perfis, dados persistidos, documentos, mirrors legados.
- Woovi/OpenPix: Pix, charge, webhook, split/subcontas.
- Google Maps/Mapbox/LocationIQ/OSM: geocoding, directions, mapas, places.
- FCM: push notifications.
- OpenTelemetry/Prometheus/Grafana/Discord: observabilidade e alertas.

## 8. Mobile app

Caminho: `mobile-app/`.

Entradas:

- `mobile-app/index.js`
- `mobile-app/App.js`
- `mobile-app/src/navigation/AppNavigator.js`

UI principal:

- `mobile-app/src/screens/RobotaxiPrototypeScreen.js` apenas reexporta `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js`.
- Telas principais Robotaxi ficam em `mobile-app/src/screens/prototype/`.
- Runtime pesado do fluxo Robotaxi fica em `mobile-app/src/screens/prototype/prototypeRideRuntime.js` com cerca de `16893` linhas.

Pontos importantes:

- Store atual: `mobile-app/src/state/appStore.js` reexporta `mobile-app/src/common-local/store`.
- `mobile-app/src/common-local` e legado vivo. Nao criar novas dependencias nele; migrar por dominio antes de remover.
- O runtime privado monta exclusivamente a interface Robotaxi; nao existe opt-out para o mapa anterior.
- `prototypeRideRuntime.js` faz ponte com WebSocket, maps, pagamentos, chat, notificacoes, onboarding de motorista, documentos, recibos e persistencia local.
- `WebSocketManager.js` tem cerca de `5096` linhas e controla conexao, autenticacao, retry, sync de active ride, booking, driver status, FCM e eventos.
- Existem `38` imports atuais de `common-local` dentro de `mobile-app/src`.

Config mobile:

- `mobile-app/app.config.js`: Expo config dinamica.
- `mobile-app/eas.json`: perfis `development`, `preview`, `release-test`, `production`, `production-apk`, `production-review`.
- `mobile-app/config/AppConfig.js`: app `Leaf`, bundle id `br.com.leaf.ride`, iOS version `1.0.1`, iOS build `23`, Android versionCode `110`.
- `mobile-app/metro.config.js`: aliases `@`, `@components`, `@screens`, `@services`, `@utils`, `@config`, `@common`, `@common-local`; resolve `axios` para browser bundle; bloqueia modulos Node-only.
- `mobile-app/babel.config.js`: `babel-preset-expo` + `react-native-reanimated/plugin`.
- `mobile-app/jest.config.js`: preset `jest-expo`.

URLs mobile:

- API default: `https://api.leaf.app.br`
- Socket default: `https://socket.leaf.app.br`
- Dashboard default: `https://dashboard.leaf.app.br`
- `NetworkConfig.js` e `ApiConfig.js` removem `/api` duplicado e derivam socket a partir de API quando necessario.

Feature flags mobile:

- `KYC_ENABLED`
- `PILOT_CONTROLLED_LAUNCH`
- `PILOT_DRIVER_WITHDRAWALS_ENABLED`
- `PILOT_REFERRAL_PROGRAMS_ENABLED`
- `PILOT_LEAF_DELAS_ENABLED`
- `PILOT_DRIVER_DESTINATION_MODE_ENABLED`
- `PILOT_DYNAMIC_PRICING_ENABLED`
- `PILOT_SMART_PUSH_ENABLED`
- `PILOT_SOFT_BAN_ENFORCEMENT_ENABLED`
- `PILOT_ADMIN_MUTATIONS_ENABLED`

Runtime access gates:

- `APP_REVIEW`
- `EXPO_PUBLIC_E2E_TEST`
- `EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS`
- `EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK`
- `EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW`
- `EXPO_PUBLIC_FORCE_PAYMENT_BYPASS`
- `EXPO_PUBLIC_BYPASS_PAYMENTS`

Build e release:

- EAS usa Node `20.19.4` nos perfis de release.
- `production` usa OTA channel `production`.
- `preview` usa APK interno e iOS Release.
- `production-review` liga `APP_REVIEW=true`.
- `EXPO_PUBLIC_ALLOW_INSECURE_HTTP=false` em perfis de producao.

Testes mobile:

- Unit: `cd mobile-app && npm run test:unit`
- Coverage: `npm run test:unit:coverage`
- E2E Maestro:
  - `mobile-app/.maestro/flows/auth/`
  - `mobile-app/.maestro/flows/rides/`
  - `mobile-app/.maestro/flows/driver/`
  - `mobile-app/.maestro/flows/payments/`
  - `mobile-app/.maestro/flows/qa/e2e/`
  - `mobile-app/.maestro/flows/qa/e2e/lifecycle/`
  - `mobile-app/.maestro/flows/qa/e2e/wave4/`
- Resultados Maestro ficam em `mobile-app/.maestro/results/` e devem ser ignorados como artefatos.

## 9. Backend

Caminho: `leaf-websocket-backend/`.

Dois runtimes vivos:

- `leaf-websocket-backend/server.vps.js`: runtime de producao/VPS atual. Arquivo grande, cerca de `13032` linhas.
- `leaf-websocket-backend/server.js`: runtime modular em migracao, cerca de `1341` linhas.

Regra: nao remover `server.vps.js` enquanto a producao depender dele. Antes de migrar, comparar rotas/eventos entre `server.vps.js` e `bootstrap/register-http-routes.js`.

Entradas e bootstrap:

- `server.js`
- `server.vps.js`
- `bootstrap/http-middleware.js`
- `bootstrap/register-http-routes.js`
- `bootstrap/register-runtime-endpoints.js`
- `bootstrap/create-socket-server.js`
- `bootstrap/start-http-server.js`
- `bootstrap/init-runtime-services.js`
- `bootstrap/register-socket-*.js`

Rotas HTTP principais registradas:

- Auth: `/auth`, `/api/auth`, `/api/custom-otp`, `/api/auth/password`, `/api/admin/auth`
- KYC/OCR: `/api/kyc`, `/api/kyc-proxy`, `/api/kyc-analytics`, `/api/ocr`, `/api/kyc-onboarding`
- Support/Ops: `/api/support`, `/api/ops`
- Geofence: `/api/geofence`
- Referral/programs: `/api/programs/referrals`
- Campaign Center: `/api/campaign-center`
- Dashboard/user management: varias rotas em `/api/users`, `/api/drivers`, `/api/metrics`, `/api/reports`, `/api/map`, `/api/subscriptions`, `/api/promotions`
- Pricing: `/api/pricing/categories`, `/api/pricing/quote`
- Demand/smart push: `/api/demand`
- Waitlist: `/api/waitlist/*`
- Payment/Woovi: `/api/payment/*`, `/api/woovi/*`
- Notifications: `/api/notifications`
- Health: `/health`, `/api/health`, `/health/quick`, `/health/readiness`, `/health/liveness`, `/health/runtime-flags`
- Queue/workers: `/api/queue/*`, `/api/workers/*`
- Places: `/api/places/*`
- Legal: `/privacy-policy`, `/terms-of-service`, `/refund-policy`, `/account-deletion`, `/api/legal/links`

Socket inbound events principais:

- Auth/session: `authenticate`, `disconnect`, `syncActiveRide`
- FCM: `registerFCMToken`, `unregisterFCMToken`
- Booking/payment: `checkRideAvailability`, `createBooking`, `confirmPayment`, `rideCostTelemetry`
- Driver dispatch: `setDriverStatus`, `updateDriverLocation`, `driverHeartbeat`, `searchDrivers`, `cancelDriverSearch`
- Ride lifecycle: `acceptRide`, `rejectRide`, `driverResponse`, `startTrip`, `updateTripLocation`, `completeTrip`, `cancelRide`
- Advanced lifecycle: `endTripEarlyByRider`, `interruptRideOperational`, `respondOperationalContinuation`, `endRideWithReview`, `requestRideExtension`, `respondRideExtension`
- Location/passenger: `updateLocation`, `passengerLocationUpdate`
- Safety/support/chat: `reportIncident`, `emergencyContact`, `support:chat:message`, `createSupportTicket`, `createChat`, `sendMessage`, `reportProblem`
- Rating/feedback: `submitRating`, `getTripRatings`, `getUserRatings`, `hasUserRatedTrip`, `submitFeedback`
- Promotions: `get_promos`, `get_user_promos`, `validate_promo_code`, `get_promo_by_code`, `apply_promo`
- Notifications/admin: `notificationAction`, `sendNotification`, `sendNotificationToUser`, `sendNotificationToUserType`, `updateNotificationPreferences`

Socket outbound events principais:

- Auth: `authenticated`, `authentication_error`, `auth_error`, `sessionTerminated`, `activeRideSync`
- Booking/payment: `bookingCreated`, `bookingError`, `paymentConfirmed`, `paymentError`, `paymentDistributed`, `paymentRefunded`
- Dispatch: `driversFound`, `noDriversFound`, `driverSearchCancelled`, `driverSearchError`, `rideAccepted`, `rideRejected`, `acceptRideError`, `rejectRideError`
- Lifecycle: `tripStarted`, `tripStartError`, `tripLocationUpdated`, `tripCompleted`, `tripCompleteError`, `rideCancelled`, `rideCancellationError`
- Advanced lifecycle: `boardingWindowExpired`, `tripIntegrityCheckRequired`, `tripIntegrityCancelled`, `rideOperationalInterruption`, `rideOperationalContinuationSearching`, `rideOperationalReleased`, `rideExtensionPaymentRequired`, `rideExtensionPendingPayment`, `rideExtensionRejected`
- Driver: `driverStatusUpdated`, `driverStatusError`, `driverLocationUpdated`, `locationUpdated`, `locationError`, `driverArrived`, `arrivedAtPickup`
- Support/chat: `support:chat:sent`, `support:chat:error`, `supportTicketCreated`, `supportTicketError`, `messageSent`, `messageError`, `newMessage`
- FCM/notifications: `fcmTokenRegistered`, `fcmTokenUpdated`, `fcmTokenError`, `notificationSent`, `notificationActionSuccess`
- Rating/promos: `ratingSubmitted`, `ratingError`, `promos_loaded`, `promo_code_validated`, `promo_applied`

Arquitetura interna:

- `commands/`: Command handlers CQRS para Request/Accept/Start/Complete/Cancel/Extend/End/Interrupt rides.
- `events/`: eventos canonicos `ride.requested`, `ride.accepted`, `ride.rejected`, `ride.canceled`, `ride.started`, `ride.completed`, `driver.online`, `driver.offline`, `payment.confirmed`.
- `listeners/`: side effects como notificacao de motorista/passageiro, push e timers.
- `workers/`: workers para listeners pesados, trip location, billing, pricing baseline, ride health.
- `services/`: maior parte da regra de negocio.
- `routes/`: APIs REST.
- `middleware/`: Firebase/JWT/support auth, WAF, rate limit, trace id.
- `utils/`: Redis pool, CORS runtime, logger, OpenTelemetry, JWT secret resolver, geohash, pricing/dispatch helpers.

Servicos de negocio importantes:

- Dispatch/ride: `ride-queue-manager`, `ride-state-manager`, `ride-lifecycle-service`, `ride-persistence-service`, `offer-reservation-service`, `driver-dispatch-availability-service`, `driver-eligibility-service`, `driver-lock-manager`, `vehicle-lock-manager`.
- Payment/Woovi: `payment-service`, `payment-dispatch-service`, `financial-ledger-service`, `ride-settlement-service`, `woovi-driver-service`.
- Pricing: `services/pricing/*`, `fare-estimation-service`, `pricing-context-provider`, `pricing-h3-read-model-service`, `pricing-baseline-materializer`.
- Maps/geofence: `places-cache-service`, `geofence-service`, `h3-map-service`, `geospatial-cache`, `operational-area-policy-service`.
- KYC/docs: `IntegratedKYCService`, `kyc-service`, `kyc-policy-service`, `aws-face-liveness-service`, `document-ai-extraction-service`, `ocr-service`.
- Support: `support-ticket-service`, `support-chat-service`, `support-queue-service`, `safety-incident-service`.
- Observability: `metrics-collector`, `modern-metrics-service`, `alert-service`, `ops-overview-service`, `ride-cost-telemetry-service`, `ride-health-monitor`.
- Campaign/growth: `campaign-center-service`, `promotion-service`, `referral-program-state-service`, `demand-prediction-service`, `demand-notification-service`.

Workers e streams:

- `workers/listener-worker.js`
- `workers/worker-trip-location.js`
- `workers/worker-billing.js`
- `workers/pricing-baseline-worker.js`
- `workers/ride-health-monitor-worker.js`
- Redis stream principal: `ride_events`
- DLQ: `ride_events_dlq`
- Consumer group padrao: `listener-workers`

Docker/backend:

- `leaf-websocket-backend/Dockerfile`
- `leaf-websocket-backend/docker-compose.production.yml`
- `leaf-websocket-backend/docker-compose.local.yml`
- `leaf-websocket-backend/docker-compose.ops-workers.yml`
- `leaf-websocket-backend/docker-compose.realtime-secondary.yml`
- `leaf-websocket-backend/nginx.conf`

Compose canonico de VPS (`docker-compose.production.yml`) contem:

- `redis`
- `websocket`
- `sideeffects-worker`
- `billing-worker`
- `nginx`

Overlay operacional (`docker-compose.ops-workers.yml`) contem:

- `pricing-baseline-worker`
- `ride-health-monitor-worker`

Variaveis/backend criticas por grupo:

- Redis: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`, `REDIS_URL`
- Firebase: `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`
- JWT/admin: `JWT_SECRET`, `ADMIN_JWT_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_JWT_REFRESH_SECRET`
- CORS/runtime: `CORS_ORIGIN`, `ALLOW_LOCAL_CORS`, `ALLOW_PRIVATE_CORS`, `ALLOW_NGROK_CORS`, `RUNTIME_ADMIN_TOKEN`, `RESTART_TOKEN`
- Socket/admission: `SOCKET_ADMISSION_ENABLED`, `SOCKET_ADMISSION_MAX_INFLIGHT`, `SOCKET_ADMISSION_MAX_QUEUE`, `SOCKET_ADMISSION_MAX_WAIT_MS`, `AUTH_VERIFY_*`
- Dispatch/matching: `DISPATCH_*`, `MATCH_*`
- Feature gates: `ENABLE_LEAF_DELAS`, `ENABLE_DRIVER_DESTINATION_MODE`, `ENABLE_DYNAMIC_PRICING`, `ENABLE_SMART_PUSH`, `ENABLE_RIDE_EXTENSION_FLOW`, `ENABLE_RIDER_EARLY_END`, `ENABLE_OPERATIONAL_REASSIGNMENT`, `ENABLE_MULTI_LEG_BILLING`
- Legacy gates: `ENABLE_LEGACY_RUNTIME_ENDPOINTS`, `ENABLE_LEGACY_SOCKET_BRIDGE`, `ENABLE_LEGACY_SOCKET_NOTIFICATIONS`, `ENABLE_LEGACY_*`
- Payment/Woovi: `WOOVI_*`, `OPENPIX_*`, `LEAF_PIX_KEY`, `LEAF_WOOVI_ACCOUNT_ID`, `PAYMENT_*`
- KYC/AWS: `KYC_*`, `AWS_*`
- Observability: `ENABLE_METRICS`, `OTEL_*`, `TEMPO_ENDPOINT`, `DISCORD_*`, `RIDE_COST_*`

Seguranca backend:

- `utils/jwt-secret-resolver.js` gera fallback local efemero se segredo JWT faltar, mas producao deve sempre configurar segredo real.
- `utils/runtime-cors-config.js` permite dominios oficiais, sslip runtime, loopback/dev se liberado por flags e origens de `CORS_ORIGIN`.
- `middleware/support-auth.js` aceita admin JWT ou Firebase token e aplica roles.
- `middleware/firebase-user-auth.js` exige Firebase bearer para rotas de usuario.
- Producao deve manter `WOOVI_WEBHOOK_REQUIRE_SIGNATURE=true`, `WOOVI_WEBHOOK_ALLOW_UNSIGNED=false`, `PAYMENT_BYPASS_ON_WOOVI_FAILURE=false`, `PAYMENT_FORCE_BYPASS=false`.

Testes backend:

- `cd leaf-websocket-backend && npm run test:unit`
- `cd leaf-websocket-backend && npm run test:integration`
- `cd leaf-websocket-backend && npm run test:e2e`
- `cd leaf-websocket-backend && npm run test:all`
- `npm run test:route-guards --workspace leaf-websocket-backend`

Ha cerca de `130` arquivos de teste no backend, cobrindo unit, integration, e2e, routes, services, commands, workers e utils.

## 10. Dashboard admin

Caminho: `leaf-dashboard-js/`.

Stack:

- Next.js App Router.
- React 19.
- CSS global em `app/globals.css`.
- Auth client-side em `src/contexts/AuthContext.js` e `src/services/auth-service.js`.
- API client em `src/services/api.js`.
- WebSocket client em `src/services/websocket-service.js`.

Paginas:

- `/dashboard`
- `/login`
- `/users`
- `/users/:id`
- `/drivers`
- `/drivers/review-queue`
- `/maps`
- `/metrics`
- `/metrics/history`
- `/metrics/marketplace`
- `/observability`
- `/notifications`
- `/campaign-center`
- `/programs`
- `/promotions`
- `/subscriptions`
- `/financial-reconciliation`
- `/financial-simulator`
- `/reports`
- `/support`
- `/waitlist`

Config:

- `leaf-dashboard-js/src/config/index.js`
- API default dev: `http://localhost:3001/api`
- API default prod: `https://api.leaf.app.br/api`
- WS default dev: `http://localhost:3001`
- WS default prod: `https://socket.leaf.app.br`

Proxy interno:

- `app/api/[...path]/route.js`: proxy para backend usando `LEAF_DASHBOARD_API_PROXY_TARGET` ou `https://api.leaf.app.br/api`.
- `app/api/support-orchestrator/[...path]/route.js`: proxy protegido para o orquestrador de suporte. Valida token admin no backend antes de enviar `X-Orchestrator-Token`.

Auth:

- Login: `/api/admin/auth/login`
- Refresh: `/api/admin/auth/refresh`
- Verify: `/api/admin/auth/verify`
- Logout: `/api/admin/auth/logout`
- Tokens ficam em `sessionStorage` com migracao suave de `localStorage`.

Basic auth opcional:

- Proxy em `leaf-dashboard-js/proxy.js`
- Vars: `DASHBOARD_BASIC_AUTH_ENABLED`, `DASHBOARD_BASIC_AUTH_USER`, `DASHBOARD_BASIC_AUTH_PASSWORD`
- Ignora rotas `/api/*`.

Docker:

- `leaf-dashboard-js/Dockerfile`
- `leaf-dashboard-js/docker-compose.contabo.yml`
- Service: `leaf-dashboard`
- Porta externa default: `3010`, interna `3000`.

Comandos:

```bash
cd leaf-dashboard-js
npm run dev
npm run build
npm run start
npm run lint
```

## 11. Landing/legal

Caminho: `landing-page/`.

Arquivos principais:

- `index.html`: landing principal.
- `em-breve.html`
- `calculadora.html`
- `cidades.html`
- `categorias-motorista.html`
- `categorias-passageiro.html`
- `quem-somos.html`
- `privacy-policy.html`
- `terms-of-service.html`
- `excluir-conta.html`
- `excluir-conta/index.html`
- `_headers`: headers Cloudflare Pages.
- `.well-known/security.txt`
- `deploy-to-cloudflare.sh`
- `DEPLOY_CLOUDFLARE.md`

Deploy recomendado:

- Cloudflare Pages com root/output `landing-page`.
- Build command vazio, site estatico.

Peculiaridades:

- `excluir-conta.html` carrega Firebase SDK via CDN e chama `/api/account/delete`.
- `calculadora.html` chama endpoint `https://api.leaf.app.br/api/metrics/calculator` em producao.
- `landing-page/assets/referencia-files` e legado de referencia, mas algumas paginas ainda podem depender de assets/CSS.

## 12. Support Agent Orchestrator

Caminho: `services/support-agent-orchestrator/`.

Objetivo:

- Camada desacoplada de copiloto de suporte.
- Consulta playbook aprovado, APIs internas Leaf e filas/chat/tickets.
- Classifica atendimento em N1/N2/N3, categoria, prioridade, confianca e flags de risco.
- Gera sugestoes e executa somente acoes seguras aprovadas por humano.
- Nao usa web search.

Entrada:

- `src/index.js`
- `src/server.js`
- `src/routes/api.js`

Componentes:

- `agents/classifier.js`
- `agents/n1-agent.js`
- `agents/n2-router.js`
- `agents/n3-diagnostics.js`
- `orchestrator/support-orchestrator.js`
- `knowledge/playbook-store.js`
- `storage/json-file-store.js`
- `clients/leaf-api-client.js`
- `clients/redis-subscriber.js`
- `clients/socket-listener.js`
- `policies/guardrails.js`

Endpoints:

- `GET /health`
- `GET /v1/status`
- `GET /v1/runs`
- `GET /v1/runs/:runId/actions`
- `POST /v1/runs/:runId/actions`
- `GET /v1/tickets/:ticketId/analysis`
- `POST /v1/tickets/:ticketId/analyze`
- `GET /v1/tickets/:ticketId/actions`
- `POST /v1/tickets/:ticketId/actions`
- `POST /v1/chat/analyze`

Acoes permitidas:

- `internal_note`
- `escalate_ticket`

Variaveis:

- `PORT`
- `LEAF_API_BASE_URL`
- `LEAF_API_TOKEN`
- `LEAF_WS_URL`
- `SUPPORT_ORCHESTRATOR_TOKEN`
- `SUPPORT_ORCHESTRATOR_ALLOW_MISSING_TOKEN`
- `SUPPORT_PLAYBOOK_PATH`
- `SUPPORT_STORE_PATH`
- `SUPPORT_AUTONOMOUS_MODE`
- `SUPPORT_MIN_CONFIDENCE`
- `ENABLE_SUPPORT_POLLING`
- `ENABLE_REDIS_SUBSCRIBER`
- `ENABLE_SOCKET_LISTENER`
- `REDIS_URL`
- `SUPPORT_CHAT_REDIS_CHANNEL`
- `CORS_ORIGIN`

Comandos:

```bash
cd services/support-agent-orchestrator
cp .env.example .env
npm install
npm run dev
npm run check
npm test
```

## 13. KYC services

KYC Python:

- Caminho: `services/kyc-service/`
- Entrada worker: `src/main.py`
- FastAPI: `src/api/main.py`
- API otimizada: `src/api/optimized_api.py`
- Config: `config/kyc_config.py`, `config/redis/redis_config.yaml`
- Streams: `kyc:verification`, `kyc:results`, `kyc:analytics`
- Objetivo: verificacao facial/liveness de motoristas.

Endpoints Python principais:

- `GET /`
- `GET /health`
- `POST /verify`
- `POST /upload_profile_image`
- `POST /verify_driver`
- `POST /batch_verify`

Comandos:

```bash
cd services/kyc-service
pip install -r requirements.txt
python src/main.py
```

KYC Node experimental:

- Removido no bloco de limpeza de 2026-05-29.
- O fluxo atual deve usar `leaf-websocket-backend/routes/kyc-routes.js` e `services/face-compare-service`.

## 14. Observabilidade

Caminho: `observability/`.

Stack:

- Tempo: traces OpenTelemetry.
- Grafana: dashboards.
- Prometheus: metricas.
- Alertmanager: alertas.

Compose:

- `docker-compose.observability.yml`
- Services: `tempo`, `grafana`, `alertmanager`, `prometheus`.

Portas locais:

- Grafana: `http://localhost:3002`
- Tempo: `http://localhost:3200`
- OTLP gRPC: `4317`
- OTLP HTTP: `4318`
- Prometheus: `http://localhost:9090`
- Alertmanager: `http://localhost:9093`

Backend expoe:

- `/api/metrics/prometheus`
- `/api/metrics/observability`
- `/api/workers/health`
- `/api/workers/lag`
- `/api/workers/dlq`
- `/health/runtime-flags`
- `/api/ops/overview`
- `/api/ops/alerts`

Docs:

- `observability/README.md`
- `observability/README_DASHBOARDS.md`
- `docs/observability/ride-cost-and-earnings.md`

## 15. Testes e validacao

Perfil canonico:

- `docs/TEST_EXECUTION_CANONICAL_PROFILE.md`
- Os scripts npm imprimem perfil antes de executar testes.
- E2E default deve apontar para os dominios canonicos atuais, salvo override explicito por variavel de ambiente:
  - Socket: `https://socket.leaf.app.br`
  - API: `https://api.leaf.app.br`

Comandos oficiais:

```bash
npm run test:profile
npm run test:mobile
npm run test:backend
npm run test:backend:all
npm run test:all
npm run lint:dashboard
npm run build:dashboard
npm run prelaunch:testids
npm run prelaunch:copy
npm run prelaunch:audit
```

Prelaunch/validation:

- `scripts/prelaunch/run-prelaunch-suite.cjs`
- `scripts/validation/init-validation-run.cjs`
- `scripts/validation/run-master-validation.sh`
- `scripts/validation/run-wave0-preflight.sh`
- `scripts/validation/run-wave1-auth-kyc.sh`
- `scripts/validation/run-wave2-eligibility.sh`
- `scripts/validation/run-wave3-ideal.sh`
- `scripts/validation/run-wave4-*`

Regras de evidencia:

- UI dinamica espera 15s, salvo teste de resposta imediata.
- Cenarios UI exigem screenshot/video.
- Backend/regra de negocio exige log, JSON, Redis ou evidencia de persistencia.
- Status de cenario deve terminar em `pass`, `fail` ou `blocked`.

Baseline validado em `docs/VALIDATION_EVIDENCE_2026-05-16.md`:

- `npm run test:mobile`: 53 suites, 246 testes.
- `npm run test:backend`: 90 suites unitarias + 5 integracao, 369 testes.
- `npm run build:dashboard`: Next build OK com 22 rotas.
- `npm run prelaunch:audit`: PASS/GO naquela branch.

## 16. CI/CD

Workflows:

- `.github/workflows/secret-guard.yml`
- `.github/workflows/eas-build.yml`

Secret Guard:

- Roda em pull requests e pushes para `main`, `master`, `develop`.
- Executa `leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`.
- Executa `npm run security:scan`.

Leaf Release Gate:

- Roda para PRs que tocam `leaf-websocket-backend/**`, `mobile-app/**` ou workflow.
- Jobs:
  - `validate-backend`: `npm ci`, `npm run config:validate`, `npm run test:route-guards`, unit e integration.
  - `validate-mobile`: `npm ci`, `npm run qa:production-guards`, testes focados de auth.
  - `eas-build`: manual via `workflow_dispatch`, depende dos dois validadores.

PR template:

- `.github/pull_request_template.md`
- Exige resumo, Linear, tipo, validacao, risco/rollback e evidencias.

## 17. Deploy e ambientes

Dominios canonicos:

- API: `https://api.leaf.app.br`
- Socket: `https://socket.leaf.app.br`
- Dashboard: `https://dashboard.leaf.app.br`
- Landing/legal: dominio Cloudflare da Leaf.

Ambiente remoto compartilhado de teste:

- API: `https://api.leaf.app.br`
- Socket: `https://socket.leaf.app.br`
- SSH host: configurar via `VPS_HOST`/`SSH_KEY_PATH` nos scripts operacionais.

Backend VPS:

- Runtime atual: modular em `server.js` (`LEAF_SERVER_RUNTIME=modular`).
- Rollback legado preservado temporariamente: `server.vps.js`.
- Compose principal: `leaf-websocket-backend/docker-compose.production.yml`.
- Deploy operacional atual documentado em workers como:

```bash
bash leaf-websocket-backend/scripts/ops/deploy-dashboard-rbac-vps.sh
```

Scripts de deploy/manutencao relevantes:

- `scripts/healthcheck-vps.sh`
- `leaf-websocket-backend/scripts/deploy-contabo-docker.sh`
- `leaf-websocket-backend/scripts/deploy/deploy-secondary-realtime-host.sh`
- `leaf-websocket-backend/scripts/deploy/validate-runtime-config.js`
- `leaf-websocket-backend/scripts/ops/*`

Dashboard:

- `leaf-dashboard-js/docker-compose.contabo.yml`
- Porta externa default: `3010`

Landing:

- Cloudflare Pages recomendado.
- Build command vazio.
- Build output/root: `landing-page`.

## 18. Segredos e arquivos sensiveis

Nunca enviar para devkit externo:

- `mobile-app/.env*`
- `leaf-websocket-backend/.env*`
- `leaf-dashboard-js/.env.local`
- `web-app/.env`
- `google-services.json`
- `GoogleService-Info.plist`
- `firebase-credentials.json`
- `mobile-app/config/leaf-reactnative-firebase-adminsdk-*.json`
- `leaf-websocket-backend/leaf-reactnative-firebase-adminsdk-*.json`
- `.jks`, `.keystore`, `.p12`, `.pfx`, `.pem`, `.key`, `.crt`, `.cer`

O `.gitignore` ja ignora esses caminhos. O dev novo deve receber:

- Templates `.env.example` quando existirem.
- Lista de variaveis necessarias.
- Acesso a segredos via secret manager/operador autorizado.

Rodar antes de qualquer PR:

```bash
npm run security:scan
npm run security:scan -- --tracked-only
```

Para modo estrito:

```bash
npm run security:scan -- --strict-content
```

## 19. Peculiaridades que dev novo precisa saber

1. Existem dois runtimes backend. Producao atual e `server.vps.js`; `server.js` e modularizacao em andamento.
2. O mobile principal e Robotaxi UI, mas ainda ha legado vivo em `common-local` e telas antigas.
3. Nao criar novas dependencias em `mobile-app/src/common-local`.
4. Nao apagar `server.vps.js`.
5. `web-app/` existe localmente, mas nao e workspace ativo e nao tem arquivos rastreados.
6. Muitos docs antigos foram arquivados; use `docs/README.md` e docs canonicos.
7. Os testes E2E default usam ambiente remoto compartilhado; falhas podem ser causadas por estado remoto, Redis, credenciais ou flags.
8. `APP_REVIEW=true` muda comportamento de auth/pagamento e pode mascarar falhas.
9. Payment bypass deve ficar desligado em producao.
10. Woovi webhook deve exigir assinatura em producao.
11. Redis em producao deve ter senha; compose local antigo pode ter Redis sem auth e nao deve virar producao.
12. O dashboard usa proxy Next para evitar CORS no browser local.
13. O orquestrador de suporte e copiloto guardado: sem autosend e sem autoresolve.
14. `reports/`, `.codex-artifacts/`, builds mobile e resultados Maestro sao artefatos locais, nao fonte de verdade.
15. Mobile carrega fontes Inter no boot e libera a UI antes de WebSocket/FCM terminar para reduzir tempo de abertura.
16. Socket auth tem admission control e cache de token para reduzir burst de `verifyIdToken`.
17. O backend usa Redis locks/idempotencia em booking, payment, accept ride e lifecycle; evitar mudancas que quebrem idempotency keys.
18. Rotas sensiveis exigem guards; rode `npm run test:route-guards --workspace leaf-websocket-backend`.
19. `landing-page/excluir-conta.html` depende de Firebase Web SDK e backend de exclusao de conta.
20. O projeto tem muitas features atras de flags; nao assumir que feature presente no codigo esta liberada em producao.

## 20. Primeiro dia de um desenvolvedor

Setup recomendado:

```bash
cd /Users/izaakdias/Documents/Leaf-new
npm run bootstrap
npm run test:profile
npm run lint:dashboard
npm run build:dashboard
npm run test:mobile
npm run test:backend
npm run security:scan
```

Rodar local:

```bash
npm run dev:backend
npm run dev:dashboard
npm run dev:mobile
npm run dev:orchestrator
```

Branch de tarefa:

```bash
npm run branch:task -- LIN-123 nome-curto
```

Se nao houver Linear:

```bash
npm run branch:task -- nome-curto
```

Checklist antes de abrir PR:

- Entendeu se a area e mobile, backend, dashboard, landing, suporte, KYC ou operacao.
- Verificou docs canonicos.
- Confirmou flags envolvidas.
- Evitou mexer em segredos e artefatos.
- Rodou validacao proporcional ao risco.
- Preencheu `.github/pull_request_template.md`.
- Incluiu risco, rollback e evidencias.

## 21. Escopo por area para novos devs

Mobile:

- Implementar e corrigir fluxos do app em `mobile-app/src/screens/prototype`, `mobile-app/src/components/prototype`, `mobile-app/src/services` e `mobile-app/src/services/runtime`.
- Criar servicos canonicos em `mobile-app/src/services` para reduzir dependencia de `common-local`.
- Manter testes em `mobile-app/__tests__`.

Backend:

- Preferir servicos, commands, listeners e bootstrap modular quando possivel.
- Se mexer em producao real, validar `server.vps.js`.
- Cobrir rotas/servicos com testes em `leaf-websocket-backend/tests/unit` ou `tests/integration`.
- Respeitar Redis/idempotencia/locks.

Dashboard:

- Implementar paginas em `leaf-dashboard-js/app`.
- Reusar `src/services/api.js`, `src/services/auth-service.js`, `src/services/websocket-service.js`.
- Reusar componentes `src/components/ui`.
- Rodar `npm run lint:dashboard` e `npm run build:dashboard`.

Landing/legal:

- Site estatico em HTML/CSS/JS.
- Garantir paths Cloudflare e headers.
- Nao introduzir backend dentro da landing; chamar APIs existentes.

Support/orchestrator:

- Seguir `docs/support/LEAF_SUPPORT_PLAYBOOK.md`.
- Manter modo copiloto guardado.
- Persistencia atual e JSON local; proxima evolucao deve ser banco operacional.

KYC:

- Python KYC e separado e ainda precisa decisao arquitetural para producao ampla.
- Backend tambem possui integracoes KYC e AWS Face Liveness.

## 22. Backlog estrategico conhecido

De `docs/roadmap/strategic-backlog-execution-2026-05-21.md`:

- Orquestrador N1/N2/N3: copiloto produtivo com JSON durable, sem autosend/autoresolve.
- Convites/waitlist: backend + dashboard, com leads da landing.
- Leaf Delas: base mobile/backend existe, flag de rollout controlado.
- Destino do motorista: base mobile/socket/backend existe, flag propria.
- Tarifa dinamica: engine backend e badge mobile existem, flag propria.
- Smart push/ML: heuristica v0 e preview admin, ainda assistido.
- UI mobile pos-canary: refinamento final depende de canary real Android/iOS.

Gates antes de producao ampla:

- Canary real Android/iOS com passageiro e motorista cobrindo Pix, match, aceite, chegada, inicio, finalizacao e ledger.
- Push real em background e deep link para corrida ativa.
- Leaf Delas em cenarios disponivel/indisponivel/genero ausente.
- Destino motorista ativo/expirado/fora de rota.
- Tarifa dinamica normal/aquecida/excepcional.
- Smart push em preview ate feedback `sent/opened/actioned/suppressed`.
- QA visual final depois do canary.

## 23. Referencias rapidas por caminho

- App entry: `mobile-app/index.js`, `mobile-app/App.js`
- Navegacao mobile: `mobile-app/src/navigation/AppNavigator.js`
- UI Robotaxi: `mobile-app/src/screens/prototype/`
- Runtime Robotaxi: `mobile-app/src/screens/prototype/prototypeRideRuntime.js`
- WebSocket mobile: `mobile-app/src/services/WebSocketManager.js`
- Config mobile: `mobile-app/app.config.js`, `mobile-app/eas.json`, `mobile-app/src/config/`
- Store mobile: `mobile-app/src/state/appStore.js`, `mobile-app/src/common-local/store.js`
- Backend producao: `leaf-websocket-backend/server.vps.js`
- Backend modular: `leaf-websocket-backend/server.js`
- Rotas backend: `leaf-websocket-backend/routes/`
- Bootstrap backend: `leaf-websocket-backend/bootstrap/`
- Servicos backend: `leaf-websocket-backend/services/`
- Commands/events/listeners: `leaf-websocket-backend/commands/`, `events/`, `listeners/`
- Workers backend: `leaf-websocket-backend/workers/`
- Dashboard pages: `leaf-dashboard-js/app/`
- Dashboard API client: `leaf-dashboard-js/src/services/api.js`
- Dashboard auth: `leaf-dashboard-js/src/services/auth-service.js`
- Dashboard proxy: `leaf-dashboard-js/app/api/`
- Landing: `landing-page/`
- Orchestrator: `services/support-agent-orchestrator/`
- KYC Python: `services/kyc-service/`
- Observability: `observability/`
- Validacao: `scripts/validation/`, `scripts/prelaunch/`
- Workflow branch: `scripts/workflow/new-task-branch.sh`
- Security scan: `scripts/maintenance/security/scan-secrets.cjs`
