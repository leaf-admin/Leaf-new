# 🔧 Corrigir Tudo Agora - Guia Definitivo

## 🎯 Problemas Identificados

1. ❌ **App instalado é versão DEV** (pede expo start)
2. ❌ **Maestro abrindo app errado** (app de telefone)
3. ❌ **Precisa build standalone REAL**

---

## ✅ Solução Passo a Passo

### Passo 1: Remover Versão Dev e Buildar Standalone

```bash
cd mobile-app
bash scripts/build-standalone-AGORA.sh
```

**O que o script faz:**
1. ✅ Remove versão dev
2. ✅ Limpa builds anteriores
3. ✅ Builda versão release (standalone)
4. ✅ Instala no dispositivo
5. ✅ Testa se funciona

**Tempo:** 5-10 minutos

### Passo 2: Verificar se Funcionou

**No celular, o app deve:**
- ✅ Abrir direto na tela inicial
- ✅ **NÃO** pedir "expo start"
- ✅ Funcionar sozinho

**Se ainda pedir expo start:**
- O build não gerou standalone
- Tente build manual (veja abaixo)

### Passo 3: Testar com Maestro

```bash
npm run test:e2e:device .maestro/flows/test-simple-launch.yaml
```

**Agora deve:**
- ✅ Abrir o app correto (não app de telefone)
- ✅ Mostrar ações em tempo real
- ✅ Capturar screenshots

---

## 🏗️ Build Manual (Se Script Falhar)

```bash
cd mobile-app

# 1. Desinstalar versão dev
adb uninstall br.com.leaf.ride

# 2. Limpar
cd android
./gradlew clean
cd ..

# 3. Build release
npx expo run:android --variant release

# 4. Instalar
adb install -r android/app/build/outputs/apk/release/app-release.apk

# 5. Testar
adb shell am start -n br.com.leaf.ride/.MainActivity
```

---

## 🔍 Verificar App Instalado

```bash
# Ver qual versão está instalada
adb shell dumpsys package br.com.leaf.ride | grep -E "versionName|DevLauncher"

# Se aparecer "DevLauncher" = versão dev (ruim)
# Se não aparecer = versão standalone (bom)
```

---

## 🎯 Checklist Final

Antes de testar com Maestro:

- [ ] Versão dev desinstalada
- [ ] Versão standalone buildada
- [ ] Versão standalone instalada
- [ ] App abre sozinho (sem pedir expo start)
- [ ] Maestro configurado (permissões OK)

---

## 🆘 Ainda Não Funciona?

### Problema: "Ainda pede expo start"

**Solução:**
```bash
# Verificar se build gerou APK correto
ls -lh android/app/build/outputs/apk/release/app-release.apk

# Se não existir, buildar novamente
npx expo run:android --variant release
```

### Problema: "Maestro abre app de telefone"

**Solução:**
- Verificar appId no teste: deve ser `br.com.leaf.ride`
- Verificar se app está instalado: `adb shell pm list packages | grep leaf`
- Tentar abrir manualmente: `adb shell am start -n br.com.leaf.ride/.MainActivity`

---

## 🚀 Depois de Corrigir

```bash
# Testar
npm run test:e2e:device .maestro/flows/test-simple-launch.yaml

# Você deve ver:
# - App abrindo no celular
# - Ações em tempo real
# - Screenshots sendo capturados
```

---

**Execute o script e vamos corrigir tudo de uma vez!** 🔧













