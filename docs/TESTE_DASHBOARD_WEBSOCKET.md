# 🧪 TESTE DASHBOARD WEBSOCKET - GUIA COMPLETO

**Data:** 16/12/2025  
**Status:** ⚠️ **PENDENTE - Requer servidor rodando**

---

## ⚠️ **PRÉ-REQUISITOS**

Antes de executar os testes, é necessário:

1. **Servidor rodando** na porta 3001
2. **Usuário admin criado no Firestore** (collection: `adminUsers`)
3. **Dashboard WebSocket Service inicializado** no servidor

---

## 🔧 **VERIFICAR SE DASHBOARD WEBSOCKET ESTÁ INICIALIZADO**

O servidor deve mostrar no log:
```
✅ Dashboard WebSocket Service inicializado
```

Se não aparecer, verifique se a inicialização foi adicionada em `server.js`:
```javascript
const DashboardWebSocketService = require('./services/dashboard-websocket');
const dashboardWebSocketService = new DashboardWebSocketService(io);
```

---

## 🧪 **EXECUTAR TESTES**

```bash
cd leaf-websocket-backend
node test-dashboard-websocket.js
```

**Variáveis de ambiente opcionais:**
```bash
API_URL=http://localhost:3001 \
WS_URL=http://localhost:3001 \
TEST_ADMIN_EMAIL=admin@leaf.com \
TEST_ADMIN_PASSWORD=sua-senha \
node test-dashboard-websocket.js
```

---

## ✅ **TESTES IMPLEMENTADOS**

1. **Login JWT** - Testa autenticação com email/senha
2. **Conexão WebSocket** - Testa conexão ao namespace `/dashboard`
3. **Autenticação WebSocket** - Testa autenticação JWT via WebSocket
4. **Eventos de Métricas** - Testa recebimento de eventos
5. **Atualizações Periódicas** - Testa eventos periódicos (5 segundos)

---

## 📊 **RESULTADO ESPERADO**

```
✅ Login: PASSOU
✅ websocketConnection: PASSOU
✅ periodicUpdates: PASSOU

✅ 3/3 testes passaram
```

---

## 🔍 **TROUBLESHOOTING**

### **Erro: "connect ECONNREFUSED"**
- Verifique se o servidor está rodando: `ps aux | grep "node server.js"`
- Verifique se a porta 3001 está livre: `netstat -tuln | grep 3001`
- Inicie o servidor: `npm start`

### **Erro: "authentication_error"**
- Verifique se o usuário admin existe no Firestore
- Verifique se o token JWT é válido
- Verifique se o campo `active: true` no Firestore

### **Erro: "Nenhum evento recebido"**
- Verifique se `DashboardWebSocketService` está inicializado
- Verifique se `startPeriodicUpdates()` está sendo chamado
- Verifique os logs do servidor para erros

---

## 📝 **NOTAS**

- Os testes aguardam até 10 segundos para eventos periódicos
- Se o servidor não estiver emitindo eventos, os testes ainda podem passar (conexão OK)
- Certifique-se de que o servidor foi reiniciado após adicionar `DashboardWebSocketService`

---

**Última atualização:** 16/12/2025



