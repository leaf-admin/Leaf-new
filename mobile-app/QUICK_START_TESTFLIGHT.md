# 🚀 Quick Start: TestFlight em 5 Passos

Guia rápido para começar a usar TestFlight **AGORA**.

---

## ✅ **PRÉ-REQUISITOS**

1. **Conta Apple Developer** ($99/ano) - https://developer.apple.com/programs/
2. **EAS CLI instalado:** `npm install -g eas-cli`

---

## 🎯 **5 PASSOS RÁPIDOS**

### **1. Login no EAS**
```bash
cd mobile-app
npx eas-cli login
```

### **2. Configurar Credenciais (Primeira Vez)**
```bash
npx eas-cli credentials
# Selecionar: iOS → Set up credentials
```

### **3. Criar Build**
```bash
npx eas-cli build --platform ios --profile production
```

**⏳ Aguardar:** 15-30 minutos

### **4. Adicionar Testadores no App Store Connect**

1. Acesse: https://appstoreconnect.apple.com
2. Vá em **TestFlight** → Seu app
3. Clique em **"+"** → **"Adicionar Testadores"**
4. Adicione emails dos testadores
5. Selecione o build processado

### **5. Testadores Recebem Convite**

- Email automático do TestFlight
- Instalar app TestFlight (se não tiver)
- Aceitar convite
- Baixar e testar o app

---

## 🛠️ **Script Automatizado**

Use o script auxiliar para facilitar:

```bash
cd mobile-app
./setup-testflight.sh
```

**Opções:**
- 1. Configurar credenciais
- 2. Criar build
- 3. Ver status
- 4. Baixar build
- 5. Verificar configuração

---

## 📋 **CHECKLIST RÁPIDO**

Antes de começar:

- [ ] Conta Apple Developer ativa
- [ ] EAS CLI instalado
- [ ] Logado no EAS
- [ ] App criado no App Store Connect
- [ ] Bundle ID: `br.com.leaf.ride`

---

## 🐛 **PROBLEMAS COMUNS**

### "No credentials found"
```bash
npx eas-cli credentials
```

### "Build failed"
```bash
npx eas-cli build:view [BUILD_ID]
```

### "Testers not receiving invite"
- Verificar spam
- Verificar se build está atribuído
- Aguardar alguns minutos

---

## 📚 **DOCUMENTAÇÃO COMPLETA**

Para guia detalhado, veja: **`GUIA_TESTFLIGHT_IOS.md`**

---

**Tempo estimado:** 30-60 minutos (incluindo build)

