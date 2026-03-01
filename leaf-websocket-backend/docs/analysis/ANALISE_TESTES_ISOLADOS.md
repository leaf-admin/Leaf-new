# Análise Isolada dos Testes - Critérios e Cenários

## TC-003: Rejeição e Próxima Corrida

### Cenário Proposto
1. Criar 2 corridas
2. Processar apenas a primeira
3. Motorista recebe notificação da primeira
4. Motorista rejeita primeira corrida
5. **Esperado**: Motorista recebe notificação da segunda corrida automaticamente

### Critérios Necessários
✅ **Motorista disponível**: Criado e próximo ao pickup
✅ **Primeira corrida processada**: Sim, processada isoladamente
✅ **Segunda corrida na fila**: Sim, enfileirada
✅ **Lock liberado após rejeição**: Sim, verificado
✅ **sendNextRideToDriver chamado**: Sim, após rejeição

### Problema Identificado
❌ **Motorista ainda tem lock de outra corrida**: O diagnóstico mostra `lock.bookingId = "test_perf_1766006283924_26"` (corrida de teste anterior)

**Causa Raiz**: Limpeza incompleta de dados de testes anteriores. O motorista criado pelo teste pode estar reutilizando um ID que já tinha lock ativo.

**Solução**: 
1. Garantir que `cleanupTestData` limpe todos os locks antes de criar novos motoristas
2. Usar IDs únicos para motoristas de teste (incluir timestamp)
3. Verificar e limpar locks antes de iniciar o teste

---

## TC-005: Edge Case - Timeout de Motorista

### Cenário Proposto
1. Criar motorista próximo
2. Criar corrida e iniciar busca
3. Motorista recebe notificação (lock adquirido)
4. **Motorista NÃO responde** (simular timeout)
5. Aguardar 20s (TTL do lock)
6. **Esperado**: 
   - Lock liberado automaticamente
   - Estado volta para SEARCHING
   - Busca continua (expansão de raio)

### Critérios Necessários
✅ **Motorista próximo**: Sim, criado muito próximo (< 100m)
✅ **Notificação enviada**: Sim, verificado
✅ **Lock adquirido**: Sim, verificado antes do timeout
✅ **Timeout de 20s**: Sim, aguardado 22s (20s + 2s margem)
✅ **Lock liberado**: Sim, verificado após timeout

### Problema Identificado
❌ **Estado não volta para SEARCHING**: O diagnóstico mostra que após timeout, o estado ainda está em `NOTIFIED`

**Causa Raiz**: O `scheduleDriverTimeout` no `DriverNotificationDispatcher` verifica se o lock ainda está ativo antes de atualizar o estado. Se o lock expirou naturalmente (TTL do Redis), o timeout handler pode não ser executado ou pode não atualizar o estado.

**Análise do Código**:
```javascript
// driver-notification-dispatcher.js:497
if (lockStatus.isLocked && lockStatus.bookingId === bookingId) {
    // Só atualiza estado se lock ainda está ativo
    await driverLockManager.releaseLock(driverId);
    // ... atualiza estado para SEARCHING
}
```

**Problema**: Se o lock expirou antes do timeout handler executar, `lockStatus.isLocked` será `false` e o estado não será atualizado.

**Solução**: 
1. Verificar estado da corrida independente do lock
2. Se estado é `NOTIFIED` ou `AWAITING_RESPONSE` e não há lock ativo, atualizar para `SEARCHING`
3. Adicionar verificação adicional após timeout para garantir transição de estado

---

## TC-010: Múltiplas Rejeições Consecutivas

### Cenário Proposto
1. Criar 3 corridas
2. Processar primeira corrida
3. Motorista recebe e rejeita primeira
4. **Esperado**: Motorista recebe segunda corrida
5. Motorista rejeita segunda
6. **Esperado**: Motorista recebe terceira corrida

### Critérios Necessários
✅ **3 corridas criadas**: Sim
✅ **Primeira processada**: Sim
✅ **Segunda processada antes de rejeitar**: Sim, processada explicitamente
✅ **Busca gradual iniciada para segunda**: Sim
✅ **Lock liberado após rejeição**: Sim

### Problema Identificado
❌ **Motorista não recebe segunda corrida após rejeitar primeira**

**Análise**: O teste processa a segunda corrida e inicia busca gradual ANTES de rejeitar a primeira. Isso pode causar race condition onde:
- Segunda corrida inicia busca gradual
- Primeira corrida é rejeitada
- `sendNextRideToDriver` tenta iniciar busca gradual novamente para segunda corrida
- Mas a busca já está ativa, então pode não notificar o motorista

**Causa Raiz**: O teste assume que `sendNextRideToDriver` vai iniciar busca gradual, mas se a busca já está ativa, pode não notificar o motorista novamente.

**Solução**: 
1. Não processar segunda corrida antes de rejeitar primeira
2. Deixar `sendNextRideToDriver` processar a segunda corrida após rejeição
3. Ou verificar se motorista já foi notificado antes de iniciar nova busca

---

## TC-013: Motorista Fica Offline Durante Notificação

### Cenário Proposto
1. Criar motorista próximo
2. Criar corrida e iniciar busca
3. Motorista recebe notificação
4. **Motorista desconecta** (simula offline: `isOnline = false`, remove location)
5. Aguardar timeout (20s)
6. **Esperado**: 
   - Estado volta para SEARCHING
   - Lock liberado

### Critérios Necessários
✅ **Motorista recebe notificação**: Sim
✅ **Motorista desconecta**: Sim, `isOnline = false` e location removida
✅ **Timeout aguardado**: Sim, 22s (20s + 2s margem)
✅ **Lock liberado**: Sim, diagnóstico mostra `isLocked: false`

### Problema Identificado
❌ **Estado não volta para SEARCHING**: Diagnóstico mostra `state: "NOTIFIED"` após timeout

**Causa Raiz**: Mesmo problema do TC-005. O timeout handler verifica se o lock está ativo antes de atualizar o estado. Quando o motorista fica offline, o lock pode expirar naturalmente (TTL), e o timeout handler não atualiza o estado.

**Solução**: Mesma do TC-005 - verificar estado independente do lock

---

## TC-016: Motorista Rejeita e Recebe Corrida Mais Antiga

### Cenário Proposto
1. Criar 3 corridas com timestamps diferentes (ordem cronológica)
2. Processar todas as 3 corridas
3. Iniciar busca gradual para todas
4. Motorista recebe primeira corrida (mais antiga)
5. Motorista rejeita primeira
6. **Esperado**: Motorista recebe segunda corrida (próxima mais antiga)

### Critérios Necessários
✅ **3 corridas criadas com timestamps diferentes**: Sim, delay de 100ms entre cada
✅ **Todas processadas**: Sim, `processNextRides(regionHash, 3)`
✅ **Busca iniciada para todas**: Sim
✅ **Primeira corrida recebida**: Sim, verificado
✅ **Primeira corrida rejeitada**: Sim
✅ **Lock liberado**: Sim

### Problema Identificado
❌ **Motorista não recebe segunda corrida**: Diagnóstico mostra que motorista ainda tem lock de outra corrida (`test_perf_1766006283924_26`)

**Causa Raiz**: Mesmo problema do TC-003 - limpeza incompleta de dados de testes anteriores. O motorista tem lock ativo de corrida de outro teste.

**Solução**: Mesma do TC-003 - garantir limpeza completa antes de iniciar teste

---

## TC-018: 100+ Motoristas Simultâneos

### Cenário Proposto
1. Criar 100 motoristas
2. Criar 50 corridas
3. Processar todas as corridas
4. Iniciar busca gradual para todas
5. **Esperado**: 
   - Nenhum motorista recebe múltiplas corridas simultaneamente
   - Distribuição equilibrada (cada motorista recebe no máximo 1 corrida)

### Critérios Necessários
✅ **100 motoristas criados**: Sim
✅ **50 corridas criadas**: Sim
✅ **Todas processadas**: Sim
✅ **Busca iniciada para todas**: Sim

### Problema Identificado
❌ **Alguns motoristas recebem múltiplas corridas simultaneamente**

**Causa Raiz**: O sistema de locks pode ter race conditions quando múltiplas corridas tentam notificar o mesmo motorista simultaneamente. O lock pode não ser adquirido a tempo antes da segunda notificação.

**Análise**: 
- 50 corridas, 100 motoristas = cada motorista deveria receber no máximo 1 corrida
- Se alguns recebem múltiplas, significa que o lock não está funcionando corretamente em cenários de alta concorrência

**Solução**: 
1. Verificar se o `acquireLock` está usando operação atômica no Redis
2. Adicionar retry logic com backoff exponencial
3. Verificar se há janela de tempo entre verificação de lock e notificação

---

## TC-019: Motorista Excluído Não Recebe Corrida Novamente

### Cenário Proposto
1. Criar motorista
2. Criar corrida e iniciar busca
3. Motorista recebe notificação
4. Motorista rejeita
5. **Esperado**: Motorista é adicionado à lista de exclusão
6. Busca continua (expansão de raio)
7. **Esperado**: Motorista NÃO recebe a mesma corrida novamente

### Critérios Necessários
✅ **Motorista recebe primeira notificação**: ❌ **FALHA AQUI**
✅ **Motorista rejeita**: Não executado (depende da notificação)
✅ **Lista de exclusão**: Não verificado (depende da rejeição)

### Problema Identificado
❌ **Motorista não recebe primeira notificação**: O teste falha antes mesmo de rejeitar

**Causa Raiz**: O teste cria apenas 1 motorista, mas a busca gradual pode não encontrar motoristas suficientes no raio inicial (0.5km). O diagnóstico mostra que 5 motoristas foram notificados, mas o motorista do teste não está entre eles.

**Análise**: 
- O teste usa `setupTestDrivers(redis, 1)` que cria 1 motorista
- Mas o diagnóstico mostra que 5 motoristas foram notificados
- Isso significa que há motoristas de outros testes ainda no Redis

**Solução**: 
1. Garantir que apenas o motorista do teste está disponível (limpar outros motoristas)
2. Ou criar motorista muito próximo ao pickup para garantir que será encontrado
3. Verificar se o motorista criado está realmente no Redis antes de iniciar busca

---

## Resumo dos Problemas

### Problemas de Limpeza (TC-003, TC-016)
- **Causa**: Dados de testes anteriores não são limpos completamente
- **Solução**: Melhorar `cleanupTestData` para limpar todos os locks e garantir IDs únicos

### Problemas de Timeout (TC-005, TC-013)
- **Causa**: Timeout handler não atualiza estado se lock expirou naturalmente
- **Solução**: Verificar estado independente do lock no timeout handler

### Problemas de Race Condition (TC-010, TC-018)
- **Causa**: Múltiplas operações simultâneas podem causar condições de corrida
- **Solução**: Melhorar atomicidade das operações de lock e notificação

### Problemas de Setup (TC-019)
- **Causa**: Teste não garante que motorista será encontrado
- **Solução**: Melhorar setup do teste para garantir motorista próximo e isolado


