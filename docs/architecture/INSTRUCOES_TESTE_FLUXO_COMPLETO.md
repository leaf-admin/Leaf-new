# 🧪 Instruções: Teste do Fluxo Completo de Corrida

## 📋 Pré-requisitos

1. **Servidor WebSocket rodando**
   - O servidor deve estar em execução na porta configurada
   - Verificar: `leaf-websocket-backend/server.js`

2. **Redis rodando** (opcional, mas recomendado)
   - Para verificar dados no Redis durante o teste

## 🚀 Como Executar o Teste

### 1. Iniciar o Servidor (se não estiver rodando)

```bash
cd leaf-websocket-backend
node server.js
```

Ou se usar PM2:
```bash
pm2 start server.js
```

### 2. Verificar Porta do Servidor

O servidor pode estar em:
- `http://localhost:3001` (padrão)
- `http://localhost:3003` (alternativa)

Verificar no arquivo `leaf-websocket-backend/server.js` qual porta está configurada.

### 3. Executar o Teste

```bash
# Com porta padrão (3001)
node test-complete-ride-flow-real.js

# Ou especificar porta customizada
WEBSOCKET_URL=http://localhost:3003 node test-complete-ride-flow-real.js
```

## 📊 O que o Teste Faz

### FASE 1: Motorista
1. ✅ Conecta ao WebSocket
2. ✅ Autentica como motorista
3. ✅ Envia localização
4. ✅ Verifica se está no Redis GEO

### FASE 2: Passageiro
1. ✅ Conecta ao WebSocket
2. ✅ Autentica como passageiro
3. ✅ Cria reserva de corrida
4. ✅ Recebe confirmação

### FASE 3: Notificação
1. ✅ Aguarda até 30 segundos para QueueWorker processar
2. ✅ Verifica se motorista recebeu notificação
3. ✅ Mostra dados recebidos

### FASE 4: Verificação Redis
1. ✅ Verifica se reserva foi criada
2. ✅ Verifica se motorista foi notificado
3. ✅ Mostra lista de motoristas notificados

## ✅ Resultado Esperado

Se tudo funcionar, você verá:

```
✅ Motorista conectado ao WebSocket
✅ Motorista autenticado
✅ Localização do motorista enviada
✅ Motorista encontrado no Redis GEO
✅ Passageiro conectado ao WebSocket
✅ Passageiro autenticado
✅ Reserva criada com sucesso
✅ Motorista recebeu notificação de corrida!
   Booking ID: booking_...
   Valor: R$ 25.50
   Origem: Rua do Ouvidor, 50...
   Destino: Avenida Atlântica, 1000...
```

## ⚠️ Troubleshooting

### Erro: "connect ECONNREFUSED"
- **Causa:** Servidor não está rodando
- **Solução:** Iniciar o servidor primeiro

### Erro: "Redis não disponível"
- **Causa:** Redis não está rodando
- **Solução:** Iniciar Redis ou ignorar (teste funciona sem Redis)

### Motorista não recebe notificação
- Verificar se motorista está no Redis GEO
- Verificar se motorista está no room correto (`driver_${driverId}`)
- Verificar logs do servidor para ver se QueueWorker processou
- Verificar se motorista está próximo o suficiente do pickup (raio de busca)

### Timeout na autenticação
- Verificar se servidor está processando eventos `authenticate`
- Verificar logs do servidor

## 🔍 Verificações Manuais

### Verificar se servidor está rodando:
```bash
curl http://localhost:3001/health
```

### Verificar motoristas no Redis:
```bash
redis-cli ZRANGE driver_locations 0 -1 WITHSCORES
```

### Verificar reservas no Redis:
```bash
redis-cli KEYS "booking:*"
```

## 📝 Notas

- O teste usa IDs únicos baseados em timestamp para evitar conflitos
- O teste aguarda até 30 segundos para QueueWorker processar (processa a cada 3 segundos)
- Se motorista não receber notificação, verificar logs do servidor para diagnóstico


