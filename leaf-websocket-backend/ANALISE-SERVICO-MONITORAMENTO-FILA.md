# Análise: Serviço de Monitoramento de Fila

## 🎯 Pergunta
**Qual serviço monitora a fila para enviar a próxima corrida ao motorista quando os critérios são cumpridos?**

## 📊 Resposta: Dois Serviços Trabalham em Conjunto

### 1. **QueueWorker** (Processamento Contínuo de Filas)
**Arquivo:** `services/queue-worker.js`

**Responsabilidade:**
- Monitora e processa corridas pendentes continuamente
- Move corridas de PENDING → SEARCHING
- Inicia busca gradual para cada corrida processada

**Como Funciona:**
```javascript
// Executa a cada 3 segundos
setInterval(() => {
    processAllQueues();
}, 3000);

// Para cada região com corridas pendentes:
// 1. Processa até 10 corridas (batch)
// 2. Muda estado: PENDING → SEARCHING
// 3. Inicia busca gradual (GradualRadiusExpander)
```

**Fluxo:**
1. Busca todas as regiões com corridas pendentes (`ride_queue:*:pending`)
2. Para cada região, processa até 10 corridas por vez
3. Para cada corrida processada:
   - Muda estado: PENDING → SEARCHING
   - Move para fila ativa (`ride_queue:{region}:active`)
   - Inicia `GradualRadiusExpander.startGradualSearch()`

**Configurações:**
- Intervalo: 3 segundos
- Batch size: 10 corridas por região
- Máximo de regiões: 50 por iteração

---

### 2. **ResponseHandler.sendNextRideToDriver()** (Envio Imediato Após Rejeição)
**Arquivo:** `services/response-handler.js` (linha 709)

**Responsabilidade:**
- Enviar próxima corrida ao motorista **imediatamente após rejeição**
- Não é um serviço contínuo, é chamado sob demanda

**Quando é Chamado:**
- Após `handleRejectRide()` (linha 619)
- Quando motorista rejeita uma corrida

**Como Funciona:**
```javascript
async sendNextRideToDriver(driverId) {
    // 1. Buscar localização do motorista
    // 2. Processar corridas pendentes (se houver)
    // 3. Buscar na fila ativa (corridas em SEARCHING)
    // 4. Verificar critérios:
    //    - Motorista não está excluído
    //    - Motorista não tem notificação ativa na tela
    //    - Corrida está dentro do raio (5km)
    // 5. Notificar motorista diretamente
    // 6. Iniciar busca gradual se necessário
}
```

**Critérios para Enviar:**
1. ✅ Motorista não está excluído da corrida (`ride_excluded_drivers`)
2. ✅ Motorista não tem notificação ativa na tela (`driver_active_notification`)
3. ✅ Corrida está dentro do raio (5km máximo)
4. ✅ Corrida está em estado SEARCHING ou EXPANDED
5. ✅ Motorista não tem lock de corrida em andamento

---

## 🔄 Fluxo Completo Atual

### Cenário: Motorista Rejeita Corrida

```
1. Motorista rejeita corrida A
   ↓
2. ResponseHandler.handleRejectRide()
   - Remove driver_active_notification
   - Adiciona motorista à lista de exclusão para corrida A
   - Chama sendNextRideToDriver()
   ↓
3. sendNextRideToDriver()
   - Processa corridas pendentes (se houver)
   - Busca na fila ativa (corridas em SEARCHING)
   - Encontra corrida B (próxima disponível)
   - Verifica critérios
   - Notifica motorista diretamente
   - Inicia busca gradual para corrida B (se não estiver ativa)
   ↓
4. Motorista recebe corrida B
```

### Problema Atual Identificado

**O `sendNextRideToDriver()` está funcionando, MAS:**

1. **Depende de corridas já estarem processadas:**
   - Se segunda corrida ainda está PENDING, precisa processar primeiro
   - Processamento pode demorar até 3 segundos (intervalo do QueueWorker)

2. **Não há monitoramento contínuo para motoristas livres:**
   - `sendNextRideToDriver()` só é chamado após rejeição
   - Se motorista fica livre (timeout, etc.), não recebe próxima corrida automaticamente
   - Depende do `QueueWorker` processar novas corridas

3. **Race Condition:**
   - Se múltiplas corridas são processadas simultaneamente
   - Busca gradual pode notificar motorista para todas elas
   - Quando rejeita primeira, já foi notificado para segunda

---

## 💡 Solução Proposta

### Opção 1: Melhorar `sendNextRideToDriver()` (Atual)
**Vantagens:**
- Já existe e funciona
- Resposta imediata após rejeição
- Não precisa de novo serviço

**Melhorias Necessárias:**
- ✅ Processar corridas pendentes antes de buscar (já implementado)
- ✅ Ordenar por timestamp (já implementado)
- ✅ Verificar notificação ativa na tela (já implementado)
- ⚠️ Garantir que apenas segunda corrida seja processada (em progresso)

### Opção 2: Criar Serviço de Monitoramento de Motoristas Livres
**Novo Serviço:** `DriverAvailabilityMonitor`

**Responsabilidade:**
- Monitorar motoristas que ficaram livres (rejeição, timeout)
- Verificar se há corridas disponíveis para eles
- Enviar próxima corrida automaticamente

**Como Funcionaria:**
```javascript
class DriverAvailabilityMonitor {
    start() {
        setInterval(async () => {
            // 1. Buscar motoristas livres (sem notificação ativa, sem lock)
            // 2. Para cada motorista livre:
            //    - Buscar próxima corrida disponível
            //    - Verificar critérios
            //    - Notificar se disponível
        }, 2000); // A cada 2 segundos
    }
}
```

**Vantagens:**
- Monitoramento contínuo
- Motorista recebe próxima corrida mesmo sem rejeição explícita
- Cobre casos de timeout, reconexão, etc.

**Desvantagens:**
- Mais complexo
- Pode causar notificações duplicadas se não bem implementado
- Mais carga no sistema

---

## 📋 Resumo

### Serviços Atuais:

1. **QueueWorker** ✅
   - Monitora filas pendentes
   - Processa corridas continuamente (a cada 3s)
   - Inicia busca gradual

2. **ResponseHandler.sendNextRideToDriver()** ✅
   - Envia próxima corrida após rejeição
   - Chamado sob demanda
   - Processa pendentes e busca ativas

3. **GradualRadiusExpander** ✅
   - Expande raio gradualmente (0.5km → 3km)
   - Notifica motoristas encontrados

4. **RadiusExpansionManager** ✅
   - Monitora corridas em SEARCHING > 60s
   - Expande para 5km se necessário

### O Que Está Faltando:

❌ **Serviço que monitora motoristas livres continuamente**
- Atualmente, motorista só recebe próxima corrida se:
  1. Rejeitar explicitamente (chama `sendNextRideToDriver`)
  2. QueueWorker processar nova corrida e busca gradual encontrar

❌ **Garantia de ordem cronológica**
- Múltiplas corridas podem ser processadas simultaneamente
- Motorista pode receber terceira antes da segunda

---

## 🔧 Recomendações

### Curto Prazo (Corrigir TC-010):
1. ✅ Melhorar `sendNextRideToDriver()` para garantir ordem cronológica
2. ✅ Processar apenas segunda corrida após rejeição (não todas)
3. ✅ Limpar corridas antigas antes de testes

### Médio Prazo (Melhorar Sistema):
1. ⚠️ Criar `DriverAvailabilityMonitor` para monitorar motoristas livres
2. ⚠️ Garantir processamento sequencial de corridas (não simultâneo)
3. ⚠️ Adicionar fila de prioridade para motoristas que rejeitaram

### Longo Prazo (Otimizar):
1. 📋 Implementar sistema de eventos para notificar motoristas livres
2. 📋 Cache de motoristas disponíveis por região
3. 📋 Balanceamento de carga entre regiões


