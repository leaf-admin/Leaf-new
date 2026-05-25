# Fechamento da Lista Completa - 2026-03-19

## Escopo
Consolidação dos itens solicitados para:
1. protótipo UI/UX
2. backend operacional
3. dashboard de gestão
4. convites/campanhas/founder
5. geografia e capacidade por cidade

## Entregas implementadas neste fechamento

### 1) Geografia + capacidade por cidade
Status: ✅ Implementado

- `routes/geofence-routes.js`
  - Cidade passou a suportar:
    - `maxActiveDrivers`
    - `waitlistEnabled`
  - `PATCH /api/geofence/admin/cities/:stateCode/:cityKey` agora atualiza:
    - ativação da cidade
    - capacidade
    - estado da waitlist
  - Resumo de geografia agora inclui `totalCapacity`.

- Dashboard (`app/maps/page.js`)
  - Na mesma tela de Geofence:
    - edição de capacidade por cidade
    - habilitar/desabilitar waitlist por cidade
    - salvar configuração por cidade

### 2) Waitlist por cidade + limite por cidade
Status: ✅ Implementado

- `routes/waitlist.js`
  - Entrada na waitlist agora registra e respeita cidade (`cityKey`, `cityLabel`, `stateCode`).
  - Posição da fila passa a ser **por cidade**.
  - Aprovação de motorista valida limite de ativos por cidade.
  - Reordenação e ajuste de posições da fila consideram a cidade.
  - `GET /api/waitlist/stats` retorna agregado por cidade (`byCity`) com:
    - pendentes/aprovados/rejeitados
    - capacidade e slots
    - estado de ativação da cidade/waitlist

- Dashboard (`app/waitlist/page.js`)
  - filtro por cidade
  - tabela de capacidade por cidade
  - exibição da cidade em cada motorista da fila

### 3) Métricas de marketplace pedidas (incluindo densidade)
Status: ✅ Implementado

- `routes/metrics.js` (`GET /api/metrics/marketplace`)
  - adicionadas métricas:
    - `passengerDriverRatio`
    - `driversPerKm2`
    - `coverageAreaKm2`

- Dashboard (`app/metrics/marketplace/page.js`)
  - cards novos com essas métricas.

### 4) Mapa com motoristas ativos em azul + indicadores
Status: ✅ Implementado

- `src/components/map/GoogleDriversMap.js`
  - marcador azul para motoristas no Google Maps.

- `routes/dashboard.js` (`GET /api/map/locations`)
  - resumo agora inclui:
    - `passengerDriverRatio`
    - `driverDensityPerKm2`

- Dashboard (`app/maps/page.js`)
  - KPIs visíveis para razão passageiro/motorista e motoristas por km².

### 5) Sistema de convites/campanhas/founder (configurável)
Status: ✅ Implementado

- Novo backend: `routes/referral-programs.js`
  - Configuração global:
    - `GET/PATCH /api/programs/referrals/config`
  - Campanhas:
    - `GET/POST /api/programs/referrals/campaigns`
    - `PATCH /api/programs/referrals/campaigns/:campaignId`
  - Convites motorista:
    - `POST /api/programs/referrals/invites/driver`
    - limite por motorista
    - dedupe de convidado
    - parâmetros por campanha (corridas/meta/janela/recompensa)
  - Convites passageiro:
    - `POST /api/programs/referrals/invites/passenger`
    - desconto configurável (até 10% por configuração)
    - não cumulativo por configuração
  - Aceite de convite:
    - `POST /api/programs/referrals/invites/accept`
  - Avaliação de qualificação por corridas:
    - `POST /api/programs/referrals/invites/driver/evaluate`
  - Founder:
    - `POST /api/programs/referrals/founder/assign`
  - Visão consolidada:
    - `GET /api/programs/referrals/summary`
    - `GET /api/programs/referrals/invites/me`

- Registro de rota
  - `bootstrap/register-http-routes.js`

- Dashboard
  - novo módulo `app/programs/page.js`
  - novo item de navegação `Convites`
  - API client com métodos de `programs/referrals`

### 6) Notificações segmentadas no dashboard
Status: ✅ Implementado

- `app/notifications/page.js`
  - envio com segmentação por tipo de usuário
  - filtros temporais (horas/dias/meses)
  - integração com endpoint existente de notificações filtradas

## Itens já existentes e mantidos
Status: ✅ Já existente

- Fluxos core websocket, PIX/Woovi, corrida ponta a ponta e suite backend verde.
- Geofence com ativação de estado/cidade.
- Gestão de assinaturas e métricas financeiras avançadas.
- Métricas de tempo de aceite, pickup médio, churn e retenção no marketplace health.

## Validação técnica executada após o fechamento
Status: ✅ Executado

- Backend (sanidade sintática):
  - `node --check` em:
    - `routes/waitlist.js`
    - `routes/geofence-routes.js`
    - `routes/metrics.js`
    - `routes/dashboard.js`
    - `routes/referral-programs.js`
    - `bootstrap/register-http-routes.js`

- Dashboard:
  - `npm run lint` ✅
  - `npm run build` ✅

## Observações de homologação
Status: ⚠ Necessário em ambiente integrado

- Convites/recompensas/founder dependem de dados reais de usuários/corridas no Firebase para validação final de negócio.
- Segmentação de push requer tokens FCM reais ativos para prova ponta a ponta em dispositivo.
- Limites por cidade precisam ser validados com operação real (entrada/aprovação em massa) para aferição de políticas de capacidade.

