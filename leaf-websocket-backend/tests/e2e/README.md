# 🧪 Testes E2E - LEAF Backend

## 📋 Visão Geral

Testes End-to-End (E2E) para validar fluxos completos do sistema LEAF, incluindo:
- ✅ Fluxo completo do passageiro
- ✅ Fluxo completo do motorista
- ✅ Integração WebSocket
- ✅ Toggle entre modos

---

## 🚀 Como Executar

### Pré-requisitos

1. **Servidor rodando:**
   ```bash
   cd leaf-websocket-backend
   npm start
   ```

2. **Redis e Firebase configurados** (conforme `.env`)

### Executar Todos os Testes

```bash
npm run test:e2e
```

### Executar Suite Específica

```bash
# Fluxo passageiro
npm run test:e2e:passenger

# Fluxo motorista
npm run test:e2e:driver

# Teste específico
npx jest --config jest.config.js tests/e2e/backend/flows/passenger-flow.test.js
```

### Executar com Watch Mode

```bash
npm run test:e2e:watch
```

### Executar com Cobertura

```bash
npm run test:e2e:coverage
```

### Com Variáveis de Ambiente

```bash
WS_URL=http://localhost:3001 npm run test:e2e
```

---

## 📁 Estrutura

```
tests/e2e/
├── backend/
│   ├── __fixtures__/          # Dados de teste reutilizáveis
│   │   └── test-data.js
│   ├── __helpers__/           # Funções auxiliares
│   │   └── websocket-test-client.js
│   ├── flows/                  # Testes de fluxos completos
│   │   ├── passenger-flow.test.js
│   │   ├── driver-flow.test.js
│   │   └── toggle-modes.test.js
│   └── websocket/              # Testes de integração WebSocket
│       └── connection.test.js
├── config/
│   └── test-setup.js          # Configuração global
└── README.md                   # Este arquivo
```

---

## 🎯 Cenários de Teste

### 1. Fluxo Passageiro Completo

**Arquivo:** `flows/passenger-flow.test.js`

**Cenários:**
- ✅ Solicitar corrida
- ✅ Confirmar pagamento
- ✅ Receber notificação de motorista
- ✅ Aceitar motorista
- ✅ Iniciar viagem
- ✅ Finalizar viagem

**Executar:**
```bash
npm run test:e2e:passenger
```

---

### 2. Fluxo Motorista Completo

**Arquivo:** `flows/driver-flow.test.js`

**Cenários:**
- ✅ Ficar online
- ✅ Receber notificação de corrida
- ✅ Aceitar corrida
- ✅ Navegar até passageiro
- ✅ Iniciar viagem
- ✅ Atualizar localização
- ✅ Finalizar viagem

**Executar:**
```bash
npm run test:e2e:driver
```

---

### 3. Integração WebSocket

**Arquivo:** `websocket/connection.test.js`

**Cenários:**
- ✅ Conexão ao servidor
- ✅ Autenticação (passageiro e motorista)
- ✅ Recebimento de eventos em tempo real
- ✅ Reconexão automática

**Executar:**
```bash
npx jest --config jest.config.js tests/e2e/backend/websocket/connection.test.js
```

---

### 4. Toggle entre Modos

**Arquivo:** `flows/toggle-modes.test.js`

**Cenários:**
- ✅ Alternar passageiro → motorista
- ✅ Alternar motorista → passageiro
- ✅ Limpeza de estado

**Executar:**
```bash
npx jest --config jest.config.js tests/e2e/backend/flows/toggle-modes.test.js
```

---

## 🛠️ Helpers

### WebSocketTestClient

Cliente WebSocket especializado para testes:

```javascript
const client = new WebSocketTestClient(WS_URL);

// Conectar
await client.connect();

// Autenticar
await client.authenticate('user-001', 'customer');

// Criar booking
const booking = await client.createBooking({
  customerId: 'user-001',
  pickupLocation: { lat: -23.5505, lng: -46.6333 },
  destinationLocation: { lat: -23.5515, lng: -46.6343 },
  estimatedFare: 25.50,
  paymentMethod: 'pix'
});

// Aguardar evento
const event = await client.waitForEvent('rideAccepted', 10000);

// Verificar se evento foi recebido
const hasEvent = client.hasReceivedEvent('rideAccepted');

// Desconectar
client.disconnect();
```

### Test Data Fixtures

Dados de teste reutilizáveis:

```javascript
const testData = require('../__fixtures__/test-data');

// Usuários
const customer = testData.users.customer;
const driver = testData.users.driver;

// Localizações
const pickup = testData.locations.pickup;
const destination = testData.locations.destination;

// Criar dados de booking
const bookingData = testData.booking.createBookingData(
  pickup,
  destination,
  customer.uid
);

// Helpers
await testData.helpers.sleep(1000);
await testData.helpers.waitFor(() => condition(), 10000);
```

---

## 📊 Resultados

Os testes geram:
- ✅ Relatório no console em tempo real
- 📄 Cobertura de código (se habilitado)
- 📈 Estatísticas de sucesso/falha

### Exemplo de Saída

```
PASS  tests/e2e/backend/flows/passenger-flow.test.js
  Fluxo Passageiro Completo
    ✓ deve completar fluxo completo de corrida (45234 ms)
    ✓ deve validar cada etapa do fluxo individualmente (32145 ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
Snapshots:   0 total
Time:        77.379 s
```

---

## 🔧 Configuração

### Variáveis de Ambiente

```bash
# URL do servidor WebSocket
WS_URL=http://localhost:3001

# Suprimir logs durante testes
SUPPRESS_LOGS=true
```

### Jest Configuration

Configuração em `jest.config.js`:
- Timeout: 30 segundos por teste
- Ambiente: Node.js
- Cobertura: Habilitada
- Workers: 50% (paralelização)

---

## 🐛 Troubleshooting

### Erro: "Timeout ao conectar WebSocket"

**Solução:** Verificar se o servidor está rodando:
```bash
cd leaf-websocket-backend
npm start
```

### Erro: "Evento não recebido"

**Solução:** 
1. Verificar se o evento está sendo emitido pelo servidor
2. Aumentar timeout do `waitForEvent`
3. Verificar se o cliente está na room correta

### Erro: "Redis não disponível"

**Solução:** Verificar conexão Redis:
```bash
redis-cli ping
# Deve retornar: PONG
```

---

## 📝 Criando Novos Testes

### Template

```javascript
const WebSocketTestClient = require('../__helpers__/websocket-test-client');
const testData = require('../__fixtures__/test-data');

describe('Meu Novo Teste', () => {
  let client;
  const WS_URL = process.env.WS_URL || 'http://localhost:3001';
  
  beforeAll(async () => {
    client = new WebSocketTestClient(WS_URL);
    await client.connect();
  });
  
  afterAll(() => {
    if (client) client.disconnect();
  });
  
  test('deve fazer algo', async () => {
    // Seu teste aqui
  });
});
```

---

## 📈 Próximos Passos

- [ ] Adicionar testes de performance
- [ ] Adicionar testes de carga
- [ ] Integrar com CI/CD
- [ ] Adicionar testes de regressão
- [ ] Criar testes para mobile (Detox)

---

**Última atualização:** 17/12/2025



