# 🧪 GUIA: TESTES COM BUILD DE RELEASE

**Data:** 21 de Dezembro de 2025  
**Status:** ✅ **PRONTO PARA TESTAR**

---

## 🎯 **RESPOSTA DIRETA**

### **1. Qual build usar para testes?**

**✅ BUILD DE RELEASE (RECOMENDADO)**

**Por quê?**
- Simula exatamente o que será publicado nas lojas
- Não tem código de debug
- Performance igual à versão final
- É o que os revisores da Apple/Google vão testar

**❌ NÃO usar build de desenvolvimento:**
- Pode ter diferenças com produção
- Pode ter código de debug
- Performance pode ser diferente

---

## 📱 **BUILDS DISPONÍVEIS NO EAS**

### **Perfis de Build:**

#### **1. `preview` (RECOMENDADO PARA TESTES)**
```bash
# Android
npx eas build --platform android --profile preview

# iOS
npx eas build --platform ios --profile preview
```

**Características:**
- ✅ Build de release (otimizado)
- ✅ Distribuição interna (não vai para lojas)
- ✅ Pode instalar diretamente no dispositivo
- ✅ Perfeito para testes finais

#### **2. `production` (PARA PUBLICAR)**
```bash
# Android (gera AAB para Play Store)
npx eas build --platform android --profile production

# iOS (gera para App Store/TestFlight)
npx eas build --platform ios --profile production
```

**Características:**
- ✅ Build de release (otimizado)
- ✅ Assinado para lojas
- ✅ Android: Gera AAB (não APK)
- ✅ iOS: Vai para TestFlight/App Store

#### **3. `development` (NÃO USAR PARA TESTES FINAIS)**
```bash
# Apenas para desenvolvimento
npx eas build --platform android --profile development
```

**Características:**
- ⚠️ Development client
- ⚠️ Pode ter diferenças com produção
- ⚠️ Não recomendado para testes finais

---

## 🍎 **iOS COM EAS - CONFIRMADO**

### **✅ SIM! EAS está configurado para iOS**

**Configuração verificada:**
- ✅ `eas.json` tem perfis iOS (`preview` e `production`)
- ✅ `app.config.js` tem `bundleIdentifier` iOS configurado
- ✅ Plugins iOS configurados
- ✅ Permissões iOS configuradas

**Requisitos para build iOS:**
- ⚠️ **Conta Apple Developer** ($99/ano) - NECESSÁRIO
- ✅ EAS gerencia certificados automaticamente
- ✅ EAS gerencia provisioning profiles automaticamente

**Se não tiver conta Apple Developer:**
- ❌ Não consegue gerar build iOS para App Store
- ✅ Mas pode gerar build Android normalmente

---

## 🚀 **COMANDOS PARA GERAR BUILDS DE TESTE**

### **Android (Recomendado para começar):**

```bash
cd mobile-app
npx eas build --platform android --profile preview
```

**O que acontece:**
1. EAS cria build na nuvem
2. Gera APK assinado
3. Disponibiliza para download
4. Pode instalar diretamente no dispositivo

**Tempo:** 15-30 minutos

### **iOS (Se tiver conta Apple Developer):**

```bash
cd mobile-app
npx eas build --platform ios --profile preview
```

**O que acontece:**
1. EAS cria build na nuvem
2. Assina com suas credenciais Apple
3. Gera IPA
4. Disponibiliza para download
5. Pode instalar via TestFlight ou diretamente

**Tempo:** 15-30 minutos

---

## 📋 **ORDEM RECOMENDADA DE TESTES**

### **1. Gerar Build Android Preview (AGORA)**
```bash
cd mobile-app
npx eas build --platform android --profile preview
```

### **2. Aguardar Build Concluir**
- Monitorar: `npx eas build:list --platform android --limit 1`
- Quando concluir, baixar: `npx eas build:download --platform android --latest`

### **3. Instalar no Dispositivo**
- Transferir APK para dispositivo
- Instalar e testar

### **4. Executar Testes Críticos**
- Seguir `LISTA_COMPLETA_TESTES_PUBLICACAO.md`
- Testar todos os itens críticos

### **5. Se tudo OK, gerar Build iOS (se tiver conta)**
```bash
npx eas build --platform ios --profile preview
```

---

## ✅ **CHECKLIST ANTES DE GERAR BUILD**

### **Configurações:**
- [ ] `app.config.js` está correto
- [ ] Versão atualizada
- [ ] Bundle ID/Package Name correto
- [ ] Permissões configuradas corretamente

### **Código:**
- [ ] Código de debug removido
- [ ] Botões de teste removidos
- [ ] URLs de API corretas (produção)
- [ ] Sem console.logs desnecessários

### **iOS (se for gerar):**
- [ ] Conta Apple Developer ativa
- [ ] Credenciais configuradas no EAS
- [ ] Bundle ID registrado no App Store Connect

---

## 🎯 **RESUMO**

### **Para Testes Finais:**
✅ **Usar:** Build de RELEASE (perfil `preview`)  
❌ **NÃO usar:** Build de desenvolvimento

### **iOS:**
✅ **SIM!** EAS está configurado para iOS  
⚠️ **Requisito:** Conta Apple Developer ($99/ano)

### **Próximo Passo:**
1. Gerar build Android preview
2. Testar tudo
3. Se OK, gerar build iOS (se tiver conta)
4. Testar iOS
5. Se tudo OK, gerar builds production para publicar

---

**🚀 Vamos começar gerando o build Android preview agora?**

