# 📋 PRÓXIMAS TAREFAS PRIORIZADAS - LEAF

## 📅 Data: 17 de Dezembro de 2025

---

## ✅ **TAREFAS CONCLUÍDAS**

### **Persistência de Dados** ✅
- ✅ Persistência de Corridas (Firestore)
- ✅ Persistência de Pagamentos (Firestore com histórico)
- ✅ Persistência de Chat (Firestore com TTL)

### **Validações de Segurança** ✅
- ✅ Validação de Pagamento antes de iniciar corrida
- ✅ Rate Limiting (todos os endpoints críticos)
- ✅ Logs de Auditoria (completo)
- ✅ Validação de Dados de Entrada (sanitização)

### **Testes E2E** ✅
- ✅ Fluxo Passageiro Completo
- ✅ Fluxo Motorista Completo
- ✅ Integração WebSocket
- ✅ Toggle entre Modos
- ✅ **11/11 testes passando (100%)**

---

## 🎯 **PRÓXIMAS TAREFAS (Por Prioridade)**

### **1. Sistema de Filas e Expansão de Raio** ⚠️

**Status:** 90% implementado, mas pode precisar de otimizações

**O que já existe:**
- ✅ `RideQueueManager` - Gerenciamento de filas regionais
- ✅ `GradualRadiusExpander` - Expansão gradual 0.5km → 3km
- ✅ `RadiusExpansionManager` - Expansão para 5km após 60s
- ✅ `DriverLockManager` - Locks distribuídos (Redis)
- ✅ `QueueWorker` - Processamento contínuo

**O que pode faltar:**
- [ ] Testes do sistema de filas
- [ ] Otimizações de performance
- [ ] Monitoramento e métricas
- [ ] Documentação de uso

**Prioridade:** 🟡 MÉDIA (já está funcionando, melhorias incrementais)

---

### **2. Dashboard Admin** ⚠️

**Status:** 60% implementado

**O que já existe:**
- ✅ Estrutura Next.js 14 + TypeScript
- ✅ Autenticação Firebase
- ✅ Páginas básicas (dashboard, drivers, metrics, notifications)
- ✅ Componentes de UI (Chakra UI)
- ✅ Hooks para buscar dados

**O que falta:**
- [ ] Autenticação JWT para admin (atualmente só Firebase)
- [ ] APIs completas de métricas em tempo real
- [ ] Interface de gerenciamento de motoristas
- [ ] Sistema de relatórios
- [ ] Logs e monitoramento
- [ ] Visualização de mapas (TODO linha 1327 em metrics.tsx)
- [ ] Histórico de notificações (TODO linha 99 em notifications.tsx)

**Prioridade:** 🟡 MÉDIA (funcional, mas pode melhorar)

---

### **3. Melhorias no DriverUI** ⚠️

**Status:** 90% implementado

**O que falta:**
- [ ] Menu do motorista (TODO linha 2837)
- [ ] Notificações do motorista (TODO linha 2858)

**Prioridade:** 🟢 BAIXA (melhorias de UX)

---

## 🎯 **RECOMENDAÇÃO: PRÓXIMA TAREFA**

### **Opção 1: Otimizar e Testar Sistema de Filas** 🟡

**Por quê:**
- Sistema já está implementado, mas pode precisar de testes
- Melhorias de performance podem ser necessárias
- Garantir que está funcionando perfeitamente em produção

**O que fazer:**
- [ ] Criar testes para RideQueueManager
- [ ] Testar expansão gradual de raio
- [ ] Validar locks distribuídos
- [ ] Otimizar performance se necessário
- [ ] Adicionar métricas e monitoramento

**Tempo estimado:** 2-3 dias

---

### **Opção 2: Completar Dashboard Admin** 🟡

**Por quê:**
- Dashboard já tem estrutura básica
- Faltam funcionalidades importantes (APIs, relatórios)
- Necessário para operação do negócio

**O que fazer:**
- [ ] Implementar autenticação JWT para admin
- [ ] Criar APIs completas de métricas em tempo real
- [ ] Implementar visualização de mapas
- [ ] Adicionar histórico de notificações
- [ ] Sistema de relatórios

**Tempo estimado:** 3-5 dias

---

### **Opção 3: Melhorias no DriverUI** 🟢

**Por quê:**
- Melhorias de UX
- Funcionalidades menores
- Não bloqueia produção

**O que fazer:**
- [ ] Implementar menu do motorista
- [ ] Implementar notificações do motorista

**Tempo estimado:** 1-2 dias

---

## 📊 **ANÁLISE DE IMPACTO**

| Tarefa | Impacto | Esforço | Prioridade |
|--------|---------|---------|------------|
| **Sistema de Filas (Testes/Otimizações)** | 🟡 Médio | 2-3 dias | MÉDIA |
| **Dashboard Admin (Completar)** | 🟡 Médio | 3-5 dias | MÉDIA |
| **DriverUI (Melhorias)** | 🟢 Baixo | 1-2 dias | BAIXA |

---

## 🎯 **RECOMENDAÇÃO FINAL**

### **Próxima Tarefa Recomendada: Otimizar Sistema de Filas**

**Justificativa:**
1. Sistema já está implementado, mas precisa de validação
2. Testes garantem que está funcionando corretamente
3. Otimizações podem melhorar performance
4. Menor esforço que completar dashboard
5. Impacto direto na experiência do usuário (matching)

**Próximos passos:**
1. Criar testes para RideQueueManager
2. Testar expansão gradual de raio
3. Validar locks distribuídos
4. Adicionar métricas e monitoramento
5. Otimizar performance se necessário

---

**Última atualização:** 17/12/2025



