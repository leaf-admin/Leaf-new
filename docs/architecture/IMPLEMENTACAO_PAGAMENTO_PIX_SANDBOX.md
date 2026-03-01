# 💳 Implementação do Fluxo de Pagamento PIX com Woovi Sandbox

## ✅ O que foi implementado

### 1. **Fluxo Completo de Pagamento**

#### **Passo a Passo:**
1. ✅ Passageiro insere destino e escolhe tipo de carro (Plus ou Elite)
2. ✅ Passageiro confirma → **Abre modal de pagamento PIX**
3. ✅ Modal exibe:
   - QR Code para escanear
   - Código PIX para copiar e colar
   - Timer de 5 minutos
   - Botão "Verificar Pagamento"
   - Botão "Cancelar"
4. ✅ Timer de 5 minutos com cancelamento automático
5. ✅ Verificação automática de pagamento a cada 3 segundos
6. ✅ Após pagamento confirmado → Cria reserva automaticamente
7. ✅ Sistema busca motoristas após reserva criada

### 2. **Integração com Woovi Sandbox**

- ✅ Usa ambiente de teste da Woovi (sem dinheiro real)
- ✅ Cria cobrança PIX via API sandbox
- ✅ Verifica status do pagamento em tempo real
- ✅ Cancela cobrança automaticamente se expirar
- ✅ Cancela cobrança se usuário cancelar manualmente

### 3. **Funcionalidades do Modal**

#### **Timer de 5 minutos:**
- ✅ Contador regressivo visível
- ✅ Muda cor para vermelho quando resta menos de 1 minuto
- ✅ Cancela automaticamente após 5 minutos
- ✅ Cancela cobrança na Woovi quando expira

#### **Verificação de Pagamento:**
- ✅ Verifica automaticamente a cada 3 segundos
- ✅ Botão manual "Verificar Pagamento"
- ✅ Feedback visual quando está verificando
- ✅ Confirmação visual quando pagamento é confirmado

#### **Cancelamento:**
- ✅ Botão "Cancelar" sempre visível
- ✅ Confirmação antes de cancelar
- ✅ Cancela cobrança na Woovi ao cancelar
- ✅ Limpa dados pendentes ao cancelar

### 4. **Segurança e Validações**

- ✅ Só cria reserva após pagamento confirmado
- ✅ Valida dados antes de abrir modal
- ✅ Previne duplo clique
- ✅ Limpa recursos ao fechar modal
- ✅ Tratamento de erros completo

---

## 📁 Arquivos Modificados

### 1. **`mobile-app/src/components/payment/WooviPaymentModal.js`**

**Principais mudanças:**
- ✅ Integração real com Woovi Sandbox
- ✅ Timer de 5 minutos implementado
- ✅ Verificação automática de pagamento
- ✅ Cancelamento automático e manual
- ✅ Exibição de QR Code e código PIX
- ✅ Feedback visual completo

**Novos recursos:**
- `generatePayment()` - Cria cobrança PIX via Woovi
- `checkPaymentStatus()` - Verifica status do pagamento
- `handleTimeout()` - Cancela após 5 minutos
- `handleCancel()` - Cancela manualmente
- `copyPixCode()` - Copia código PIX para clipboard

### 2. **`mobile-app/src/components/map/PassengerUI.js`**

**Principais mudanças:**
- ✅ Modal abre ANTES de criar reserva
- ✅ Reserva só é criada após pagamento confirmado
- ✅ Dados da reserva ficam pendentes até pagamento
- ✅ Callback `onPaymentConfirmed` cria reserva

**Novos recursos:**
- `initiateBooking()` - Agora abre modal de pagamento
- `onPaymentConfirmed()` - Cria reserva após pagamento
- `createBookingAfterPayment()` - Cria reserva com dados de pagamento
- Estados: `pendingBookingData`, `confirmedPaymentData`

---

## 🔧 Configuração Necessária

### 1. **Instalar Dependências**

```bash
cd mobile-app
npm install @react-native-clipboard/clipboard react-native-qrcode-svg
```

### 2. **Configurar Woovi Sandbox**

O sistema já está configurado para usar sandbox:
- ✅ `mobile-app/config/WooviConfig.js` - Configuração sandbox
- ✅ `leaf-websocket-backend/services/woovi-driver-service.js` - API sandbox

**URLs configuradas:**
- Base URL: `https://api-sandbox.woovi.com/api/v1`
- Environment: `sandbox`

### 3. **Criar Conta Bancária de Teste na Woovi**

Seguir instruções em: https://developers.woovi.com/docs/test-environment/test-account/flow-company-bank-test

**Passos:**
1. Acessar dashboard Woovi
2. Ir em `Ajustes -> Pix -> Configurações avançadas`
3. Clicar em `Criar uma conta bancária de teste`
4. Marcar como conta padrão

---

## 🧪 Como Testar

### 1. **Teste do Fluxo Completo:**

1. Abrir app como passageiro
2. Inserir origem e destino
3. Escolher tipo de carro (Plus ou Elite)
4. Clicar em "Pedir Agora"
5. **Modal de pagamento deve abrir**
6. Verificar:
   - ✅ QR Code aparece
   - ✅ Código PIX aparece
   - ✅ Timer inicia em 5:00
   - ✅ Botões aparecem

### 2. **Teste de Pagamento (Sandbox):**

1. Escanear QR Code ou copiar código PIX
2. Pagar usando conta de teste da Woovi
3. **Pagamento deve ser detectado automaticamente**
4. Modal fecha automaticamente
5. Reserva é criada automaticamente
6. Sistema busca motoristas

### 3. **Teste de Cancelamento:**

1. Abrir modal de pagamento
2. Clicar em "Cancelar"
3. Confirmar cancelamento
4. **Modal deve fechar**
5. **Cobrança deve ser cancelada na Woovi**

### 4. **Teste de Timeout:**

1. Abrir modal de pagamento
2. Aguardar 5 minutos sem pagar
3. **Sistema deve cancelar automaticamente**
4. **Alerta deve aparecer**
5. **Cobrança deve ser cancelada na Woovi**

---

## 📊 Fluxo de Dados

```
Passageiro clica "Pedir Agora"
    ↓
Valida dados (origem, destino, tipo de carro)
    ↓
Abre modal de pagamento
    ↓
Gera cobrança PIX via Woovi Sandbox
    ↓
Exibe QR Code e código PIX
    ↓
Timer de 5 minutos inicia
    ↓
[LOOP] Verifica pagamento a cada 3 segundos
    ↓
Pagamento confirmado?
    ├─ SIM → Cria reserva → Busca motoristas
    └─ NÃO → Continua verificando
    ↓
Timeout (5 minutos)?
    └─ SIM → Cancela cobrança → Fecha modal
```

---

## ⚠️ Pontos de Atenção

### 1. **Biblioteca QRCode**

O código usa `react-native-qrcode-svg`. Se não estiver instalada:
- Instalar: `npm install react-native-qrcode-svg`
- Ou usar imagem do QR Code retornada pela Woovi (já implementado como fallback)

### 2. **Clipboard**

O código usa `@react-native-clipboard/clipboard`. Se não estiver instalada:
- Instalar: `npm install @react-native-clipboard/clipboard`
- Ou usar `Clipboard` do React Native (deprecated)

### 3. **Webhooks Woovi**

Para produção, configurar webhooks da Woovi para notificação instantânea de pagamento:
- Webhook URL: `https://seu-servidor.com/api/woovi/webhooks`
- Eventos: `charge.confirmed`, `charge.expired`

### 4. **Persistência de Dados**

Atualmente os dados de pagamento ficam apenas em memória. Para produção:
- Salvar `payment_holdings` no banco de dados
- Salvar histórico de pagamentos
- Implementar auditoria

---

## 🚀 Próximos Passos

1. ✅ **Testar fluxo completo em sandbox**
2. ⏳ **Configurar webhooks da Woovi**
3. ⏳ **Implementar persistência de dados**
4. ⏳ **Adicionar logs de auditoria**
5. ⏳ **Testar em produção (quando pronto)**

---

## 📝 Notas Técnicas

### **Tempo de Expiração:**
- Timer: 5 minutos (300 segundos)
- Configurável via constante `PAYMENT_TIMEOUT`

### **Frequência de Verificação:**
- Automática: A cada 3 segundos
- Manual: Botão "Verificar Pagamento"

### **Estados do Pagamento:**
- `pending` - Aguardando pagamento
- `confirmed` - Pagamento confirmado
- `expired` - Tempo esgotado
- `cancelled` - Cancelado pelo usuário

---

**Última atualização:** 2025-01-XX
**Status:** ✅ Implementado e pronto para testes em sandbox





