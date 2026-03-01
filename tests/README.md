# 🧪 TESTES AUTOMATIZADOS - LEAF APP

Sistema completo de testes automatizados para validar os 85 cenários do plano de testes.

## ✅ **FIDEDIGNIDADE AO APP REAL**

**IMPORTANTE:** Os testes foram criados para replicar **EXATAMENTE** o comportamento do app mobile:

- ✅ **Mesmos eventos emitidos:** `authenticate`, `createBooking`, `acceptRide`, etc.
- ✅ **Mesmos payloads:** Estrutura de dados idêntica ao app (`{ uid, userType }`, etc.)
- ✅ **Mesmos timeouts:** Valores exatos do `WebSocketManager`
- ✅ **Mesmas respostas esperadas:** `authenticated`, `bookingCreated`, `rideAccepted`, etc.

Os testes **disparam diretamente para o servidor** usando a mesma comunicação que o app real, garantindo que os testes sejam válidos e reflitam o comportamento real do sistema.

## 📋 Estrutura

```
tests/
├── config/
│   └── test-parameters.js       # Todos os parâmetros definidos
├── helpers/
│   ├── test-helpers.js           # Funções auxiliares
│   └── websocket-client.js       # Cliente WebSocket para testes
├── suites/
│   ├── 00-template.test.js       # Template para novos testes
│   ├── 01-autenticacao-identidade.test.js  # Suite exemplo
│   └── ...                       # Outras suites
├── reports/                      # Relatórios gerados
├── test-runner.js               # Executor principal
└── README.md                    # Este arquivo
```

## 🚀 Como Executar

### Pré-requisitos

```bash
npm install socket.io-client
```

### Executar Todos os Testes

```bash
node tests/test-runner.js
```

### Executar Suite Específica

```bash
node tests/suites/01-autenticacao-identidade.test.js
```

### Com Variáveis de Ambiente

```bash
WS_URL=ws://216.238.107.59:3001 \
TEST_DRIVER_ID=driver-001 \
TEST_CUSTOMER_ID=customer-001 \
node tests/test-runner.js
```

## 📊 Resultados

Os testes geram:
- ✅ Relatório no console em tempo real
- 📄 Arquivo JSON em `tests/reports/test-report-{timestamp}.json`
- 📈 Estatísticas de sucesso/falha

## 🎯 Cobertura de Testes

### Categorias Implementadas

1. ✅ **Autenticação e Identidade** (TC-001 a TC-004)
   - Login Driver
   - Login Customer
   - Reconexão WebSocket
   - Sessão Simultânea

### Categorias Pendentes

2. ⏳ Status do Motorista e Presença
3. ⏳ Solicitação de Corrida
4. ⏳ Distribuição e Notificação
5. ⏳ Aceitação e Recusa
6. ⏳ Reatribuição e Fallback
7. ⏳ Cancelamentos
8. ⏳ Início da Viagem
9. ⏳ Durante a Viagem
10. ⏳ Finalização da Viagem
11. ⏳ Pagamento PIX
12. ⏳ Pós-Corrida
... (e mais 8 categorias)

**Total:** 85 cenários de teste planejados

## 🛠️ Criando Novos Testes

### 1. Use o Template

```bash
cp tests/suites/00-template.test.js tests/suites/NN-nome-categoria.test.js
```

### 2. Implemente os Métodos

Cada teste deve:
- Incrementar `this.results.total`
- Executar ações
- Validar critérios de aceite
- Registrar `passed` ou `failed`
- Fazer cleanup (disconnect)

### 3. Exemplo de Validação

```javascript
const checks = [];

checks.push({
    name: 'Evento recebido',
    passed: client.hasReceivedEvent('rideRequest'),
});

checks.push({
    name: 'Dados normalizados',
    passed: TestHelpers.validateNormalizedBooking(data),
});

const allPassed = checks.every(c => c.passed);
```

## 📝 Parâmetros Disponíveis

Todos os parâmetros estão em `config/test-parameters.js`:

- `PARAMS.TIMEOUTS.*` - Todos os timeouts
- `PARAMS.RADIUS.*` - Raios e distâncias
- `PARAMS.FARES.*` - Valores e tarifas
- `PARAMS.BUSINESS_RULES.*` - Regras de negócio
- `PARAMS.VEHICLE_TYPES.*` - Tarifas por tipo de veículo
- `PARAMS.POLICIES.*` - Políticas gerais

## 🔧 Helpers Disponíveis

### TestHelpers

- `sleep(seconds)` - Aguarda tempo
- `waitFor(condition, timeout)` - Aguarda condição
- `calculateFare(vehicleType, distanceKm, timeMinutes)` - Calcula tarifa
- `calculateDistance(lat1, lng1, lat2, lng2)` - Calcula distância
- `validateNormalizedBooking(data)` - Valida dados normalizados
- `createBookingPayload(pickup, destination, vehicleType)` - Cria payload de booking
- `waitForEvent(socket, eventName, timeout)` - Aguarda evento

### WebSocketTestClient

- `connect()` - Conecta ao servidor
- `authenticate()` - Autentica usuário
- `on(event, callback)` - Registra listener
- `emit(event, data)` - Emite evento
- `waitForEvent(eventName, timeout)` - Aguarda evento específico
- `hasReceivedEvent(eventName)` - Verifica se evento foi recebido
- `getEvents(eventName)` - Obtém todos os eventos recebidos

## 📈 Progresso

- **Parâmetros Definidos:** 43/43 (100%) ✅
- **Testes Implementados:** 4/85 (~5%)
- **Testes Pendentes:** 81/85 (~95%)

## 🎯 Próximos Passos

1. Implementar suites para todas as categorias
2. Criar testes de integração end-to-end
3. Adicionar testes de carga/performance
4. Integrar com CI/CD
5. Adicionar cobertura de código

## 📞 Suporte

Para dúvidas ou problemas, consulte:
- `PARAMETROS_DEFINIDOS.md` - Todos os parâmetros
- `PLANO_TESTES_COMPLETO.md` - Cenários detalhados
- Template em `tests/suites/00-template.test.js`

---

**Última atualização:** 29/01/2025

