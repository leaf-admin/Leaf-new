# Implementacao Runtime, H3, Pricing e Lifecycle - 2026-03-29

## Escopo consolidado
Este documento consolida as alteracoes realizadas na rodada avancada de runtime operacional do projeto Leaf, cobrindo quatro frentes integradas:

1. lifecycle de corrida com extensao, encerramento prematuro e continuidade operacional
2. H3 backend-first para leitura operacional de oferta e demanda
3. engine de pricing dinamico baseada em contexto operacional por microrregiao
4. refinamentos de UX no app do motorista e do passageiro

O objetivo desta entrega foi fortalecer o dominio operacional sem reabrir o legado como caminho principal, preservando a arquitetura atual baseada em VPS + Redis + Firestore + mobile prototype.

## 1. Lifecycle de corrida
### Fluxos implementados
- extensao de corrida por aditivo:
  - passageiro solicita novo destino
  - motorista aceita ou recusa
  - Pix complementar confirma a alteracao
  - novo destino so se torna oficial apos pagamento confirmado
- encerramento prematuro por solicitacao do passageiro:
  - bloqueio de `cancelRide` apos `startTrip`
  - settlement autoritativo com valor executado + refund liquido
- interrupcao operacional:
  - motorista pode interromper por motivo operacional legitimo
  - passageiro escolhe continuar com outro motorista ou encerrar ali
  - continuidade mantida na mesma corrida com `rideLegs`
  - taxa operacional da segunda perna absorvida pela plataforma

### Componentes principais
- backend:
  - `leaf-websocket-backend/services/ride-lifecycle-service.js`
  - `leaf-websocket-backend/services/ride-state-manager.js`
  - `leaf-websocket-backend/utils/trip-completion-payload.js`
  - `leaf-websocket-backend/workers/worker-billing.js`
- comandos:
  - `RequestRideExtensionCommand`
  - `RespondRideExtensionCommand`
  - `EndRideEarlyByRiderCommand`
  - `InterruptRideOperationalCommand`
  - `RespondOperationalContinuationCommand`
- runtime mobile:
  - `mobile-app/src/screens/prototype/prototypeRideRuntime.js`

### Evidencias principais
- `leaf-websocket-backend/reports/ride-lifecycle-readiness-2026-03-29.md`
- `leaf-websocket-backend/reports/ride-lifecycle-evidence-2026-03-29.md`
- `leaf-websocket-backend/reports/operational-reassignment-smoke-vps-1774751630780.json`
- `leaf-websocket-backend/reports/ride-lifecycle-smoke-vps-1774753389691.json`

## 2. H3 backend-first
### Decisao arquitetural
O H3 foi implementado como read model geoespacial no backend. A source of truth continua sendo Redis GEO para localizacao. O cliente apenas envia viewport e renderiza `Polygon` com o boundary retornado pelo backend.

### Contrato
Endpoint principal:
- `GET /api/map/h3-cells`

Entradas:
- `bbox`
- `zoom`
- `surface`
- `mode`
- `includeBoundary`
- `includeEmpty`

Saida por cell:
- `h3Index`
- `center`
- `boundary`
- `metrics`
- `style`

### Implementacao
- backend:
  - `leaf-websocket-backend/services/h3-map-service.js`
  - `leaf-websocket-backend/routes/dashboard.js`
  - `leaf-websocket-backend/utils/prometheus-metrics.js`
  - `leaf-websocket-backend/utils/map-h3-refresh-broadcaster.js`
  - `leaf-websocket-backend/services/dashboard-websocket.js`
- dashboard:
  - `leaf-dashboard-js/app/maps/page.js`
  - `leaf-dashboard-js/src/components/map/GoogleDriversMap.js`
  - `leaf-dashboard-js/src/services/api.js`
- mobile motorista:
  - `mobile-app/src/services/runtime/h3MapService.js`
  - `mobile-app/src/components/prototype/PrototypeMapLayer.js`
  - `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js`

### Refinamentos visuais aplicados
- remocao de texto redundante de status do motorista
- remocao do card debug de leitura de oferta/demanda
- bordas e preenchimento do H3 suavizados
- transicao visual continua entre clusters, evitando saltos duros por faixa
- cancelamentos de request por `AbortController` deixaram de poluir o runtime com warning de Axios

### Evidencias principais
- `leaf-websocket-backend/reports/h3-backend-first-v1-2026-03-29.md`
- `leaf-websocket-backend/reports/smoke-h3-map-vps-1774816120094.json`
- `leaf-websocket-backend/reports/h3-style-polish-vps-1774831187482.json`
- `leaf-websocket-backend/reports/h3-style-gradient-vps-1774831438913.json`

## 3. Pricing dinamico por microrregiao H3
### Objetivo
A engine de pricing passou a considerar:
- distancia
- duracao com trafego
- score de pressao operacional
- score de excecao
- adicional de pickup
- estado operacional da regiao

### Modulos de dominio
Localizados em `leaf-websocket-backend/services/pricing/`:
- `utils.js`
- `pressureScore.js`
- `exceptionScore.js`
- `operationalState.js`
- `dynamicRules.js`
- `calculateFare.js`
- `index.js`

### Provider operacional
`leaf-websocket-backend/services/pricing-context-provider.js` deriva contexto real a partir da microrregiao H3 do pickup, olhando oferta, demanda, vizinhanca e baseline heuristico local.

### Integracao backend
- `leaf-websocket-backend/services/fare-estimation-service.js`
- `leaf-websocket-backend/commands/RequestRideCommand.js`
- `leaf-websocket-backend/routes/pricing.js`
- `POST /api/pricing/quote`

### Integracao mobile
- passageiro:
  - `mobile-app/src/services/runtime/pricingQuoteService.js`
  - `mobile-app/src/components/map/PassengerUI.js`
- runtime:
  - `mobile-app/src/screens/prototype/prototypeRideRuntime.js`

### Resultado funcional
- `estimateRideFare(...)` continua compatível com o fluxo legado
- agora tambem devolve:
  - `pricingPayload`
  - `operationalState`
  - `scorePressao`
  - `scoreExcecao`
  - `exceptionalMode`
- o booking persiste esses metadados no create/request
- o passageiro recebe `passenger_notice` curta no card, sem expor H3 ou formula

### Evidencias principais
- `leaf-websocket-backend/reports/dynamic-pricing-smoke-vps-1774828650289.json`
- `leaf-websocket-backend/reports/dynamic-pricing-derived-smoke-vps-1774829550550.json`
- `leaf-websocket-backend/reports/pricing-quote-route-smoke-vps-1774830605025.json`

## 4. UX do motorista e do passageiro
### Motorista
- mapa H3 como principal leitura operacional
- sem card textual tipo "Regiao estavel"
- sem card de debug com oferta/demanda
- overlay mais leve e menos agressivo

### Passageiro
- continua sem visualizacao de H3
- recebe no maximo uma mensagem curta de demanda quando aplicavel
- cotacao local foi enriquecida por quote autoritativo do backend

## 5. Validacao consolidada
### Backend e VPS
- deploys controlados realizados na VPS
- smokes remotos executados para lifecycle, H3 e pricing
- health checks confirmados apos rebuilds relevantes

### iOS Simulator
- validacao do motorista no iPhone 16e
- validacao do passageiro no iPhone 17 Pro em rodadas anteriores de runtime
- warning de Axios saneado no fluxo atual do H3

### Cobertura de testes
Foram adicionados ou atualizados testes unitarios para:
- pricing core
- fare estimation service
- pricing context provider
- RequestRideCommand
- H3 service

## 6. Limitacoes conhecidas
- baseline do pricing ainda e heuristico/local no v1; nao esta materializado por dia e faixa horaria em storage proprio
- histerese do pricing context esta em memoria do processo no v1
- parte do runtime canonical da VPS ainda depende de `server.vps.js`, que concentra multiplas responsabilidades e merece separacao adicional
- Android fisico segue como validacao pendente em alguns fluxos avancados por questao de ambiente/ADB
- Cloud Billing API continua fora do fluxo confiavel de custo exato por SKU

## 7. Proximos passos recomendados
1. materializar baseline e historico operacional por H3 em Redis
2. expor `driver_region_status` via payload backend dedicado para a home do motorista, sem texto redundante
3. reduzir acoplamento do runtime canonical da VPS, movendo mais fluxo para bootstrap modular
4. fechar a trilha de validacao visual final do passageiro para cotacao dinamica no simulator
5. abrir a fase 2 do H3 como sinal auxiliar de dispatch, mantendo Redis GEO como source of truth

## 8. Evidencias complementares
Outros artefatos relevantes desta rodada:
- `leaf-websocket-backend/reports/current-runtime-service-map-2026-03-29.md`
- `leaf-websocket-backend/reports/scenario-service-window-summary-1774753771638.json`
- `leaf-websocket-backend/reports/ride-lifecycle-implementation-wave1-2026-03-28.md`
- `leaf-websocket-backend/docs/implementation/RIDE_LIFECYCLE_EXTENSION_AND_EARLY_END_SPEC_2026-03-28.md`

