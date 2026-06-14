# Runtime Config + E2E Canary - 2026-06-11

## Objetivo

Validar a nova estrutura backend-first de runtime config, confirmar que os usuários de canary usam Woovi sandbox por perfil, manter mapas backend-only com cache de Places ativo, garantir geofence desativada e rodar um fluxo de corrida ponta a ponta usando API e Socket públicos.

## Escopo executado

- Deploy incremental do backend em `api.leaf.app.br`, sem sobrescrever `.env` remoto.
- Runtime config público validado em `/api/app/runtime-config`.
- Runtime flags validadas em `/health/runtime-flags`.
- Perfil de pagamento sandbox por usuários/telefones de canary validado.
- Patch no gate de motorista online para respeitar a política canônica de ativação antes de exigir KYC diário legado.
- Smoke Woovi sandbox real para criação/limpeza de cobrança.
- Smoke Socket.IO público com Redis adapter e multi-gateway.
- E2E de corrida normal com passageiro e motorista reais de teste.
- QA mobile production guards.
- QA backoffice com lint, build e smoke de navegação.

## Evidências

- Runtime config para motorista de teste:
  - `paymentRuntime.effectiveProfile.environment`: `sandbox`
  - `paymentRuntime.effectiveProfile.profileId`: `canary-review-phones-sandbox`
  - `mapsRoutingPolicy.backendOnly`: `true`
  - `mapsRoutingPolicy.clientDirectGoogleFallback`: `false`
  - `mapsRoutingPolicy.placesCacheEnabled`: `true`
  - `driverOnlinePolicy.geofenceEnforced`: `false`
  - `notificationPolicy.fcmConfigured`: `true`
- Perfil sandbox expira em `2026-06-12T05:57:07.025Z`.
- Woovi sandbox smoke:
  - `/Users/izaakdias/Documents/Leaf-new/test-results/woovi-sandbox/20260611T035557Z-runtime-profile.json`
- Socket public smoke:
  - `/Users/izaakdias/Documents/Leaf-new/test-results/socket-health/socket-health-smoke-1781161626072.json`
  - Redis adapter: healthy/ready.
  - Handshake p95/p99: `1207ms`.
  - Multi-gateway readiness: `PASS`.
  - Session ID unknown negative probe: `PASS`.
- E2E ride smoke:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/normal-ride-smoke-vps-1781161681836.json`
  - Status: `success`.
  - Driver online: `success`, attempt `1`.
  - Booking created: `booking_1781161699757_OjML1wSzdNRaynjqMRlSW1Y0LVy2`.
  - Driver received `newRideRequest`, accepted, arrived, started and completed the trip.
  - Passenger received `tripStarted` and `tripCompleted`.
  - Financial snapshot balanced:
    - Passenger paid: `R$ 27,50`.
    - Operational fee: `R$ 1,49`.
    - Payment intermediation fee: `R$ 0,50`.
    - Driver net amount: `R$ 25,51`.
    - Toll: `R$ 0,00`.
    - `financialContract.balanced`: `true`.
- Backoffice smoke:
  - `npm --prefix leaf-dashboard-js run qa:backoffice`
  - Lint, Next build and smoke passed.
  - Routes checked: `/dashboard`, `/support`, `/campaign-center`, `/drivers/review-queue`, `/financial-reconciliation`, `/runtime-flags`.
  - Browser smoke confirmed no direct calls to Google, Woovi/OpenPix or Firebase providers.
- Mobile guard:
  - `npm --prefix mobile-app run qa:production-guards`
  - PASS.

## Ajuste aplicado

`leaf-websocket-backend/server.js` now consults `driver-activation-state-service` inside `enforceDailyKYCForOnline`.

If the canonical activation state says the driver can go online and does not require liveness, the socket online gate allows the driver. If the canonical state blocks the driver, the socket returns the canonical blocking reason. This prevents the legacy daily KYC check from contradicting the current driver activation policy.

## Ressalvas

- The full E2E used `CANARY_DIRECT_PAYMENT_CONFIRMATION=true` after creating the Woovi sandbox charge. This confirms the internal ledger/holding and ride lifecycle without requiring a locally forged Woovi signed webhook.
- A direct unsigned webhook attempt correctly failed with `401`, because production webhook verification is strict.
- The direct canary confirmation was run locally and produced Redis local retry noise, but the E2E completed successfully against the public API/socket and remote Firebase state.
- The runtime flags endpoint currently reports KYC strict biometric controls as disabled/unconfigured. This matches the current operational decision, but remains a production-hardening item before strict biometric enforcement.
- Compose still reports known orphan containers: `leaf-pricing-baseline-worker` and `leaf-ride-health-monitor-worker`; no cleanup was performed in this scope.

## Rollback

- Revert the backend patch in `leaf-websocket-backend/server.js`.
- Rebuild/recreate `websocket`, `websocket-gateway-2` and `websocket-gateway-3`.
- Disable the canary sandbox payment profile if needed from the payment runtime profile store.

