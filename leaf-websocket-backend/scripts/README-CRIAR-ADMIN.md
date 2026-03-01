# 📋 Como Criar Usuário Admin

## 🚀 Método Rápido (Interativo)

```bash
cd leaf-websocket-backend
node scripts/create-admin-user.js
```

O script irá solicitar:
- 📧 Email do administrador
- 🔒 Senha
- 👤 Nome completo
- 📋 Role (super-admin, admin ou viewer)

---

## ⚡ Método Rápido (Linha de Comando)

```bash
node scripts/create-admin-user.js \
  --email admin@leaf.com \
  --password senha123 \
  --name "Administrador" \
  --role super-admin
```

---

## 📋 Roles Disponíveis

### **super-admin** (Acesso Total)
- ✅ Dashboard: leitura
- ✅ Usuários: leitura e escrita
- ✅ Corridas: leitura e escrita
- ✅ Relatórios: leitura e escrita
- ✅ Sistema: configuração
- ✅ Notificações: envio

### **admin** (Acesso Administrativo)
- ✅ Dashboard: leitura
- ✅ Usuários: leitura
- ✅ Corridas: leitura
- ✅ Relatórios: leitura
- ✅ Notificações: envio

### **viewer** (Somente Leitura)
- ✅ Dashboard: leitura

---

## 🔐 Segurança

- ✅ Senhas são armazenadas como hash bcrypt (10 rounds)
- ✅ Hash é gerado automaticamente pelo script
- ✅ Senha nunca é exibida após criação (apenas na criação)

---

## ⚠️ Importante

1. **Guarde as credenciais** em local seguro após criar o usuário
2. **Não compartilhe** as credenciais
3. **Use senhas fortes** (mínimo 6 caracteres, recomendado 12+)
4. **Desative usuários** que não precisam mais de acesso (campo `active: false`)

---

## 🔄 Atualizar Usuário Existente

Se o email já existe, o script perguntará se deseja atualizar:

```bash
⚠️  Usuário já existe!
   ID: abc123
   Email: admin@leaf.com
   Role: super-admin
   Ativo: Sim

Deseja atualizar este usuário? (s/N):
```

Digite `s` para atualizar ou `N` para cancelar.

---

## 🧪 Testar Login

Após criar o usuário, teste o login:

```bash
node test-admin-auth.js
```

Ou use curl:

```bash
curl -X POST http://localhost:3001/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@leaf.com",
    "password": "sua-senha"
  }'
```

---

## 📝 Estrutura no Firestore

O script cria um documento na collection `adminUsers`:

```json
{
  "email": "admin@leaf.com",
  "displayName": "Administrador",
  "name": "Administrador",
  "role": "super-admin",
  "permissions": [
    "dashboard:read",
    "users:read",
    "users:write",
    ...
  ],
  "passwordHash": "$2a$10$...",
  "active": true,
  "createdAt": "2025-12-16T00:00:00Z",
  "lastLogin": null
}
```

---

**Última atualização:** 16/12/2025
