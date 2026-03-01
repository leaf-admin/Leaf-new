# 📋 Plano de Implementação - Observabilidade Completa

## 🎯 Objetivo
Completar todos os itens de observabilidade pendentes, organizados por item completo.

---

## ✅ ITEM 1: Remover console.log e substituir por logger estruturado

### Arquivos prioritários (produção):
1. **server.js** - 49 console.log/warn/error
2. **services/** - 25 arquivos com console.log
3. **routes/** - Verificar arquivos principais
4. **commands/** - Apenas README (não crítico)
5. **listeners/** - ✅ Já está limpo!

### Estratégia:
- Substituir `console.log()` por `logStructured('info', ...)`
- Substituir `console.error()` por `logStructured('error', ...)`
- Substituir `console.warn()` por `logStructured('warn', ...)`
- Manter contexto (traceId será adicionado automaticamente pelo logger)

---

## ✅ ITEM 2: Validar traceId em todos os pontos

### Pontos a validar:
1. Handlers (server.js)
2. Commands (todos os 5)
3. Events (todos os 9)
4. Listeners (todos)

### Estratégia:
- Adicionar validação no início de cada função crítica
- Logar warning se traceId estiver ausente
- Garantir que traceId seja propagado corretamente

---

## ✅ ITEM 3: Completar spans OpenTelemetry para Commands

### Commands pendentes:
1. **StartTripCommand** - Adicionar spans
2. **CompleteTripCommand** - Adicionar spans
3. **CancelRideCommand** - Adicionar spans

### Commands já completos:
- ✅ RequestRideCommand
- ✅ AcceptRideCommand

### Estratégia:
- Usar `createCommandSpan()` no início
- Usar `runInSpan()` para executar lógica
- Usar `endSpanSuccess()` ou `endSpanError()` no final

---

## ✅ ITEM 4: Adicionar spans OpenTelemetry para Redis

### Operações Redis a instrumentar:
1. GET/SET operations
2. Stream operations (XADD, XREAD, etc.)
3. Hash operations
4. List operations

### Estratégia:
- Criar helper `createRedisSpan()` (já existe!)
- Instrumentar operações críticas no redis-pool
- Adicionar spans em operações de streams

---

## ✅ ITEM 5: Completar spans OpenTelemetry para Events

### Events pendentes:
1. **ride.rejected** - Adicionar spans
2. **ride.canceled** - Adicionar spans
3. **ride.started** - Adicionar spans
4. **ride.completed** - Adicionar spans
5. **driver.online** - Adicionar spans
6. **driver.offline** - Adicionar spans
7. **payment.confirmed** - Adicionar spans

### Events já completos:
- ✅ ride.requested
- ✅ ride.accepted

### Estratégia:
- Usar `createEventSpan()` no construtor do evento
- Adicionar atributos relevantes (eventType, correlationId, etc.)

---

## 📊 Progresso

- [ ] Item 1: Remover console.log (0%)
- [ ] Item 2: Validar traceId (0%)
- [ ] Item 3: Spans Commands (40% - 2/5)
- [ ] Item 4: Spans Redis (0%)
- [ ] Item 5: Spans Events (40% - 2/9)

---

**Iniciando implementação...**


## 🎯 Objetivo
Completar todos os itens de observabilidade pendentes, organizados por item completo.

---

## ✅ ITEM 1: Remover console.log e substituir por logger estruturado

### Arquivos prioritários (produção):
1. **server.js** - 49 console.log/warn/error
2. **services/** - 25 arquivos com console.log
3. **routes/** - Verificar arquivos principais
4. **commands/** - Apenas README (não crítico)
5. **listeners/** - ✅ Já está limpo!

### Estratégia:
- Substituir `console.log()` por `logStructured('info', ...)`
- Substituir `console.error()` por `logStructured('error', ...)`
- Substituir `console.warn()` por `logStructured('warn', ...)`
- Manter contexto (traceId será adicionado automaticamente pelo logger)

---

## ✅ ITEM 2: Validar traceId em todos os pontos

### Pontos a validar:
1. Handlers (server.js)
2. Commands (todos os 5)
3. Events (todos os 9)
4. Listeners (todos)

### Estratégia:
- Adicionar validação no início de cada função crítica
- Logar warning se traceId estiver ausente
- Garantir que traceId seja propagado corretamente

---

## ✅ ITEM 3: Completar spans OpenTelemetry para Commands

### Commands pendentes:
1. **StartTripCommand** - Adicionar spans
2. **CompleteTripCommand** - Adicionar spans
3. **CancelRideCommand** - Adicionar spans

### Commands já completos:
- ✅ RequestRideCommand
- ✅ AcceptRideCommand

### Estratégia:
- Usar `createCommandSpan()` no início
- Usar `runInSpan()` para executar lógica
- Usar `endSpanSuccess()` ou `endSpanError()` no final

---

## ✅ ITEM 4: Adicionar spans OpenTelemetry para Redis

### Operações Redis a instrumentar:
1. GET/SET operations
2. Stream operations (XADD, XREAD, etc.)
3. Hash operations
4. List operations

### Estratégia:
- Criar helper `createRedisSpan()` (já existe!)
- Instrumentar operações críticas no redis-pool
- Adicionar spans em operações de streams

---

## ✅ ITEM 5: Completar spans OpenTelemetry para Events

### Events pendentes:
1. **ride.rejected** - Adicionar spans
2. **ride.canceled** - Adicionar spans
3. **ride.started** - Adicionar spans
4. **ride.completed** - Adicionar spans
5. **driver.online** - Adicionar spans
6. **driver.offline** - Adicionar spans
7. **payment.confirmed** - Adicionar spans

### Events já completos:
- ✅ ride.requested
- ✅ ride.accepted

### Estratégia:
- Usar `createEventSpan()` no construtor do evento
- Adicionar atributos relevantes (eventType, correlationId, etc.)

---

## 📊 Progresso

- [ ] Item 1: Remover console.log (0%)
- [ ] Item 2: Validar traceId (0%)
- [ ] Item 3: Spans Commands (40% - 2/5)
- [ ] Item 4: Spans Redis (0%)
- [ ] Item 5: Spans Events (40% - 2/9)

---

**Iniciando implementação...**



