# 🚀 USUÁRIO DE TESTE DRIVER COM BYPASS

## 📱 **NÚMERO DE TESTE**
```
11999999999
```

## ✨ **COMO FUNCIONA**

### 🔐 **Bypass Automático**
- **Digite apenas**: `11999999999`
- **Clique em "Continuar"**
- **Sistema detecta automaticamente** e faz bypass do OTP
- **Vai direto para o mapa** como driver completo

### 🚗 **Dados do Usuário de Teste**
```json
{
  "uid": "test-driver-bypass-123",
  "phoneNumber": "+5511999999999",
  "firstName": "João",
  "lastName": "Silva Teste",
  "email": "joao.teste@leaf.com",
  "mobile": "+5511999999999",
  "cpf": "123.456.789-00",
  "dateOfBirth": "1990-01-01",
  "gender": "M",
  "usertype": "driver",
  "phoneValidated": true,
  "cnhUploaded": true,
  "isApproved": true,
  "driverActiveStatus": true,
  "profileComplete": true,
  "onboardingCompleted": true,
  "walletBalance": 0,
  "referralId": "leaf9999",
  "rating": 4.8,
  "vehicle": "ABC-9999",
  "location": {
    "latitude": -23.5505,
    "longitude": -46.6333
  },
  "isTestUser": true
}
```

## 🗺️ **O QUE VOCÊ VERÁ**

### ✅ **Após o Bypass**
1. **SplashScreen** aparece brevemente
2. **Sistema detecta** o número de teste
3. **Cria usuário completo** automaticamente
4. **Vai direto para o mapa** com clusters
5. **Aparece como motorista** ativo no mapa

### 🚗 **No Mapa**
- **Clusters de motoristas** funcionando
- **Sua localização** em São Paulo
- **Status de motorista** ativo
- **Todos os recursos** disponíveis

## 🔧 **IMPLEMENTAÇÃO TÉCNICA**

### 📁 **Arquivos Modificados**
- `PhoneInputStep.js` - Detecta número de teste
- `AuthFlow.js` - Processa bypass
- `TestUserService.js` - Gerencia dados de teste

### 🚀 **Fluxo de Bypass**
1. **Detecção**: `phoneNumber === '11999999999'`
2. **Criação**: Usuário mock + dados completos
3. **Banco**: Salva no Firebase Realtime Database
4. **Localização**: Adiciona motorista ativo
5. **Navegação**: Vai direto para o mapa

## 🧪 **TESTANDO**

### 📱 **Passos para Teste**
1. **Abra o app**
2. **Digite**: `11999999999`
3. **Clique**: "Continuar"
4. **Aguarde**: Bypass automático
5. **Veja**: Mapa com clusters

### 🎯 **O que Testar**
- ✅ **Bypass funciona** sem OTP
- ✅ **Usuário criado** no banco
- ✅ **Motorista aparece** no mapa
- ✅ **Clusters funcionando**
- ✅ **Localização ativa**

## 🛠️ **MANUTENÇÃO**

### 🧹 **Limpar Dados de Teste**
```javascript
import testUserService from './src/services/TestUserService';

// Limpar todos os usuários de teste
await testUserService.cleanupTestUsers();
```

### 📊 **Ver Usuários Disponíveis**
```javascript
const testUsers = testUserService.getAvailableTestUsers();
console.log(testUsers);
```

## ⚠️ **IMPORTANTE**

### 🚨 **Apenas para Desenvolvimento**
- **NÃO usar** em produção
- **Número específico** para bypass
- **Dados fictícios** para teste

### 🔒 **Segurança**
- **Bypass apenas** para número específico
- **Dados isolados** de produção
- **Fácil limpeza** quando necessário

---

## 🎉 **PRONTO PARA TESTE!**

**Digite `11999999999` e veja a mágica acontecer!** ✨
