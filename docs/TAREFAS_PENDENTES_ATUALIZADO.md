# 📋 TAREFAS PENDENTES - PROJETO LEAF

**Data:** 2026-01-08  
**Status Geral:** ~92% completo  
**Última Atualização:** Após implementação de Liveness Detection Real

---

## ✅ TAREFAS CONCLUÍDAS (Nesta Sessão)

1. ✅ **Observabilidade** (~90% completo)
   - Spans OpenTelemetry (Events + Redis) - 100%
   - Métricas Automáticas (Commands, Events, Listeners, Redis) - 100%
   - Dashboards Grafana (Redis + Sistema) - 100%
   - Validação de traceId - 100%
   - Substituição console.log - ~95%

2. ✅ **KYC** (100% completo)
   - Detecção Facial Mobile - 100%
   - Liveness Detection Real - 100% ✅ (RECÉM IMPLEMENTADO)
   - Comparação com Foto de Perfil - 100%
   - Bloqueio/Liberação Automática - 100%
   - Timeout CNH - 100%

3. ✅ **Limpeza de Código**
   - Remoção de arquivos deprecated - 100%
   - Consolidação de serviços duplicados (Streams) - 100%

---

## 🔥 PRIORIDADE ALTA - TAREFAS PENDENTES

### 1. Finalizar Substituição de console.log ⏳

**Status:** ~95% completo  
**Impacto:** Médio - Logs estruturados essenciais para produção

**O que fazer:**
- Verificar arquivos restantes com `console.log`
- Substituir por `logStructured`, `logError`, etc.
- Focar em arquivos de produção (não scripts de teste)

**Tempo estimado:** ~1-2 horas

---

### 2. Consolidar Serviços de Notificações ⏳

**Status:** 0% completo  
**Impacto:** Médio - Reduz complexidade e bugs

**Serviços identificados:**
- `NotificationService.js`
- `FCMNotificationService.js`
- `RealTimeNotificationService.js`
- `InteractiveNotificationService.js`
- `PersistentRideNotificationService.js`
- `DriverNotificationService.js`

**O que fazer:**
1. Analisar uso de cada serviço
2. Identificar funcionalidades duplicadas
3. Consolidar em serviços principais
4. Atualizar imports em todo o projeto

**Tempo estimado:** ~4-6 horas

---

### 3. Consolidar Serviços de WebSocket ⏳

**Status:** 0% completo  
**Impacto:** Médio - Reduz complexidade

**Serviços identificados:**
- `WebSocketService.js`
- `WebSocketServiceWithRetry.js`
- `SocketService.js`
- `WebSocketManager.js` (mobile)

**O que fazer:**
1. Analisar uso de cada serviço
2. Consolidar funcionalidades
3. Manter apenas serviços necessários

**Tempo estimado:** ~3-4 horas

---

### 4. Consolidar Serviços de Cache ⏳

**Status:** 0% completo  
**Impacto:** Baixo-Médio - Organização

**Serviços identificados:**
- `LocalCacheService.js`
- `IntelligentCacheService.js`
- `CacheIntegrationService.js`

**O que fazer:**
1. Analisar uso de cada serviço
2. Consolidar funcionalidades
3. Manter apenas serviços necessários

**Tempo estimado:** ~2-3 horas

---

## ⚙️ PRIORIDADE MÉDIA - TAREFAS PENDENTES

### 5. Workers e Escalabilidade ⏳

**Status:** 0% completo  
**Impacto:** Médio - Melhora escalabilidade futura

**O que fazer:**
1. Implementar workers separados
2. Configurar Consumer Groups para Redis Streams
3. Implementar DLQ (Dead Letter Queue) completo

**Tempo estimado:** ~2-3 semanas

**Nota:** Não é crítico para MVP, mas importante para escalabilidade

---

### 6. Dashboard Avançado ⏳

**Status:** ~70% completo  
**Impacto:** Baixo - Já funcional

**O que fazer:**
1. Completar funcionalidades pendentes
2. Melhorar visualizações
3. Adicionar relatórios

**Tempo estimado:** ~2-3 dias

---

## 📊 RESUMO POR PRIORIDADE

| Prioridade | Tarefas | Status | Tempo | Impacto |
|------------|---------|--------|-------|---------|
| **🔥 Alta** | 4 tarefas | ⏳ Pendente | ~10-15h | Médio |
| **⚙️ Média** | 2 tarefas | ⏳ Pendente | ~2-3 semanas | Médio |

---

## 🎯 RECOMENDAÇÃO DE ORDEM

### Próximos 3 Passos (Imediato):

1. **Finalizar Substituição de console.log** (1-2h)
   - Rápido e fácil
   - Finaliza observabilidade
   - Melhora logs em produção

2. **Consolidar Serviços de Notificações** (4-6h)
   - Reduz complexidade
   - Facilita manutenção
   - Previne bugs

3. **Consolidar Serviços de WebSocket** (3-4h)
   - Reduz complexidade
   - Facilita manutenção

**Total:** ~8-12 horas para completar tarefas de alta prioridade

---

## 📈 PROGRESSO GERAL

**Status Atual:** ~92% completo

**Para chegar a 95%+ (pronto para produção):**
1. ✅ Observabilidade 90%+ (FEITO)
2. ✅ KYC 100% (FEITO)
3. ⏳ Finalizar console.log (95% → 100%)
4. ⏳ Consolidar serviços duplicados (0% → 100%)
5. ⏳ Testes completos (parcial)

**Estimativa:** 1-2 semanas para 95%+

---

## 🚀 CONCLUSÃO

O projeto está **muito próximo de produção** (~92%). As principais funcionalidades estão completas e funcionando. O que falta são principalmente:

1. **Limpeza** (consolidação de serviços)
2. **Finalização** (console.log restantes)
3. **Escalabilidade** (workers - opcional para MVP)

**Recomendação:** Focar em limpeza e finalização para chegar a 95%+ e estar pronto para produção básica.

---

**Última atualização:** 2026-01-08

