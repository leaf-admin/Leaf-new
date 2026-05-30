# Linear Release Backlog Closure - 2026-05-30

## Escopo

Rodada de fechamento dos blocos `LEA-23`, `LEA-17`, `LEA-20`, `LEA-21`, `LEA-22`, `LEA-30`, `LEA-31` e `LEA-32`.

Objetivo: validar o que ja pode ser fechado por codigo/evidencia local e separar claramente o que ainda depende de console de loja, TestFlight/Internal Testing ou canary em device.

## Resultado Por Ticket

| Ticket | Status tecnico | Decisao |
|---|---|---|
| `LEA-17` | Fallback direto Google no mobile fica bloqueado por `runtimeAccessPolicy`; `HybridMapsService` tambem passou a usar a mesma policy. | Fechavel. |
| `LEA-20` | Pacote de privacidade/data safety pronto e links publicos validados. | Manter em review ate publicacao manual nos consoles. |
| `LEA-21` | Links legais publicos ativos em `https://leaf.app.br` com HTTP 200 e sem host temporario. | Fechavel. |
| `LEA-22` | App tem disclosure proeminente e requisicao centralizada de background location. | Manter em review ate video/declaração Play Console e build interna validada. |
| `LEA-23` | Canary tecnica e runtime smoke passaram. | Manter em review ate smoke oficial TestFlight/Internal Testing. |
| `LEA-30` | Fachadas canonicas criadas em `mobile-app/src/services/canonical`. | Fechavel. |
| `LEA-31` | Bridges runtime migrados para fachadas canonicas, sem imports diretos novos de `common-local`. | Fechavel. |
| `LEA-32` | Primeira fatia de `prototypeRideRuntime` concluida via `locationRouteBridge` -> `locationService`. | Manter em progresso para proximas fatias. |

## Evidencias Executadas Nesta Rodada

- `npm --prefix mobile-app run qa:production-guards`: PASS.
- `bash mobile-app/scripts/store-console-preflight.sh`: PASS, `22/22`, relatorio local em `mobile-app/reports/store/store-preflight-2026-05-30.md`.
- `npm --prefix mobile-app test -- --runTestsByPath __tests__/runtime-access-policy.test.js __tests__/google-api-functions.test.js --runInBand`: PASS, `16/16`.
- `npm --prefix mobile-app test -- --runTestsByPath __tests__/woovi-payment-modal.test.js __tests__/driver-balance-service-pilot.test.js --runInBand`: PASS, `6/6`.
- `cd mobile-app && EAS_BUILD_PROFILE=production npx expo config --type prebuild --json`: PASS; URLs legais em `leaf.app.br`; `allowClientDirectGoogleFallback=false`.
- `cd mobile-app && npx expo export --platform android --output-dir /tmp/leaf-export-check-android-closure`: PASS.
- `cd mobile-app && npx expo export --platform ios --output-dir /tmp/leaf-export-check-ios-closure`: PASS.
- `npm --prefix leaf-websocket-backend run smoke:runtime-full-ride-flow`: PASS, evidencia `test-results/runtime-full-ride-flow/runtime-full-ride-flow-smoke-1780132534343.json`.
- `npm --prefix leaf-websocket-backend run smoke:runtime-critical-events`: PASS, evidencia `test-results/runtime-critical-events/runtime-critical-events-smoke-1780132522505.json`.
- `npm --prefix leaf-websocket-backend run smoke:runtime-redis-adapter`: PASS, evidencia `test-results/runtime-redis-adapter/runtime-redis-adapter-smoke-1780132586328.json`.
- `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime`: PASS.
- `git diff --check`: PASS.
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`: PASS.

## Observacoes De Risco

- `LEA-20`, `LEA-22` e `LEA-23` possuem criterios que dependem de consoles externos ou device/release oficial. A base tecnica esta pronta, mas nao devem ser marcados como totalmente concluidos sem essa evidencia manual.
- `LEA-32` nao deve tentar extrair `prototypeRideRuntime` inteiro em uma so leva. O arquivo segue vivo e grande; a abordagem segura e extrair por dominio.
- `common-local` segue classificado como legado vivo, agora concentrado nas fachadas canonicas e em pontos conhecidos (`appStore`, tokens de tema e services canonicos).

## Proximas Fatias Recomendadas Para `LEA-32`

1. Extrair busca/cache de destino de `prototypeRideRuntime` para service dedicado.
2. Extrair quote lock e telemetria de custo.
3. Extrair heartbeat de localizacao por papel.
4. Extrair chat/notificacoes persistidas.
5. Reduzir `common-local` restante dentro das fachadas, uma por dominio.
