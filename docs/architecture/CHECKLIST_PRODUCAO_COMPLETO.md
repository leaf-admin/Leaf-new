# 🚀 Checklist Completo para Produção - Leaf App

## 📋 Resumo Executivo

Este documento lista **TODAS** as funcionalidades, validações e ajustes necessários antes de colocar o sistema em produção real. Baseado em análise profunda do código e regras de negócio definidas.

---

## 🔴 CRÍTICO - BLOQUEADORES DE PRODUÇÃO

### 1. 💳 **SISTEMA DE PAGAMENTO WOOVI EM PRODUÇÃO**

#### Status Atual:
- ✅ Código de integração existe (`payment-service.js`)
- ❌ **NÃO está em produção real** - há TODOs e simulações
- ❌ **NÃO valida pagamento antes de iniciar corrida**

#### O que falta:

**1.1. Integração Real com Woovi:**
- [ ] Remover todas as simulações de pagamento
- [ ] Configurar credenciais reais da Woovi (não usar mocks)
- [ ] Implementar webhooks da Woovi para confirmação de pagamento
- [ ] Testar fluxo completo com PIX real

**1.2. Validação de Pagamento Antes de Iniciar Corrida:**
- [ ] **CRÍTICO**: Adicionar validação no evento `startTrip` do backend
- [ ] Verificar se pagamento está confirmado (`status: 'in_holding'`)
- [ ] Bloquear início de corrida se pagamento não estiver confirmado
- [ ] Retornar erro claro para motorista se tentar iniciar sem pagamento

**Arquivos a modificar:**
- `leaf-websocket-backend/server.js` - Evento `startTrip` (linha ~1192)
- `leaf-websocket-backend/services/payment-service.js` - Remover TODOs (linhas 67, 119, 149, 181, 285, 313)
- `mobile-app/src/components/map/DriverUI.js` - Adicionar validação antes de `startRide()` (linha ~2292)

**Código necessário:**
```javascript
// No evento startTrip do backend
socket.on('startTrip', async (data) => {
    const { bookingId } = data;
    
    // ✅ VALIDAÇÃO CRÍTICA: Verificar pagamento
    const paymentStatus = await paymentService.getPaymentStatus(bookingId);
    if (paymentStatus.status !== 'in_holding') {
        socket.emit('tripStartError', {
            error: 'Pagamento não confirmado',
            message: 'A corrida só pode ser iniciada após confirmação do pagamento'
        });
        return;
    }
    
    // ... resto do código
});
```

**1.3. Persistência de Dados de Pagamento:**
- [ ] Implementar salvamento no banco de dados (PostgreSQL/Firebase)
- [ ] Criar tabela/coleção `payment_holdings` com campos:
  - `rideId`, `chargeId`, `passengerId`, `amount`, `status`, `createdAt`, `confirmedAt`
- [ ] Implementar queries para buscar status de pagamento
- [ ] Adicionar logs de auditoria de pagamentos

---

### 2. 💬 **SISTEMA DE CHAT - VALIDAÇÃO E TESTES**

#### Status Atual:
- ✅ Chat existe e verifica status (`accepted` ou `started`)
- ⚠️ **NÃO testado completamente** se desabilita corretamente ao finalizar

#### O que falta:

**2.1. Validação de Habilitar Chat:**
- [ ] Testar se chat só aparece quando corrida está em `accepted` ou `started`
- [ ] Verificar se chat é desabilitado quando corrida é cancelada
- [ ] Verificar se chat é desabilitado quando corrida é finalizada (`completed`)

**2.2. Desabilitar Chat ao Finalizar Corrida:**
- [ ] Adicionar lógica no evento `completeTrip` para desabilitar chat
- [ ] Parar listeners de mensagens quando corrida termina
- [ ] Limpar estado do chat no Redux quando corrida finaliza

**Arquivos a verificar/modificar:**
- `mobile-app/src/components/map/PassengerUI.js` (linha ~2248-2319)
- `mobile-app/src/components/map/DriverUI.js` - Verificar se tem chat implementado
- `leaf-websocket-backend/server.js` - Evento `completeTrip`

**Código necessário:**
```javascript
// No PassengerUI.js - quando corrida finaliza
useEffect(() => {
    if (tripStatus === 'completed') {
        // Desabilitar chat
        dispatch(stopFetchMessages(currentBooking?.bookingId));
        setChatMessages([]);
    }
}, [tripStatus]);
```

**2.3. Testes de Chat:**
- [ ] Teste: Chat não aparece antes de corrida ser aceita
- [ ] Teste: Chat funciona durante corrida (`accepted` e `started`)
- [ ] Teste: Chat é desabilitado ao cancelar corrida
- [ ] Teste: Chat é desabilitado ao finalizar corrida
- [ ] Teste: Mensagens não são enviadas após corrida finalizada

---

## 🟡 ALTA PRIORIDADE - FUNCIONALIDADES CRÍTICAS

### 3. 📊 **PERSISTÊNCIA DE DADOS COMPLETA**

#### Status Atual:
- ⚠️ Dados ficam apenas no Redis (volátil)
- ❌ **TODOs no código** indicam que persistência não está implementada
- ⚠️ Firebase usado parcialmente, mas não de forma consistente

#### O que falta:

**3.1. Persistência de Corridas:**
- [ ] Criar tabela/coleção `rides` no banco de dados
- [ ] Salvar corrida completa quando criada
- [ ] Atualizar status da corrida em cada mudança de estado
- [ ] Salvar dados finais quando corrida é finalizada
- [ ] Implementar backup automático

**3.2. Persistência de Pagamentos:**
- [ ] Salvar todos os dados de `payment_holdings`
- [ ] Salvar histórico de reembolsos
- [ ] Salvar histórico de distribuições para motoristas
- [ ] Implementar auditoria completa

**3.3. Persistência de Chat:**
- [ ] Salvar mensagens do chat no banco de dados
- [ ] Implementar histórico de conversas
- [ ] Adicionar TTL para mensagens antigas (ex: 90 dias)

**Arquivos com TODOs:**
- `leaf-websocket-backend/services/payment-service.js` (linhas 67, 119, 149, 181, 285, 313)
- `leaf-websocket-backend/services/ride-service.js` - Verificar se salva no banco

---

### 4. 🔒 **SEGURANÇA E VALIDAÇÕES**

#### Status Atual:
- ✅ Autenticação básica implementada
- ⚠️ Validações de dados incompletas
- ❌ Logs de segurança não implementados

#### O que falta:

**4.1. Validações de Entrada:**
- [ ] Validar todos os dados de entrada nos endpoints
- [ ] Sanitizar inputs para prevenir SQL injection
- [ ] Validar formato de IDs (bookingId, driverId, etc.)
- [ ] Validar coordenadas geográficas (lat/lng dentro de limites válidos)
- [ ] Validar valores monetários (não negativos, formato correto)

**4.2. Validações de Negócio:**
- [ ] Motorista só pode aceitar corrida se estiver online e disponível
- [ ] Passageiro só pode cancelar se corrida não foi iniciada
- [ ] Motorista só pode iniciar corrida se pagamento estiver confirmado
- [ ] Validar que motorista está próximo do pickup antes de marcar "chegou"
- [ ] Validar que corrida foi iniciada antes de finalizar

**4.3. Logs de Segurança:**
- [ ] Logar todas as tentativas de acesso não autorizado
- [ ] Logar mudanças de status críticas (pagamento, início/fim de corrida)
- [ ] Implementar alertas para atividades suspeitas
- [ ] Logar cancelamentos e reembolsos

---

### 5. ⭐ **SISTEMA DE AVALIAÇÕES**

#### Status Atual:
- ✅ Interface de avaliação existe
- ⚠️ Persistência pode não estar completa
- ⚠️ Cálculo de rating médio pode não estar funcionando

#### O que falta:

**5.1. Persistência de Avaliações:**
- [ ] Salvar avaliações no banco de dados
- [ ] Calcular e atualizar rating médio do motorista
- [ ] Calcular e atualizar rating médio do passageiro
- [ ] Implementar histórico de avaliações

**5.2. Validações de Avaliação:**
- [ ] Passageiro só pode avaliar após corrida finalizada
- [ ] Motorista só pode avaliar após corrida finalizada
- [ ] Não permitir múltiplas avaliações da mesma corrida
- [ ] Validar que rating está entre 1-5 estrelas

**5.3. Exibição de Ratings:**
- [ ] Mostrar rating médio do motorista antes de aceitar corrida
- [ ] Mostrar rating médio do passageiro para motorista
- [ ] Exibir histórico de avaliações no perfil

---

### 6. 🔄 **REEMBOLSOS E CANCELAMENTOS**

#### Status Atual:
- ✅ Código de reembolso existe
- ⚠️ **NÃO testado com Woovi real**
- ⚠️ Lógica de taxa de cancelamento pode não estar completa

#### O que falta:

**6.1. Reembolsos Automáticos:**
- [ ] Testar reembolso quando não encontra motorista
- [ ] Testar reembolso quando passageiro cancela
- [ ] Testar reembolso quando motorista cancela
- [ ] Implementar cálculo correto de taxa de cancelamento
- [ ] Validar que reembolso foi processado com sucesso

**6.2. Política de Cancelamento:**
- [ ] Definir taxas de cancelamento por fase:
  - Antes de motorista aceitar: 100% reembolso
  - Após motorista aceitar: 95% reembolso
  - Após motorista chegar: 90% reembolso
  - Após iniciar corrida: 50% reembolso
- [ ] Implementar lógica de cálculo de taxa
- [ ] Exibir política de cancelamento para usuário

**6.3. Notificações de Reembolso:**
- [ ] Notificar passageiro quando reembolso é processado
- [ ] Informar tempo estimado de reembolso (2-5 dias úteis)
- [ ] Permitir rastreamento de status do reembolso

---

## 🟢 MÉDIA PRIORIDADE - MELHORIAS IMPORTANTES

### 7. 📱 **NOTIFICAÇÕES PUSH**

#### Status Atual:
- ✅ Sistema FCM implementado
- ⚠️ Pode não estar 100% testado
- ⚠️ Notificações interativas podem ter bugs

#### O que falta:

**7.1. Testes de Notificações:**
- [ ] Testar notificações em Android
- [ ] Testar notificações em iOS
- [ ] Testar notificações em background
- [ ] Testar notificações interativas (botões de ação)
- [ ] Verificar se notificações chegam em tempo real

**7.2. Melhorias:**
- [ ] Adicionar deep linking nas notificações
- [ ] Implementar notificações de lembrete (ex: "Motorista chegando")
- [ ] Adicionar som e vibração personalizados
- [ ] Implementar agrupamento de notificações

---

### 8. 🗺️ **TRACKING E NAVEGAÇÃO**

#### Status Atual:
- ✅ Tracking básico implementado
- ⚠️ Pode não estar otimizado
- ⚠️ Integração com Waze/Google Maps pode ter bugs

#### O que falta:

**8.1. Otimizações:**
- [ ] Otimizar frequência de atualização de localização
- [ ] Implementar throttling inteligente
- [ ] Reduzir consumo de bateria
- [ ] Otimizar uso de dados móveis

**8.2. Funcionalidades:**
- [ ] Melhorar precisão de ETA (tempo estimado de chegada)
- [ ] Adicionar alerta quando motorista está próximo
- [ ] Implementar rota alternativa se necessário
- [ ] Adicionar modo offline para navegação

---

### 9. 💰 **DISTRIBUIÇÃO DE GANHOS**

#### Status Atual:
- ✅ Cálculo de valor líquido existe
- ⚠️ **NÃO testado com Woovi real**
- ⚠️ Distribuição automática pode não estar funcionando

#### O que falta:

**9.1. Distribuição Automática:**
- [ ] Testar criação de ganhos para motorista via Woovi
- [ ] Validar cálculo de taxas (operacional + Woovi)
- [ ] Implementar distribuição automática ao finalizar corrida
- [ ] Adicionar notificação quando ganhos são creditados

**9.2. Dashboard de Ganhos:**
- [ ] Criar tela de ganhos para motorista
- [ ] Mostrar histórico de ganhos
- [ ] Mostrar detalhamento de taxas
- [ ] Permitir saque de ganhos

---

## 🔵 BAIXA PRIORIDADE - MELHORIAS FUTURAS

### 10. 📊 **ANALYTICS E MÉTRICAS**

- [ ] Implementar Google Analytics / Firebase Analytics
- [ ] Adicionar métricas de negócio (corridas/dia, receita, etc.)
- [ ] Criar dashboard administrativo
- [ ] Implementar relatórios automáticos

### 11. 🌍 **INTERNACIONALIZAÇÃO**

- [ ] Implementar sistema de tradução completo
- [ ] Adicionar suporte a múltiplos idiomas
- [ ] Validar textos em todos os idiomas

### 12. 🎨 **UX/UI MELHORIAS**

- [ ] Revisar todos os fluxos de usuário
- [ ] Adicionar animações e transições
- [ ] Melhorar feedback visual
- [ ] Adicionar loading states apropriados

---

## 🧪 TESTES OBRIGATÓRIOS ANTES DE PRODUÇÃO

### Testes de Fluxo Completo:

1. **Fluxo de Corrida Completo:**
   - [ ] Passageiro solicita corrida
   - [ ] Pagamento é processado e confirmado
   - [ ] Motorista recebe notificação
   - [ ] Motorista aceita corrida
   - [ ] Chat é habilitado
   - [ ] Motorista chega ao pickup
   - [ ] Motorista inicia corrida (após pagamento confirmado)
   - [ ] Corrida é finalizada
   - [ ] Chat é desabilitado
   - [ ] Avaliações são enviadas
   - [ ] Ganhos são distribuídos para motorista

2. **Fluxo de Cancelamento:**
   - [ ] Passageiro cancela antes de motorista aceitar
   - [ ] Reembolso de 100% é processado
   - [ ] Passageiro cancela após motorista aceitar
   - [ ] Reembolso de 95% é processado
   - [ ] Motorista cancela
   - [ ] Reembolso apropriado é processado

3. **Fluxo de Pagamento:**
   - [ ] Pagamento PIX é criado
   - [ ] QR Code é exibido
   - [ ] Pagamento é confirmado via webhook
   - [ ] Valor fica em holding
   - [ ] Corrida só inicia após confirmação
   - [ ] Ganhos são distribuídos após finalizar

---

## 📝 CHECKLIST FINAL ANTES DE PRODUÇÃO

### Configuração:
- [ ] Todas as variáveis de ambiente configuradas
- [ ] Credenciais da Woovi em produção
- [ ] Chaves do Firebase configuradas
- [ ] Redis configurado e testado
- [ ] Banco de dados (PostgreSQL/Firebase) configurado

### Segurança:
- [ ] HTTPS configurado
- [ ] Validações de entrada implementadas
- [ ] Logs de segurança ativos
- [ ] Backup automático configurado

### Monitoramento:
- [ ] Logs centralizados configurados
- [ ] Alertas configurados
- [ ] Dashboard de monitoramento ativo
- [ ] Métricas de performance coletadas

### Documentação:
- [ ] Documentação de API atualizada
- [ ] Manual de operação criado
- [ ] Runbook de incidentes criado
- [ ] Documentação de deploy atualizada

---

## 🎯 PRIORIZAÇÃO RECOMENDADA

### Fase 1 (BLOQUEADORES - 1-2 semanas):
1. ✅ Woovi em produção real
2. ✅ Validação de pagamento antes de iniciar corrida
3. ✅ Testes e validação do chat
4. ✅ Persistência de dados básica

### Fase 2 (CRÍTICO - 1 semana):
5. ✅ Segurança e validações
6. ✅ Sistema de avaliações completo
7. ✅ Reembolsos testados

### Fase 3 (IMPORTANTE - 1 semana):
8. ✅ Notificações testadas
9. ✅ Distribuição de ganhos testada
10. ✅ Testes de fluxo completo

### Fase 4 (MELHORIAS - contínuo):
11. Analytics
12. Internacionalização
13. UX/UI melhorias

---

## 📞 PRÓXIMOS PASSOS IMEDIATOS

1. **HOJE:**
   - Revisar este checklist
   - Priorizar itens críticos
   - Criar issues/tasks no sistema de gerenciamento

2. **ESTA SEMANA:**
   - Implementar validação de pagamento antes de iniciar corrida
   - Testar chat completamente
   - Configurar Woovi em produção

3. **PRÓXIMA SEMANA:**
   - Implementar persistência de dados
   - Adicionar validações de segurança
   - Testar fluxo completo

---

**Última atualização:** 2025-01-XX
**Versão:** 1.0
**Status:** 🟡 Em Análise





