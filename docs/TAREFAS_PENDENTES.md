# 📋 TAREFAS PENDENTES - PROJETO LEAF

**Data:** 2026-01-08  
**Baseado em:** Diagnóstico Completo do Projeto

---

## ✅ O QUE JÁ FOI CONCLUÍDO (Nesta Sessão)

### Observabilidade
- ✅ **Spans OpenTelemetry nos Events** (100%) - 7 eventos completos
- ✅ **Spans OpenTelemetry no Redis** (100%) - 11 operações instrumentadas
- ✅ **Métricas automáticas nos Commands** (100%) - 5 commands
- ✅ **Métricas automáticas nos Events** (100%)
- ✅ **Métricas automáticas nos Listeners** (100%)
- ✅ **Métricas automáticas no Redis** (100%)
- ✅ **Dashboard Redis e Sistema no Admin Dashboard** (100%)
- ✅ **Pacotes OpenTelemetry instalados** (100%)

**Progresso Observabilidade:** De ~40% para **~85%** ✅

---

## ⏳ TAREFAS PENDENTES

### 🔥 PRIORIDADE ALTA

#### 1. Observabilidade (Restante ~15%)

**1.1. Substituir console.log restantes**
- ⏳ **~93 console.log** no `server.js` (estimativa inicial)
- ⏳ **console.log em ~15 arquivos** em `services/`
- ⏳ **console.log em arquivos de routes/**
- **Status:** ~40% completo (faltam ~60%)
- **Ação:** Substituir por `logStructured`, `logError`, `logPerformance`, etc.

**1.2. Dashboards Grafana** (não no admin dashboard)
- ⏳ **Dashboard Grafana para Redis** (ops, latência, memória, conexões)
- ⏳ **Dashboard Grafana para Sistema** (CPU, RAM, conexões WebSocket, uptime, throughput)
- **Nota:** Já implementado no admin dashboard, falta criar no Grafana

**1.3. Validação de traceId**
- ⏳ Validar traceId em todos os pontos críticos
- ⏳ Garantir propagação correta do traceId

---

#### 2. KYC (Know Your Customer) - ~71% completo

**2.1. Timeout de Upload CNH**
- ⏳ **Problema:** Upload de CNH está com timeout de 20s
- ⏳ **Ação:** Investigar e corrigir timeout
- **Prioridade:** Alta (bloqueia onboarding de motoristas)

**2.2. Liveness Detection**
- ⏳ **Implementar verificação de ação:** sorrir, piscar, virar cabeça
- ⏳ **Status:** 0% completo
- **Prioridade:** Alta (segurança e compliance)

**2.3. Bloqueio/Liberação de Motorista**
- ⏳ **Integração completa** com status do motorista baseado em KYC
- ⏳ Bloquear motorista se KYC falhar
- ⏳ Liberar motorista quando KYC for aprovado
- **Status:** Parcial

---

#### 3. Limpeza de Código

**3.1. Remover Arquivos Deprecated**
- ⏳ **mobile-app/Deprecated/common-duplicated/** (diretório completo)
- ⏳ **mobile-app/App.js.backup**
- ⏳ **mobile-app/app.config.js.backup**
- ⏳ **mobile-app/@freedom-tech-organization__leaf_OLD_1.jks**
- ⏳ **mobile-app/backups/leaf-app-working-version-20250926-1217/** (993 arquivos)
- ⏳ **leaf-websocket-backend/backup/servers/** (5 backups antigos)
- ⏳ **leaf-websocket-backend/routes/*.bak** (vários arquivos .bak)
- ⏳ **leaf-dashboard/deprecated/typescript/** (31 arquivos)
- ⏳ **landing-page/index-old.html**
- ⏳ **landing-page/excluir-conta-backup.html**
- ⏳ **temp-deploy-leaf/** (se existir)
- ⏳ **temp-upload-leaf/** (se existir)

**3.2. Consolidar Serviços Duplicados**

**WebSocket:**
- ⏳ `WebSocketService.js`
- ⏳ `WebSocketServiceWithRetry.js`
- ⏳ `SocketService.js`
- **Ação:** Consolidar em um único serviço

**Cache:**
- ⏳ `LocalCacheService.js`
- ⏳ `IntelligentCacheService.js`
- ⏳ `CacheIntegrationService.js`
- **Ação:** Consolidar funcionalidades

**Notificações:**
- ⏳ `NotificationService.js`
- ⏳ `FCMNotificationService.js`
- ⏳ `RealTimeNotificationService.js`
- ⏳ `InteractiveNotificationService.js`
- ⏳ `PersistentRideNotificationService.js`
- **Ação:** Consolidar em serviços principais

**Chat:**
- ⏳ `chatService.js`
- ⏳ `OptimizedChatService.js`
- ⏳ `SupportChatService.js`
- **Ação:** Verificar se todos são necessários ou consolidar

---

### ⚙️ PRIORIDADE MÉDIA

#### 4. Workers e Escalabilidade (0% completo)

**4.1. Workers Separados**
- ⏳ Implementar workers separados para processamento pesado
- ⏳ Separar lógica de processamento do servidor principal
- **Status:** 0% completo

**4.2. Consumer Groups**
- ⏳ Configurar Consumer Groups no Redis Streams
- ⏳ Múltiplos workers consumindo o mesmo stream
- ⏳ Distribuição de carga entre workers
- **Status:** 0% completo

**4.3. Dead Letter Queue (DLQ)**
- ⏳ Implementar DLQ completo
- ⏳ Retry automático (3 tentativas)
- ⏳ Monitoramento de lag por consumer
- **Status:** 0% completo

---

#### 5. Dashboard Avançado

**5.1. Funcionalidades Avançadas**
- ⏳ Completar funcionalidades pendentes no dashboard
- ⏳ Adicionar dashboards avançados
- ⏳ Melhorar visualizações
- **Status:** ~70% completo

---

### 🧪 PRIORIDADE BAIXA

#### 6. Stress Testing (0% completo)

**6.1. Scripts de Teste**
- ⏳ Criar scripts de stress test
- ⏳ Executar testes de capacidade
- ⏳ Identificar gargalos
- ⏳ Documentar resultados
- **Status:** 0% completo

---

## 📊 RESUMO POR CATEGORIA

| Categoria | Total | Concluídas | Pendentes | % Completo |
|-----------|-------|------------|-----------|------------|
| **Observabilidade** | 8 | 7 | 1 | **87.5%** |
| **KYC** | 3 | 0 | 3 | **0%** (das pendentes) |
| **Limpeza** | 2 | 0 | 2 | **0%** |
| **Workers** | 3 | 0 | 3 | **0%** |
| **Dashboard** | 1 | 0 | 1 | **0%** (das pendentes) |
| **Stress Testing** | 1 | 0 | 1 | **0%** |

---

## 🎯 PRÓXIMOS PASSOS RECOMENDADOS

### Semana 1-2: Finalizar Observabilidade
1. ✅ ~~Completar spans OpenTelemetry~~ (FEITO)
2. ✅ ~~Integrar métricas automáticas~~ (FEITO)
3. ✅ ~~Criar dashboards no admin~~ (FEITO)
4. ⏳ Substituir console.log restantes (~93)
5. ⏳ Criar dashboards Grafana (Redis e Sistema)
6. ⏳ Validar traceId em todos os pontos

### Semana 3-4: KYC + Limpeza
1. ⏳ Corrigir timeout upload CNH
2. ⏳ Implementar Liveness Detection
3. ⏳ Remover arquivos deprecated
4. ⏳ Consolidar serviços duplicados

### Semana 5-6: Workers (Opcional)
1. ⏳ Implementar workers separados
2. ⏳ Configurar Consumer Groups
3. ⏳ Implementar DLQ

---

## 📈 PROGRESSO GERAL

**Antes desta sessão:**
- Observabilidade: ~40%
- Total Geral: ~73%

**Depois desta sessão:**
- Observabilidade: ~85% ✅
- Total Geral: ~78% ✅

**Meta para Produção:**
- Observabilidade: 100%
- Total Geral: ~90%+

---

**Última atualização:** 2026-01-08

