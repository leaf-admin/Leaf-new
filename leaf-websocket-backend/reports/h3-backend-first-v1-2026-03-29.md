# H3 Backend-First V1

Data: 2026-03-29

## Escopo fechado
- serviço H3 no backend com agregação por viewport
- endpoint `GET /api/map/h3-cells`
- métricas Prometheus do H3
- integração no dashboard
- integração no app do motorista via `Polygon`
- deploy na VPS
- smoke remoto do endpoint em produção

## Arquivos principais
- backend:
  - `services/h3-map-service.js`
  - `routes/dashboard.js`
  - `utils/prometheus-metrics.js`
- dashboard:
  - `src/services/api.js`
  - `src/components/map/GoogleDriversMap.js`
  - `app/maps/page.js`
- mobile:
  - `src/services/runtime/h3MapService.js`
  - `src/components/prototype/PrototypeMapLayer.js`
  - `src/screens/prototype/RobotaxiHomeScreen.js`

## Deploy
- VPS atualizada com:
  - `routes/dashboard.js`
  - `services/h3-map-service.js`
  - `utils/prometheus-metrics.js`
  - dashboard sincronizado por `rsync`
- backend saudável após restart do container

## Smoke remoto
Relatório JSON:
- `reports/smoke-h3-map-vps-1774812372900.json`

### Cenários validados
1. `rio-dashboard-zoom14`
   - `200`
   - `resolution=8`
   - `cells=38`
   - `activeTrips=994`
2. `rio-driver-zoom16`
   - `200`
   - `resolution=9`
   - `cells=136`
   - `activeTrips=994`
3. `sf-driver-include-empty`
   - `200`
   - `resolution=9`
   - `cells=223`
   - boundary e style válidos mesmo sem operação ativa

## Evidência visual
### Dashboard
- screenshots:
  - `/tmp/leaf-dashboard-h3-map-panel-v2.png`
  - `/tmp/leaf-dashboard-h3-map-focused.png`
- leitura real:
  - a página `/maps` nova está no ar
  - a seção Google Maps está presente
  - os toggles `Motoristas / Hex de oferta-demanda / Ambos` renderizam
  - os hexágonos H3 renderizam no painel do dashboard
  - foi necessário espelhar `GOOGLE_MAPS_API_KEY` para `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` no env do dashboard

### Mobile motorista
- screenshot base: `/tmp/leaf-driver-home-seeded.png`
- screenshot tentativa com viewport Rio: `/tmp/leaf-driver-home-rio-h3.png`
- screenshot com `includeEmpty` no fetch do driver: `/tmp/leaf-driver-home-h3-include-empty.png`
- leitura real:
  - a home do motorista segue íntegra
  - o overlay H3 ainda não apareceu nessa evidência local
  - o gargalo observado ficou concentrado no replay/bundle local do simulator
  - o endpoint H3 e a renderização do dashboard já provam a cadeia backend -> boundary -> polygon

## Achados importantes
1. O endpoint H3 está vivo e respondendo com boundary e métricas reais na VPS.
2. O dashboard remoto passou a renderizar a camada visual após receber `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
3. Para QA visual local via túnel, foi necessário liberar CORS de loopback:
   - `http://localhost:*`
   - `http://127.0.0.1:*`

## Ajustes operacionais feitos junto
- `server.vps.js`
- `server.js`

Esses arquivos passaram a aceitar origens loopback locais para QA controlado via túnel, sem abrir origem pública nova.

## Status
- backend H3: GO
- endpoint remoto: GO
- dashboard visual remoto: GO
- mobile visual H3: GO COM BLOQUEIO DE QA local

## Próximos passos recomendados
1. ajustar o replay/build local do simulator para materializar o overlay H3 do motorista na captura
2. decidir se `includeEmpty=true` deve ficar definitivo no surface do motorista ou só em QA
3. só depois considerar feed incremental por WebSocket
