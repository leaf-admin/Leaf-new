# 🧪 TESTS - Índice de Testes

**Pasta:** `/tests`  
**Descrição:** Todos os testes do projeto organizados por categoria

---

## 📁 **Estrutura de Pastas**

### **🔗 Integração**
- **Pasta:** `integration/`
- **Descrição:** Testes de integração entre componentes
- **Arquivos:** Testes de API, WebSocket, Redis, Firebase

### **⚡ Performance**
- **Pasta:** `performance/`
- **Descrição:** Testes de performance e carga
- **Arquivos:** Testes de stress, benchmark, otimização

### **🧩 Unitários**
- **Pasta:** `unit/`
- **Descrição:** Testes unitários de funções e componentes
- **Arquivos:** Testes isolados de módulos

### **🌐 WebSocket**
- **Pasta:** `websocket/`
- **Descrição:** Testes específicos de WebSocket
- **Arquivos:** Conexão, eventos, sincronização

### **🔧 Setup**
- **Pasta:** `setup/`
- **Descrição:** Testes de configuração e setup
- **Arquivos:** Instalação, configuração, ambiente

### **🗄️ Redis**
- **Pasta:** `redis/`
- **Descrição:** Testes específicos do Redis
- **Arquivos:** Conexão, operações, otimização

### **📱 Mobile**
- **Pasta:** `mobile/`
- **Descrição:** Testes específicos do app mobile
- **Arquivos:** Componentes, navegação, funcionalidades

### **📊 Load**
- **Pasta:** `load/`
- **Descrição:** Testes de carga e stress
- **Arquivos:** Múltiplos usuários, performance

### **🔥 Firebase**
- **Pasta:** `firebase/`
- **Descrição:** Testes específicos do Firebase
- **Arquivos:** Autenticação, Firestore, Functions

### **🔐 Auth**
- **Pasta:** `auth/`
- **Descrição:** Testes de autenticação
- **Arquivos:** Login, registro, permissões

### **📜 Scripts**
- **Pasta:** `scripts/`
- **Descrição:** Scripts auxiliares para testes
- **Arquivos:** Utilitários, helpers, setup

---

## 🚀 **Como Executar os Testes**

### **Executar Todos os Testes:**
```bash
# Executar todos os testes
npm test

# Ou executar por categoria
npm run test:integration
npm run test:unit
npm run test:performance
```

### **Executar Testes Específicos:**
```bash
# Testes de integração
node tests/integration/test-redis-optimization.cjs

# Testes de performance
node tests/performance/test-load-performance.cjs

# Testes de WebSocket
node tests/websocket/test-websocket-only.cjs
```

### **Executar Testes por Ambiente:**
```bash
# Desenvolvimento
npm run test:dev

# Produção
npm run test:prod

# Staging
npm run test:staging
```

---

## 📋 **Tipos de Teste**

### **🔗 Testes de Integração**
- **Objetivo:** Verificar se os componentes funcionam juntos
- **Exemplos:** API + Redis, WebSocket + Firebase, Mobile + Backend
- **Frequência:** Antes de cada deploy

### **⚡ Testes de Performance**
- **Objetivo:** Verificar performance e escalabilidade
- **Exemplos:** Carga de usuários, tempo de resposta, uso de memória
- **Frequência:** Semanalmente

### **🧩 Testes Unitários**
- **Objetivo:** Verificar funções individuais
- **Exemplos:** Cálculos, validações, utilitários
- **Frequência:** A cada mudança de código

### **🌐 Testes de WebSocket**
- **Objetivo:** Verificar comunicação em tempo real
- **Exemplos:** Conexão, desconexão, eventos, sincronização
- **Frequência:** Antes de cada release

---

## 📊 **Cobertura de Testes**

### **Métricas:**
- **Cobertura de Código:** >80%
- **Testes de Integração:** 100% das APIs
- **Testes de Performance:** 100% dos endpoints críticos
- **Testes de Segurança:** 100% das autenticações

### **Relatórios:**
- **Cobertura:** `coverage/`
- **Logs:** `logs/`
- **Resultados:** `results/`

---

## 🔧 **Configuração**

### **Variáveis de Ambiente:**
```bash
# .env.test
NODE_ENV=test
TEST_DATABASE_URL=test-db-url
TEST_REDIS_URL=test-redis-url
TEST_FIREBASE_PROJECT=test-project
```

### **Scripts de Setup:**
```bash
# Setup do ambiente de teste
npm run test:setup

# Limpar dados de teste
npm run test:clean

# Reset do banco de teste
npm run test:reset
```

---

## 📝 **Padrões de Nomenclatura**

### **Arquivos de Teste:**
- `test-*.cjs` - Testes de integração
- `test-*.js` - Testes unitários
- `test-*.spec.js` - Testes específicos
- `test-*.bench.js` - Benchmarks

### **Pastas:**
- `integration/` - Testes de integração
- `unit/` - Testes unitários
- `performance/` - Testes de performance
- `e2e/` - Testes end-to-end

---

## ⚠️ **Observações Importantes**

### **Antes de Executar:**
1. **Configurar ambiente** de teste
2. **Instalar dependências** de teste
3. **Configurar banco** de teste
4. **Verificar permissões** de arquivo

### **Durante os Testes:**
1. **Não executar** em produção
2. **Usar dados** de teste
3. **Limpar** após execução
4. **Verificar** logs de erro

### **Após os Testes:**
1. **Analisar** resultados
2. **Corrigir** falhas
3. **Atualizar** documentação
4. **Limpar** dados temporários

---

## 📚 **Documentação Adicional**

- **README-TESTES.md** - Documentação detalhada dos testes
- **Guia de Testes** - Como escrever novos testes
- **Padrões de Teste** - Convenções e boas práticas
- **Troubleshooting** - Solução de problemas comuns 