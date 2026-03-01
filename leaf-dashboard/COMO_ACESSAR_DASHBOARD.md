# 🚀 Como Acessar o Dashboard Leaf

## 📍 URL de Acesso

**Dashboard:** http://147.93.66.253:3002

## 🔐 Autenticação

O dashboard suporta **dois métodos de autenticação**:

### 1️⃣ **JWT (Prioridade)**
- Tenta fazer login via API do backend (`/api/admin/auth/login`)
- Usa tokens JWT armazenados no localStorage
- **Usuários criados via script `create-admin-user.js`**

### 2️⃣ **Firebase Auth (Fallback)**
- Se JWT falhar, tenta Firebase Auth
- Busca permissões no Firestore (`adminUsers` collection)
- **Usuários criados no Firebase Authentication**

## ✅ Seus Usuários Admin Existentes

**SIM, seus usuários admin continuam válidos!**

O sistema funciona assim:

1. **Primeiro tenta JWT** (se você criou via script `create-admin-user.js`)
2. **Se falhar, tenta Firebase Auth** (se você criou no Firebase Console)
3. **Busca permissões no Firestore** (`adminUsers` collection)

### Como Verificar seus Usuários

#### Usuários JWT (criados via script):
```bash
# No backend
cd leaf-websocket-backend
node scripts/create-admin-user.js --list
```

#### Usuários Firebase Auth:
- Acesse Firebase Console → Authentication
- Ou use o script para listar:
```bash
cd leaf-websocket-backend
node scripts/create-admin-user.js --list
```

## 🔧 Se Não Conseguir Fazer Login

### Opção 1: Alterar Senha (JWT)
```bash
cd leaf-websocket-backend
node scripts/change-admin-password.js --email seu@email.com --password novaSenha
```

### Opção 2: Criar Novo Usuário Admin
```bash
cd leaf-websocket-backend
node scripts/create-admin-user.js
```

## 📱 Interface

O dashboard agora usa:
- ✅ **JavaScript puro** (sem TypeScript)
- ✅ **shadcn/ui** (componentes modernos)
- ✅ **Tailwind CSS** (estilização)
- ✅ **Lucide React** (ícones)

## 🐛 Problemas Comuns

### Dashboard não carrega
```bash
# Verificar status na VPS
ssh root@147.93.66.253
cd /opt/leaf-dashboard
pm2 status leaf-dashboard
pm2 logs leaf-dashboard
```

### Erro 404
- Verifique se o PM2 está rodando: `pm2 status`
- Reinicie: `pm2 restart leaf-dashboard`

### Erro de autenticação
- Verifique se o backend está rodando na porta 3001
- Verifique se o usuário existe no Firestore ou foi criado via script

## 🔗 URLs Importantes

- **Dashboard:** http://147.93.66.253:3002
- **Backend API:** http://147.93.66.253:3001
- **WebSocket:** ws://147.93.66.253:3001

## 📝 Notas

- O dashboard redireciona automaticamente de `/` para `/dashboard`
- Se já estiver logado, redireciona automaticamente para `/dashboard`
- A página de login está em `/login`


