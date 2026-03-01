# 📋 TODO: Testes Pendentes para Sistema de Filas

**Data:** 17/12/2025  
**Status:** Testes de Alta Prioridade Implementados ✅

---

## ✅ TESTES IMPLEMENTADOS (Alta Prioridade)

- ✅ **TC-008**: Race Condition - Múltiplos Motoristas Aceitando
- ✅ **TC-010**: Múltiplas Rejeições Consecutivas  
- ✅ **TC-015**: Ordem Cronológica de Múltiplas Corridas

---

## 🔴 PRIORIDADE ALTA (Próximos a Implementar)

### **TC-009: Motorista Aceita Enquanto Outro Rejeita**
**Objetivo:** Validar que aceitação tem prioridade sobre rejeição simultânea

**Cenário:**
1. Criar corrida e notificar 2 motoristas
2. Motorista 1 tenta aceitar enquanto Motorista 2 rejeita simultaneamente
3. Verificar que aceitação prevalece
4. Verificar que locks são liberados corretamente

**Critérios de Aceite:**
- Apenas aceitação é processada com sucesso
- Rejeição retorna erro ou é ignorada
- Estado final: ACCEPTED
- Locks liberados corretamente

---

### **TC-011: Timing Entre Rejeição e Nova Corrida**
**Objetivo:** Validar que não há condição de corrida entre liberação de lock e nova notificação

**Cenário:**
1. Motorista rejeita corrida
2. Imediatamente verificar se lock foi liberado
3. Verificar se nova corrida foi notificada
4. Validar que não há race condition

**Critérios de Aceite:**
- Lock liberado antes de nova notificação
- Nova corrida notificada corretamente
- Sem erros de concorrência

---

### **TC-012: Timeout e Rejeição Simultâneos**
**Objetivo:** Validar que apenas uma ação é processada quando timeout e rejeição ocorrem simultaneamente

**Cenário:**
1. Motorista recebe notificação
2. Aguardar ~14s (próximo do timeout)
3. Motorista rejeita enquanto timeout está prestes a ocorrer
4. Verificar que apenas uma ação é processada

**Critérios de Aceite:**
- Apenas rejeição OU timeout é processado
- Estado atualizado corretamente
- Sem duplicação de ações

---

## 🟡 PRIORIDADE MÉDIA

### **TC-013: Motorista Fica Offline Durante Notificação**
**Objetivo:** Validar comportamento quando motorista desconecta após receber notificação

**Cenário:**
1. Motorista recebe notificação
2. Motorista desconecta (simular offline)
3. Aguardar timeout
4. Verificar que corrida volta para SEARCHING

**Critérios de Aceite:**
- Timeout é acionado após 15s
- Estado volta para SEARCHING
- Corrida disponível para outros motoristas

---

### **TC-014: Motorista Volta Online Após Timeout**
**Objetivo:** Validar que motorista pode receber novas corridas após timeout

**Cenário:**
1. Motorista recebe notificação
2. Timeout ocorre (15s sem resposta)
3. Motorista reconecta
4. Verificar que pode receber novas corridas
5. Verificar que não recebe corrida que expirou

**Critérios de Aceite:**
- Motorista pode receber novas corridas
- Não recebe corrida que teve timeout
- Lock foi liberado corretamente

---

### **TC-016: Motorista Rejeita e Recebe Corrida Mais Antiga**
**Objetivo:** Validar que ordem cronológica é respeitada ao enviar próxima corrida

**Cenário:**
1. Criar 3 corridas com timestamps diferentes
2. Processar todas
3. Motorista rejeita primeira
4. Verificar que recebe segunda (mais antiga disponível)
5. Não deve receber terceira antes da segunda

**Critérios de Aceite:**
- Recebe corrida mais antiga disponível
- Ordem cronológica respeitada
- Não recebe corridas fora de ordem

---

### **TC-019: Motorista Excluído Não Recebe Corrida Novamente**
**Objetivo:** Validar lista de exclusão permanente

**Cenário:**
1. Motorista rejeita corrida
2. Verificar que foi adicionado à lista de exclusão
3. Corrida continua em SEARCHING
4. Verificar que motorista não recebe a mesma corrida novamente
5. Verificar TTL de exclusão (1 hora)

**Critérios de Aceite:**
- Motorista adicionado à lista de exclusão
- Não recebe mesma corrida novamente
- TTL de 1 hora configurado
- Pode receber outras corridas

---

## 🟢 PRIORIDADE BAIXA

### **TC-017: Stress Test - 500+ Corridas Simultâneas**
**Objetivo:** Validar performance e estabilidade sob carga alta

**Cenário:**
1. Criar 500 corridas simultaneamente
2. Processar todas
3. Monitorar performance
4. Verificar que não há memory leaks
5. Validar que todas são processadas

**Critérios de Aceite:**
- Todas as corridas são processadas
- Sem memory leaks
- Performance aceitável (< 30s para processar todas)
- Sistema estável

---

### **TC-018: 100+ Motoristas Simultâneos**
**Objetivo:** Validar distribuição equilibrada entre muitos motoristas

**Cenário:**
1. Criar 100 motoristas
2. Criar 50 corridas
3. Processar corridas
4. Verificar distribuição entre motoristas
5. Validar que locks funcionam corretamente

**Critérios de Aceite:**
- Distribuição equilibrada
- Locks funcionam corretamente
- Sem motoristas recebendo múltiplas corridas simultaneamente
- Performance aceitável

---

### **TC-020: Motorista Pode Receber Corrida Após 30s de Rejeição**
**Objetivo:** Validar timer de 30s para permitir receber mesma corrida novamente

**Cenário:**
1. Motorista rejeita corrida
2. Verificar timer de 30s agendado
3. Aguardar 30s
4. Verificar que pode receber mesma corrida novamente
5. Validar que antes de 30s não recebe

**Critérios de Aceite:**
- Timer de 30s agendado
- Não recebe antes de 30s
- Pode receber após 30s
- Timer funciona corretamente

---

### **TC-021: Redis Desconecta Durante Busca**
**Objetivo:** Validar tratamento de erro e recuperação

**Cenário:**
1. Iniciar busca gradual
2. Simular desconexão do Redis
3. Verificar tratamento de erro
4. Reconectar Redis
5. Verificar que sistema se recupera

**Critérios de Aceite:**
- Erros são tratados graciosamente
- Sistema se recupera após reconexão
- Busca continua ou para corretamente
- Sem crashes

---

### **TC-022: Múltiplas Regiões Simultâneas**
**Objetivo:** Validar que filas regionais não interferem entre si

**Cenário:**
1. Criar corridas em 3 regiões diferentes
2. Processar todas simultaneamente
3. Verificar que motoristas recebem corridas da região correta
4. Validar que filas não se misturam

**Critérios de Aceite:**
- Filas regionais independentes
- Motoristas recebem corridas da região correta
- Sem interferência entre regiões
- Processamento correto

---

## 📊 RESUMO

- **Total de Testes Pendentes:** 14
- **Alta Prioridade:** 3 (TC-009, TC-011, TC-012)
- **Média Prioridade:** 4 (TC-013, TC-014, TC-016, TC-019)
- **Baixa Prioridade:** 4 (TC-017, TC-018, TC-020, TC-021, TC-022)

---

## 🎯 PRÓXIMOS PASSOS

1. Implementar testes de Alta Prioridade (TC-009, TC-011, TC-012)
2. Executar suite completa de testes
3. Corrigir quaisquer falhas encontradas
4. Implementar testes de Média Prioridade
5. Validar cobertura completa do sistema

