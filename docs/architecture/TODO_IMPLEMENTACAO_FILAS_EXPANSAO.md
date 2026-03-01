# 📋 TODO: IMPLEMENTAÇÃO DE FILAS E EXPANSÃO GRADUAL DE RAIO

**Data:** 01/11/2025  
**Objetivo:** Implementar sistema completo de filas de corridas com expansão gradual de raio

---

## 🎯 VISÃO GERAL

Este TODO contém **40 tarefas** organizadas em **10 fases**, cobrindo:
1. ✅ Sistema de filas de corridas por região
2. ✅ Expansão gradual de raio (0.5km → 3km a cada 5s)
3. ✅ Distribuição sequencial de múltiplas corridas
4. ✅ Prevenção de eventos sobrepostos
5. ✅ Expansão secundária para 5km após 1 minuto

---

## 📊 RESUMO POR FASE

| Fase | Descrição | Tarefas | Prioridade |
|------|-----------|---------|------------|
| **1** | Infraestrutura Base | 4 | 🔴 Crítica |
| **2** | Ride Queue Manager | 4 | 🔴 Crítica |
| **3** | Expansão Gradual | 5 | 🔴 Crítica |
| **4** | Driver Matching | 5 | 🔴 Crítica |
| **5** | Expansão 5km | 3 | 🟡 Importante |
| **6** | Response Handler | 4 | 🔴 Crítica |
| **7** | Integração Server.js | 5 | 🔴 Crítica |
| **8** | Múltiplas Corridas | 4 | 🟡 Importante |
| **9** | Testes | 5 | 🟢 Necessário |
| **10** | Otimizações | 4 | 🟢 Desejável |

**Total:** 40 tarefas

---

## 📝 DETALHAMENTO POR FASE

### **FASE 1: INFRAESTRUTURA BASE** (4 tarefas)

**Objetivo:** Criar estrutura Redis para filas e estados de corridas

#### ✅ Tarefa 1.1: Estruturas Redis Básicas
- [ ] Criar `ride_queue:{region}:pending` (Sorted Set) - Fila de corridas pendentes por região
- [ ] Criar `ride_queue:{region}:active` (Hash) - Corridas em busca ativa
- [ ] Criar `booking_search:{bookingId}` (Hash) - Estado da busca de cada corrida
- [ ] Criar `booking:{bookingId}` (Hash) - Dados completos da corrida

**Arquivo:** `leaf-websocket-backend/services/ride-queue-manager.js`

#### ✅ Tarefa 1.2: Sistema de Locks Distribuídos
- [ ] Implementar `driver_lock:{driverId}` (String com TTL 20s)
- [ ] Criar função `acquireLock(driverId, bookingId)` usando Redis SET NX
- [ ] Criar função `releaseLock(driverId)`
- [ ] Criar função `isDriverLocked(driverId)`

**Arquivo:** `leaf-websocket-backend/services/driver-lock-manager.js`

#### ✅ Tarefa 1.3: Event Sourcing Básico
- [ ] Criar stream `ride_events` no Redis
- [ ] Criar função `recordEvent(eventType, data)` usando XADD
- [ ] Definir tipos de eventos: `ride_requested`, `driver_notified`, `ride_accepted`, `ride_rejected`, `radius_expanded`

**Arquivo:** `leaf-websocket-backend/services/event-sourcing.js`

#### ✅ Tarefa 1.4: Função GeoHash
- [ ] Instalar biblioteca `ngeohash` ou implementar GeoHash
- [ ] Criar função `getRegionHash(lat, lng, precision=5)` para dividir regiões
- [ ] Criar função auxiliar `getAdjacentRegions(regionHash)` para busca expandida

**Arquivo:** `leaf-websocket-backend/utils/geohash-utils.js`

---

### **FASE 2: RIDE QUEUE MANAGER** (4 tarefas)

**Objetivo:** Criar classe principal para gerenciar filas de corridas

#### ✅ Tarefa 2.1: Classe RideQueueManager
- [ ] Criar classe `RideQueueManager` com constructor(redis, io)
- [ ] Implementar `async enqueueRide(bookingData)` - Adiciona corrida à fila regional
- [ ] Implementar `async dequeueRide(bookingId)` - Remove corrida da fila
- [ ] Implementar `async getPendingRides(regionHash, limit)` - Busca próximas N corridas

**Arquivo:** `leaf-websocket-backend/services/ride-queue-manager.js`

#### ✅ Tarefa 2.2: Processamento em Batch
- [ ] Implementar `async processNextRides(regionHash, batchSize=10)` - Processa lote de corridas
- [ ] Mover corridas de `pending` → `active` quando começam a ser processadas
- [ ] Garantir que corridas não sejam processadas duas vezes (verificar estado)

**Arquivo:** `leaf-websocket-backend/services/ride-queue-manager.js`

#### ✅ Tarefa 2.3: Sistema de Estados
- [ ] Definir estados: `PENDING`, `SEARCHING`, `MATCHED`, `ACCEPTED`, `IN_PROGRESS`, `COMPLETED`, `REJECTED`, `CANCELED`
- [ ] Implementar `async updateBookingState(bookingId, newState)` com validação
- [ ] Criar objeto `validTransitions` para validar transições de estado

**Arquivo:** `leaf-websocket-backend/services/ride-state-manager.js`

#### ✅ Tarefa 2.4: Validação de Transições
- [ ] Implementar máquina de estados com validação de transições válidas
- [ ] Criar erros específicos para transições inválidas
- [ ] Adicionar logs de tentativas de transição inválida

**Arquivo:** `leaf-websocket-backend/services/ride-state-manager.js`

---

### **FASE 3: EXPANSÃO GRADUAL DE RAIO** (5 tarefas)

**Objetivo:** Implementar notificação progressiva de motoristas

#### ✅ Tarefa 3.1: Classe GradualRadiusExpander
- [ ] Criar classe `GradualRadiusExpander` com constructor(redis, io)
- [ ] Implementar `async startGradualSearch(bookingId, pickupLocation)` - Inicia busca gradual
- [ ] Implementar `async searchAndNotify(bookingId, pickupLocation, radius, limit)` - Busca e notifica
- [ ] Implementar `scheduleNextExpansion(bookingId, pickupLocation, nextRadius, ...)` - Agenda próxima expansão

**Arquivo:** `leaf-websocket-backend/services/gradual-radius-expander.js`

#### ✅ Tarefa 3.2: Lógica de Expansão
- [ ] Implementar expansão: 0.5km → 1km → 1.5km → 2km → 2.5km → 3km
- [ ] Intervalo fixo de 5 segundos entre expansões
- [ ] Armazenar `currentRadius` em `booking_search:{bookingId}`
- [ ] Atualizar `lastExpansion` timestamp a cada expansão

**Arquivo:** `leaf-websocket-backend/services/gradual-radius-expander.js`

#### ✅ Tarefa 3.3: Sistema de Timeouts
- [ ] Criar Map `expansionIntervals` para armazenar timeouts ativos
- [ ] Implementar `stopSearch(bookingId)` - Cancela expansões agendadas
- [ ] Verificar estado da corrida antes de expandir (se já foi aceita, não expandir)
- [ ] Limpar timeouts quando corrida é aceita/cancelada

**Arquivo:** `leaf-websocket-backend/services/gradual-radius-expander.js`

#### ✅ Tarefa 3.4: Seleção de Motoristas por Wave
- [ ] Implementar seleção de top N motoristas por expansão (ex: 5 por wave)
- [ ] Filtrar motoristas já notificados usando Set `ride_notifications:{bookingId}`
- [ ] Verificar disponibilidade antes de notificar (usar locks)
- [ ] Calcular scores e ordenar por prioridade

**Arquivo:** `leaf-websocket-backend/services/gradual-radius-expander.js`

#### ✅ Tarefa 3.5: Otimizações
- [ ] Implementar skip de raios vazios (se raio atual vazio, pular para próximo)
- [ ] Ajuste dinâmico de intervalo baseado em disponibilidade de motoristas
- [ ] Se muitos motoristas disponíveis, expandir mais rápido (intervalo menor)
- [ ] Parar expansão imediatamente quando motorista aceita

**Arquivo:** `leaf-websocket-backend/services/gradual-radius-expander.js`

---

### **FASE 4: DRIVER MATCHING E NOTIFICAÇÃO** (5 tarefas)

**Objetivo:** Integrar busca e notificação de motoristas

#### ✅ Tarefa 4.1: Integração com DriverResolver
- [ ] Reutilizar `DriverResolver.nearbyDrivers()` existente
- [ ] Adaptar para trabalhar com raios variáveis (0.5km, 1km, etc.)
- [ ] Integrar com Redis GEO `driver_locations` existente
- [ ] Garantir que busca funciona com raios pequenos (0.5km)

**Arquivo:** `leaf-websocket-backend/services/gradual-radius-expander.js`

#### ✅ Tarefa 4.2: Algoritmo de Score
- [ ] Implementar cálculo de score: `(1/distância) * rating * (1/responseTime)`
- [ ] Pesos: Distância 40%, Rating 20%, Acceptance Rate 20%, Response Time 20%
- [ ] Buscar dados de motorista (rating, histórico) do Firebase ou cache
- [ ] Ordenar motoristas por score antes de notificar

**Arquivo:** `leaf-websocket-backend/services/driver-scoring.js`

#### ✅ Tarefa 4.3: Driver Notification Dispatcher
- [ ] Criar `async notifyDriver(driverId, bookingId, pickupLocation)` - Envia notificação via WebSocket
- [ ] Verificar lock antes de notificar (evitar múltiplas notificações)
- [ ] Adquirir lock ao notificar (TTL 15s)
- [ ] Registrar notificação em `ride_notifications:{bookingId}` Set

**Arquivo:** `leaf-websocket-backend/services/driver-notification-dispatcher.js`

#### ✅ Tarefa 4.4: Prevenção de Duplicação
- [ ] Usar Set `ride_notifications:{bookingId}` para rastrear motoristas notificados
- [ ] Verificar Set antes de notificar cada motorista
- [ ] Adicionar motorista ao Set após notificação bem-sucedida
- [ ] Limpar Set quando corrida é aceita/cancelada

**Arquivo:** `leaf-websocket-backend/services/driver-notification-dispatcher.js`

#### ✅ Tarefa 4.5: Timeout de Resposta
- [ ] Implementar timeout de 15 segundos após notificar motorista
- [ ] Se timeout ocorrer, liberar lock do motorista automaticamente
- [ ] Continuar busca para corrida (expandir raio ou enviar próxima)
- [ ] Registrar evento `driver_timeout` no event sourcing

**Arquivo:** `leaf-websocket-backend/services/driver-notification-dispatcher.js`

---

### **FASE 5: EXPANSÃO PARA 5KM** (3 tarefas)

**Objetivo:** Implementar expansão secundária após 1 minuto

#### ✅ Tarefa 5.1: Radius Expansion Manager
- [ ] Criar classe `RadiusExpansionManager` com tarefa agendada
- [ ] Implementar função `checkRadiusExpansion()` - Executa a cada 10 segundos
- [ ] Buscar corridas em `SEARCHING` há mais de 60 segundos
- [ ] Verificar se `currentRadius` = 3km e expandir para 5km

**Arquivo:** `leaf-websocket-backend/services/radius-expansion-manager.js`

#### ✅ Tarefa 5.2: Lógica de Expansão Secundária
- [ ] Se corrida está em busca há > 60s e raio = 3km, expandir para 5km
- [ ] Atualizar `booking_search:{bookingId}` com novo raio
- [ ] Continuar expansão gradual até 5km (3.5km, 4km, 4.5km, 5km)
- [ ] Notificar customer sobre expansão de área de busca

**Arquivo:** `leaf-websocket-backend/services/radius-expansion-manager.js`

#### ✅ Tarefa 5.3: Rebusca de Motoristas
- [ ] Após expansão para 5km, buscar novos motoristas não notificados
- [ ] Filtrar motoristas já notificados anteriormente
- [ ] Notificar novos motoristas encontrados
- [ ] Continuar expansão gradual até atingir 5km completo

**Arquivo:** `leaf-websocket-backend/services/radius-expansion-manager.js`

---

### **FASE 6: RESPONSE HANDLER** (4 tarefas)

**Objetivo:** Processar aceitações e rejeições de motoristas

#### ✅ Tarefa 6.1: Handler de Aceitação
- [ ] Criar `async handleAcceptance(bookingId, driverId)` - Processa aceitação
- [ ] Parar busca gradual (chamar `GradualRadiusExpander.stopSearch()`)
- [ ] Atualizar estado para `ACCEPTED`
- [ ] Notificar customer com confirmação
- [ ] Remover corrida de `ride_queue:{region}:active`
- [ ] Liberar locks de outros motoristas notificados

**Arquivo:** `leaf-websocket-backend/services/response-handler.js`

#### ✅ Tarefa 6.2: Handler de Rejeição
- [ ] Criar `async handleRejection(bookingId, driverId, reason)` - Processa rejeição
- [ ] Remover motorista de `ride_notifications:{bookingId}`
- [ ] Liberar lock do motorista (`driver_lock:{driverId}`)
- [ ] Continuar busca para corrida atual (se ainda em SEARCHING)
- [ ] Chamar `sendNextRideToDriver(driverId)` - Enviar próxima corrida

**Arquivo:** `leaf-websocket-backend/services/response-handler.js`

#### ✅ Tarefa 6.3: Enviar Próxima Corrida
- [ ] Criar `async sendNextRideToDriver(driverId, currentBookingId)` - Envia próxima corrida da fila
- [ ] Buscar região do motorista (GeoHash)
- [ ] Buscar próximas corridas em `ride_queue:{region}:pending`
- [ ] Filtrar corridas que motorista já foi notificado
- [ ] Enviar primeira corrida disponível para motorista

**Arquivo:** `leaf-websocket-backend/services/response-handler.js`

#### ✅ Tarefa 6.4: Liberação Automática de Lock
- [ ] Criar função `async handleDriverTimeout(driverId, bookingId)` - Processa timeout
- [ ] Liberar lock após 15s sem resposta
- [ ] Remover motorista de `ride_notifications:{bookingId}`
- [ ] Continuar busca para corrida (expandir raio ou próxima)
- [ ] Registrar evento `driver_timeout` no event sourcing

**Arquivo:** `leaf-websocket-backend/services/response-handler.js`

---

### **FASE 7: INTEGRAÇÃO COM SERVER.JS** (5 tarefas)

**Objetivo:** Modificar handlers existentes para usar novo sistema

#### ✅ Tarefa 7.1: Modificar createBooking
- [ ] Importar `RideQueueManager` e `GradualRadiusExpander` no `server.js`
- [ ] Modificar handler `createBooking`: em vez de emitir direto, adicionar à fila
- [ ] Chamar `rideQueueManager.enqueueRide(bookingData)`
- [ ] Confirmar criação ao customer: "Corrida adicionada à fila"

**Arquivo:** `leaf-websocket-backend/server.js`

#### ✅ Tarefa 7.2: Integrar Expansão Gradual
- [ ] Após adicionar à fila, iniciar busca gradual
- [ ] Chamar `gradualRadiusExpander.startGradualSearch(bookingId, pickupLocation)`
- [ ] Processar corrida imediatamente (não aguardar worker)
- [ ] Garantir que expansão seja iniciada automaticamente

**Arquivo:** `leaf-websocket-backend/server.js`

#### ✅ Tarefa 7.3: Modificar acceptRide
- [ ] Integrar com `ResponseHandler.handleAcceptance()`
- [ ] Chamar `gradualRadiusExpander.stopSearch(bookingId)` para parar expansão
- [ ] Atualizar estado da corrida via `RideQueueManager`
- [ ] Manter compatibilidade com código existente de notificação ao customer

**Arquivo:** `leaf-websocket-backend/server.js`

#### ✅ Tarefa 7.4: Modificar rejectRide
- [ ] Integrar com `ResponseHandler.handleRejection()`
- [ ] Chamar `responseHandler.sendNextRideToDriver(driverId)` automaticamente
- [ ] Manter expansão gradual ativa para corrida atual (se ainda em busca)
- [ ] Limpar locks e notificações apropriadamente

**Arquivo:** `leaf-websocket-backend/server.js`

#### ✅ Tarefa 7.5: Handler de Cancelamento
- [ ] Criar handler `cancelBooking` (se não existir)
- [ ] Remover corrida de todas as filas (`pending` e `active`)
- [ ] Parar busca gradual (`GradualRadiusExpander.stopSearch()`)
- [ ] Liberar todos os motoristas notificados
- [ ] Atualizar estado para `CANCELED`
- [ ] Notificar customer sobre cancelamento

**Arquivo:** `leaf-websocket-backend/server.js`

---

### **FASE 8: MÚLTIPLAS CORRIDAS SIMULTÂNEAS** (4 tarefas)

**Objetivo:** Distribuição sequencial de múltiplas corridas

#### ✅ Tarefa 8.1: Processamento em Batch
- [ ] Criar worker assíncrono que executa a cada 2-5 segundos
- [ ] Buscar corridas pendentes por região usando `RideQueueManager.processNextRides()`
- [ ] Processar em batches de 10 corridas por vez
- [ ] Garantir que cada corrida seja processada apenas uma vez

**Arquivo:** `leaf-websocket-backend/workers/ride-queue-worker.js`

#### ✅ Tarefa 8.2: Prevenção de Múltiplas Corridas
- [ ] Garantir que mesmo motorista não recebe múltiplas corridas simultaneamente
- [ ] Usar locks para verificar disponibilidade antes de notificar
- [ ] Se motorista já tem lock, pular e passar para próximo motorista
- [ ] Distribuir corridas entre motoristas disponíveis no batch

**Arquivo:** `leaf-websocket-backend/workers/ride-queue-worker.js`

#### ✅ Tarefa 8.3: Distribuição Inteligente
- [ ] Quando processar batch de corridas, distribuir entre motoristas disponíveis
- [ ] Evitar que mesma corrida seja enviada para múltiplos motoristas simultaneamente
- [ ] Priorizar motoristas que não estão ocupados
- [ ] Balancear carga entre motoristas (round-robin ou score-based)

**Arquivo:** `leaf-websocket-backend/workers/ride-queue-worker.js`

#### ✅ Tarefa 8.4: Worker Contínuo
- [ ] Criar worker que roda continuamente em background
- [ ] Processar todas as regiões disponíveis
- [ ] Executar a cada 2-5 segundos
- [ ] Logar métricas de processamento (corridas processadas, tempo médio)

**Arquivo:** `leaf-websocket-backend/workers/ride-queue-worker.js`

---

### **FASE 9: TESTES E VALIDAÇÃO** (5 tarefas)

**Objetivo:** Testar cenários complexos

#### ✅ Tarefa 9.1: Teste Expansão Gradual
- [ ] Criar teste: 1 corrida com expansão gradual
- [ ] Verificar que notificações são enviadas progressivamente (0.5km, 1km, 1.5km...)
- [ ] Verificar timeouts de 5 segundos entre expansões
- [ ] Validar que busca para quando motorista aceita

**Arquivo:** `tests/suites/gradual-expansion.test.js`

#### ✅ Tarefa 9.2: Teste Múltiplas Corridas
- [ ] Criar teste: 10 corridas simultâneas na mesma região
- [ ] Verificar que todas são adicionadas à fila
- [ ] Validar distribuição sequencial
- [ ] Verificar que motoristas não recebem múltiplas corridas ao mesmo tempo

**Arquivo:** `tests/suites/multiple-rides-queue.test.js`

#### ✅ Tarefa 9.3: Teste Rejeição e Próxima Corrida
- [ ] Criar teste: Motorista rejeita corrida e recebe próxima automaticamente
- [ ] Verificar que próxima corrida é enviada dentro de 2-3 segundos
- [ ] Validar que motorista não recebe mesma corrida duas vezes
- [ ] Confirmar que corrida rejeitada continua buscando outros motoristas

**Arquivo:** `tests/suites/rejection-next-ride.test.js`

#### ✅ Tarefa 9.4: Teste Expansão 5km
- [ ] Criar teste: Corrida sem motorista disponível por 60 segundos
- [ ] Verificar expansão automática para 5km após 1 minuto
- [ ] Validar que novos motoristas são notificados
- [ ] Confirmar notificação ao customer sobre expansão

**Arquivo:** `tests/suites/radius-expansion-5km.test.js`

#### ✅ Tarefa 9.5: Teste Prevenção de Sobreposição
- [ ] Criar teste: Múltiplos motoristas, múltiplas corridas
- [ ] Verificar locks distribuídos (motorista não recebe 2 corridas simultâneas)
- [ ] Validar que eventos não se sobrepõem
- [ ] Confirmar transições de estado válidas
- [ ] Testar race conditions e garantir idempotência

**Arquivo:** `tests/suites/overlap-prevention.test.js`

---

### **FASE 10: OTIMIZAÇÕES E MONITORAMENTO** (4 tarefas)

**Objetivo:** Melhorias finais e observabilidade

#### ✅ Tarefa 10.1: Métricas
- [ ] Adicionar métricas: tempo médio de match, taxa de aceitação, tempo de expansão
- [ ] Criar contadores: corridas em fila, corridas em busca, motoristas notificados
- [ ] Implementar histogramas: distribuição de tempos de resposta
- [ ] Expor métricas via endpoint `/metrics` ou integração com Prometheus

**Arquivo:** `leaf-websocket-backend/services/metrics-collector.js`

#### ✅ Tarefa 10.2: Cache de Buscas
- [ ] Implementar cache de resultados de busca geoespacial
- [ ] Cachear por 5-10 segundos (buscas na mesma região)
- [ ] Invalidar cache quando motoristas mudam de status
- [ ] Usar Redis para cache compartilhado entre instâncias

**Arquivo:** `leaf-websocket-backend/services/spatial-cache.js`

#### ✅ Tarefa 10.3: Logs Detalhados
- [ ] Adicionar logs estruturados para cada etapa:
  - Corrida adicionada à fila
  - Expansão de raio iniciada
  - Motoristas notificados
  - Respostas recebidas
  - Estado da corrida atualizado
- [ ] Incluir timestamps e IDs de rastreamento
- [ ] Usar níveis apropriados (INFO, DEBUG, WARN, ERROR)

**Arquivo:** `leaf-websocket-backend/utils/logger.js`

#### ✅ Tarefa 10.4: Dashboard/Monitoramento
- [ ] Criar endpoint `/admin/queue-status` com estatísticas:
  - Número de corridas em fila por região
  - Corridas em busca ativa
  - Motoristas notificados
  - Tempo médio de match
  - Taxa de aceitação
- [ ] Criar dashboard simples (HTML ou usar ferramenta de monitoramento)
- [ ] Alertas para filas muito longas (> 50 corridas)

**Arquivo:** `leaf-websocket-backend/routes/admin.js`

---

## 📊 ESTIMATIVA DE TEMPO

| Fase | Tarefas | Tempo Estimado | Prioridade |
|------|---------|----------------|------------|
| Fase 1 | 4 | 2-3 horas | 🔴 Crítica |
| Fase 2 | 4 | 3-4 horas | 🔴 Crítica |
| Fase 3 | 5 | 4-5 horas | 🔴 Crítica |
| Fase 4 | 5 | 4-5 horas | 🔴 Crítica |
| Fase 5 | 3 | 2-3 horas | 🟡 Importante |
| Fase 6 | 4 | 3-4 horas | 🔴 Crítica |
| Fase 7 | 5 | 2-3 horas | 🔴 Crítica |
| Fase 8 | 4 | 3-4 horas | 🟡 Importante |
| Fase 9 | 5 | 4-5 horas | 🟢 Necessário |
| Fase 10 | 4 | 2-3 horas | 🟢 Desejável |
| **TOTAL** | **43** | **29-39 horas** | |

---

## 🎯 ORDEM DE IMPLEMENTAÇÃO RECOMENDADA

### **Sprint 1: Fundação** (Fases 1-3)
1. Fase 1: Infraestrutura Base
2. Fase 2: Ride Queue Manager
3. Fase 3: Expansão Gradual

**Resultado:** Sistema básico funcionando com expansão gradual

### **Sprint 2: Integração** (Fases 4-7)
4. Fase 4: Driver Matching
5. Fase 6: Response Handler
6. Fase 7: Integração Server.js

**Resultado:** Sistema integrado e funcionando end-to-end

### **Sprint 3: Escala e Qualidade** (Fases 5, 8-10)
7. Fase 5: Expansão 5km
8. Fase 8: Múltiplas Corridas
9. Fase 9: Testes
10. Fase 10: Otimizações

**Resultado:** Sistema completo, testado e otimizado

---

## ✅ CHECKLIST DE VALIDAÇÃO

Antes de considerar implementação completa, verificar:

- [ ] Todas as fases críticas (1-4, 6-7) implementadas
- [ ] Testes básicos passando
- [ ] Sem race conditions ou eventos sobrepostos
- [ ] Expansão gradual funcionando corretamente
- [ ] Múltiplas corridas sendo distribuídas sequencialmente
- [ ] Locks distribuídos prevenindo sobreposição
- [ ] Integração com `server.js` funcionando
- [ ] Logs e métricas coletando dados
- [ ] Performance aceitável (< 100ms por operação crítica)

---

**Documento criado em:** 01/11/2025  
**Total de Tarefas:** 40  
**Status:** 📋 Pronto para Iniciar Implementação


