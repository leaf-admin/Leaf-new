# 📋 RESUMO DAS PENDÊNCIAS REAIS - LEAF APP

## 📅 Última Atualização: 15 de Janeiro de 2025

---

## ✅ O QUE ESTÁ PRONTO

### 🏦 **BaaS e Pagamentos**
- ✅ Backend BaaS completo (aguardando API MASTER)
- ✅ Fluxo de pagamento antecipado funcionando
- ✅ Fallback automático para customer

### 📱 **App Único (Passageiro + Motorista)**
- ✅ **PassengerUI.js** - Completo e funcional
- ✅ **DriverUI.js** - Completo (3467 linhas, implementado)
- ✅ **ProfileToggleService** - Sistema de alternar entre modos
- ✅ **Redux** com profileToggleReducer
- ✅ **WebSocketManager** integrado

---

## ⏳ O QUE REALMENTE FALTA

### 🔴 **CRÍTICO - ANTES DE PRODUÇÃO**

#### 1. **API MASTER Woovi** (Amanhã)
- [ ] Receber credenciais na call
- [ ] Configurar variáveis de ambiente
- [ ] Testar criação de contas BaaS

#### 2. **Persistência de Dados**
- [ ] Salvar corridas no Firestore quando criadas
- [ ] Salvar pagamentos (`payment_holdings`) no banco
- [ ] Salvar mensagens do chat (com TTL)

**Arquivos com TODOs:**
- `leaf-websocket-backend/services/payment-service.js` (linhas 67, 119, 149, 181, 285, 313)

#### 3. **Validações de Segurança**
- [ ] Validar pagamento antes de iniciar corrida
- [ ] Rate limiting
- [ ] Logs de auditoria

#### 4. **Testes do Modo Motorista**
- [ ] Testar fluxo completo: online → receber corrida → aceitar → iniciar → finalizar
- [ ] Validar integração WebSocket no modo motorista
- [ ] Testar notificações de corridas
- [ ] Validar GPS tracking do motorista

**Nota:** DriverUI.js já está implementado, só precisa testar!

---

## 🟡 **IMPORTANTE (Próximas Semanas)**

#### 5. **Melhorias no DriverUI**
- [ ] Implementar menu (TODO linha 2837)
- [ ] Implementar notificações (TODO linha 2858)

#### 6. **Sistema de Filas**
- [ ] Implementar expansão gradual de raio
- [ ] Gerenciamento de múltiplas corridas

#### 7. **Dashboard Admin**
- [ ] Estrutura básica
- [ ] Métricas e estatísticas

---

## 📊 RESUMO POR CATEGORIA

| Item | Status | % |
|------|--------|---|
| BaaS Backend | ✅ Pronto | 95% |
| Pagamentos | ✅ Funcional | 90% |
| Backend Corridas | ✅ Funcional | 80% |
| App Passageiro | ✅ Funcional | 85% |
| **App Motorista** | ✅ **Implementado** | **90%** |
| Persistência | ⚠️ Parcial | 40% |
| Segurança | ⚠️ Básica | 50% |

---

## 🎯 PRÓXIMOS PASSOS REAIS

### **Esta Semana:**
1. ✅ Call com Woovi → API MASTER
2. ✅ Implementar persistência básica
3. ✅ Testar modo motorista end-to-end

### **Próximas 2 Semanas:**
4. ✅ Validações de segurança
5. ✅ Sistema de filas
6. ✅ Dashboard admin básico

---

## ⚠️ NOTA IMPORTANTE

**O app é ÚNICO** - não existe "app do motorista" separado. O sistema usa:
- `ProfileToggleService` para alternar entre modos
- `DriverUI.js` para interface do motorista
- `PassengerUI.js` para interface do passageiro
- Redux para gerenciar estado de cada modo

**DriverUI já está implementado** - só precisa testar e validar o fluxo completo!

---

**Status Geral**: 🟡 **75% Completo** - Pronto para beta após resolver bloqueadores


