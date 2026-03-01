# 🔧 GUIA DE CONFIGURAÇÃO ADB - LINUX

## 📅 Data: 29 de Julho de 2025
## 🎯 Status: ✅ **RESOLVIDO**

---

## 🚨 **PROBLEMA RESOLVIDO**

### **❌ Erro Original**
```bash
Error: adb: insufficient permissions for device: missing udev rules? user is in the plugdev group
```

### **✅ Solução Aplicada**
1. Adicionar usuário ao grupo `plugdev`
2. Criar regras udev para dispositivos Android
3. Recarregar regras udev
4. Reiniciar servidor ADB

---

## 🔧 **PASSOS PARA RESOLVER**

### **1. Adicionar Usuário ao Grupo**
```bash
sudo usermod -a -G plugdev $LOGNAME
```

### **2. Criar Regras UDEV**
```bash
sudo tee /etc/udev/rules.d/51-android.rules << EOF
# Google Nexus/Pixel devices
SUBSYSTEM=="usb", ATTR{idVendor}=="18d1", MODE="0666", GROUP="plugdev"
# Samsung devices
SUBSYSTEM=="usb", ATTR{idVendor}=="04e8", MODE="0666", GROUP="plugdev"
# HTC devices
SUBSYSTEM=="usb", ATTR{idVendor}=="0bb4", MODE="0666", GROUP="plugdev"
# Motorola devices
SUBSYSTEM=="usb", ATTR{idVendor}=="22b8", MODE="0666", GROUP="plugdev"
# LG devices
SUBSYSTEM=="usb", ATTR{idVendor}=="1004", MODE="0666", GROUP="plugdev"
# Huawei devices
SUBSYSTEM=="usb", ATTR{idVendor}=="12d1", MODE="0666", GROUP="plugdev"
# Generic Android devices
SUBSYSTEM=="usb", ATTR{idVendor}=="18d1", ATTR{idProduct}=="4ee7", MODE="0666", GROUP="plugdev"
EOF
```

### **3. Recarregar Regras UDEV**
```bash
sudo udevadm control --reload-rules && sudo udevadm trigger
```

### **4. Reiniciar Servidor ADB**
```bash
adb kill-server && adb start-server
```

### **5. Verificar Dispositivo**
```bash
adb devices
```

**Resultado esperado:**
```bash
List of devices attached
irsgaiscr4j7cenv        device
```

---

## 📱 **CONFIGURAÇÃO DO DISPOSITIVO**

### **🔧 Habilitar Depuração USB**
1. Ir em **Configurações** > **Sobre o telefone**
2. Tocar 7 vezes em **Número da versão**
3. Voltar para **Configurações** > **Opções do desenvolvedor**
4. Ativar **Depuração USB**
5. Conectar dispositivo via USB
6. Autorizar depuração no dispositivo

### **🔗 Conectar Dispositivo**
```bash
# Verificar se está conectado
lsusb | grep -i android

# Verificar dispositivos ADB
adb devices
```

---

## 🧪 **TESTE DE FUNCIONAMENTO**

### **📱 Instalar APK**
```bash
# Instalar APK no dispositivo
adb install -r app-release.apk

# Verificar se foi instalado
adb shell pm list packages | grep leaf
```

### **🔍 Logs do Dispositivo**
```bash
# Ver logs em tempo real
adb logcat

# Filtrar logs do app
adb logcat | grep "Leaf"
```

---

## 🚀 **EXPO DEVELOPMENT**

### **📱 Expo Go**
```bash
# Iniciar servidor Expo
cd mobile-app
npx expo start --dev-client

# Escanear QR code no dispositivo
# Ou pressionar 'a' para abrir no Android
```

### **🔧 Expo CLI**
```bash
# Instalar Expo CLI globalmente
npm install -g @expo/cli

# Verificar dispositivos
expo devices

# Abrir no dispositivo
expo start --android
```

---

## 🔧 **TROUBLESHOOTING**

### **❌ Dispositivo não aparece**
```bash
# Verificar se está conectado
lsusb

# Reiniciar ADB
adb kill-server && adb start-server

# Verificar permissões
groups $USER
```

### **❌ Permissões insuficientes**
```bash
# Adicionar usuário ao grupo novamente
sudo usermod -a -G plugdev $LOGNAME

# Fazer logout e login novamente
# Ou executar:
newgrp plugdev
```

### **❌ Regras udev não funcionam**
```bash
# Verificar regras criadas
cat /etc/udev/rules.d/51-android.rules

# Recarregar regras
sudo udevadm control --reload-rules
sudo udevadm trigger
```

---

## 📋 **COMANDOS ÚTEIS**

### **🔍 Diagnóstico**
```bash
# Verificar dispositivos USB
lsusb

# Verificar dispositivos ADB
adb devices

# Verificar grupos do usuário
groups $USER

# Verificar regras udev
ls -la /etc/udev/rules.d/51-android.rules
```

### **🔧 Manutenção**
```bash
# Reiniciar ADB
adb kill-server && adb start-server

# Recarregar regras udev
sudo udevadm control --reload-rules

# Verificar permissões do dispositivo
ls -la /dev/bus/usb/
```

---

## 🎯 **PRÓXIMOS PASSOS**

### **✅ Configuração Concluída**
- ADB funcionando corretamente
- Dispositivo reconhecido
- Permissões configuradas

### **🚀 Desenvolvimento**
```bash
# Iniciar desenvolvimento
cd mobile-app
npx expo start --dev-client

# Testar no dispositivo
# Escanear QR code ou pressionar 'a'
```

---

## 📞 **SUPORTE**

Se o problema persistir:
1. Verificar se o dispositivo está conectado via USB
2. Verificar se a depuração USB está ativada
3. Verificar se o usuário está no grupo `plugdev`
4. Recarregar regras udev
5. Reiniciar servidor ADB

**🎉 Agora você pode desenvolver e testar no dispositivo físico!** 