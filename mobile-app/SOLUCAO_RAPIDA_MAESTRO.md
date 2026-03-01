# ⚡ Solução Rápida: Build Standalone para Maestro

## 🎯 Problema

O app instalado é a **versão dev** que precisa do `npx expo start`.  
O Maestro precisa de uma **versão standalone** que funciona sozinha.

---

## ✅ Solução Rápida (5-10 minutos)

### Opção 1: Build Local Release (Mais Rápido)

```bash
cd mobile-app

# 1. Build release local
npx expo run:android --variant release

# 2. Instalar no dispositivo
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

**Pronto!** Agora o app funciona standalone e o Maestro pode testar.

### Opção 2: Script Automático

```bash
cd mobile-app
npm run build:standalone
```

O script pergunta qual tipo de build você quer e faz tudo.

---

## 🔍 Como Saber se Funcionou?

**Antes (versão dev):**
- ❌ Abre tela pedindo "npx expo start"
- ❌ Não funciona sozinho

**Depois (versão standalone):**
- ✅ Abre direto na tela inicial
- ✅ Funciona sozinho
- ✅ Maestro pode testar

---

## 🚀 Depois de Instalar

```bash
# Testar se funciona
adb shell am start -n br.com.leaf.ride/.MainActivity

# Se abrir direto (sem pedir expo start) = ✅ Funcionou!

# Executar teste Maestro
npm run test:e2e:device .maestro/flows/auth/01-login-customer-real.yaml
```

---

## 📋 Checklist

- [ ] Build release feito
- [ ] APK instalado no dispositivo
- [ ] App abre sozinho (sem pedir expo start)
- [ ] Teste Maestro executado

---

**Agora o Maestro vai conseguir abrir o app automaticamente!** 🎉













