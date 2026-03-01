# 🚀 Teste de Carga - Simulação de Produção

Script de teste de carga completo para simular cenários de produção do sistema LEAF.

## 📋 O que o teste simula

- ✅ **Múltiplas corridas simultâneas**: Criação de corridas em alta frequência
- ✅ **Múltiplos motoristas conectados**: Simulação de motoristas online recebendo notificações
- ✅ **Eventos de início e chegada**: Simulação completa do ciclo de vida de uma corrida
- ✅ **Eventos múltiplos do escopo**: Todos os eventos principais do sistema
- ✅ **Métricas de latência**: Medição de tempo de resposta para cada evento
- ✅ **Monitoramento do servidor**: CPU, memória, conexões ativas

## 🛠️ Pré-requisitos

```bash
# Instalar dependências
npm install socket.io-client axios
```

## 🚀 Como executar

### Opção 1: Usando o script bash (recomendado)

```bash
cd leaf-websocket-backend
./scripts/run-load-test.sh
```

### Opção 2: Executar diretamente com Node.js

```bash
cd leaf-websocket-backend
node scripts/load-test-production.js
```

### Opção 3: Com variáveis de ambiente customizadas

```bash
# Configurar variáveis
export WS_URL="http://seu-servidor:3003"
export NUM_PASSENGERS=100
export NUM_DRIVERS=200
export RIDE_CREATION_RATE=20
export TEST_DURATION_MS=600000

# Executar
node scripts/load-test-production.js
```

## ⚙️ Configurações

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `WS_URL` | `http://localhost:3003` | URL do servidor WebSocket |
| `NUM_PASSENGERS` | `50` | Número de passageiros simultâneos |
| `NUM_DRIVERS` | `100` | Número de motoristas simultâneos |
| `RIDE_CREATION_RATE` | `10` | Corridas criadas por segundo |
| `TEST_DURATION_MS` | `300000` | Duração do teste em milissegundos (5 minutos) |
| `TRIP_DURATION_MS` | `30000` | Duração simulada de cada viagem (30 segundos) |

## 📊 Eventos monitorados

O teste coleta métricas de latência para os seguintes eventos:

1. **rideCreated**: Criação de corrida
2. **rideAccepted**: Aceitação de corrida pelo motorista
3. **tripStarted**: Início da viagem
4. **tripCompleted**: Conclusão da viagem
5. **driverNotification**: Notificação enviada ao motorista
6. **locationUpdate**: Atualização de localização do motorista

## 📈 Relatório gerado

Após a execução, um arquivo JSON é gerado com:

- **Resumo**: Total de eventos, erros, taxa de sucesso
- **Latência por evento**: Mín, máx, média, mediana, P95, P99
- **Status do servidor**: CPU, memória, conexões (se disponível)
- **Estatísticas de corridas**: Completadas vs falhadas

### Exemplo de saída:

```
📊 RELATÓRIO DE TESTE DE CARGA
================================================================================

📈 RESUMO:
  Duração: 300.00s
  Total de Eventos: 1523
  Total de Erros: 12
  Corridas Completadas: 145
  Corridas Falhadas: 5
  Taxa de Sucesso: 96.67%

⏱️  LATÊNCIA DOS EVENTOS:

  RIDECREATED:
    Total: 500 | Erros: 2
    Mín: 45.23ms
    Máx: 234.56ms
    Média: 89.45ms
    Mediana: 78.32ms
    P95: 156.78ms
    P99: 198.45ms

  RIDEACCEPTED:
    Total: 145 | Erros: 0
    Mín: 123.45ms
    Máx: 456.78ms
    Média: 234.56ms
    Mediana: 198.34ms
    P95: 345.67ms
    P99: 412.34ms

  ...
```

## 🔍 Monitoramento do servidor

O script tenta coletar métricas do servidor via API (`/api/metrics`). Se a API não estiver disponível, você pode:

1. **Habilitar endpoint de métricas no servidor** (recomendado)
2. **Usar monitor SSH** (ver `monitor-server-ssh.js`)

### Monitor SSH (opcional)

Para monitorar recursos via SSH:

```javascript
const ServerMonitor = require('./monitor-server-ssh');

const monitor = new ServerMonitor({
    host: 'seu-servidor.com',
    user: 'root',
    key: '/path/to/ssh/key' // opcional
});

const metrics = await monitor.getAllMetrics();
```

## 🎯 Cenários de teste recomendados

### Teste leve (desenvolvimento)
```bash
NUM_PASSENGERS=10 NUM_DRIVERS=20 RIDE_CREATION_RATE=2 TEST_DURATION_MS=60000 node scripts/load-test-production.js
```

### Teste médio (staging)
```bash
NUM_PASSENGERS=50 NUM_DRIVERS=100 RIDE_CREATION_RATE=10 TEST_DURATION_MS=300000 node scripts/load-test-production.js
```

### Teste pesado (produção)
```bash
NUM_PASSENGERS=200 NUM_DRIVERS=500 RIDE_CREATION_RATE=50 TEST_DURATION_MS=600000 node scripts/load-test-production.js
```

## ⚠️ Avisos importantes

1. **Não execute em produção sem autorização**: O teste pode sobrecarregar o servidor
2. **Monitore recursos do servidor**: Acompanhe CPU, memória e conexões durante o teste
3. **Ajuste conforme capacidade**: Reduza os números se o servidor não suportar
4. **Teste em ambiente isolado primeiro**: Valide em staging antes de produção

## 🐛 Troubleshooting

### Erro de conexão
- Verifique se o servidor está rodando
- Confirme a URL em `WS_URL`
- Verifique firewall/portas

### Muitos erros
- Reduza `NUM_PASSENGERS` e `NUM_DRIVERS`
- Reduza `RIDE_CREATION_RATE`
- Verifique logs do servidor

### Timeout
- Aumente timeout nas conexões WebSocket
- Verifique latência de rede
- Reduza carga do teste

## 📝 Notas

- O teste usa tokens de autenticação simulados (`test_token_*`)
- As coordenadas são geradas aleatoriamente próximas a São Paulo
- Motoristas aceitam/rejeitam corridas aleatoriamente (70% aceita)
- Viagens são simuladas com duração configurável

## 🔗 Arquivos relacionados

- `load-test-production.js`: Script principal
- `monitor-server-ssh.js`: Monitor SSH (opcional)
- `run-load-test.sh`: Script bash de execução


