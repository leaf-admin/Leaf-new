# 🔄 Como Recarregar o App para Aplicar Mudanças

## ⚡ Método Rápido (Recomendado)

### 1. **Recarregar via Dev Menu**
- No app, agite o dispositivo (shake)
- Ou pressione `Ctrl+M` (Android) / `Cmd+D` (iOS) no emulador
- Selecione **"Reload"** ou **"Recarregar"**

### 2. **Recarregar via Terminal**
```bash
# No terminal onde o Metro está rodando, pressione:
r  # Para recarregar
```

### 3. **Fechar e Reabrir o App**
- Feche completamente o app (swipe up no Android)
- Abra novamente

---

## 🔄 Método Completo (Se o Método Rápido Não Funcionar)

### 1. **Parar e Reiniciar Metro Bundler**
```bash
cd mobile-app
# Parar Metro (Ctrl+C)
# Limpar cache
npm start -- --reset-cache
```

### 2. **Recarregar no App**
- No app, agite o dispositivo
- Selecione **"Reload"**

---

## 🧹 Limpar Cache Completo (Último Recurso)

### Android
```bash
cd mobile-app
# Limpar cache do Metro
npm start -- --reset-cache

# Limpar cache do app (via ADB)
adb shell pm clear br.com.leaf.ride
```

### iOS
```bash
cd mobile-app
# Limpar cache do Metro
npm start -- --reset-cache

# Limpar cache do app (via Xcode ou dispositivo)
# Settings > General > iPhone Storage > Leaf App > Offload App
```

---

## ✅ Verificar se Mudanças Foram Aplicadas

Após recarregar, verifique nos logs do console:
- Procure por mensagens como `✅ Placa extraída` ou `✅ RENAVAM extraído`
- Se aparecer `⚠️ Placa não encontrada`, as mudanças podem não ter sido aplicadas

---

## 🚨 Se Ainda Não Funcionar

1. **Reinstalar o app:**
```bash
cd mobile-app
npx expo run:android
```

2. **Ou fazer rebuild completo:**
```bash
cd mobile-app
rm -rf node_modules
npm install
npx expo run:android
```




























