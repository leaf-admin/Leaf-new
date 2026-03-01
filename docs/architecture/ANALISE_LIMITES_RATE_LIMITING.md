# 📊 ANÁLISE DETALHADA: LIMITES DE RATE LIMITING POR ENDPOINT

## 📅 Data: 16 de Dezembro de 2025

---

## 🎯 **OBJETIVO**

Definir limites adequados de rate limiting para cada endpoint WebSocket crítico, considerando:
- Comportamento normal do usuário
- Casos de uso legítimos
- Proteção contra abuso
- Impacto financeiro/operacional

---

## 📋 **ANÁLISE POR ENDPOINT**

### **1. `createBooking` - Criação de Corrida**

**Comportamento Normal:**
- Usuário solicita 1 corrida por vez
- Pode cancelar e solicitar novamente (máximo 2-3 vezes)
- Tempo entre solicitações: 30-60 segundos
- **Frequência normal: 1-3 requisições/minuto**

**Casos de Uso Legítimos:**
- Solicitar corrida
- Cancelar e solicitar novamente (até 3x)
- Corrigir destino e solicitar novamente

**Possíveis Abusos:**
- Bot criando múltiplas corridas
- Spam de requisições
- Ataque de negação de serviço

**Impacto:**
- 🔴 **ALTO**: Cada corrida gera custos (notificações, busca de motoristas)
- 🔴 **ALTO**: Pode sobrecarregar sistema de matching
- 🔴 **ALTO**: Pode gerar corridas fantasma

**Limite Recomendado:**
- **5 requisições/minuto por usuário** ⚠️ CONSERVADOR
- **10 requisições/minuto por usuário** ✅ BALANCEADO (recomendado)
- **20 requisições/minuto por usuário** ⚠️ PERMISSIVO

**Justificativa:**
- 10/min permite até 3 tentativas com intervalo de 20s
- Protege contra spam
- Não bloqueia usuário legítimo
- **RECOMENDADO: 10/min**

---

### **2. `confirmPayment` - Confirmação de Pagamento**

**Comportamento Normal:**
- 1 confirmação por corrida
- Pode tentar novamente se falhar (máximo 2-3 vezes)
- Tempo entre tentativas: 10-30 segundos
- **Frequência normal: 1-3 requisições/minuto**

**Casos de Uso Legítimos:**
- Confirmar pagamento da corrida
- Retentar se primeira tentativa falhar
- Verificar status do pagamento

**Possíveis Abusos:**
- Tentativas de pagamento múltiplas
- Ataque de força bruta
- Spam de requisições

**Impacto:**
- 🔴 **CRÍTICO**: Operação financeira
- 🔴 **ALTO**: Pode gerar cobranças duplicadas
- 🔴 **ALTO**: Pode sobrecarregar gateway de pagamento

**Limite Recomendado:**
- **3 requisições/minuto por usuário** ⚠️ CONSERVADOR
- **5 requisições/minuto por usuário** ✅ BALANCEADO (recomendado)
- **10 requisições/minuto por usuário** ⚠️ PERMISSIVO

**Justificativa:**
- 5/min permite 2-3 tentativas com intervalo de 12-20s
- Protege contra abuso financeiro
- Não bloqueia retry legítimo
- **RECOMENDADO: 5/min**

---

### **3. `acceptRide` - Aceitar Corrida**

**Comportamento Normal:**
- Motorista aceita 1 corrida por vez
- Pode rejeitar e aceitar outra (máximo 5-10 vezes/minuto em pico)
- Tempo entre aceitações: 5-10 segundos
- **Frequência normal: 2-10 requisições/minuto**

**Casos de Uso Legítimos:**
- Aceitar corrida recebida
- Rejeitar e aceitar outra rapidamente
- Selecionar melhor corrida entre opções

**Possíveis Abusos:**
- Bot aceitando/rejeitando automaticamente
- Spam de aceitações
- Manipulação de sistema de matching

**Impacto:**
- 🟡 **MÉDIO**: Afeta experiência do passageiro
- 🟡 **MÉDIO**: Pode gerar corridas canceladas
- 🟡 **MÉDIO**: Pode sobrecarregar sistema

**Limite Recomendado:**
- **10 requisições/minuto por motorista** ⚠️ CONSERVADOR
- **20 requisições/minuto por motorista** ✅ BALANCEADO (recomendado)
- **30 requisições/minuto por motorista** ⚠️ PERMISSIVO

**Justificativa:**
- 20/min permite selecionar entre múltiplas corridas
- Motorista pode rejeitar e aceitar rapidamente
- Protege contra bot mas permite uso legítimo
- **RECOMENDADO: 20/min**

---

### **4. `startTrip` - Iniciar Corrida**

**Comportamento Normal:**
- 1 início por corrida
- Pode tentar novamente se falhar (máximo 2-3 vezes)
- Tempo entre tentativas: 10-30 segundos
- **Frequência normal: 1-3 requisições/minuto**

**Casos de Uso Legítimos:**
- Iniciar corrida aceita
- Retentar se primeira tentativa falhar
- Corrigir e tentar novamente

**Possíveis Abusos:**
- Tentativas múltiplas de início
- Manipulação de status da corrida
- Bypass de validações

**Impacto:**
- 🔴 **ALTO**: Já tem validação de pagamento
- 🟡 **MÉDIO**: Pode gerar corridas iniciadas incorretamente
- 🟡 **MÉDIO**: Afeta rastreamento

**Limite Recomendado:**
- **3 requisições/minuto por motorista** ⚠️ CONSERVADOR
- **5 requisições/minuto por motorista** ✅ BALANCEADO (recomendado)
- **10 requisições/minuto por motorista** ⚠️ PERMISSIVO

**Justificativa:**
- 5/min permite 2-3 tentativas com intervalo de 12-20s
- Já tem validação de pagamento (proteção adicional)
- Não bloqueia retry legítimo
- **RECOMENDADO: 5/min**

---

### **5. `finishTrip` - Finalizar Corrida**

**Comportamento Normal:**
- 1 finalização por corrida
- Pode tentar novamente se falhar (máximo 2-3 vezes)
- Tempo entre tentativas: 10-30 segundos
- **Frequência normal: 1-3 requisições/minuto**

**Casos de Uso Legítimos:**
- Finalizar corrida iniciada
- Retentar se primeira tentativa falhar
- Corrigir e tentar novamente

**Possíveis Abusos:**
- Tentativas múltiplas de finalização
- Manipulação de valores
- Bypass de validações

**Impacto:**
- 🔴 **CRÍTICO**: Gera distribuição financeira
- 🔴 **ALTO**: Pode gerar pagamentos duplicados
- 🔴 **ALTO**: Afeta saldo do motorista

**Limite Recomendado:**
- **3 requisições/minuto por motorista** ⚠️ CONSERVADOR
- **5 requisições/minuto por motorista** ✅ BALANCEADO (recomendado)
- **10 requisições/minuto por motorista** ⚠️ PERMISSIVO

**Justificativa:**
- 5/min permite 2-3 tentativas com intervalo de 12-20s
- Operação crítica (financeira)
- Não bloqueia retry legítimo
- **RECOMENDADO: 5/min**

---

### **6. `cancelRide` - Cancelar Corrida**

**Comportamento Normal:**
- 1 cancelamento por corrida
- Pode cancelar e solicitar novamente (máximo 2-3 vezes)
- Tempo entre cancelamentos: 30-60 segundos
- **Frequência normal: 1-3 requisições/minuto**

**Casos de Uso Legítimos:**
- Cancelar corrida solicitada
- Cancelar e solicitar novamente
- Cancelar por mudança de planos

**Possíveis Abusos:**
- Spam de cancelamentos
- Manipulação de sistema
- Ataque de negação de serviço

**Impacto:**
- 🟡 **MÉDIO**: Pode gerar reembolsos
- 🟡 **MÉDIO**: Afeta experiência
- 🟡 **MÉDIO**: Pode sobrecarregar sistema

**Limite Recomendado:**
- **2 requisições/minuto por usuário** ⚠️ CONSERVADOR
- **3 requisições/minuto por usuário** ✅ BALANCEADO (recomendado)
- **5 requisições/minuto por usuário** ⚠️ PERMISSIVO

**Justificativa:**
- 3/min permite cancelar e solicitar novamente
- Protege contra spam
- Não bloqueia uso legítimo
- **RECOMENDADO: 3/min**

---

### **7. `rejectRide` - Rejeitar Corrida**

**Comportamento Normal:**
- Motorista pode rejeitar múltiplas corridas rapidamente
- Pode rejeitar 5-10 corridas/minuto em pico
- Tempo entre rejeições: 2-5 segundos
- **Frequência normal: 5-15 requisições/minuto**

**Casos de Uso Legítimos:**
- Rejeitar corridas indesejadas
- Selecionar melhor corrida
- Filtrar corridas por critérios

**Possíveis Abusos:**
- Bot rejeitando automaticamente
- Spam de rejeições
- Manipulação de sistema

**Impacto:**
- 🟢 **BAIXO**: Não gera custos
- 🟡 **MÉDIO**: Afeta experiência do passageiro
- 🟡 **MÉDIO**: Pode sobrecarregar sistema

**Limite Recomendado:**
- **15 requisições/minuto por motorista** ⚠️ CONSERVADOR
- **30 requisições/minuto por motorista** ✅ BALANCEADO (recomendado)
- **50 requisições/minuto por motorista** ⚠️ PERMISSIVO

**Justificativa:**
- 30/min permite rejeitar múltiplas corridas rapidamente
- Motorista precisa filtrar corridas
- Protege contra bot mas permite uso legítimo
- **RECOMENDADO: 30/min**

---

### **8. `updateLocation` / `updateDriverLocation` - Atualização de Localização**

**Comportamento Normal:**
- Atualização contínua (GPS)
- Frequência: 1-5 vezes/segundo (60-300/minuto)
- Crítico para rastreamento em tempo real
- **Frequência normal: 60-300 requisições/minuto**

**Casos de Uso Legítimos:**
- Rastreamento GPS em tempo real
- Atualização contínua durante corrida
- Navegação e direcionamento

**Possíveis Abusos:**
- Spam de atualizações
- Manipulação de localização
- Ataque de negação de serviço

**Impacto:**
- 🟡 **MÉDIO**: Alto volume de requisições
- 🟢 **BAIXO**: Operação leve (apenas atualização)
- 🟡 **MÉDIO**: Pode sobrecarregar Redis

**Limite Recomendado:**
- **100 requisições/minuto por usuário** ⚠️ CONSERVADOR
- **200 requisições/minuto por usuário** ✅ BALANCEADO (recomendado)
- **300 requisições/minuto por usuário** ⚠️ PERMISSIVO

**Justificativa:**
- 200/min = ~3 atualizações/segundo (suficiente para GPS)
- Permite rastreamento em tempo real
- Protege contra spam mas não bloqueia uso legítimo
- **RECOMENDADO: 200/min**

---

### **9. `sendMessage` - Enviar Mensagem no Chat**

**Comportamento Normal:**
- Usuário pode enviar múltiplas mensagens rapidamente
- Conversa ativa: 5-20 mensagens/minuto
- Pico: até 30 mensagens/minuto
- **Frequência normal: 5-30 requisições/minuto**

**Casos de Uso Legítimos:**
- Conversa durante corrida
- Enviar múltiplas mensagens rapidamente
- Comunicação em tempo real

**Possíveis Abusos:**
- Spam de mensagens
- Flood de chat
- Ataque de negação de serviço

**Impacto:**
- 🟢 **BAIXO**: Operação leve
- 🟡 **MÉDIO**: Pode sobrecarregar sistema de chat
- 🟡 **MÉDIO**: Afeta experiência do outro usuário

**Limite Recomendado:**
- **20 requisições/minuto por usuário** ⚠️ CONSERVADOR
- **30 requisições/minuto por usuário** ✅ BALANCEADO (recomendado)
- **50 requisições/minuto por usuário** ⚠️ PERMISSIVO

**Justificativa:**
- 30/min permite conversa ativa
- Protege contra spam
- Não bloqueia uso legítimo
- **RECOMENDADO: 30/min**

---

### **10. `searchDrivers` - Buscar Motoristas**

**Comportamento Normal:**
- Busca contínua enquanto aguarda motorista
- Frequência: 1-2 vezes/segundo (60-120/minuto)
- Pode durar vários minutos
- **Frequência normal: 60-120 requisições/minuto**

**Casos de Uso Legítimos:**
- Busca contínua de motoristas próximos
- Atualização de motoristas disponíveis
- Expansão gradual de raio

**Possíveis Abusos:**
- Spam de buscas
- Ataque de negação de serviço
- Sobrecarregar sistema de matching

**Impacto:**
- 🟡 **MÉDIO**: Operação pesada (busca geográfica)
- 🟡 **MÉDIO**: Pode sobrecarregar Redis
- 🟡 **MÉDIO**: Afeta performance do sistema

**Limite Recomendado:**
- **60 requisições/minuto por usuário** ⚠️ CONSERVADOR
- **120 requisições/minuto por usuário** ✅ BALANCEADO (recomendado)
- **180 requisições/minuto por usuário** ⚠️ PERMISSIVO

**Justificativa:**
- 120/min = 2 buscas/segundo (suficiente para busca contínua)
- Permite expansão gradual de raio
- Protege contra spam mas não bloqueia uso legítimo
- **RECOMENDADO: 120/min**

---

## 📊 **TABELA RESUMO DE LIMITES**

| Endpoint | Impacto | Frequência Normal | Limite Conservador | Limite Balanceado ⭐ | Limite Permissivo |
|----------|---------|-----------------|----------------------|---------------------|-------------------|
| `createBooking` | 🔴 ALTO | 1-3/min | 5/min | **10/min** | 20/min |
| `confirmPayment` | 🔴 CRÍTICO | 1-3/min | 3/min | **5/min** | 10/min |
| `acceptRide` | 🟡 MÉDIO | 2-10/min | 10/min | **20/min** | 30/min |
| `startTrip` | 🔴 ALTO | 1-3/min | 3/min | **5/min** | 10/min |
| `finishTrip` | 🔴 CRÍTICO | 1-3/min | 3/min | **5/min** | 10/min |
| `cancelRide` | 🟡 MÉDIO | 1-3/min | 2/min | **3/min** | 5/min |
| `rejectRide` | 🟡 MÉDIO | 5-15/min | 15/min | **30/min** | 50/min |
| `updateLocation` | 🟡 MÉDIO | 60-300/min | 100/min | **200/min** | 300/min |
| `sendMessage` | 🟢 BAIXO | 5-30/min | 20/min | **30/min** | 50/min |
| `searchDrivers` | 🟡 MÉDIO | 60-120/min | 60/min | **120/min** | 180/min |

---

## 🎯 **LIMITES FINAIS RECOMENDADOS**

### **Endpoints Críticos (Financeiros/Operacionais):**

```javascript
const RATE_LIMITS = {
  // 🔴 CRÍTICO - Operações Financeiras
  'confirmPayment': { limit: 5, window: 60 },    // 5/min
  'finishTrip': { limit: 5, window: 60 },        // 5/min
  
  // 🔴 ALTO - Operações que Geram Custos
  'createBooking': { limit: 10, window: 60 },    // 10/min
  'startTrip': { limit: 5, window: 60 },         // 5/min
  
  // 🟡 MÉDIO - Operações que Afetam Experiência
  'acceptRide': { limit: 20, window: 60 },        // 20/min
  'cancelRide': { limit: 3, window: 60 },          // 3/min
  'rejectRide': { limit: 30, window: 60 },        // 30/min
  
  // 🟡 MÉDIO - Operações de Alto Volume
  'updateLocation': { limit: 200, window: 60 },   // 200/min
  'updateDriverLocation': { limit: 200, window: 60 }, // 200/min
  'searchDrivers': { limit: 120, window: 60 },   // 120/min
  
  // 🟢 BAIXO - Operações Leves
  'sendMessage': { limit: 30, window: 60 },       // 30/min
};
```

---

## 🔍 **ANÁLISE DE CASOS ESPECIAIS**

### **Caso 1: Usuário com Bug no Cliente**

**Cenário:** Cliente com bug fazendo requisições repetidas

**Proteção:**
- Limites por usuário protegem
- Usuário legítimo não é afetado
- Sistema não fica sobrecarregado

**Ajuste:** Não necessário (limites já protegem)

---

### **Caso 2: Motorista Selecionando Múltiplas Corridas**

**Cenário:** Motorista recebe 5 corridas e precisa escolher

**Proteção:**
- `acceptRide`: 20/min permite aceitar/rejeitar rapidamente
- `rejectRide`: 30/min permite filtrar múltiplas corridas
- **Adequado para uso legítimo**

---

### **Caso 3: Passageiro com Problemas de Conexão**

**Cenário:** Passageiro perde conexão e tenta novamente várias vezes

**Proteção:**
- `createBooking`: 10/min permite 3 tentativas com intervalo de 20s
- `confirmPayment`: 5/min permite 2-3 tentativas
- **Adequado para retry legítimo**

---

### **Caso 4: GPS de Alta Frequência**

**Cenário:** App enviando atualizações GPS muito frequentes

**Proteção:**
- `updateLocation`: 200/min = ~3 atualizações/segundo
- Suficiente para GPS preciso
- **Adequado para rastreamento em tempo real**

---

## ⚠️ **AJUSTES FUTUROS**

### **Se Limites Forem Muito Restritivos:**

**Sintomas:**
- Muitos usuários legítimos bloqueados
- Reclamações de "muitas requisições"

**Ação:**
- Aumentar limites em 50-100%
- Monitorar logs de bloqueios
- Ajustar conforme necessário

---

### **Se Limites Forem Muito Permissivos:**

**Sintomas:**
- Ataques ainda ocorrem
- Sistema sobrecarregado
- Muitas requisições suspeitas

**Ação:**
- Reduzir limites em 30-50%
- Adicionar validações adicionais
- Implementar rate limiting híbrido

---

## 📊 **MÉTRICAS PARA MONITORAR**

1. **Taxa de Bloqueios:**
   - % de requisições bloqueadas
   - Por endpoint
   - Por usuário

2. **Falsos Positivos:**
   - Usuários legítimos bloqueados
   - Reclamações de bloqueio

3. **Padrões de Abuso:**
   - Usuários que sempre atingem limite
   - IPs com muitos bloqueios
   - Padrões suspeitos

---

## 🎯 **RECOMENDAÇÃO FINAL**

### **Limites Balanceados (Recomendados):**

```javascript
const RATE_LIMITS = {
  // Operações Críticas (Financeiras)
  'confirmPayment': 5,   // 5/min - Proteção máxima
  'finishTrip': 5,       // 5/min - Proteção máxima
  
  // Operações Importantes
  'createBooking': 10,   // 10/min - Permite retry
  'startTrip': 5,        // 5/min - Já tem validação
  
  // Operações de Seleção
  'acceptRide': 20,      // 20/min - Permite escolher
  'rejectRide': 30,      // 30/min - Permite filtrar
  'cancelRide': 3,       // 3/min - Proteção contra spam
  
  // Operações de Alto Volume
  'updateLocation': 200,        // 200/min - GPS em tempo real
  'updateDriverLocation': 200,  // 200/min - GPS em tempo real
  'searchDrivers': 120,         // 120/min - Busca contínua
  
  // Operações Leves
  'sendMessage': 30,     // 30/min - Conversa ativa
};
```

**Justificativa:**
- ✅ Balanceia proteção e usabilidade
- ✅ Permite uso legítimo normal
- ✅ Protege contra abuso
- ✅ Fácil de ajustar depois

---

**Última atualização:** 16/12/2025



