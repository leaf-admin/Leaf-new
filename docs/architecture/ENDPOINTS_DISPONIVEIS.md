# 📋 Todos os Endpoints Disponíveis - Leaf Backend

## 🎯 Base URL
- **Desenvolvimento:** `http://localhost:3001`
- **Produção:** `http://216.238.107.59:3001`

---

## 🔐 Autenticação

### POST `/auth/login`
- Login de usuário
- Body: `{ email, password }`

### GET `/api/auth/verify`
- Verificar token de autenticação

### POST `/api/auth/refresh`
- Renovar token

### POST `/auth/logout`
- Logout

---

## 👥 Usuários

### GET `/api/users/stats`
- Estatísticas de usuários (total, clientes, motoristas, etc.)

### GET `/api/users`
- Listar usuários

---

## 🚗 Motoristas

### GET `/api/drivers/applications`
- Listar aplicações de motoristas

### POST `/api/drivers/applications/:id/approve`
- Aprovar motorista

### POST `/api/drivers/applications/:id/reject`
- Rejeitar motorista

### GET `/api/drivers/:driverId/documents`
- Documentos do motorista

### POST `/api/drivers/:driverId/documents/:documentType/review`
- Revisar documento

### GET `/api/drivers/active`
- Motoristas ativos

---

## 📊 Métricas

### GET `/api/metrics/rides/daily`
- Corridas do dia

### GET `/api/metrics/users/status`
- Status de usuários

### GET `/api/metrics/financial/rides`
- Métricas financeiras de corridas

### GET `/api/metrics/financial/operational-fee`
- Taxa operacional

### GET `/api/metrics/maps/rides-by-region`
- Corridas por região

### GET `/api/metrics/maps/demand-by-region`
- Demanda por região

### GET `/api/metrics/subscriptions/active`
- Assinaturas ativas

### GET `/api/metrics/waitlist/landing`
- Waitlist da landing page

### GET `/api/metrics/landing-page/analytics`
- Analytics da landing page

---

## 🗺️ Places Cache (NOVO)

### POST `/api/places/search`
- Buscar lugar no cache
- Body: `{ query: "BarraShopping", location: { lat, lng } }`

### POST `/api/places/save`
- Salvar lugar no cache
- Body: `{ query: "BarraShopping", placeData: {...} }`

### GET `/api/places/health`
- Health check do Places Cache

### GET `/api/places/metrics` ⭐ **MONITORAMENTO**
- Métricas do cache (hit rate, misses, saves, etc.)

### POST `/api/places/metrics/reset`
- Resetar métricas (testes)

---

## 🚦 Filas e Matching

### GET `/api/queue/status`
- Status das filas

### GET `/api/queue/region/:regionHash`
- Status de região específica

### GET `/api/queue/metrics`
- Métricas das filas

### GET `/api/queue/drivers/notified`
- Motoristas notificados

### GET `/api/queue/cache/stats`
- Estatísticas do cache de filas

### POST `/api/queue/cache/clear`
- Limpar cache de filas

### GET `/api/queue/worker/stats`
- Estatísticas do worker

---

## 🔍 KYC (Know Your Customer)

### POST `/api/kyc/upload-profile`
- Upload de foto de perfil

### POST `/api/kyc/verify-driver`
- Verificar motorista

### GET `/api/kyc/encoding/:userId`
- Obter encoding facial

### DELETE `/api/kyc/encoding/:userId`
- Deletar encoding

### GET `/api/kyc/stats`
- Estatísticas KYC

### GET `/api/kyc/health`
- Health check KYC

### GET `/api/kyc-analytics/analytics`
- Analytics KYC

### GET `/api/kyc-analytics/analytics/driver/:driverId`
- Analytics de motorista específico

### GET `/api/kyc-analytics/analytics/daily`
- Analytics diário

### GET `/api/kyc-analytics/analytics/realtime`
- Analytics em tempo real

---

## 📋 Waitlist

### POST `/api/waitlist/landing`
- Adicionar à waitlist (landing)

### GET `/api/waitlist/status`
- Status da waitlist

### POST `/api/waitlist/join`
- Entrar na waitlist

### DELETE `/api/waitlist/leave`
- Sair da waitlist

### GET `/api/waitlist/drivers`
- Motoristas na waitlist

### POST `/api/waitlist/approve`
- Aprovar da waitlist

### POST `/api/waitlist/reject`
- Rejeitar da waitlist

### PUT `/api/waitlist/position`
- Atualizar posição

### GET `/api/waitlist/stats`
- Estatísticas da waitlist

---

## 💳 Pagamentos

### POST `/payment/advance`
- Pagamento antecipado

### POST `/payment/confirm`
- Confirmar pagamento

### POST `/payment/refund`
- Reembolso

### POST `/payment/distribute`
- Distribuir pagamento

### GET `/payment/status/:rideId`
- Status do pagamento

### GET `/payment/calculate-net`
- Calcular valor líquido

---

## 📄 Recibos

### GET `/api/receipts/:rideId`
- Obter recibo

### POST `/api/receipts/generate`
- Gerar recibo

### GET `/api/receipts/user/:userId`
- Recibos do usuário

### GET `/api/receipts/:rideId/map`
- Mapa do recibo

### GET `/api/receipts/health`
- Health check de recibos

---

## 🗺️ Mapas

### GET `/api/map/locations`
- Localizações no mapa

### GET `/api/map/heatmap`
- Heatmap

### GET `/api/map/trip/:bookingId/route`
- Rota da corrida

---

## 📊 Dashboard

### GET `/api/metrics/financial`
- Métricas financeiras

### GET `/api/metrics/financial/advanced`
- Métricas financeiras avançadas

### GET `/api/analytics/bookings`
- Analytics de corridas

### GET `/api/metrics/services`
- Métricas de serviços

### GET `/api/subscriptions`
- Assinaturas

### GET `/api/subscriptions/stats`
- Estatísticas de assinaturas

### GET `/api/promotions`
- Promoções

### GET `/api/promotions/stats`
- Estatísticas de promoções

### POST `/api/promotions`
- Criar promoção

### GET `/api/passengers/active`
- Passageiros ativos

### GET `/api/trips/active`
- Corridas ativas

### GET `/api/live/stats`
- Estatísticas em tempo real

### GET `/api/reports/comprehensive`
- Relatório abrangente

### GET `/api/reports/export/:reportId`
- Exportar relatório

### GET `/api/monitoring/services`
- Monitoramento de serviços

### GET `/api/monitoring/health`
- Health check geral

### GET `/api/monitoring/performance`
- Performance

### GET `/api/analytics/growth`
- Analytics de crescimento

### GET `/api/analytics/growth/insights`
- Insights de crescimento

### GET `/api/analytics/growth/cohorts`
- Cohorts de crescimento

---

## 🔒 Driver Status

### GET `/api/driver-status/:driverId`
- Status do motorista

### GET `/api/driver-status/:driverId/lock`
- Lock do motorista

### POST `/api/driver-status/:driverId/clear-lock`
- Limpar lock

### POST `/api/driver-status/:driverId/test-request`
- Testar requisição

### GET `/api/driver-status/locks/all`
- Todos os locks

### POST `/api/driver-status/clear-all-locks`
- Limpar todos os locks

---

## 💬 Notificações

### GET `/notifications`
- Listar notificações

### POST `/notifications/send`
- Enviar notificação

### POST `/notifications/schedule`
- Agendar notificação

### GET `/notifications/scheduled`
- Notificações agendadas

### DELETE `/notifications/scheduled/:id`
- Deletar notificação agendada

### GET `/notifications/stats`
- Estatísticas de notificações

---

## 🗄️ Cache

### GET `/cache/stats`
- Estatísticas do cache

### GET `/cache/health`
- Health check do cache

### POST `/cache/invalidate/:queryType`
- Invalidar cache por tipo

### POST `/cache/invalidate-user/:userId`
- Invalidar cache de usuário

### POST `/cache/clear`
- Limpar todo o cache

### POST `/cache/invalidate-pattern`
- Invalidar por padrão

---

## 📝 Conta

### POST `/api/account/delete`
- Deletar conta

---

## 🎁 Promoções

### GET `/api/promotions`
- Listar promoções

### POST `/api/promotions`
- Criar promoção

### PATCH `/api/promotions/:promoId`
- Atualizar promoção

### GET `/api/promotions/analytics`
- Analytics de promoções

---

## 💰 Custos

### GET `/api/costs/per-trip`
- Custo por corrida

### GET `/api/costs/insights`
- Insights de custos

---

## 📊 GraphQL

### Endpoint: `/graphql`
- Queries e Mutations GraphQL
- Ver schema em `graphql/schema/`

---

## 🔍 Total de Endpoints

**Aproximadamente 100+ endpoints disponíveis**

---

## ⭐ Endpoints Mais Importantes

1. **Places Cache Metrics:** `GET /api/places/metrics` ⭐ NOVO
2. **Dashboard Stats:** `GET /api/live/stats`
3. **Queue Status:** `GET /api/queue/status`
4. **User Stats:** `GET /api/users/stats`
5. **Financial Metrics:** `GET /api/metrics/financial`

---

## 📝 Notas

- Todos os endpoints retornam JSON
- Alguns endpoints requerem autenticação (verificar documentação específica)
- Health checks estão disponíveis para a maioria dos serviços
- Métricas estão disponíveis para monitoramento




