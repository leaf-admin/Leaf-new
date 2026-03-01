# Análise dos Testes Falhados

## Objetivo
Verificar se os testes estão corretos quanto ao cenário proposto antes de corrigir a lógica de negócio.

---

## TC-003: Múltiplas Corridas Simultâneas

### Cenário do Teste
- Criar 10 motoristas
- Criar 10 corridas
- Processar todas em batch (10 corridas)
- Espera: 10 corridas processadas

### Problema
- **Erro**: Esperado 10 corridas processadas, recebido: 0
- **Análise**: O teste chama `processNextRides(regionHash, 10)` mas retorna array vazio

### Verificação da Lógica de Negócio
- `processNextRides` busca corridas na fila `pending` usando `getPendingRides`
- Verifica se estado é `PENDING` ou `SEARCHING`
- Move para fila `active` e atualiza estado para `SEARCHING`

### Avaliação do Teste
✅ **Cenário correto**: O teste está correto ao esperar que todas as 10 corridas sejam processadas
❌ **Problema**: Pode ser que as corridas não estejam na fila `pending` ou o estado não esteja correto

### Possíveis Causas
1. As corridas podem não ter sido adicionadas à fila corretamente
2. O `regionHash` pode estar diferente entre `enqueueRide` e `processNextRides`
3. Pode haver um delay necessário entre criar e processar

---

## TC-004: Expansão para 5km

### Cenário do Teste
- Criar 1 motorista longe (fora do raio inicial)
- Criar 1 corrida
- Processar e iniciar busca gradual
- Espera: Raio expandir até >= 3km (máximo 5km)

### Problema
- **Erro**: Raio final esperado >= 3.0km, recebido: 1km
- **Análise**: A expansão parou em 1km ao invés de continuar até 3-5km

### Verificação da Lógica de Negócio
- `GradualRadiusExpander` inicia com 0.5km
- Expande em steps de 0.5km a cada 5 segundos
- Máximo configurado: 5km
- Deve continuar expandindo até encontrar motoristas ou atingir máximo

### Avaliação do Teste
✅ **Cenário correto**: O teste está correto ao esperar expansão até 3-5km
❌ **Problema**: A expansão está parando antes do esperado

### Possíveis Causas
1. A expansão pode estar parando quando encontra algum motorista (mesmo que não notifique)
2. O intervalo de expansão pode estar muito longo
3. A busca pode estar sendo pausada por algum motivo (estado NOTIFIED?)

---

## TC-005: Timeout de Motorista

### Cenário do Teste
- Criar 1 motorista
- Criar 1 corrida
- Processar e notificar motorista
- Motorista não responde
- Aguardar 21s (timeout de 20s)
- Espera: Estado voltar para SEARCHING

### Problema
- **Erro**: Estado esperado: SEARCHING após timeout, encontrado: NOTIFIED
- **Análise**: O timeout não está mudando o estado de volta para SEARCHING

### Verificação da Lógica de Negócio
- `DriverNotificationDispatcher.scheduleDriverTimeout` agenda timeout de 20s
- Quando timeout ocorre, deve:
  1. Liberar lock do motorista
  2. Atualizar estado de `NOTIFIED` para `SEARCHING`
  3. Continuar busca gradual

### Avaliação do Teste
✅ **Cenário correto**: O teste está correto ao esperar que o estado volte para SEARCHING após timeout
❌ **Problema**: O timeout não está atualizando o estado corretamente

### Possíveis Causas
1. O timeout pode não estar sendo executado
2. A verificação de estado antes de atualizar pode estar falhando
3. Pode haver condição de corrida entre timeout e atualização de estado

---

## TC-006: Cancelamento Durante Busca

### Cenário do Teste
- Criar 3 motoristas
- Criar 1 corrida
- Processar e notificar os 3 motoristas (todos recebem lock)
- Cancelar corrida
- Espera: Todos os locks liberados

### Problema
- **Erro**: 3 motorista(s) ainda com lock após cancelamento
- **Análise**: Os locks não estão sendo liberados quando a corrida é cancelada

### Verificação da Lógica de Negócio
- Quando corrida é cancelada, deve:
  1. Parar busca gradual
  2. Remover da fila
  3. **Liberar todos os locks dos motoristas notificados**
  4. Cancelar todos os timeouts

### Avaliação do Teste
✅ **Cenário correto**: O teste está correto ao esperar que todos os locks sejam liberados
❌ **Problema**: A lógica de cancelamento não está liberando os locks

### Possíveis Causas
1. Não há lógica para liberar locks ao cancelar
2. A busca por motoristas notificados pode estar falhando
3. Os locks podem ter TTL e não estão sendo liberados explicitamente

---

## TC-010: Múltiplas Rejeições Consecutivas

### Cenário do Teste
- Criar 1 motorista
- Criar 3 corridas
- Processar primeira e notificar
- Motorista rejeita primeira
- Espera: Segunda corrida ser notificada
- Motorista rejeita segunda
- Espera: Terceira corrida ser notificada

### Problema
- **Erro**: "undefined" is not valid JSON
- **Análise**: Erro ao fazer JSON.parse de `bookingData.pickupLocation` que está undefined

### Verificação da Lógica de Negócio
- `handleRejectRide` deve chamar `sendNextRideToDriver`
- `sendNextRideToDriver` busca próxima corrida e notifica
- Deve buscar dados do booking antes de notificar

### Avaliação do Teste
✅ **Cenário correto**: O teste está correto ao esperar múltiplas rejeições consecutivas
❌ **Problema**: Falta validação de dados antes de fazer JSON.parse

### Possíveis Causas
1. Os dados do booking podem não estar salvos corretamente
2. Pode haver race condition entre rejeição e busca de próxima corrida
3. A validação adicionada pode não estar em todos os lugares necessários

---

## TC-011: Timing Entre Rejeição e Nova Corrida

### Cenário do Teste
- Criar 1 motorista
- Criar 2 corridas
- Processar primeira e notificar
- Motorista rejeita primeira
- Espera: Segunda corrida ser notificada rapidamente

### Problema
- **Erro**: Primeira corrida não foi notificada
- **Análise**: A primeira corrida não está sendo notificada antes da rejeição

### Verificação da Lógica de Negócio
- Após processar corrida, deve iniciar busca gradual
- Busca gradual deve notificar motoristas
- Após rejeição, deve buscar próxima corrida

### Avaliação do Teste
✅ **Cenário correto**: O teste está correto ao esperar timing entre rejeição e nova corrida
❌ **Problema**: A primeira corrida não está sendo notificada (pode ser problema de timing)

### Possíveis Causas
1. O teste pode estar rejeitando antes da notificação chegar
2. A busca gradual pode não estar iniciando corretamente
3. Pode haver delay entre processar e notificar

---

## TC-013: Motorista Fica Offline Durante Notificação

### Cenário do Teste
- Criar 1 motorista
- Criar 1 corrida
- Processar e iniciar busca
- Motorista fica offline (desconecta)
- Espera: Sistema detectar e continuar busca

### Problema
- **Erro**: Motorista não recebeu notificação
- **Análise**: O teste pode estar verificando notificação antes de motorista ficar offline

### Verificação da Lógica de Negócio
- Sistema deve detectar quando motorista desconecta
- Deve liberar lock se motorista estava com lock
- Deve continuar busca para outros motoristas

### Avaliação do Teste
⚠️ **Cenário pode estar incorreto**: O teste verifica notificação antes de motorista ficar offline
- Deveria: Notificar → Motorista recebe → Motorista fica offline → Sistema detecta → Continua busca

### Possíveis Causas
1. O teste pode estar desconectando motorista antes de notificar
2. A detecção de desconexão pode não estar funcionando
3. O sistema pode não estar liberando lock ao detectar desconexão

---

## TC-014: Motorista Volta Online Após Timeout

### Cenário do Teste
- Criar 1 motorista
- Criar 1 corrida
- Processar e notificar
- Timeout ocorre (motorista não responde)
- Motorista volta online
- Espera: Estado voltar para SEARCHING e busca continuar

### Problema
- **Erro**: Estado esperado: SEARCHING, recebido: NOTIFIED
- **Análise**: Similar ao TC-005, o timeout não está mudando o estado

### Verificação da Lógica de Negócio
- Mesma lógica do TC-005
- Quando motorista volta online, não deve receber a mesma corrida (já foi notificado)

### Avaliação do Teste
✅ **Cenário correto**: O teste está correto
❌ **Problema**: Mesmo problema do TC-005 (timeout não atualiza estado)

---

## TC-016: Motorista Rejeita e Recebe Corrida Mais Antiga

### Cenário do Teste
- Criar 1 motorista
- Criar 3 corridas com timestamps diferentes
- Processar todas
- Motorista rejeita primeira
- Espera: Receber segunda corrida (mais antiga disponível)

### Problema
- **Erro**: Não especificado no resumo
- **Análise**: Pode ser problema de ordem cronológica

### Verificação da Lógica de Negócio
- `sendNextRideToDriver` deve buscar próxima corrida na fila
- Deve respeitar ordem cronológica (mais antiga primeiro)
- Deve verificar se motorista já foi notificado

### Avaliação do Teste
✅ **Cenário correto**: O teste está correto ao esperar ordem cronológica
❌ **Problema**: Pode ser que a busca não esteja respeitando ordem cronológica

---

## TC-017: Stress Test - 500+ Corridas

### Cenário do Teste
- Criar 50 motoristas
- Criar 500 corridas
- Processar todas
- Espera: Sistema processar todas sem erros

### Problema
- **Erro**: Não especificado no resumo
- **Análise**: Pode ser problema de performance ou processamento em batch

### Verificação da Lógica de Negócio
- Sistema deve processar grandes volumes
- Deve usar processamento em batch eficiente
- Não deve travar ou perder corridas

### Avaliação do Teste
✅ **Cenário correto**: O teste está correto para validar performance
❌ **Problema**: Pode ser que o processamento em batch não esteja funcionando para 500 corridas

---

## Resumo das Avaliações

### Testes com Cenários Corretos (mas problemas na lógica)
- ✅ TC-003: Múltiplas Corridas Simultâneas
- ✅ TC-004: Expansão para 5km
- ✅ TC-005: Timeout de Motorista
- ✅ TC-006: Cancelamento Durante Busca
- ✅ TC-010: Múltiplas Rejeições Consecutivas (com validação faltando)
- ✅ TC-011: Timing Entre Rejeição e Nova Corrida
- ✅ TC-014: Motorista Volta Online Após Timeout
- ✅ TC-016: Motorista Rejeita e Recebe Corrida Mais Antiga
- ✅ TC-017: Stress Test

### Testes com Cenários que Precisam Revisão
- ⚠️ TC-013: Motorista Fica Offline Durante Notificação (timing pode estar errado)

---

## Próximos Passos

1. **Corrigir validações** (TC-010): Adicionar validações robustas antes de JSON.parse
2. **Corrigir processamento em batch** (TC-003): Verificar por que `processNextRides` retorna vazio
3. **Corrigir expansão de raio** (TC-004): Verificar por que para em 1km
4. **Corrigir timeout** (TC-005, TC-014): Verificar por que não atualiza estado
5. **Corrigir cancelamento** (TC-006): Adicionar lógica para liberar locks ao cancelar
6. **Revisar timing** (TC-011, TC-013): Ajustar esperas e verificações


