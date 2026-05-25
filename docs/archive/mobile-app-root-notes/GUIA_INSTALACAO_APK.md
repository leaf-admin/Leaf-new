# 📱 Guia de Instalação do APK Leaf

## 🎯 **APK Disponível:**
- **Arquivo:** `leaf-app-latest.apk` (84MB)
- **Versão:** Release (04/09/2025)
- **Compatibilidade:** Android 5.0+ (API 21+)

---

## 🚀 **Métodos de Instalação**

### **1. Via ADB (Recomendado para Desenvolvedores)**

```bash
# Verificar dispositivos conectados
adb devices

# Instalar APK
adb install leaf-app-latest.apk

# Ou forçar reinstalação
adb install -r leaf-app-latest.apk

# Abrir o app
adb shell am start -n br.com.leaf.ride/.MainActivity
```

### **2. Instalação Manual (Usuários Finais)**

1. **Transferir APK para o dispositivo:**
   - Conectar via USB e copiar arquivo
   - Enviar por WhatsApp/Email
   - Upload para Google Drive/Dropbox

2. **Habilitar instalação de fontes desconhecidas:**
   - Configurações > Segurança > Fontes desconhecidas
   - Ou Configurações > Apps > Acesso especial > Instalar apps desconhecidos

3. **Instalar APK:**
   - Abrir arquivo APK no dispositivo
   - Tocar em "Instalar"
   - Aguardar conclusão

---

## 🔧 **Teste Automático em Múltiplos Dispositivos**

### **Script Automatizado:**
```bash
# Executar teste em todos os dispositivos conectados
./test-apk-multiple-devices.sh
```

### **Teste Manual por Dispositivo:**
```bash
# Para cada dispositivo
adb -s [DEVICE_ID] install leaf-app-latest.apk
adb -s [DEVICE_ID] shell am start -n br.com.leaf.ride/.MainActivity
```

---

## 🧪 **Verificação de Funcionamento**

### **1. Verificar se o app está instalado:**
```bash
adb shell pm list packages | grep leaf
# Deve retornar: package:br.com.leaf.ride
```

### **2. Verificar se o app está rodando:**
```bash
adb shell ps | grep br.com.leaf.ride
```

### **3. Verificar logs do Firebase/FCM:**
```bash
adb logcat | grep -E "(FCM|Firebase|Token|Notification|Leaf)"
```

### **4. Testar notificações:**
```bash
# Enviar notificação de teste
curl -X POST http://216.238.107.59:3003/api/send-notification \
  -H "Content-Type: application/json" \
  -d '{
    "token": "SEU_TOKEN_FCM_AQUI",
    "title": "🎉 Teste de Notificação",
    "body": "APK funcionando corretamente!",
    "data": {"test": "true"}
  }'
```

---

## 📋 **Checklist de Instalação**

- [ ] Dispositivo Android 5.0+ (API 21+)
- [ ] USB Debugging habilitado (para ADB)
- [ ] Fontes desconhecidas habilitadas (para instalação manual)
- [ ] Conexão com internet (para Firebase/FCM)
- [ ] APK transferido para o dispositivo
- [ ] App instalado com sucesso
- [ ] App abre sem erros
- [ ] Firebase inicializa corretamente
- [ ] Token FCM é gerado
- [ ] Notificações funcionam

---

## 🐛 **Solução de Problemas**

### **Erro: "App não instalado"**
- Verificar se o dispositivo é compatível (Android 5.0+)
- Habilitar "Fontes desconhecidas"
- Verificar espaço disponível no dispositivo

### **Erro: "Package not found"**
- Verificar se o APK foi transferido corretamente
- Tentar reinstalar: `adb install -r leaf-app-latest.apk`

### **App não abre:**
- Verificar logs: `adb logcat | grep -E "(Leaf|Error|Exception)"`
- Verificar permissões do app
- Reiniciar o dispositivo

### **Notificações não funcionam:**
- Verificar conexão com internet
- Verificar se o token FCM está sendo gerado
- Verificar configurações de notificação do dispositivo

---

## 📞 **Suporte**

Para problemas técnicos:
1. Verificar logs do dispositivo
2. Testar em outro dispositivo
3. Verificar configurações de rede
4. Contatar suporte técnico

---

## 🎉 **Próximos Passos**

Após instalação bem-sucedida:
1. Testar funcionalidades básicas do app
2. Verificar notificações push
3. Testar integração com backend
4. Coletar feedback dos usuários
5. Planejar próximas atualizações


