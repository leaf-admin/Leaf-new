# 🔐 Alterar Senha de Usuário Admin

## 📋 Usuários Admin Encontrados

1. **izaak.dias@hotmail.com** (super-admin)
2. **admin.g@leaf.app.br** (super-admin)

---

## 🚀 Como Usar

### **Opção 1: Modo Interativo**

```bash
cd leaf-websocket-backend
node scripts/change-admin-password.js
```

O script irá:
1. Listar todos os usuários admin
2. Pedir o email do usuário
3. Pedir a nova senha
4. Confirmar a senha
5. Atualizar no Firestore

### **Opção 2: Linha de Comando**

```bash
node scripts/change-admin-password.js \
  --email admin.g@leaf.app.br \
  --password novaSenha123
```

### **Opção 3: Listar Usuários**

```bash
node scripts/change-admin-password.js --list
```

---

## 📝 Exemplos

### Alterar senha do admin.g@leaf.app.br:

```bash
cd leaf-websocket-backend
node scripts/change-admin-password.js \
  --email admin.g@leaf.app.br \
  --password suaNovaSenha123
```

### Alterar senha do izaak.dias@hotmail.com:

```bash
cd leaf-websocket-backend
node scripts/change-admin-password.js \
  --email izaak.dias@hotmail.com \
  --password suaNovaSenha123
```

---

## ⚠️ Importante

- ✅ Senha mínima: 6 caracteres (recomendado: 12+)
- ✅ Senha é armazenada como hash bcrypt (seguro)
- ✅ Guarde a nova senha em local seguro
- ✅ Após alterar, faça login no dashboard com a nova senha

---

## 🧪 Testar Login

Após alterar a senha, teste o login:

```bash
curl -X POST http://147.93.66.253:3001/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin.g@leaf.app.br",
    "password": "suaNovaSenha123"
  }'
```

Ou acesse o dashboard: `http://localhost:3000/login`


