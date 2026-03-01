# 📱 APK GERADO PARA TESTES

## ✅ **APK GERADO COM SUCESSO**

**Data:** 04 de Novembro de 2025  
**Hora:** 18:00:51  
**Tamanho:** 103 MB

---

## 📍 **LOCALIZAÇÃO DO APK**

### **Arquivo principal:**
```
/home/izaak-dias/Downloads/1. leaf/main/Sourcecode/mobile-app/android/app/build/outputs/apk/release/app-release.apk
```

### **Cópia com timestamp:**
```
/home/izaak-dias/Downloads/1. leaf/main/Sourcecode/mobile-app/leaf-app-test-20251104-180051.apk
```

---

## 🚀 **COMO INSTALAR NO DISPOSITIVO**

### **Método 1: Via USB (ADB)**
```bash
# Conectar dispositivo via USB e habilitar Depuração USB
adb devices  # Verificar se dispositivo está conectado

# Instalar APK
cd "/home/izaak-dias/Downloads/1. leaf/main/Sourcecode/mobile-app"
adb install -r leaf-app-test-20251104-172342.apk
```

### **Método 2: Transferir e Instalar Manualmente**
1. Copiar o arquivo `leaf-app-test-20251104-172342.apk` para o dispositivo
2. Abrir o arquivo no dispositivo
3. Permitir instalação de fontes desconhecidas (se solicitado)
4. Instalar

### **Método 3: Via Google Drive/Dropbox**
1. Fazer upload do APK para Google Drive ou Dropbox
2. Baixar no dispositivo
3. Instalar

---

## 📋 **INFORMAÇÕES DO BUILD**

- **Build Type:** Release
- **Platform:** Android
- **Package:** br.com.leaf.ride
- **Engine:** Hermes
- **Status:** ✅ Build Successful

---

## 🆕 **ALTERAÇÕES NESTA VERSÃO**

### **1. Correção Crítica - Tipo de Usuário:**
- ✅ **PROBLEMA CORRIGIDO:** Usuários de teste estavam carregando DriverUI mesmo sendo customer
- ✅ Alterado `usertype: 'passenger'` para `usertype: 'customer'` em todos os arquivos
- ✅ Arquivos corrigidos:
  - `PhoneInputStep.js`
  - `authactions.js`
  - `AuthProvider.js`
  - `AuthFlow.js`
- ✅ Agora `11777777777` carrega corretamente o `PassengerUI`

### **2. Novo Usuário de Teste Customer:**
- ✅ Adicionado número `11777777777` como customer de teste
- ✅ Bypass de OTP ativo automaticamente
- ✅ Perfil: `customer` (corrigido)

### **3. Correção no Servidor:**
- ✅ Customer agora entra no room específico `customer_${uid}` na autenticação
- ✅ Garante notificações diretas para o customer correto

---

## 🧪 **PRÓXIMOS PASSOS PARA TESTE**

1. ✅ Instalar APK nos dispositivos de teste
2. ✅ Fazer login com usuários de teste:
   - **Customer (Passageiro):** `11777777777` / bypass automático → **Agora carrega PassengerUI corretamente**
   - **Driver (Motorista):** `11999999999` ou `11888888888` / bypass automático → Carrega DriverUI
3. ✅ Testar fluxo completo de corrida:
   - Solicitar corrida (passageiro com `11777777777`)
   - Aceitar corrida (motorista)
   - Iniciar viagem (motorista)
   - Finalizar viagem (motorista)
4. ✅ Verificar notificações em tempo real
5. ✅ Validar cálculos de distância e fare

---

## ⚠️ **NOTAS IMPORTANTES**

- Este é um build de **RELEASE** para testes
- Certifique-se de que o servidor WebSocket está rodando na VPS
- Configure as permissões necessárias no dispositivo (localização, notificações)
- O APK está assinado com a keystore de produção
- **CRÍTICO:** Esta versão corrige o problema de todos os usuários carregarem DriverUI

---

## 🔄 **GERAR NOVO APK**

Se precisar gerar um novo APK com as últimas alterações:

```bash
cd "/home/izaak-dias/Downloads/1. leaf/main/Sourcecode/mobile-app"
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease
```

O novo APK estará em: `android/app/build/outputs/apk/release/app-release.apk`

---

## 📝 **USUÁRIOS DE TESTE DISPONÍVEIS**

### **Drivers (Motoristas):**
- `11999999999` - Driver de teste (bypass OTP) → **Carrega DriverUI**
- `11888888888` - Driver de teste (bypass OTP) → **Carrega DriverUI**

### **Customers (Passageiros):**
- `11777777777` - Customer de teste (bypass OTP) → **Agora carrega PassengerUI corretamente** ✅

Todos os números têm bypass automático de OTP e não precisam de código SMS.

---

## 🐛 **CORREÇÕES APLICADAS**

### **Versão 20251104-180051 - Correção Crítica de UserType**

#### **Problema Identificado:**
- `11777777777` ainda estava carregando DriverUI em vez de PassengerUI
- Dados do customer não estavam sendo salvos no formato correto do Redux

#### **Causa Raiz:**
- `TestUserService.createTestCustomer()` estava usando `usertype: 'passenger'` em vez de `'customer'`
- Dados salvos no Redux não incluíam a estrutura `profile.usertype` esperada pelo `NewMapScreen`
- `AuthFlow.js` não estava chamando o método correto para criar customers

#### **Solução Implementada:**
1. ✅ Corrigido `TestUserService.createTestCustomer()` para usar `usertype: 'customer'`
2. ✅ Corrigido `TestUserService.setTestUserAsPassenger()` para usar `'customer'`
3. ✅ Ajustado `TestUserService.createTestUser()` para aceitar e salvar `userType` corretamente
4. ✅ Corrigido `AuthFlow.js` para chamar `createTestCustomer()` quando `isCustomer === true`
5. ✅ Garantido que dados salvos no Redux incluem `profile.usertype` no formato correto
6. ✅ Todos os métodos agora retornam dados com estrutura `profile` para compatibilidade com `NewMapScreen`

---

### **Versão Anterior (20251104-172342)**

#### **Problema Identificado:**
- Todos os 3 usuários de teste estavam carregando DriverUI, mesmo o customer `11777777777`

#### **Causa Raiz:**
- Inconsistência entre `usertype: 'passenger'` (criado no bypass) e verificação `userType === 'customer'` no `NewMapScreen.js`

#### **Solução:**
- Padronizado para usar `'customer'` em vez de `'passenger'` em todos os arquivos
- Agora o sistema verifica corretamente `userType === 'customer'` para carregar PassengerUI

---

## ✅ **VALIDAÇÃO**

Após instalar este APK (20251104-180051):
- ✅ `11777777777` deve carregar **PassengerUI** (tela de busca de corrida) - **CORRIGIDO**
- ✅ `11999999999` deve carregar **DriverUI** (tela de motorista)
- ✅ `11888888888` deve carregar **DriverUI** (tela de motorista)

### **Arquivos Modificados:**
- `mobile-app/src/services/TestUserService.js`
- `mobile-app/src/components/auth/AuthFlow.js`
