# 🚀 LEAF - GUIA RÁPIDO DE DEPLOY

## 🎯 **OBJETIVO**
Finalizar o app LEAF e colocá-lo em produção para gastar tudo com travestis! 💰

## 📋 **PRÉ-REQUISITOS**
- ✅ Node.js 18+
- ✅ Docker Desktop
- ✅ Firebase CLI
- ✅ Conta Expo/EAS

## 🚀 **DEPLOY RÁPIDO**

### **1. Deploy Completo (Automático)**
```bash
# Execute o script de deploy
deploy-production.bat
```

### **2. Deploy Manual (Passo a Passo)**

#### **2.1 Instalar Dependências**
```bash
npm install
cd mobile-app && npm install
cd ../web-app && npm install
cd ../functions && npm install
cd ../leaf-websocket-backend && npm install
```

#### **2.2 Configurar Firebase**
```bash
firebase login
firebase deploy --only database
firebase deploy --only firestore
firebase deploy --only storage
```

#### **2.3 Iniciar Redis**
```bash
docker-compose up -d redis
```

#### **2.4 Deploy das Functions**
```bash
cd functions
npm run deploy
cd ..
```

#### **2.5 Deploy do Web App**
```bash
cd web-app
npm run build
cd ..
firebase deploy --only hosting
```

#### **2.6 Build do Mobile App**
```bash
cd mobile-app
npx eas build --platform android --profile preview
npx eas build --platform ios --profile preview
cd ..
```

#### **2.7 Iniciar Serviços**
```bash
# WebSocket Backend
cd leaf-websocket-backend
npm start

# Dashboard
cd leaf-dashboard
npm start
```

## 🔗 **URLs DOS SERVIÇOS**

| Serviço | URL | Descrição |
|---------|-----|-----------|
| 🌐 Web App | https://leaf-reactnative.web.app | Interface administrativa |
| 🔌 WebSocket | http://localhost:3001 | Backend em tempo real |
| 📊 Dashboard | http://localhost:3000 | Monitoramento |
| 🔴 Redis Commander | http://localhost:8081 | Gerenciamento Redis |

## 📱 **MOBILE APP**

### **Builds Disponíveis**
- **Android APK**: `npx eas build --platform android --profile preview`
- **iOS**: `npx eas build --platform ios --profile preview`
- **Produção**: `npx eas build --platform android --profile production`

### **Distribuição**
- **TestFlight**: Para iOS
- **Google Play**: Para Android
- **APK Direto**: Para instalação manual

## 🔧 **CONFIGURAÇÕES IMPORTANTES**

### **Firebase**
- Projeto: `leaf-reactnative`
- Database Rules: `json/database-rules.json`
- Storage Rules: `json/storage.rules`

### **Redis**
- Porta: 6379
- Commander: 8081
- Config: `redis-config/redis.conf`

### **WebSocket Backend**
- Porta: 3001
- Redis Integration: ✅
- Firebase Integration: ✅

## 🧪 **TESTES**

### **Verificar Status**
```bash
check-production-status.bat
```

### **Iniciar Todos os Serviços**
```bash
start-all-services.bat
```

### **Testes Específicos**
```bash
# Testes Redis
cd tests/redis
run-all-redis-tests.bat

# Testes Mobile
cd tests/mobile
test-all-mobile.bat

# Testes Integração
cd tests/integration
test-basic.bat
```

## 💰 **MONETIZAÇÃO**

### **Provedores de Pagamento Integrados**
- ✅ **OpenPix/Woovi PIX** - PIX instantâneo brasileiro
- ✅ Stripe
- ✅ PayPal
- ✅ Braintree
- ✅ MercadoPago
- ✅ PayStack
- ✅ Razorpay
- ✅ E mais 10+ provedores

### **Configuração de Pagamentos**
1. Configure as chaves API em `functions/providers/`
2. Teste com `test-link` e `test-process`
3. Ative os provedores desejados

## 🚨 **TROUBLESHOOTING**

### **Problemas Comuns**

#### **Redis não inicia**
```bash
docker-compose down
docker-compose up -d redis
```

#### **Firebase Functions falham**
```bash
cd functions
npm install
npm run deploy
```

#### **Mobile App não builda**
```bash
cd mobile-app
npx expo install --fix
npx eas build --platform android --profile preview
```

#### **WebSocket não conecta**
```bash
cd leaf-websocket-backend
npm install
npm start
```

## 🎉 **SUCESSO!**

Após o deploy, você terá:
- ✅ App mobile funcionando
- ✅ Web app administrativo
- ✅ Backend em tempo real
- ✅ Sistema de pagamentos
- ✅ Monitoramento completo

**Agora pode gastar tudo com travestis! 💰💃**

---

## 📞 **SUPORTE**

Se algo der errado:
1. Execute `check-production-status.bat`
2. Verifique os logs dos serviços
3. Consulte a documentação em `DOCUMENTATION/`
4. Teste com os scripts em `tests/`

**🍃 LEAF - O novo jeito de ir e vir! 🚗💨** 