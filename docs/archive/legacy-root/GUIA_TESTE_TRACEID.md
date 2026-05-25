# 🧪 GUIA DE TESTE - RASTREAMENTO COM traceId

## 📋 Visão Geral

Este guia explica como testar o rastreamento completo com `traceId` implementado nas Fases 1.1 e 1.2.

---

## 🚀 Executando os Testes

### Pré-requisitos

1. Servidor rodando:
```bash
cd leaf-websocket-backend
npm start
# ou
node server.js
```

2. Redis rodando (local ou remoto)

3. Firebase configurado

### Executar Teste Automatizado

```bash
cd leaf-websocket-backend
node scripts/tests/test-traceid-completo.js
```

### Configuração

Você pode configurar a URL do servidor via variável de ambiente:

```bash
SERVER_URL=http://localhost:3000 node scripts/tests/test-traceid-completo.js
```

---

## 📊 Testes Implementados

### Teste 1: Extração de traceId no Handler
- **Objetivo:** Validar que traceId é extraído corretamente dos dados ou headers
- **O que testa:**
  - Handler recebe traceId via `data.traceId` ou `socket.handshake.headers['x-trace-id']`
  - traceId é propagado para a resposta
- **Resultado esperado:** traceId na resposta `bookingCreated` deve corresponder ao enviado

### Teste 2: Propagação de traceId em Commands
- **Objetivo:** Validar que traceId é passado para Commands
- **O que testa:**
  - traceId é passado no construtor do Command
  - Command executa dentro do contexto `traceContext.runWithTraceId()`
- **Como validar:** Verificar logs do servidor para confirmar traceId nos logs de Commands

### Teste 3: Propagação de traceId em Events
- **Objetivo:** Validar que traceId é incluído em Events canônicos
- **O que testa:**
  - Event inclui traceId no `data`
  - Event é publicado no EventBus com traceId
- **Resultado esperado:** Eventos recebidos via WebSocket devem incluir traceId

### Teste 4: Propagação de traceId em Listeners
- **Objetivo:** Validar que traceId é propagado para Listeners
- **O que testa:**
  - Listener extrai traceId do evento
  - Listener executa dentro do contexto `traceContext.runWithTraceId()`
- **Como validar:** Verificar logs do servidor para confirmar traceId nos logs de Listeners

### Teste 5: traceId em Operações Externas
- **Objetivo:** Validar que traceId é incluído em logs de Redis, Firebase, Woovi, FCM
- **O que testa:**
  - Logs de Redis incluem traceId
  - Logs de Firebase incluem traceId
  - Logs de Woovi incluem traceId
  - Logs de FCM incluem traceId
- **Como validar:** Verificar logs do servidor (arquivos em `logs/` ou console)

### Teste 6: Rastreamento Completo de um Ride
- **Objetivo:** Validar rastreamento completo do início ao fim
- **O que testa:**
  - Fluxo completo: createBooking → acceptRide → startTrip → completeTrip
  - traceId é mantido através de todo o fluxo
- **Resultado esperado:** Todos os logs do fluxo devem ter o mesmo traceId

---

## 🔍 Validação Manual

### 1. Verificar Logs do Servidor

Durante a execução dos testes, monitore os logs do servidor:

```bash
# Terminal 1: Servidor
cd leaf-websocket-backend
npm start

# Terminal 2: Testes
node scripts/tests/test-traceid-completo.js
```

### 2. Filtrar Logs por traceId

Após executar um teste, você pode filtrar os logs por traceId:

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

### 4. Validar Propagação

Para validar que traceId é propagado corretamente:

1. **Handler:** Verifique que traceId é extraído e usado
2. **Command:** Verifique que traceId está nos logs do Command
3. **Event:** Verifique que traceId está no evento publicado
4. **Listener:** Verifique que traceId está nos logs do Listener
5. **Operações Externas:** Verifique que traceId está nos logs de Redis/Firebase/Woovi/FCM

---

## 📝 Exemplo de Saída Esperada

```
🚀 Iniciando testes de rastreamento com traceId...
📡 Servidor: http://localhost:3000
🔍 traceId de teste: abc-123-def-456-ghi-789

📋 TESTE 1: Extração de traceId no Handler
✅ Conectado ao servidor
📤 createBooking enviado com traceId: abc-123-def-456-ghi-789
✅ bookingCreated recebido
✅ traceId encontrado na resposta: abc-123-def-456-ghi-789
✅ traceId corresponde ao enviado!

📋 TESTE 2: Propagação de traceId em Commands
✅ Teste 2 concluído (verificar logs do servidor)

📋 TESTE 3: Propagação de traceId em Events
✅ Conectado ao servidor
📤 createBooking enviado com traceId: xyz-789-abc-123
✅ traceId encontrado em rideRequested: xyz-789-abc-123
✅ bookingCreated recebido
✅ Evento recebido com traceId correto

...

📊 RELATÓRIO FINAL DE RASTREAMENTO
============================================================
✅ Handlers com traceId: 1/1
✅ Commands com traceId: 1/1
✅ Events com traceId: 1/1
✅ Listeners com traceId: 1/1
✅ Operações Externas com traceId: 1/1

📋 traceIds únicos encontrados: 2
   traceIds:
   - abc-123-def-456-ghi-789
   - xyz-789-abc-123

✅ Nenhum erro encontrado!

📈 Taxa de Sucesso: 100.0%

🎉 TODOS OS TESTES PASSARAM! Sistema 100% rastreável!
============================================================
```

---

## 🐛 Troubleshooting

### Erro: "Cannot connect to server"
- Verifique se o servidor está rodando
- Verifique a URL do servidor (`SERVER_URL`)
- Verifique se a porta está correta

### Erro: "traceId não encontrado"
- Verifique se o handler está extraindo traceId corretamente
- Verifique se o traceId está sendo passado na requisição
- Verifique os logs do servidor para mais detalhes

### Erro: "traceId diferente"
- Isso pode acontecer se o servidor gerar um novo traceId
- Verifique se o handler está usando o traceId recebido ou gerando um novo

### Logs não mostram traceId
- Verifique se `logger.js` está incluindo traceId automaticamente
- Verifique se `traceContext` está funcionando corretamente
- Verifique se os logs estão sendo escritos nos arquivos corretos

---

## 📚 Próximos Passos

Após validar os testes:

1. **Fase 1.3:** Implementar OpenTelemetry para rastreamento distribuído avançado
2. **Métricas:** Adicionar métricas de latência por traceId
3. **Dashboard:** Criar dashboard para visualizar traces em tempo real
4. **Alertas:** Configurar alertas baseados em traceId (ex: latência alta)

---

## ✅ Checklist de Validação

- [ ] Teste 1 passou (Extração de traceId)
- [ ] Teste 2 validado (Commands com traceId)
- [ ] Teste 3 passou (Events com traceId)
- [ ] Teste 4 validado (Listeners com traceId)
- [ ] Teste 5 validado (Operações Externas com traceId)
- [ ] Teste 6 passou (Rastreamento Completo)
- [ ] Logs do servidor mostram traceId em todos os pontos
- [ ] Taxa de sucesso: 100%

---

## 🎯 Conclusão

Com os testes passando, o sistema está 100% rastreável e pronto para:
- Debugging completo de fluxos
- Identificação de gargalos
- Monitoramento de operações críticas
- Preparação para OpenTelemetry (Fase 1.3)

