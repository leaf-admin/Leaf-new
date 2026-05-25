# GUIA DO USUÁRIO DE TESTE CUSTOMER/PASSAGEIRO

## 🎯 **RESUMO**
Criamos um sistema completo de usuário de teste para customer/passageiro com todos os bypasses necessários para desenvolvimento.

## 📱 **NÚMEROS DE TELEFONE DE TESTE**

### Driver de Teste:
- **Número:** `11999999999` (ou qualquer número começando com `119999`)
- **Tipo:** Motorista
- **UID:** `test-user-dev-[timestamp]`

### Customer de Teste:
- **Número:** `11888888888` (ou qualquer número começando com `118888`)
- **Tipo:** Passageiro/Customer
- **UID:** `test-customer-dev-[timestamp]`

## 🔓 **BYPASSES IMPLEMENTADOS**

### 1. **Autenticação**
- ✅ Bypass completo do Firebase Auth
- ✅ Criação automática de dados mock
- ✅ População do Redux store
- ✅ Persistência no AsyncStorage

### 2. **Database**
- ✅ Bypass de permissões do Firebase Realtime Database
- ✅ Acesso total de leitura/escrita
- ✅ Evita erros `PERMISSION_DENIED`

### 3. **Pagamentos**
- ✅ Bypass completo de pagamentos
- ✅ Simulação de pagamentos bem-sucedidos
- ✅ Verificação de status simulada
- ✅ Cancelamento simulado

### 4. **KYC**
- ✅ Bypass de verificação de documentos
- ✅ Status de aprovação automático
- ✅ Simulação de câmera

## 🚀 **COMO USAR**

### Método 1: Ativação Automática
```javascript
import TestUserService from './src/services/TestUserService';

// Ativar customer de teste
const customerData = await TestUserService.createTestCustomer('11888888888');

// Ativar driver de teste
const driverData = await TestUserService.createTestUser({
    phoneNumber: '+5511999999999',
    usertype: 'driver'
});
```

### Método 2: Login Manual
1. Abra o app
2. Digite o número `11888888888` (customer) ou `11999999999` (driver)
3. O bypass será ativado automaticamente
4. Todos os fluxos funcionarão sem erros

### Método 3: Componente UI
```javascript
import TestUserManager from './src/components/TestUserManager';

<TestUserManager visible={showManager} onClose={() => setShowManager(false)} />
```

## 📊 **DADOS DO CUSTOMER DE TESTE**

```javascript
{
    uid: 'test-customer-dev-[timestamp]',
    phone: '+5511888888888',
    usertype: 'passenger',
    name: 'Customer de Teste',
    firstName: 'Customer',
    lastName: 'de Teste',
    email: 'customer@leafapp.com',
    isTestUser: true,
    isTestCustomer: true,
    approved: true,
    walletBalance: 500,
    rating: 4.9,
    customerData: {
        preferredPaymentMethod: 'credit_card',
        hasValidPayment: true,
        totalRides: 0,
        totalSpent: 0,
        favoriteLocations: [],
        emergencyContact: {
            name: 'Contato de Emergência',
            phone: '+5511999999998'
        }
    },
    permissions: {
        canAccessDatabase: true,
        canReadAll: true,
        canWriteAll: true,
        bypassSecurity: true,
        bypassPayment: true,
        bypassKYC: true
    }
}
```

## 🔧 **SERVIÇOS CRIADOS**

### 1. **TestUserService**
- Gerenciamento completo de usuários de teste
- Suporte para driver e customer
- Métodos de criação, limpeza e debug

### 2. **PaymentBypassService**
- Bypass completo de pagamentos
- Simulação de pagamentos bem-sucedidos
- Verificação de status simulada

### 3. **TestUserManager**
- Interface visual para gerenciar usuários de teste
- Ativação rápida de driver/customer
- Informações de debug

## 🧪 **FLUXOS TESTADOS**

### Customer/Passageiro:
1. ✅ **Login** - Bypass de autenticação
2. ✅ **Registro** - Criação automática de dados
3. ✅ **Solicitação de Corrida** - WebSocket funcionando
4. ✅ **Pagamento** - Simulação completa
5. ✅ **Avaliação** - Sistema funcionando
6. ✅ **Cancelamento** - Processo completo

### Driver:
1. ✅ **Login** - Bypass de autenticação
2. ✅ **Aprovação** - Status automático
3. ✅ **Ficar Online** - WebSocket funcionando
4. ✅ **Receber Corridas** - Sistema funcionando
5. ✅ **Aceitar/Recusar** - Processo completo
6. ✅ **Finalizar Viagem** - Sistema funcionando

## 🎮 **SCRIPTS DE ATIVAÇÃO RÁPIDA**

### Ativar Customer:
```bash
cd mobile-app
node activate-test-customer.js
```

### Ativar Driver:
```bash
cd mobile-app
node activate-test-user-now.js
```

## 🔍 **DEBUG E MONITORAMENTO**

### Logs de Debug:
```javascript
// Logar informações completas
await TestUserService.logDebugInfo();
await PaymentBypassService.logDebugInfo();
```

### Verificar Status:
```javascript
// Verificar se é customer de teste
const isCustomer = await TestUserService.isTestCustomer();

// Verificar se tem bypass de pagamento
const hasBypass = await PaymentBypassService.hasPaymentBypass();
```

## ⚠️ **IMPORTANTE**

- **Apenas em desenvolvimento** (`__DEV__ = true`)
- **Não funciona em produção**
- **Todos os dados são simulados**
- **Pagamentos não são reais**
- **Use apenas para testes**

## 🎉 **RESULTADO FINAL**

Agora você tem:
- ✅ **Customer de teste completo** com todos os bypasses
- ✅ **Driver de teste completo** com todos os bypasses
- ✅ **Sistema de pagamentos simulado**
- ✅ **Interface de gerenciamento**
- ✅ **Scripts de ativação rápida**
- ✅ **Debug completo**

**Pronto para testar todo o fluxo de corridas!** 🚀


