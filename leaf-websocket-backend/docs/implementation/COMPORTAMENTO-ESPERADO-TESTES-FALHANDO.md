# Comportamento Esperado dos Testes que Estão Falhando

## 📋 Resumo
- **Total de testes**: 22
- **Passando**: 14 (63.6%)
- **Falhando**: 8 (36.4%)

## ❌ Testes Falhando

### TC-003: Rejeição e Próxima Corrida

#### Objetivo
Validar que quando um motorista rejeita uma corrida, ele recebe automaticamente a próxima corrida disponível na fila.

#### Cenário
1. Criar 2 corridas (primeira e segunda)
2. Processar primeira corrida e iniciar busca gradual
3. Motorista recebe notificação da primeira corrida
4. Motorista rejeita primeira corrida
5. **Esperado**: Motorista recebe notificação da segunda corrida automaticamente

#### Comportamento Esperado
- **Estado da primeira corrida**: Permanece `SEARCHING` após rejeição
- **Lock do motorista**: Liberado imediatamente após rejeição
- **Segunda corrida**: Deve ser notificada ao motorista automaticamente via `sendNextRideToDriver`
- **Estado da segunda corrida**: Deve estar em `SEARCHING` ou já processada (na fila ativa)

#### Critérios de Sucesso
1. ✅ Lock liberado após rejeição
2. ❌ Segunda corrida notificada automaticamente ao motorista
3. ✅ Estado da primeira corrida permanece `SEARCHING`

#### Possíveis Problemas
- `sendNextRideToDriver` não está sendo chamado após rejeição
- Segunda corrida não está na fila ativa quando `sendNextRideToDriver` é chamado
- Busca gradual não está iniciada para segunda corrida
- Motorista está excluído da segunda corrida (não deveria estar)

---

### TC-006: Cancelamento Durante Busca

#### Objetivo
Validar que quando uma corrida é cancelada durante a busca de motoristas, todos os locks são liberados e a busca para.

#### Cenário
1. Criar corrida e iniciar busca gradual
2. Aguardar algumas notificações (motoristas recebem notificações e adquirem locks)
3. Cancelar corrida
4. **Esperado**: Busca para, locks são liberados, corrida removida da fila

#### Comportamento Esperado
- **Estado da corrida**: `SEARCHING` → `CANCELED`
- **Busca gradual**: Deve parar (timeout removido)
- **Locks**: Todos os locks de motoristas notificados devem ser liberados
- **Fila**: Corrida removida da fila pendente e ativa

#### Critérios de Sucesso
1. ✅ Corrida removida da fila
2. ❌ Busca gradual parada (timeout removido)
3. ❌ Todos os locks liberados

#### Possíveis Problemas
- `stopSearch` não está liberando locks corretamente
- Locks não estão sendo liberados quando busca é parada
- Timeout da busca gradual não está sendo cancelado

---

### TC-010: Múltiplas Rejeições Consecutivas

#### Objetivo
Validar que um motorista pode rejeitar múltiplas corridas consecutivas e receber a próxima automaticamente, mantendo ordem cronológica.

#### Cenário
1. Criar 3 corridas (primeira, segunda, terceira)
2. Processar primeira corrida e iniciar busca
3. Motorista recebe primeira corrida e rejeita
4. **Esperado**: Motorista recebe segunda corrida automaticamente
5. Motorista rejeita segunda corrida
6. **Esperado**: Motorista recebe terceira corrida automaticamente (ordem cronológica)

#### Comportamento Esperado
- **Ordem**: Primeira → Segunda → Terceira (ordem cronológica)
- **Lock**: Liberado após cada rejeição
- **Próxima corrida**: Notificada automaticamente após cada rejeição
- **Estado**: Todas as corridas permanecem em `SEARCHING` até aceitação

#### Critérios de Sucesso
1. ✅ Primeira corrida rejeitada, segunda notificada
2. ❌ Segunda corrida rejeitada, terceira notificada
3. ✅ Ordem cronológica mantida

#### Possíveis Problemas
- `sendNextRideToDriver` não está buscando próxima corrida na ordem correta
- Terceira corrida não está processada quando segunda é rejeitada
- Motorista está excluído de alguma corrida (não deveria estar)

---

### TC-011: Timing Entre Rejeição e Nova Corrida

#### Objetivo
Validar que o lock é liberado imediatamente após rejeição e a próxima corrida é notificada rapidamente.

#### Cenário
1. Criar 2 corridas
2. Processar primeira e iniciar busca
3. Motorista recebe primeira corrida
4. Motorista rejeita primeira corrida
5. **Esperado**: Lock liberado imediatamente, segunda corrida notificada rapidamente

#### Comportamento Esperado
- **Lock**: Liberado imediatamente após rejeição (< 200ms)
- **Segunda corrida**: Notificada dentro de 1-2 segundos após rejeição
- **Estado**: Primeira corrida permanece `SEARCHING`, segunda corrida em `SEARCHING`

#### Critérios de Sucesso
1. ✅ Lock liberado imediatamente (< 200ms)
2. ❌ Segunda corrida notificada rapidamente (< 2s)
3. ✅ Lock adquirido para segunda corrida

#### Possíveis Problemas
- `sendNextRideToDriver` não está sendo chamado imediatamente após rejeição
- Segunda corrida não está processada quando primeira é rejeitada
- Busca gradual não está iniciada para segunda corrida

---

### TC-013: Motorista Fica Offline Durante Notificação

#### Objetivo
Validar que quando um motorista fica offline após receber notificação, o timeout é acionado e a corrida volta para `SEARCHING`.

#### Cenário
1. Criar corrida e iniciar busca
2. Motorista recebe notificação (lock adquirido)
3. Motorista desconecta (fica offline)
4. Aguardar timeout (20s)
5. **Esperado**: Lock liberado, estado volta para `SEARCHING`

#### Comportamento Esperado
- **Estado antes do timeout**: `SEARCHING` (não muda para `NOTIFIED`)
- **Lock**: Adquirido quando motorista recebe notificação
- **Motorista offline**: `isOnline = false`, removido de `driver_locations`
- **Após timeout (20s)**: Lock liberado, estado permanece `SEARCHING`
- **Busca**: Continua buscando outros motoristas

#### Critérios de Sucesso
1. ✅ Motorista recebe notificação
2. ✅ Motorista fica offline
3. ❌ Após timeout, estado permanece `SEARCHING` (não volta, já está)
4. ✅ Lock liberado após timeout

#### Possíveis Problemas
- Timeout handler não está verificando se motorista está offline
- Estado está sendo verificado incorretamente (esperando `NOTIFIED` mas estado sempre é `SEARCHING`)
- Lock não está sendo liberado no timeout

---

### TC-016: Motorista Rejeita e Recebe Corrida Mais Antiga

#### Objetivo
Validar que quando um motorista rejeita uma corrida, ele recebe a próxima corrida mais antiga disponível (ordem cronológica).

#### Cenário
1. Criar 3 corridas com timestamps diferentes (primeira mais antiga)
2. Processar todas e iniciar busca
3. Motorista recebe primeira corrida (mais antiga)
4. Motorista rejeita primeira corrida
5. **Esperado**: Motorista recebe segunda corrida (mais antiga disponível)

#### Comportamento Esperado
- **Ordem**: Primeira (mais antiga) → Segunda (mais antiga disponível após rejeição)
- **Lock**: Liberado após rejeição
- **Próxima corrida**: Segunda corrida (ordem cronológica)
- **Estado**: Todas permanecem `SEARCHING` até aceitação

#### Critérios de Sucesso
1. ✅ Motorista recebe primeira corrida (mais antiga)
2. ✅ Motorista rejeita primeira
3. ❌ Motorista recebe segunda corrida (mais antiga disponível)

#### Possíveis Problemas
- `sendNextRideToDriver` não está buscando corrida mais antiga
- Segunda corrida não está na fila ativa quando primeira é rejeitada
- Ordem cronológica não está sendo respeitada

---

### TC-018: 100+ Motoristas Simultâneos

#### Objetivo
Validar que o sistema de locks previne que motoristas recebam múltiplas corridas simultaneamente, mesmo com muitos motoristas.

#### Cenário
1. Criar 100 motoristas
2. Criar 50 corridas
3. Processar todas e iniciar busca
4. **Esperado**: Nenhum motorista recebe múltiplas corridas simultaneamente

#### Comportamento Esperado
- **Locks**: Cada motorista pode ter apenas 1 lock ativo por vez
- **Notificações**: Cada motorista recebe no máximo 1 corrida simultaneamente
- **Distribuição**: Corridas distribuídas entre motoristas disponíveis
- **Estado**: Todas as corridas em `SEARCHING`

#### Critérios de Sucesso
1. ❌ Nenhum motorista recebe múltiplas corridas simultaneamente
2. ✅ Locks funcionam corretamente
3. ✅ Distribuição adequada

#### Possíveis Problemas
- Lock não está sendo adquirido antes de notificar
- Múltiplas notificações sendo enviadas antes do lock ser adquirido
- Race condition entre múltiplas corridas tentando notificar o mesmo motorista

---

### TC-019: Motorista Excluído Não Recebe Corrida Novamente

#### Objetivo
Validar que quando um motorista rejeita uma corrida, ele não recebe a mesma corrida novamente (está na lista de exclusão).

#### Cenário
1. Criar corrida e iniciar busca
2. Motorista recebe notificação
3. Motorista rejeita corrida
4. Motorista é adicionado à lista de exclusão
5. Busca continua (expansão de raio)
6. **Esperado**: Motorista NÃO recebe a mesma corrida novamente

#### Comportamento Esperado
- **Lista de exclusão**: Motorista adicionado a `ride_excluded_drivers:${bookingId}`
- **TTL**: Lista de exclusão expira após 1 hora (3600s)
- **Busca continua**: Expansão de raio continua, mas motorista excluído não recebe notificação
- **Estado**: Corrida permanece `SEARCHING`

#### Critérios de Sucesso
1. ✅ Motorista recebe primeira notificação
2. ✅ Motorista rejeita e é adicionado à lista de exclusão
3. ❌ Motorista NÃO recebe a mesma corrida novamente

#### Possíveis Problemas
- Lista de exclusão não está sendo verificada antes de notificar
- Motorista está sendo removido da lista de exclusão prematuramente
- Busca gradual não está verificando lista de exclusão

---

## 🔍 Padrões Comuns de Problemas

### 1. Estado Sempre SEARCHING
**Problema**: Muitos testes esperam que estado mude para `NOTIFIED`, mas estado sempre permanece `SEARCHING`.

**Solução**: Ajustar testes para verificar que estado permanece `SEARCHING` (não muda).

### 2. sendNextRideToDriver Não Funciona
**Problema**: Após rejeição, próxima corrida não é notificada automaticamente.

**Solução**: Verificar se `sendNextRideToDriver` está sendo chamado e se está encontrando próxima corrida na fila.

### 3. Locks Não Liberados
**Problema**: Locks não são liberados após rejeição ou cancelamento.

**Solução**: Verificar se `releaseLock` está sendo chamado corretamente e se locks estão sendo liberados no `stopSearch`.

### 4. Busca Gradual Não Iniciada
**Problema**: Após rejeição, busca gradual não é iniciada para próxima corrida.

**Solução**: Verificar se `startGradualSearch` está sendo chamado para próxima corrida em `sendNextRideToDriver`.

---

## 📊 Resumo das Correções Necessárias

| Teste | Problema Principal | Correção Necessária |
|-------|-------------------|-------------------|
| TC-003 | Segunda corrida não notificada após rejeição | Verificar `sendNextRideToDriver` |
| TC-006 | Locks não liberados no cancelamento | Corrigir `stopSearch` para liberar locks |
| TC-010 | Terceira corrida não notificada | Verificar ordem cronológica em `sendNextRideToDriver` |
| TC-011 | Segunda corrida não notificada rapidamente | Verificar timing de `sendNextRideToDriver` |
| TC-013 | Estado verificado incorretamente | Ajustar teste para verificar `SEARCHING` (não `NOTIFIED`) |
| TC-016 | Segunda corrida não notificada | Verificar ordem cronológica |
| TC-018 | Múltiplas corridas simultâneas | Verificar locks antes de notificar |
| TC-019 | Motorista recebe corrida novamente | Verificar lista de exclusão antes de notificar |


