# 🧪 TESTE DASHBOARD ADMIN - AUTENTICAÇÃO JWT

**Data:** 16/12/2025  
**Status:** ⚠️ **PENDENTE - Requer configuração**

---

## ⚠️ **PRÉ-REQUISITOS**

Antes de executar os testes, é necessário:

1. **Servidor rodando** na porta 3001
2. **Usuário admin criado no Firestore** (collection: `adminUsers`)
3. **Senha com hash bcrypt** configurada

---

## 📋 **COMO CRIAR USUÁRIO ADMIN**

### **1. Gerar hash da senha**

```javascript
const bcrypt = require('bcryptjs');
const hash = await bcrypt.hash('sua-senha-aqui', 10);
console.log(hash);
```

### **2. Criar documento no Firestore**

**Collection:** `adminUsers`  
**Document ID:** Qualquer (ex: `admin1`)

```json
{
  "email": "admin@leaf.com",
  "displayName": "Administrador",
  "role": "super-admin",
  "permissions": [
    "dashboard:read",
    "users:read",
    "users:write",
    "rides:read",
    "rides:write",
    "reports:read",
    "reports:write",
    "system:config",
    "notifications:send"
  ],
  "passwordHash": "$2a$10$...", // Hash gerado no passo 1
  "active": true,
  "createdAt": "2025-12-16T00:00:00Z",
  "lastLogin": null
}
```

---

## 🧪 **EXECUTAR TESTES**

```bash
cd leaf-websocket-backend
node test-admin-auth.js
```

**Variáveis de ambiente opcionais:**
```bash
API_URL=http://localhost:3001 \
TEST_ADMIN_EMAIL=admin@leaf.com \
TEST_ADMIN_PASSWORD=sua-senha \
node test-admin-auth.js
```

---

## ✅ **TESTES IMPLEMENTADOS**

1. **Login** - Testa autenticação com email/senha
2. **Verificar Token** - Testa validação de access token
3. **Refresh Token** - Testa renovação de token
4. **Logout** - Testa invalidação de tokens
5. **Credenciais Inválidas** - Testa rejeição de credenciais erradas
6. **Token Inválido** - Testa rejeição de token inválido

---

## 🔧 **CORREÇÕES APLICADAS**

- ✅ Corrigido erro de sintaxe no `server.js` (linha 1689)
- ✅ Removida duplicação de `driverId` no handler `rejectRide`
- ✅ Estrutura de try-catch verificada e corrigida

---

## 📝 **NOTAS**

- O servidor precisa ser reiniciado após criar o usuário admin
- Certifique-se de que o Firebase está configurado corretamente
- As rotas `/api/admin/auth/*` devem estar registradas no servidor

---

**Última atualização:** 16/12/2025



