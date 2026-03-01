# 🧪 GUIA DE TESTES LOCAIS

**Objetivo:** Validar que a refatoração está funcionando corretamente com o servidor rodando.

---

## 📋 PRÉ-REQUISITOS

1. **Redis rodando:**
   ```bash
   redis-server
   # ou
   docker run -d -p 6379:6379 redis
   ```

2. **Firebase configurado:**
   - Arquivo de credenciais presente
   - Variáveis de ambiente configuradas

3. **Dependências instaladas:**
   ```bash
   cd leaf-websocket-backend
   npm install
   ```

---

## 🚀 EXECUTANDO OS TESTES

### **1. Iniciar o Servidor**

Em um terminal:

```bash
cd leaf-websocket-backend
node server.js
```

Aguarde até ver:
```
✅ Servidor rodando na porta 3001
✅ Socket.IO inicializado
✅ EventBus e Listeners configurados
```

### **2. Executar Testes Básicos**

Em outro terminal:

```bash
cd leaf-websocket-backend
node scripts/tests/test-local-server.js
```

**O que testa:**
- ✅ Conexão ao servidor
- ✅ Autenticação (cliente e motorista)
- ✅ createBooking com idempotency
- ✅ Publicação de eventos

### **3. Executar Teste de Fluxo Completo**

```bash
cd leaf-websocket-backend
node scripts/tests/test-local-full-flow.js
```

**O que testa:**
- ✅ Cliente cria corrida
- ✅ Motorista aceita corrida
- ✅ Motorista inicia viagem
- ✅ Motorista finaliza viagem
- ✅ Eventos sendo publicados
- ✅ Listeners executando
- ✅ Notificações sendo enviadas

---

## 📊 RESULTADOS ESPERADOS

### **Teste Básico:**
```
✅ Conexão - Conectar ao servidor
✅ Autenticação - Autenticar cliente
✅ Autenticação - Autenticar motorista
✅ createBooking - Criar corrida com idempotency
✅ EventBus - Verificar que eventos são publicados

📊 RESULTADO: 5 passou, 0 falhou
✅ TODOS OS TESTES LOCAIS PASSARAM!
```

### **Teste de Fluxo Completo:**
```
1️⃣ Conectando cliente e motorista...
✅ Cliente e motorista conectados

2️⃣ Cliente criando corrida...
✅ Corrida criada: booking_1234567890_customer_123

3️⃣ Motorista aceitando corrida...
✅ Cliente notificado sobre aceitação
✅ Corrida aceita: booking_1234567890_customer_123

4️⃣ Motorista iniciando viagem...
✅ Cliente notificado sobre início da viagem
✅ Viagem iniciada: booking_1234567890_customer_123

5️⃣ Motorista finalizando viagem...
✅ Cliente notificado sobre finalização da viagem
✅ Viagem finalizada: booking_1234567890_customer_123

✅ FLUXO COMPLETO TESTADO COM SUCESSO!
```

---

## 🔍 TROUBLESHOOTING

### **Erro: "Servidor não está rodando"**

**Solução:**
1. Verifique se o servidor está rodando na porta 3001
2. Verifique se há erros no console do servidor
3. Tente ajustar `SERVER_URL`:
   ```bash
   SERVER_URL=http://localhost:3001 node scripts/tests/test-local-server.js
   ```

### **Erro: "Timeout na autenticação"**

**Solução:**
1. Verifique se o handler `authenticate` está registrado
2. Verifique logs do servidor para erros de autenticação
3. Verifique se Redis está conectado

### **Erro: "Evento não foi recebido"**

**Solução:**
1. Verifique se EventBus está configurado
2. Verifique se listeners estão registrados
3. Verifique logs do servidor para eventos publicados

### **Erro: "Falha ao criar corrida"**

**Solução:**
1. Verifique se Redis está conectado
2. Verifique se geofence está configurado corretamente
3. Verifique logs do servidor para erros específicos

---

## 📝 OBSERVAÇÕES

1. **Idempotency:** O teste valida que requisições duplicadas retornam resultado cached
2. **Eventos:** O teste valida que eventos são publicados e recebidos pelos listeners
3. **Notificações:** O teste valida que cliente e motorista recebem notificações
4. **Fluxo Completo:** O teste valida todo o ciclo de vida de uma corrida

---

## 🎯 PRÓXIMOS PASSOS

Após testes locais bem-sucedidos:

1. ✅ Validar logs do servidor
2. ✅ Verificar métricas do Redis
3. ✅ Validar eventos no EventBus
4. ✅ Preparar para deploy na VPS

---

**Última atualização:** 2025-01-XX

