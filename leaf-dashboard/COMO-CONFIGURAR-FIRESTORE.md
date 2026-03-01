# 🔐 Como Configurar Regras do Firestore para o Dashboard

## ❌ Problema

Se você está recebendo o erro:
```
FirebaseError: missing or insufficient permissions
```

Isso significa que as regras de segurança do Firestore estão bloqueando o acesso.

## ✅ Solução

### Opção 1: Configurar Regras no Console do Firebase (Recomendado)

1. Acesse o [Console do Firebase](https://console.firebase.google.com/)
2. Selecione o projeto: **leaf-reactnative**
3. Vá em **Firestore Database** → **Regras**
4. Cole as regras do arquivo `firestore.rules` que está nesta pasta
5. Clique em **Publicar**

### Opção 2: Regras Temporárias para Desenvolvimento

Se você está apenas desenvolvendo/testando, pode usar regras mais permissivas temporariamente:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // ATENÇÃO: Estas regras permitem acesso total para usuários autenticados
    // USE APENAS EM DESENVOLVIMENTO!
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

⚠️ **IMPORTANTE**: Remova essas regras permissivas antes de ir para produção!

### Opção 3: Verificar/Criar Documento Admin

Execute o script de verificação:

```bash
cd leaf-websocket-backend
node scripts/verify-admin-user.js seu-email@exemplo.com
```

Este script vai:
- Verificar se o usuário existe no Firebase Auth
- Verificar se o documento existe no Firestore
- Criar o documento se não existir
- Configurar claims customizadas

## 📋 Regras Recomendadas (Produção)

As regras em `firestore.rules` incluem:

1. **adminUsers**: Permite leitura/escrita para o próprio usuário ou admins
2. **users**: Permite acesso apenas para admins
3. **rides**: Permite acesso apenas para admins
4. **Fallback temporário**: Permite acesso total para desenvolvimento (remover em produção)

## 🔍 Verificar se Funcionou

Após configurar as regras:

1. Recarregue a página do dashboard
2. Faça login novamente
3. O erro de permissões deve desaparecer

## 🐛 Troubleshooting

**Erro persiste após configurar regras:**
- Verifique se as regras foram publicadas no console
- Aguarde alguns segundos (pode levar até 1 minuto para propagar)
- Limpe o cache do navegador
- Faça logout e login novamente

**Documento não existe:**
- Execute: `node scripts/verify-admin-user.js seu-email@exemplo.com`
- Ou execute: `node scripts/create-admin-user.js` novamente

**Claims não funcionam:**
- O usuário precisa fazer logout e login novamente após as claims serem configuradas
- As claims são incluídas no token JWT, que é renovado no login




