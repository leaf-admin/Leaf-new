# 🍎 Guia Completo: Configuração iOS para TestFlight

Este guia detalha todos os passos necessários para configurar o app Leaf para distribuição via TestFlight.

---

## 📋 **PRÉ-REQUISITOS**

### ✅ **1. Conta Apple Developer**
- **Custo:** $99 USD/ano
- **Onde:** https://developer.apple.com/programs/
- **Tempo de aprovação:** 24-48 horas (geralmente instantâneo)

### ✅ **2. Conta App Store Connect**
- Criada automaticamente ao se inscrever no Apple Developer Program
- Acesso: https://appstoreconnect.apple.com

### ✅ **3. Ferramentas Necessárias**
- **EAS CLI:** `npm install -g eas-cli`
- **Expo CLI:** Já instalado no projeto
- **Xcode** (opcional, para builds locais): Disponível na Mac App Store

---

## 🔧 **PASSO 1: Configurar Credenciais no EAS**

### **1.1. Login no EAS**
```bash
cd mobile-app
npx eas-cli login
```

### **1.2. Configurar Credenciais iOS**
```bash
npx eas-cli credentials
```

**Selecione:**
1. **Platform:** `iOS`
2. **Action:** `Set up credentials`
3. **Project:** Selecione seu projeto Expo

**O EAS irá:**
- ✅ Criar certificados de distribuição automaticamente
- ✅ Criar provisioning profiles
- ✅ Configurar App Store Connect
- ✅ Gerenciar tudo automaticamente

**Nota:** Você precisará fazer login com sua conta Apple Developer quando solicitado.

---

## 📱 **PASSO 2: Verificar Configuração do App**

### **2.1. Verificar `app.config.js`**

Certifique-se de que o `bundleIdentifier` está correto:

```javascript
ios: {
    bundleIdentifier: "br.com.leaf.ride",  // ✅ Já configurado
    googleServicesFile: "./GoogleService-Info.plist",
    icon: "./assets/icon.png"
}
```

### **2.2. Verificar Versão e Build Number**

No `app.config.js`, verifique:
- `version`: Versão do app (ex: "1.0.0")
- `runtimeVersion`: Versão do runtime (ex: "1.0.0")

**Importante:** A versão deve seguir o formato semântico (major.minor.patch).

---

## 🏗️ **PASSO 3: Configurar App Store Connect**

### **3.1. Criar App no App Store Connect**

1. Acesse: https://appstoreconnect.apple.com
2. Vá em **"Meus Apps"** → **"+"** → **"Novo App"**
3. Preencha:
   - **Plataforma:** iOS
   - **Nome:** Leaf
   - **Idioma Principal:** Português (Brasil)
   - **Bundle ID:** `br.com.leaf.ride`
   - **SKU:** `leaf-ios-001` (qualquer identificador único)
   - **Acesso Completo:** Sim

### **3.2. Configurar Informações Básicas**

No App Store Connect, preencha:

**Informações do App:**
- **Nome:** Leaf
- **Subtítulo:** Transporte Inteligente
- **Categoria:** Transporte
- **Classificação:** 4+ (ou conforme seu conteúdo)

**Preços e Disponibilidade:**
- **Preço:** Grátis
- **Disponibilidade:** Todos os países (ou selecione)

**Privacidade:**
- **URL da Política de Privacidade:** https://leaf.app.br/privacy
- **URL dos Termos de Serviço:** https://leaf.app.br/terms

---

## 🚀 **PASSO 4: Criar Build para TestFlight**

### **4.1. Build via EAS (Recomendado)**

```bash
cd mobile-app
npx eas-cli build --platform ios --profile production
```

**O que acontece:**
1. EAS cria o build na nuvem
2. Assina automaticamente com suas credenciais
3. Faz upload para App Store Connect
4. Processa para TestFlight

**Tempo estimado:** 15-30 minutos

### **4.2. Monitorar Build**

```bash
# Ver status do build
npx eas-cli build:list --platform ios --limit 1

# Ver logs em tempo real
npx eas-cli build:view [BUILD_ID]
```

### **4.3. Alternativa: Build Local (se tiver Mac)**

```bash
npx eas-cli build --platform ios --profile production --local
```

**Requisitos:**
- Mac com Xcode instalado
- Certificados configurados

---

## 📤 **PASSO 5: Configurar TestFlight**

### **5.1. Aguardar Processamento**

Após o build ser enviado:
1. Acesse App Store Connect
2. Vá em **"TestFlight"** → Seu app
3. Aguarde processamento (5-30 minutos)

**Status possíveis:**
- ⏳ **Processando:** Build sendo processado
- ✅ **Pronto para Teste:** Build disponível
- ❌ **Falhou:** Verificar logs

### **5.2. Adicionar Testadores Internos**

**Testadores Internos (até 100):**
1. Vá em **"TestFlight"** → **"Testadores Internos"**
2. Clique em **"+"** → **"Adicionar Testadores"**
3. Adicione emails dos testadores
4. Selecione o build para testar

**Nota:** Testadores internos precisam estar no seu time no App Store Connect.

### **5.3. Adicionar Testadores Externos**

**Testadores Externos (até 10.000):**
1. Vá em **"TestFlight"** → **"Testadores Externos"**
2. Clique em **"+"** → **"Criar Grupo"**
3. Adicione emails dos testadores
4. Selecione o build para testar
5. **Importante:** Primeira versão externa precisa de revisão da Apple (1-2 dias)

---

## ✅ **PASSO 6: Verificar Checklist**

### **6.1. Checklist Técnico**

- ✅ Bundle ID configurado
- ✅ Certificados criados
- ✅ Provisioning profiles configurados
- ✅ Build criado e processado
- ✅ App Store Connect configurado

### **6.2. Checklist de Conteúdo**

- ✅ Política de Privacidade hospedada
- ✅ Termos de Serviço hospedados
- ✅ Ícone do app (1024x1024)
- ✅ Screenshots (pelo menos 1)
- ✅ Descrição do app

### **6.3. Checklist de TestFlight**

- ✅ Build processado com sucesso
- ✅ Testadores adicionados
- ✅ Build atribuído aos testadores
- ✅ Testadores receberam convite

---

## 🔄 **PASSO 7: Atualizar Builds Futuros**

### **7.1. Incrementar Versão**

Antes de cada novo build, atualize a versão:

**No `app.config.js`:**
```javascript
version: "1.0.1",  // Incrementar
runtimeVersion: "1.0.1",  // Incrementar também
```

### **7.2. Criar Novo Build**

```bash
npx eas-cli build --platform ios --profile production
```

### **7.3. Distribuir para TestFlight**

O build será automaticamente enviado para TestFlight após processamento.

---

## 🐛 **SOLUÇÃO DE PROBLEMAS**

### **Problema: "No credentials found"**

**Solução:**
```bash
npx eas-cli credentials
# Selecionar "iOS" → "Set up credentials"
```

### **Problema: "Bundle ID already exists"**

**Solução:**
- Verificar se o Bundle ID já está em uso
- Se sim, usar outro Bundle ID ou remover o app antigo

### **Problema: "Build failed"**

**Solução:**
```bash
# Ver logs detalhados
npx eas-cli build:view [BUILD_ID]

# Verificar configuração
npx expo config --type public
```

### **Problema: "TestFlight build not processing"**

**Solução:**
- Aguardar até 30 minutos
- Verificar se há erros no App Store Connect
- Verificar se o build foi realmente enviado

### **Problema: "Testers not receiving invite"**

**Solução:**
- Verificar se emails estão corretos
- Verificar spam/lixo eletrônico
- Verificar se build está atribuído aos testadores

---

## 📊 **PERFIS DE BUILD (eas.json)**

### **Profile: `production`**
```json
{
  "production": {
    "ios": {
      "buildConfiguration": "Release"
    },
    "channel": "production"
  }
}
```

**Uso:** Builds para App Store e TestFlight

### **Profile: `preview`**
```json
{
  "preview": {
    "distribution": "internal",
    "ios": {
      "buildConfiguration": "Release",
      "simulator": false
    },
    "channel": "preview"
  }
}
```

**Uso:** Builds para testes internos (não vai para TestFlight)

---

## 🎯 **COMANDOS ÚTEIS**

```bash
# Login no EAS
npx eas-cli login

# Verificar credenciais
npx eas-cli credentials

# Criar build iOS
npx eas-cli build --platform ios --profile production

# Listar builds
npx eas-cli build:list --platform ios

# Ver build específico
npx eas-cli build:view [BUILD_ID]

# Baixar build
npx eas-cli build:download --platform ios --latest

# Submeter para App Store (após TestFlight)
npx eas-cli submit --platform ios
```

---

## 📝 **CHECKLIST FINAL**

Antes de distribuir para TestFlight:

- [ ] Conta Apple Developer ativa ($99/ano)
- [ ] App criado no App Store Connect
- [ ] Bundle ID configurado corretamente
- [ ] Versão e build number atualizados
- [ ] Credenciais configuradas no EAS
- [ ] Build criado com sucesso
- [ ] Build processado no App Store Connect
- [ ] Testadores adicionados
- [ ] Build atribuído aos testadores
- [ ] Política de Privacidade hospedada
- [ ] Termos de Serviço hospedados

---

## 🚀 **PRÓXIMOS PASSOS**

Após TestFlight funcionando:

1. **Coletar Feedback:** Testadores testam e reportam bugs
2. **Corrigir Problemas:** Ajustar baseado no feedback
3. **Criar Novo Build:** Incrementar versão e criar novo build
4. **Submeter para App Store:** Quando estiver pronto para produção

---

## 📚 **RECURSOS ÚTEIS**

- **Documentação EAS:** https://docs.expo.dev/build/introduction/
- **App Store Connect:** https://appstoreconnect.apple.com
- **Apple Developer:** https://developer.apple.com
- **TestFlight Docs:** https://developer.apple.com/testflight/

---

## ⚠️ **IMPORTANTE**

1. **Primeira Submissão Externa:** Requer revisão da Apple (1-2 dias)
2. **Limite de Testadores:** Internos (100), Externos (10.000)
3. **Validade do Build:** 90 dias no TestFlight
4. **Versões:** Cada build precisa de versão única
5. **Certificados:** EAS gerencia automaticamente, mas podem expirar

---

**Status:** ✅ Guia completo criado
**Última atualização:** Dezembro 2024

