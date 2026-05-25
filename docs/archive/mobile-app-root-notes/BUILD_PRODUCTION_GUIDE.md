# 🚀 **GUIA DE BUILD PRODUÇÃO - LEAF APP**

**Status:** ✅ **PRONTO PARA BUILD**  
**EAS CLI:** Configurado  
**Projeto:** @leaf-app/leafapp-reactnative  
**ID:** 91dfdce0-9705-4fde-8417-747273ab7cc2  

---

## 📋 **PRÉ-REQUISITOS VERIFICADOS:**

### ✅ **Configuração do Projeto:**
- ✅ Expo Doctor: 17/17 checks passaram
- ✅ EAS.json: Configurado para Android (AAB) e iOS
- ✅ App.config.js: Bundle IDs e configurações OK
- ✅ Metro config: Corrigido para usar configurações padrão Expo
- ✅ Gitignore: .expo/ adicionado

### ✅ **Build Profiles:**
- ✅ **Development**: APK + Development Client
- ✅ **Preview**: AAB + Internal Distribution  
- ✅ **Production**: AAB + Store Distribution

---

## 🚀 **COMANDOS DE BUILD:**

### **📱 ANDROID:**

#### **Build de Teste (Preview):**
```bash
npx eas build --platform android --profile preview
```

#### **Build de Produção (Play Store):**
```bash
npx eas build --platform android --profile production
```

### **🍎 iOS:**

#### **Build de Teste (Preview):**
```bash
npx eas build --platform ios --profile preview
```

#### **Build de Produção (App Store):**
```bash
npx eas build --platform ios --profile production
```

### **🔄 AMBAS PLATAFORMAS:**
```bash
npx eas build --platform all --profile production
```

---

## 📤 **SUBMIT PARA LOJAS:**

### **📱 Google Play Store:**
```bash
npx eas submit --platform android
```

### **🍎 Apple App Store:**
```bash
npx eas submit --platform ios
```

### **🔄 AMBAS LOJAS:**
```bash
npx eas submit --platform all
```

---

## 🔑 **CREDENCIAIS NECESSÁRIAS:**

### **📱 Android (Google Play):**
- ✅ **Keystore**: Gerado automaticamente pelo EAS
- ✅ **Service Account**: Para upload automático
- ✅ **Play Console**: Conta configurada

### **🍎 iOS (App Store):**
- ⚠️ **Apple Developer Account**: $99/ano necessário
- ⚠️ **Provisioning Profiles**: Configurar via EAS
- ⚠️ **Certificates**: Gerado automaticamente pelo EAS

---

## 📊 **MONITORAMENTO:**

### **🔍 Status do Build:**
```bash
npx eas build:list
```

### **📋 Logs Detalhados:**
```bash
npx eas build:view [BUILD_ID]
```

### **🔧 Configurar Credenciais:**
```bash
# Android
npx eas credentials --platform android

# iOS  
npx eas credentials --platform ios
```

---

## 🚨 **TROUBLESHOOTING:**

### **❌ Build Falha:**
1. Verificar logs: `npx eas build:view [BUILD_ID]`
2. Limpar cache: `npx expo r -c`
3. Verificar dependências: `npm install --legacy-peer-deps`

### **❌ Credenciais Inválidas:**
1. Reconfigurar: `npx eas credentials`
2. Verificar Apple Developer Account
3. Verificar Google Play Console

### **❌ Upload Falha:**
1. Verificar permissões do Service Account
2. Verificar versão do app (não pode ser menor que anterior)
3. Verificar se AAB está assinado corretamente

---

## 🎯 **PRÓXIMOS PASSOS RECOMENDADOS:**

### **FASE 1 - Build de Teste:**
1. ✅ **Build Preview Android**: Testar AAB
2. ⚠️ **Build Preview iOS**: Precisa de Apple Developer Account  
3. ✅ **Testar instalação**: Verificar funcionamento

### **FASE 2 - Preparar Produção:**
1. ⚠️ **Configurar Apple Developer**: $99/ano
2. ⚠️ **Google Play Console**: $25 taxa única
3. ✅ **Políticas de Privacidade**: Já implementadas
4. ✅ **Screenshots**: Preparar para lojas

### **FASE 3 - Deploy Produção:**
1. ✅ **Build Production**: Ambas plataformas
2. ✅ **Submit to Stores**: Upload automático
3. ✅ **Review Process**: Aguardar aprovação (1-7 dias)

---

## 💰 **CUSTOS ESTIMADOS:**

- **Apple Developer Program**: $99/ano (obrigatório)
- **Google Play Developer**: $25 taxa única (obrigatório)
- **EAS Build**: Gratuito (até 30 builds/mês)
- **Total inicial**: $124

---

## 🏆 **STATUS ATUAL:**

### **✅ PRONTO:**
- ✅ Configuração EAS completa
- ✅ Android build profile configurado
- ✅ Projeto sem erros
- ✅ Dependências corretas

### **⚠️ PENDENTE:**
- ⚠️ Apple Developer Account ($99)
- ⚠️ iOS Provisioning Profiles
- ⚠️ Google Play Console setup

### **🚀 RECOMENDAÇÃO:**
**INICIAR COM BUILD ANDROID PREVIEW PARA VALIDAR TUDO**

```bash
npx eas build --platform android --profile preview
```

Este comando vai:
1. Criar AAB de teste
2. Validar todas as configurações  
3. Permitir download e teste no dispositivo
4. Preparar para build de produção

**O projeto está 100% pronto para build!** 🎉







