# 📝 Script: Criar Perfis de Usuários de Teste no Realtime Database

## 🎯 Objetivo

Este script cria perfis no Realtime Database para usuários de teste que já existem no Firebase Auth mas não têm perfil no Realtime Database.

## 📋 Usuários que serão processados

### Passageiro (Customer)
- **UID:** `gyEGB07CssbnsACPJlywos40yaK2`
- **Telefone:** `+5511999999999`
- **Email:** `joao.teste@leaf.com`
- **Nome:** João Silva Teste

### Motorista (Driver)
- **UID:** `G62Nd6i22GhxhFm9R3PT08d0Ouw2`
- **Telefone:** `+5511888888888`
- **Email:** `maria.teste@leaf.com`
- **Nome:** Maria Santos Teste
- **Veículo:** Honda Civic 2020, Placa ABC1234

---

## 🚀 Como usar

### 1. Navegar até a pasta do script
```bash
cd leaf-websocket-backend
```

### 2. Executar o script
```bash
node scripts/create-test-user-profiles.js
```

### 3. Confirmar atualizações (se necessário)
Se os perfis já existirem, o script perguntará se deseja atualizá-los.

---

## ✅ O que o script faz

1. **Verifica se usuários existem no Firebase Auth**
   - Se não existirem, exibe erro e para

2. **Verifica se perfis já existem no Realtime Database**
   - Se existirem, pergunta se deseja atualizar

3. **Cria/atualiza perfis no Realtime Database**
   - Passageiro: dados completos de customer
   - Motorista: dados completos de driver + veículo

4. **Cria veículo para o motorista**
   - Salva em `vehicles/` e vincula ao perfil

---

## 📊 Dados criados

### Passageiro
- ✅ Perfil completo em `users/gyEGB07CssbnsACPJlywos40yaK2`
- ✅ Status: aprovado
- ✅ Saldo inicial: R$ 500,00
- ✅ Rating: 4.9

### Motorista
- ✅ Perfil completo em `users/G62Nd6i22GhxhFm9R3PT08d0Ouw2`
- ✅ Status: aprovado
- ✅ Veículo aprovado
- ✅ Saldo inicial: R$ 1.000,00
- ✅ Rating: 4.8

---

## 🔍 Verificação

### 1. Firebase Console
1. Acesse: https://console.firebase.google.com
2. Vá em **Realtime Database**
3. Navegue para `users/`
4. Verifique se os dois UIDs existem

### 2. Dashboard
1. Acesse o dashboard admin
2. Vá em **Usuários**
3. Verifique se os dois usuários aparecem na lista

### 3. Teste de Login
1. Abra o app
2. Faça login com:
   - Passageiro: `11999999999` / senha: `teste123`
   - Motorista: `11888888888` / senha: `teste123`
3. Verifique se o login funciona e o perfil carrega

---

## ⚠️ Requisitos

- ✅ Node.js instalado
- ✅ Firebase Admin SDK configurado
- ✅ Arquivo de credenciais em: `leaf-websocket-backend/leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json`
- ✅ Usuários já existem no Firebase Auth

---

## 🐛 Troubleshooting

### Erro: "Usuário não encontrado no Firebase Auth"
- **Solução:** Crie os usuários no Firebase Auth primeiro
- **Como:** Use o Firebase Console ou outro script

### Erro: "Erro ao inicializar Firebase Admin"
- **Solução:** Verifique se o arquivo de credenciais existe
- **Caminho:** `leaf-websocket-backend/leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json`

### Erro: "Permission denied"
- **Solução:** Verifique as permissões do arquivo de credenciais
- **Como:** O arquivo deve ter permissões de leitura

---

## 📝 Notas

- O script **não cria** usuários no Firebase Auth (apenas perfis no Realtime Database)
- O script **não altera** senhas dos usuários
- O script **pode atualizar** perfis existentes (com confirmação)

---

**Criado em:** 2025-01-XX  
**Última atualização:** 2025-01-XX


