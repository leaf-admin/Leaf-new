# 🚀 Guia Rápido - Dashboard Admin

## 📋 **PASSO A PASSO COMPLETO**

### **1. Criar Usuário Admin** ✅

```bash
cd leaf-websocket-backend
npm run admin:create
```

Ou com parâmetros:

```bash
npm run admin:create -- --email admin@leaf.com --password senha123 --name "Administrador" --role super-admin
```

**O que o script faz:**
- ✅ Gera hash bcrypt da senha automaticamente
- ✅ Cria documento no Firestore (`adminUsers` collection)
- ✅ Configura role e permissões
- ✅ Verifica se usuário já existe (pergunta se deseja atualizar)

---

### **2. Reiniciar Servidor** ✅

```bash
# Parar servidor atual
pkill -f "node server.js"

# Iniciar servidor
npm start
# ou
node server.js
```

**Verificar se está rodando:**
```bash
curl http://localhost:3001/api/admin/auth/verify -H "Authorization: Bearer test"
```

---

### **3. Testar Autenticação** ✅

```bash
npm run admin:test
```

Ou manualmente:

```bash
node test-admin-auth.js
```

**Com variáveis de ambiente:**
```bash
TEST_ADMIN_EMAIL=admin@leaf.com \
TEST_ADMIN_PASSWORD=sua-senha \
npm run admin:test
```

---

### **4. Acessar Dashboard** ✅

1. Iniciar o dashboard:
   ```bash
   cd leaf-dashboard
   npm run dev
   ```

2. Acessar: `http://localhost:3000/login`

3. Fazer login com:
   - Email: `admin@leaf.com` (ou o email que você criou)
   - Senha: `sua-senha`

---

## 🔐 **ENDPOINTS DISPONÍVEIS**

### **Login**
```bash
POST /api/admin/auth/login
Body: { "email": "admin@leaf.com", "password": "senha123" }
```

### **Verificar Token**
```bash
GET /api/admin/auth/verify
Headers: { "Authorization": "Bearer SEU_TOKEN" }
```

### **Renovar Token**
```bash
POST /api/admin/auth/refresh
Body: { "refreshToken": "SEU_REFRESH_TOKEN" }
```

### **Logout**
```bash
POST /api/admin/auth/logout
Headers: { "Authorization": "Bearer SEU_TOKEN" }
```

---

## 📊 **ESTRUTURA DE PERMISSÕES**

### **super-admin**
- `dashboard:read`
- `users:read`, `users:write`
- `rides:read`, `rides:write`
- `reports:read`, `reports:write`
- `system:config`
- `notifications:send`

### **admin**
- `dashboard:read`
- `users:read`
- `rides:read`
- `reports:read`
- `notifications:send`

### **viewer**
- `dashboard:read`

---

## ⚠️ **TROUBLESHOOTING**

### **Erro: "Token não fornecido"**
- Verifique se o token está sendo enviado no header `Authorization: Bearer ...`
- Verifique se o token não expirou (renove com `/api/admin/auth/refresh`)

### **Erro: "Credenciais inválidas"**
- Verifique se o email está correto
- Verifique se a senha está correta
- Verifique se o usuário existe no Firestore
- Verifique se `passwordHash` está configurado no Firestore

### **Erro: "Usuário não encontrado ou inativo"**
- Verifique se o campo `active: true` no Firestore
- Verifique se o documento existe na collection `adminUsers`

### **Erro: "Cannot POST /api/admin/auth/login"**
- Verifique se o servidor está rodando
- Verifique se as rotas foram registradas (procure por "Rotas de Autenticação Admin" no log)
- Reinicie o servidor após adicionar as rotas

---

## 📝 **CHECKLIST**

- [ ] Usuário admin criado no Firestore
- [ ] Servidor reiniciado
- [ ] Rotas `/api/admin/auth/*` registradas
- [ ] Testes passando
- [ ] Dashboard acessível
- [ ] Login funcionando

---

## 🔗 **LINKS ÚTEIS**

- [Plano Completo](./architecture/PLANO_DASHBOARD_ADMIN.md)
- [Implementação Fase 1](./IMPLEMENTACAO_DASHBOARD_ADMIN_FASE1.md)
- [Guia de Testes](./TESTE_DASHBOARD_ADMIN.md)
- [Script de Criação](../leaf-websocket-backend/scripts/README-CRIAR-ADMIN.md)

---

**Última atualização:** 16/12/2025



