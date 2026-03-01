# 📋 Como Usar o Monitor de Logs

## 🚀 **VERSÃO RECOMENDADA (Mais Simples)**

```bash
./monitorar-logs.sh
```

**Esta versão é a mais simples e robusta!**

---

## 📋 **OUTRAS VERSÕES (Se a simples não funcionar)**

### **Versão Completa (com estatísticas):**
```bash
./monitorar-logs-completo.sh
```

### **Versão Direta:**
```bash
./monitorar-logs-direto.sh
```

### **Versão SSH:**
```bash
./monitorar-logs-ssh.sh
```

---

## 🔧 **SE DER ERRO**

### **Erro de Conexão SSH:**
- Verificar se servidor está acessível
- Verificar credenciais SSH

### **Erro "Arquivo não encontrado":**
- O servidor pode estar usando outro caminho
- Verificar manualmente: `ssh root@216.238.107.59 "ls -la /home/leaf/leaf-websocket-backend/server.log"`

### **Alternativa Manual:**
```bash
# Conectar manualmente e monitorar
ssh root@216.238.107.59
tail -f /home/leaf/leaf-websocket-backend/server.log | grep -E "(authenticate|createBooking|Dispatcher|newRideRequest)"
```

---

## ✅ **RECOMENDAÇÃO**

**Use a versão simples primeiro:**
```bash
./monitorar-logs.sh
```

Se funcionar, deixe rodando e faça o teste!


