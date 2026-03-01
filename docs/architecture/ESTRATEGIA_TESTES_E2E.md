# 🧪 ESTRATÉGIA DE TESTES E2E - LEAF APP

## 📅 Data: 16 de Dezembro de 2025

---

## 🎯 **OBJETIVO**

Definir estratégia completa, ferramentas, abordagem e metodologia para testes End-to-End (E2E) do sistema LEAF, garantindo cobertura completa dos fluxos críticos.

---

## 📊 **ANÁLISE DO PROJETO**

### **Stack Tecnológica:**

| Componente | Tecnologia | Versão |
|------------|------------|--------|
| **Backend** | Node.js + Express | - |
| **WebSocket** | Socket.IO | 4.7.2 |
| **Mobile App** | React Native | - |
| **Banco de Dados** | Firebase Firestore | - |
| **Cache** | Redis | - |
| **Testes Atuais** | Node.js scripts | - |

### **Arquitetura:**

```
┌─────────────────┐
│  Mobile App     │ (React Native)
│  (Passageiro/   │
│   Motorista)    │
└────────┬────────┘
         │ WebSocket
         │
┌────────▼────────┐
│  Backend        │ (Node.js + Socket.IO)
│  - WebSocket    │
│  - HTTP APIs    │
│  - GraphQL      │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼────┐
│Redis  │ │Firebase│
│Cache  │ │Firestore│
└───────┘ └────────┘
```

---

## 🛠️ **FERRAMENTAS RECOMENDADAS**

### **1. Para Backend/WebSocket (Recomendado: Jest + Socket.IO Client)**

**Por quê:**
- ✅ Já tem `socket.io-client` no projeto
- ✅ Jest é padrão da indústria
- ✅ Fácil mockar serviços externos
- ✅ Suporte a async/await
- ✅ Relatórios detalhados

**Instalação:**
```bash
npm install --save-dev jest @types/jest jest-environment-node
```

**Vantagens:**
- Testes rápidos (sem emular dispositivo)
- Fácil integrar com CI/CD
- Cobertura de código
- Paralelização

---

### **2. Para Mobile App (Recomendado: Detox + Jest)**

**Por quê:**
- ✅ Framework oficial para React Native
- ✅ Testa app real (não WebView)
- ✅ Suporta iOS e Android
- ✅ Integração com Jest
- ✅ Testes em dispositivos reais/emuladores

**Instalação:**
```bash
npm install --save-dev detox jest-circus
```

**Vantagens:**
- Testa UI real
- Interage com componentes nativos
- Suporta gestos e navegação
- Testes em dispositivos físicos

---

### **3. Alternativa Híbrida (Recomendado para MVP)**

**Abordagem em 2 Camadas:**

#### **Camada 1: Testes de Integração Backend (Jest)**
- Testa WebSocket diretamente
- Testa APIs HTTP
- Testa lógica de negócio
- **Rápido e confiável**

#### **Camada 2: Testes de UI Mobile (Detox - Opcional)**
- Testa interface do usuário
- Testa navegação
- Testa gestos
- **Mais lento, mas completo**

---

## 🎯 **ABORDAGEM RECOMENDADA**

### **Abordagem: Backend-First com Validação Mobile**

**Justificativa:**
1. **80% da lógica está no backend** (WebSocket, matching, pagamentos)
2. **Testes backend são mais rápidos** (segundos vs minutos)
3. **Mais fácil debugar** (logs, breakpoints)
4. **Cobertura maior** (testa todos os cenários)
5. **Mobile pode ser testado manualmente** inicialmente

**Estratégia:**
```
Fase 1: Testes Backend E2E (Jest) ✅ PRIORIDADE
  ├─ Testa WebSocket completo
  ├─ Testa fluxos de negócio
  ├─ Testa integrações (Firebase, Redis)
  └─ Cobertura: 90% dos cenários

Fase 2: Testes Mobile E2E (Detox) ⏳ FUTURO
  ├─ Testa UI e navegação
  ├─ Testa gestos e interações
  └─ Cobertura: 10% dos cenários críticos
```

---

## 📋 **METODOLOGIA**

### **1. BDD (Behavior-Driven Development)**

**Estrutura:**
```javascript
describe('Fluxo Passageiro Completo', () => {
  it('deve permitir solicitar corrida, pagar e finalizar', async () => {
    // Given: Passageiro autenticado
    // When: Solicita corrida
    // Then: Deve receber confirmação
  });
});
```

**Vantagens:**
- Testes legíveis (documentação viva)
- Foco em comportamento
- Fácil comunicação com stakeholders

---

### **2. Page Object Pattern (para Mobile)**

**Estrutura:**
```javascript
class PassengerScreen {
  async requestRide(pickup, destination) {
    // Interações com a tela
  }
}
```

**Vantagens:**
- Reutilização de código
- Manutenção fácil
- Separação de concerns

---

### **3. Test Data Builders**

**Estrutura:**
```javascript
class RideRequestBuilder {
  withPickup(lat, lng) { /* ... */ }
  withDestination(lat, lng) { /* ... */ }
  build() { /* ... */ }
}
```

**Vantagens:**
- Dados de teste consistentes
- Fácil criar cenários
- Menos duplicação

---

## 🏗️ **ESTRUTURA DE TESTES**

### **Organização Recomendada:**

```
tests/
├── e2e/
│   ├── backend/
│   │   ├── __fixtures__/          # Dados de teste
│   │   ├── __helpers__/           # Funções auxiliares
│   │   ├── __mocks__/              # Mocks de serviços
│   │   ├── flows/
│   │   │   ├── passenger-flow.test.js
│   │   │   ├── driver-flow.test.js
│   │   │   └── toggle-modes.test.js
│   │   ├── websocket/
│   │   │   ├── connection.test.js
│   │   │   ├── authentication.test.js
│   │   │   └── reconnection.test.js
│   │   └── integration/
│   │       ├── payment-flow.test.js
│   │       └── ride-lifecycle.test.js
│   └── mobile/                    # Futuro: Detox
│       ├── screens/
│       └── flows/
├── unit/                           # Testes unitários
├── integration/                    # Testes de integração
└── config/
    ├── jest.config.js
    └── test-setup.js
```

---

## 🔧 **IMPLEMENTAÇÃO**

### **Fase 1: Setup Básico (Jest)**

**1. Configuração Jest:**

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/e2e/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/config/test-setup.js'],
  testTimeout: 30000,
  verbose: true,
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html']
};
```

**2. Helper para WebSocket:**

```javascript
// tests/e2e/__helpers__/websocket-client.js
class WebSocketTestClient {
  constructor(url) {
    this.socket = io(url);
    this.events = new Map();
  }
  
  async connect() {
    return new Promise((resolve) => {
      this.socket.on('connect', resolve);
    });
  }
  
  async authenticate(uid, userType) {
    return new Promise((resolve, reject) => {
      this.socket.emit('authenticate', { uid, userType });
      this.socket.once('authenticated', resolve);
      this.socket.once('auth_error', reject);
    });
  }
  
  // ... outros métodos
}
```

**3. Teste de Fluxo:**

```javascript
// tests/e2e/flows/passenger-flow.test.js
describe('Fluxo Passageiro Completo', () => {
  let passengerClient;
  let driverClient;
  
  beforeAll(async () => {
    passengerClient = new WebSocketTestClient(WS_URL);
    driverClient = new WebSocketTestClient(WS_URL);
    
    await passengerClient.connect();
    await driverClient.connect();
  });
  
  it('deve completar fluxo completo de corrida', async () => {
    // 1. Autenticar
    await passengerClient.authenticate('customer-001', 'customer');
    await driverClient.authenticate('driver-001', 'driver');
    
    // 2. Solicitar corrida
    const booking = await passengerClient.createBooking({
      pickupLocation: { lat: -23.5505, lng: -46.6333 },
      destinationLocation: { lat: -23.5515, lng: -46.6343 }
    });
    
    // 3. Driver recebe notificação
    const notification = await driverClient.waitForEvent('newRideAvailable');
    expect(notification.bookingId).toBe(booking.bookingId);
    
    // 4. Driver aceita
    await driverClient.acceptRide(booking.bookingId);
    
    // 5. Passageiro recebe confirmação
    const accepted = await passengerClient.waitForEvent('rideAccepted');
    expect(accepted.driverId).toBe('driver-001');
    
    // ... resto do fluxo
  });
});
```

---

## 📊 **CENÁRIOS DE TESTE**

### **1. Fluxo Passageiro Completo**

**Cenários:**
- ✅ Solicitar corrida
- ✅ Confirmar pagamento
- ✅ Receber notificação de motorista
- ✅ Aceitar motorista
- ✅ Iniciar viagem
- ✅ Finalizar viagem
- ✅ Confirmar pagamento final

**Casos de Erro:**
- ❌ Pagamento não confirmado
- ❌ Motorista não encontrado
- ❌ Cancelamento
- ❌ Timeout

---

### **2. Fluxo Motorista Completo**

**Cenários:**
- ✅ Ficar online
- ✅ Receber notificação de corrida
- ✅ Aceitar/rejeitar corrida
- ✅ Navegar até passageiro
- ✅ Iniciar viagem
- ✅ Atualizar localização
- ✅ Finalizar viagem
- ✅ Receber pagamento

**Casos de Erro:**
- ❌ Múltiplas corridas simultâneas
- ❌ Timeout de resposta
- ❌ Cancelamento

---

### **3. Integração WebSocket**

**Cenários:**
- ✅ Conexão inicial
- ✅ Autenticação
- ✅ Reconexão automática
- ✅ Eventos em tempo real
- ✅ Desconexão e limpeza

**Casos de Erro:**
- ❌ Conexão perdida
- ❌ Autenticação falha
- ❌ Timeout de eventos

---

### **4. Toggle entre Modos**

**Cenários:**
- ✅ Alternar passageiro → motorista
- ✅ Alternar motorista → passageiro
- ✅ Limpeza de estado
- ✅ Bloqueio durante corrida ativa

---

## 🎯 **METODOLOGIA DE EXECUÇÃO**

### **1. Testes Locais (Desenvolvimento)**

```bash
# Executar todos os testes E2E
npm run test:e2e

# Executar suite específica
npm run test:e2e -- flows/passenger-flow

# Executar com watch
npm run test:e2e:watch
```

### **2. Testes em CI/CD**

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm run test:e2e
```

### **3. Testes em Staging**

- Executar antes de deploy
- Validar integrações reais
- Testar com dados de produção (anônimos)

---

## 📈 **MÉTRICAS E COBERTURA**

### **Métricas a Acompanhar:**

1. **Cobertura de Código:**
   - Meta: 80%+ para código crítico
   - Ferramenta: Jest coverage

2. **Taxa de Sucesso:**
   - Meta: 95%+ dos testes passando
   - Monitorar tendências

3. **Tempo de Execução:**
   - Meta: < 5 minutos para suite completa
   - Otimizar testes lentos

4. **Cenários Críticos:**
   - 100% dos fluxos críticos cobertos
   - Testes de regressão

---

## 🔍 **FERRAMENTAS ADICIONAIS**

### **1. Test Containers (Opcional)**

Para testar com Redis/Firebase reais:

```javascript
// Usar containers Docker para serviços
const redis = new RedisContainer();
await redis.start();
```

**Vantagens:**
- Testa com serviços reais
- Isolamento completo
- Fácil limpeza

---

### **2. Visual Regression (Futuro)**

Para testar UI do mobile:

```javascript
// Detox + screenshot comparison
await expect(element).toMatchSnapshot();
```

---

### **3. Performance Testing**

```javascript
// Medir tempo de resposta
const start = Date.now();
await client.createBooking(data);
const duration = Date.now() - start;
expect(duration).toBeLessThan(1000); // < 1s
```

---

## 🚀 **PLANO DE IMPLEMENTAÇÃO**

### **Fase 1: Setup e Infraestrutura (1-2 dias)**
- ✅ Configurar Jest
- ✅ Criar estrutura de pastas
- ✅ Criar helpers e fixtures
- ✅ Setup de CI/CD básico

### **Fase 2: Testes Críticos (3-5 dias)**
- ✅ Fluxo passageiro completo
- ✅ Fluxo motorista completo
- ✅ Integração WebSocket
- ✅ Toggle entre modos

### **Fase 3: Testes de Regressão (2-3 dias)**
- ✅ Casos de erro
- ✅ Edge cases
- ✅ Timeouts e reconexões

### **Fase 4: Otimização (1-2 dias)**
- ✅ Paralelização
- ✅ Otimização de tempo
- ✅ Relatórios e métricas

---

## 📝 **RECOMENDAÇÃO FINAL**

### **Stack Recomendado:**

1. **Jest** - Framework de testes
2. **Socket.IO Client** - Cliente WebSocket para testes
3. **Supertest** (opcional) - Testes HTTP
4. **Detox** (futuro) - Testes mobile E2E

### **Abordagem:**

**Backend-First com Jest:**
- ✅ Rápido de implementar
- ✅ Cobertura alta
- ✅ Fácil manutenção
- ✅ Integração com CI/CD

**Mobile com Detox (Fase 2):**
- ⏳ Implementar após backend
- ⏳ Focar em fluxos críticos
- ⏳ Testes manuais complementares

---

## 🎯 **PRÓXIMOS PASSOS**

1. ✅ **Aprovar estratégia**
2. ⏳ **Configurar Jest**
3. ⏳ **Criar estrutura base**
4. ⏳ **Implementar primeiro fluxo**
5. ⏳ **Iterar e expandir**

---

**Última atualização:** 16/12/2025



