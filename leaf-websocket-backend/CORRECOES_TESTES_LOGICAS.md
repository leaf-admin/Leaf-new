# Correções de Lógicas dos Testes

## Problemas Identificados

1. **TC-004 (Expansão para 5km)**: Expansão só acontece após 60 segundos E quando raio já chegou a 3km
2. **TC-003 (Rejeição e Próxima Corrida)**: Motorista só recebe próxima corrida se:
   - Houver outra corrida disponível (SEARCHING ou PENDING)
   - Motorista estiver dentro do raio de busca
   - Busca gradual já tiver iniciado ou iniciar automaticamente
3. **TC-006 (Cancelamento)**: Quando passageiro cancela, locks devem ser liberados (já corrigido no stopSearch)
4. **TC-005 (Timeout)**: Timeout é de 20 segundos, não 21

## Correções Necessárias

### TC-004: Aguardar 60 segundos naturalmente
- Não forçar expansão simulando tempo
- Aguardar que o sistema expanda naturalmente após 60s
- Verificar que raio chegou a 3km antes de expandir para 5km

### TC-003: Verificar condições para próxima corrida
- Segunda corrida deve estar em SEARCHING ou PENDING
- Motorista deve estar dentro do raio de busca
- Busca gradual deve estar ativa ou iniciar automaticamente

### TC-005: Ajustar timeout para 20 segundos
- Aguardar exatamente 20 segundos (não 21)
- Verificar que estado volta para SEARCHING

### TC-006: Verificar cancelamento pelo passageiro
- Quando passageiro cancela corrida aceita mas não iniciada, motorista deve ser liberado
- Locks devem ser liberados imediatamente


