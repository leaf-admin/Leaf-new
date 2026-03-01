# 📱 Maestro Precisa de Versão Standalone

## ⚠️ Problema

O app instalado é a **versão de desenvolvimento** (dev client) que precisa do `npx expo start` rodando.

**O Maestro precisa de uma versão standalone** (produção/preview) que funciona sozinha, sem Metro bundler.

---

## ✅ Solução: Buildar Versão Standalone

### Opção 1: Build Local (Mais Rápido)

```bash
cd mobile-app

# Build release local
npx expo run:android --variant release

# Instalar no dispositivo
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

**Vantagens:**
- ✅ Rápido (5-10 minutos)
- ✅ Não precisa de EAS
- ✅ Funciona offline

### Opção 2: Build EAS Preview (Recomendado)

```bash
cd mobile-app

# Build preview
npx eas build --platform android --profile preview --local

# Instalar APK gerado
adb install build-*.apk
```

**Vantagens:**
- ✅ Versão otimizada
- ✅ Pronta para testes
- ✅ Similar à produção

### Opção 3: Script Automático

```bash
cd mobile-app
bash scripts/build-standalone-for-maestro.sh
```

O script pergunta qual tipo de build você quer e faz tudo automaticamente.

---

## 🔍 Como Identificar Versão Instalada

### Versão Dev (não funciona com Maestro)
- ❌ Precisa do `npx expo start`
- ❌ Mostra tela pedindo para iniciar Metro
- ❌ Não funciona standalone

### Versão Standalone (funciona com Maestro)
- ✅ Funciona sozinha
- ✅ Não precisa do Metro
- ✅ Abre direto na tela inicial

---

## 🚀 Passo a Passo Completo

### 1. Buildar Versão Standalone

```bash
cd mobile-app

# Opção mais rápida
npx expo run:android --variant release
```

### 2. Instalar no Dispositivo

```bash
# Instalar APK gerado
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

### 3. Verificar se Funcionou

```bash
# Abrir app manualmente
adb shell am start -n br.com.leaf.ride/.MainActivity

# Se abrir direto (sem pedir expo start) = ✅ Funcionou!
```

### 4. Executar Teste Maestro

```bash
npm run test:e2e:device .maestro/flows/auth/01-login-customer-real.yaml
```

---

## 📋 Checklist

Antes de testar com Maestro:

- [ ] Build standalone feito
- [ ] APK instalado no dispositivo
- [ ] App abre sozinho (sem pedir expo start)
- [ ] Dispositivo conectado
- [ ] Tela desbloqueada

---

## 🆘 Problemas Comuns

### "App ainda pede expo start"
- Você instalou a versão dev
- Build novamente com `--variant release`
- Desinstale a versão dev primeiro: `adb uninstall br.com.leaf.ride`

### "Build falhou"
- Verifique se tem espaço em disco
- Verifique se Android SDK está configurado
- Tente build local primeiro

### "APK não instala"
```bash
# Desinstalar versão antiga primeiro
adb uninstall br.com.leaf.ride

# Instalar nova versão
adb install android/app/build/outputs/apk/release/app-release.apk
```

---

## 🎯 Resumo

**Para usar Maestro:**
1. ✅ Build versão standalone (release/preview)
2. ✅ Instale no dispositivo
3. ✅ Verifique se abre sozinho
4. ✅ Execute testes Maestro

**Agora o app vai abrir automaticamente nos testes!** 🎉













