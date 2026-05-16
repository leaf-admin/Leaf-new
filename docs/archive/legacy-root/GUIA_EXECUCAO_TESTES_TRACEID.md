# 🧪 GUIA DE EXECUÇÃO - TESTES DE RASTREAMENTO traceId

## ⚠️ PRÉ-REQUISITOS

Antes de executar os testes, é **ESSENCIAL** que o servidor esteja rodando.

---

## 🚀 PASSO A PASSO

### 1. Iniciar o Servidor

**Terminal 1 - Servidor:**
```bash
cd leaf-websocket-backend
npm start
# ou
node server.js
```

**Aguarde até ver:**
```
✅ Servidor rodando na porta 3000 (ou 3001)
✅ Socket.IO configurado
✅ Redis conectado
✅ Firebase inicializado
```

### 2. Verificar Conexão

**Verificar se o servidor está respondendo:**
```bash
curl http://localhost:3000/health
# ou
curl http://localhost:3001/health
```

**Deve retornar JSON com status "healthy"**

### 3. Executar os Testes

**Terminal 2 - Testes:**
```bash
cd leaf-websocket-backend
node scripts/tests/test-traceid-completo.js
```

### 4. Configurar URL do Servidor (se necessário)

Se o servidor estiver em outra porta ou URL:

```bash
SERVER_URL=http://localhost:3001 node scripts/tests/test-traceid-completo.js
```

---

## 📊 INTERPRETAÇÃO DOS RESULTADOS

### ✅ Teste Bem-Sucedido

```
✅ Handlers com traceId: 1/1
✅ Commands com traceId: 1/1
✅ Events com traceId: 1/1
✅ Listeners com traceId: 1/1
✅ Operações Externas com traceId: 1/1

📈 Taxa de Sucesso: 100.0%

🎉 TODOS OS TESTES PASSARAM! Sistema 100% rastreável!
```

### ❌ Erro de Conexão

```
❌ Erro de conexão: websocket error
```

**Causa:** Servidor não está rodando ou não está acessível.

**Solução:**
1. Verificar se o servidor está rodando
2. Verificar a porta (3000 ou 3001)
3. Verificar firewall/redes
4. Verificar logs do servidor para erros

### ⚠️ Testes Parciais

```
✅ Handlers com traceId: 0/1
✅ Commands com traceId: 1/1
```

**Causa:** Alguns testes requerem conexão WebSocket ativa.

**Solução:**
- Verificar se o servidor está rodando
- Verificar se Socket.IO está configurado corretamente
- Verificar logs do servidor

---

## 🔍 VALIDAÇÃO MANUAL

### 1. Verificar Logs do Servidor

Durante a execução dos testes, monitore os logs do servidor:

```bash
# Terminal 1 - Servidor (já deve estar rodando)
# Os logs devem mostrar:
# - [traceId:xxx] createBooking iniciado
# - [traceId:xxx] RequestRideCommand.execute iniciado
# - [traceId:xxx] Evento ride.requested publicado
# - [traceId:xxx] Listener notifyDrivers acionado
```

### 2. Filtrar Logs por traceId

Após executar um teste, você pode filtrar os logs:

```bash
# No arquivo de logs
grep "traceId:abc-123" logs/combined.log

# Ou no console (se estiver logando no console)
# Procure por [traceId:abc-123] nos logs
```

### 3. Verificar Estrutura dos Logs

Os logs devem ter o formato:

```json
{
  "timestamp": "2024-01-15 10:30:45",
  "level": "info",
  "message": "createBooking iniciado",
  "traceId": "abc-123-def-456",
  "userId": "customer-1",
  "eventType": "createBooking",
  "service": "leaf-websocket-backend"
}
```

---

## 🐛 TROUBLESHOOTING

### Erro: "Cannot connect to server"

**Possíveis causas:**
1. Servidor não está rodando
2. Porta incorreta
3. Firewall bloqueando conexão
4. Servidor em outro host

**Soluções:**
```bash
# Verificar se servidor está rodando
ps aux | grep "node.*server"

# Verificar porta
netstat -tuln | grep 3000

# Testar conexão
curl http://localhost:3000/health

# Verificar logs do servidor
tail -f logs/combined.log
```

### Erro: "traceId não encontrado"

**Possíveis causas:**
1. Middleware não está registrado
2. Handler não está usando extractTraceIdFromEvent
3. traceContext não está funcionando

**Soluções:**
1. Verificar se `io.use(traceIdSocketMiddleware)` está no server.js
2. Verificar se `app.use(traceIdExpressMiddleware)` está no server.js
3. Verificar se handlers usam `extractTraceIdFromEvent(data, socket)`
4. Verificar logs do servidor para erros

### Erro: "traceId diferente"

**Possíveis causas:**
1. Servidor gerando novo traceId
2. traceId não está sendo propagado corretamente

**Soluções:**
1. Verificar se o handler está usando o traceId recebido
2. Verificar se traceContext.runWithTraceId está sendo usado
3. Verificar logs do servidor para ver qual traceId está sendo usado

---

## 📝 CHECKLIST ANTES DE EXECUTAR

- [ ] Servidor está rodando
- [ ] Redis está conectado
- [ ] Firebase está inicializado
- [ ] Porta do servidor está correta (3000 ou 3001)
- [ ] Logs do servidor estão sendo gerados
- [ ] Middleware está registrado (verificar logs de inicialização)

---

## 🎯 RESULTADO ESPERADO

Após executar os testes com sucesso, você deve ver:

```
🎉 TODOS OS TESTES PASSARAM! Sistema 100% rastreável!

📋 traceIds únicos encontrados: 2
   traceIds:
   - abc-123-def-456-ghi-789
   - xyz-789-abc-123

✅ Nenhum erro encontrado!

📈 Taxa de Sucesso: 100.0%
```

---

## 📚 PRÓXIMOS PASSOS

Após validar os testes:

1. **Monitorar em Produção:**
   - Filtrar logs por traceId
   - Validar rastreamento completo
   - Identificar gargalos

2. **Fase 1.3 (Opcional):**
   - Implementar OpenTelemetry
   - Configurar Jaeger/Tempo
   - Visualizar traces em Grafana

---

**Última atualização:** Janeiro 2025




## ⚠️ PRÉ-REQUISITOS

Antes de executar os testes, é **ESSENCIAL** que o servidor esteja rodando.

---

## 🚀 PASSO A PASSO

### 1. Iniciar o Servidor

**Terminal 1 - Servidor:**
```bash
cd leaf-websocket-backend
npm start
# ou
node server.js
```

**Aguarde até ver:**
```
✅ Servidor rodando na porta 3000 (ou 3001)
✅ Socket.IO configurado
✅ Redis conectado
✅ Firebase inicializado
```

### 2. Verificar Conexão

**Verificar se o servidor está respondendo:**
```bash
curl http://localhost:3000/health
# ou
curl http://localhost:3001/health
```

**Deve retornar JSON com status "healthy"**

### 3. Executar os Testes

**Terminal 2 - Testes:**
```bash
cd leaf-websocket-backend
node scripts/tests/test-traceid-completo.js
```

### 4. Configurar URL do Servidor (se necessário)

Se o servidor estiver em outra porta ou URL:

```bash
SERVER_URL=http://localhost:3001 node scripts/tests/test-traceid-completo.js
```

---

## 📊 INTERPRETAÇÃO DOS RESULTADOS

### ✅ Teste Bem-Sucedido

```
✅ Handlers com traceId: 1/1
✅ Commands com traceId: 1/1
✅ Events com traceId: 1/1
✅ Listeners com traceId: 1/1
✅ Operações Externas com traceId: 1/1

📈 Taxa de Sucesso: 100.0%

🎉 TODOS OS TESTES PASSARAM! Sistema 100% rastreável!
```

### ❌ Erro de Conexão

```
❌ Erro de conexão: websocket error
```

**Causa:** Servidor não está rodando ou não está acessível.

**Solução:**
1. Verificar se o servidor está rodando
2. Verificar a porta (3000 ou 3001)
3. Verificar firewall/redes
4. Verificar logs do servidor para erros

### ⚠️ Testes Parciais

```
✅ Handlers com traceId: 0/1
✅ Commands com traceId: 1/1
```

**Causa:** Alguns testes requerem conexão WebSocket ativa.

**Solução:**
- Verificar se o servidor está rodando
- Verificar se Socket.IO está configurado corretamente
- Verificar logs do servidor

---

## 🔍 VALIDAÇÃO MANUAL

### 1. Verificar Logs do Servidor

Durante a execução dos testes, monitore os logs do servidor:

```bash
# Terminal 1 - Servidor (já deve estar rodando)
# Os logs devem mostrar:
# - [traceId:xxx] createBooking iniciado
# - [traceId:xxx] RequestRideCommand.execute iniciado
# - [traceId:xxx] Evento ride.requested publicado
# - [traceId:xxx] Listener notifyDrivers acionado
```

### 2. Filtrar Logs por traceId

Após executar um teste, você pode filtrar os logs:

```bash
# No arquivo de logs
grep "traceId:abc-123" logs/combined.log

# Ou no console (se estiver logando no console)
# Procure por [traceId:abc-123] nos logs
```

### 3. Verificar Estrutura dos Logs

Os logs devem ter o formato:

```json
{
  "timestamp": "2024-01-15 10:30:45",
  "level": "info",
  "message": "createBooking iniciado",
  "traceId": "abc-123-def-456",
  "userId": "customer-1",
  "eventType": "createBooking",
  "service": "leaf-websocket-backend"
}
```

---

## 🐛 TROUBLESHOOTING

### Erro: "Cannot connect to server"

**Possíveis causas:**
1. Servidor não está rodando
2. Porta incorreta
3. Firewall bloqueando conexão
4. Servidor em outro host

**Soluções:**
```bash
# Verificar se servidor está rodando
ps aux | grep "node.*server"

# Verificar porta
netstat -tuln | grep 3000

# Testar conexão
curl http://localhost:3000/health

# Verificar logs do servidor
tail -f logs/combined.log
```

### Erro: "traceId não encontrado"

**Possíveis causas:**
1. Middleware não está registrado
2. Handler não está usando extractTraceIdFromEvent
3. traceContext não está funcionando

**Soluções:**
1. Verificar se `io.use(traceIdSocketMiddleware)` está no server.js
2. Verificar se `app.use(traceIdExpressMiddleware)` está no server.js
3. Verificar se handlers usam `extractTraceIdFromEvent(data, socket)`
4. Verificar logs do servidor para erros

### Erro: "traceId diferente"

**Possíveis causas:**
1. Servidor gerando novo traceId
2. traceId não está sendo propagado corretamente

**Soluções:**
1. Verificar se o handler está usando o traceId recebido
2. Verificar se traceContext.runWithTraceId está sendo usado
3. Verificar logs do servidor para ver qual traceId está sendo usado

---

## 📝 CHECKLIST ANTES DE EXECUTAR

- [ ] Servidor está rodando
- [ ] Redis está conectado
- [ ] Firebase está inicializado
- [ ] Porta do servidor está correta (3000 ou 3001)
- [ ] Logs do servidor estão sendo gerados
- [ ] Middleware está registrado (verificar logs de inicialização)

---

## 🎯 RESULTADO ESPERADO

Após executar os testes com sucesso, você deve ver:

```
🎉 TODOS OS TESTES PASSARAM! Sistema 100% rastreável!

📋 traceIds únicos encontrados: 2
   traceIds:
   - abc-123-def-456-ghi-789
   - xyz-789-abc-123

✅ Nenhum erro encontrado!

📈 Taxa de Sucesso: 100.0%
```

---

## 📚 PRÓXIMOS PASSOS

Após validar os testes:

1. **Monitorar em Produção:**
   - Filtrar logs por traceId
   - Validar rastreamento completo
   - Identificar gargalos

2. **Fase 1.3 (Opcional):**
   - Implementar OpenTelemetry
   - Configurar Jaeger/Tempo
   - Visualizar traces em Grafana

---

**Última atualização:** Janeiro 2025





