# 📱 **GUIA RÁPIDO - REINSTALAÇÃO DO DEVELOPMENT BUILD**

## 🚀 **Instalação Automática (Recomendado)**

### **Passo 1: Conectar o Aparelho**
```bash
# Conectar o outro aparelho via USB
# Habilitar depuração USB
# Verificar conexão:
adb devices
```

### **Passo 2: Executar Script Automático**
```bash
cd "/home/izaak-dias/Downloads/1. leaf/main/Sourcecode/mobile-app"
./reinstall-dev-build.sh
```

### **Passo 3: Escolher APK**
- **Opção 1** (Recomendado): `leaf-app-latest.apk`
- **Opção 2**: `development-client.apk`
- **Opção 3**: `leaf-dev-client.apk`
- **Opção 4**: `leaf-app-driver.apk`
- **Opção 5**: Construir novo APK

---

## 🔧 **Instalação Manual**

### **Método 1: ADB Install**
```bash
# Desinstalar versão anterior
adb uninstall br.com.leaf.ride

# Instalar novo APK
adb install -r leaf-app-latest.apk

# Abrir o app
adb shell monkey -p br.com.leaf.ride -c android.intent.category.LAUNCHER 1
```

### **Método 2: Transferir e Instalar**
```bash
# Transferir APK para o dispositivo
adb push leaf-app-latest.apk /sdcard/Download/

# Instalar via dispositivo
# (Usar gerenciador de arquivos do Android)
```

---

## 🧪 **Configuração do Usuário de Teste**

### **Após a Instalação:**
```javascript
// No console do app (React Native Debugger):
import testUserQuick from './test-user-quick';
await testUserQuick();
```

### **Ou usar o botão flutuante:**
```javascript
// Adicionar em qualquer tela:
import TestUserButton from './src/components/TestUserButton';
<TestUserButton />
```

---

## 📊 **Verificação da Instalação**

### **1. Verificar se o app abriu:**
```bash
adb shell dumpsys activity | grep "br.com.leaf.ride"
```

### **2. Verificar logs:**
```bash
adb logcat | grep -E "(Leaf|FCM|WebSocket)"
```

### **3. Verificar conectividade:**
```bash
# Testar WebSocket
curl http://192.168.0.41:3001/health

# Testar API
curl http://192.168.0.41:3001/metrics
```

---

## 🔍 **Solução de Problemas**

### **Problema: "Dispositivo não encontrado"**
```bash
# Verificar conexão USB
adb devices

# Reiniciar ADB
adb kill-server
adb start-server
adb devices
```

### **Problema: "Falha na instalação"**
```bash
# Verificar espaço
adb shell df /data

# Instalar com flags adicionais
adb install -r -d leaf-app-latest.apk
```

### **Problema: "App não abre"**
```bash
# Limpar dados do app
adb shell pm clear com.leafapp.reactnative

# Reinstalar
adb install -r leaf-app-latest.apk
```

---

## 📱 **APKs Disponíveis**

| APK | Descrição | Recomendado |
|-----|-----------|-------------|
| `leaf-app-latest.apk` | Versão mais recente | ✅ Sim |
| `development-client.apk` | Cliente de desenvolvimento | ✅ Sim |
| `leaf-dev-client.apk` | Cliente dev alternativo | ⚠️ Teste |
| `leaf-app-driver.apk` | Versão específica para drivers | ⚠️ Teste |

---

## 🎯 **Próximos Passos Após Instalação**

1. **✅ Abrir o app** (deve abrir automaticamente)
2. **🧪 Configurar usuário de teste** (usar script ou botão)
3. **🔌 Testar WebSocket** (verificar logs)
4. **📱 Testar "ficar online"** (funcionalidade principal)
5. **📊 Monitorar logs** (verificar funcionamento)

---

## 🚀 **Comandos Úteis**

```bash
# Reiniciar app
adb shell am force-stop br.com.leaf.ride && adb shell monkey -p br.com.leaf.ride -c android.intent.category.LAUNCHER 1

# Ver logs em tempo real
adb logcat | grep -E "(Leaf|FCM|WebSocket|🧪)"

# Limpar dados do app
adb shell pm clear br.com.leaf.ride

# Verificar versão instalada
adb shell dumpsys package br.com.leaf.ride | grep versionName
```

---

**🎉 Após seguir este guia, o development build estará instalado e configurado no outro aparelho!**
