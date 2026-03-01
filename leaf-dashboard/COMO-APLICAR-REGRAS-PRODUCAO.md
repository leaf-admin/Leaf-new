# 🔐 Como Aplicar Regras de Produção no Firestore

## 📋 Passo a Passo

### 1. Acessar o Console do Firebase

1. Vá para: https://console.firebase.google.com/
2. Selecione o projeto: **leaf-reactnative**
3. No menu lateral, clique em **Firestore Database**
4. Clique na aba **Regras**

### 2. Aplicar as Regras

1. Abra o arquivo `firestore.rules` desta pasta
2. Copie TODO o conteúdo
3. Cole no editor de regras do Firebase Console
4. Clique em **Publicar**

### 3. Verificar se Funcionou

Após publicar, aguarde alguns segundos e:

1. Recarregue a página do dashboard
2. Faça logout e login novamente
3. O dashboard deve funcionar normalmente

## 🔒 Segurança das Regras

As regras de produção implementam:

### ✅ Controle de Acesso Baseado em Roles

- **Super-Admin**: Acesso total, pode criar/deletar admins
- **Admin**: Acesso de leitura/escrita em todas as coleções
- **Viewer**: Apenas leitura (se implementado)

### ✅ Verificação de Claims Customizadas

As regras verificam:
- `request.auth.token.admin == true`
- `request.auth.token.role in ['admin', 'super-admin']`

### ✅ Proteção por Coleção

Cada coleção tem regras específicas:
- **adminUsers**: Apenas o próprio usuário ou admins podem ler
- **ride_payments**: Apenas super-admin pode modificar
- **user_locations**: Apenas leitura para admins, escrita bloqueada

### ✅ Negação por Padrão

Qualquer coleção não especificada é negada por padrão (segurança máxima).

## ⚠️ Importante

### Claims Customizadas

Para as regras funcionarem, os usuários admin precisam ter **claims customizadas** configuradas no token Firebase.

Execute o script para garantir que as claims estão configuradas:

```bash
cd leaf-websocket-backend
node scripts/verify-admin-user.js seu-email@exemplo.com
```

### Logout/Login Necessário

Após configurar claims, o usuário precisa:
1. Fazer **logout** do dashboard
2. Fazer **login** novamente
3. As claims são incluídas no token JWT no momento do login

## 🧪 Testar as Regras

### Teste 1: Acesso Admin
- Login como admin
- Deve conseguir ler/escrever em todas as coleções permitidas

### Teste 2: Acesso Negado
- Tentar acessar coleção não permitida
- Deve retornar erro de permissão

### Teste 3: Proteção de Dados Sensíveis
- Verificar que `ride_payments` só pode ser modificado por super-admin
- Verificar que `user_locations` não pode ser escrita pelo frontend

## 📝 Checklist de Produção

Antes de publicar em produção, verifique:

- [ ] Regras publicadas no Firebase Console
- [ ] Claims customizadas configuradas para todos os admins
- [ ] Testado login/logout de admins
- [ ] Verificado que usuários não-admin não conseguem acessar
- [ ] Backup das regras antigas (se houver)
- [ ] Documentação atualizada

## 🐛 Troubleshooting

**Erro: "missing or insufficient permissions"**
- Verifique se as claims estão configuradas: `node scripts/verify-admin-user.js`
- Faça logout e login novamente
- Verifique se as regras foram publicadas corretamente

**Erro: "Permission denied"**
- Verifique se o usuário tem role 'admin' ou 'super-admin' no Firestore
- Verifique se as claims customizadas estão no token
- Use o Firebase Console para verificar o documento `adminUsers/{uid}`

**Regras não estão funcionando**
- Aguarde até 1 minuto após publicar (propagação)
- Limpe o cache do navegador
- Verifique se não há erros de sintaxe nas regras no console

## 📚 Referências

- [Documentação Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Custom Claims](https://firebase.google.com/docs/auth/admin/custom-claims)




