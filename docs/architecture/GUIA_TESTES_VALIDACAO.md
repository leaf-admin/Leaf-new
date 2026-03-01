# 🧪 GUIA COMPLETO DE TESTES E VALIDAÇÃO - LEAF

## 📋 **VISÃO GERAL**

Este guia fornece instruções detalhadas para testar e validar todo o sistema LEAF, incluindo backend, dashboard, integrações Firebase/Redis e funcionalidades de negócio.

---

## 🎯 **OBJETIVOS DOS TESTES**

### **✅ O que Validar:**
1. **Funcionamento do Backend** - Servidor HTTP + WebSocket
2. **Integração Firebase** - Dados reais sendo carregados
3. **Sistema de Cache Redis** - Performance e consistência
4. **Dashboard Frontend** - Interface funcionando corretamente
5. **Sistema de Notificações** - FCM funcionando
6. **Aprovação de Motoristas** - Fluxo completo
7. **Sincronização Automática** - Firebase ↔ Redis
8. **Performance Geral** - Tempo de resposta e escalabilidade

---

## 🚀 **PREPARAÇÃO DO AMBIENTE**

### **📦 Instalação de Dependências:**

```bash
# Backend
cd leaf-websocket-backend
npm install

# Dashboard
cd leaf-dashboard
npm install

# Testes
cd tests/integration
npm install node-fetch ioredis
```

### **⚙️ Configuração de Ambiente:**

```bash
# .env (leaf-websocket-backend)
REDIS_URL=redis://localhost:6379
FIREBASE_DATABASE_URL=https://seu-projeto.firebaseio.com
PORT=3001
NODE_ENV=development
```

### **🔧 Verificar Serviços:**

```bash
# Redis
redis-cli ping
# Deve retornar: PONG

# Firebase (verificar arquivo de configuração)
ls leaf-websocket-backend/firebase-config.js
```

---

## 🧪 **TESTES AUTOMATIZADOS**

### **1. 🚀 Teste Completo do Sistema:**

```bash
# Executar teste completo
cd tests/integration
node test-complete-metrics-system.cjs
```

**O que testa:**
- ✅ Todos os endpoints HTTP
- ✅ Conexão Redis
- ✅ Estrutura das respostas
- ✅ Performance dos endpoints
- ✅ Consistência dos dados

### **2. 📊 Testes Específicos:**

```bash
# Teste de métricas de usuários
node test-user-metrics.cjs

# Teste do sistema FCM
node test-fcm-system.cjs

# Teste do sistema de rating
node test-rating-system.cjs
```

---

## 🔍 **TESTES MANUAIS PASSO A PASSO**

### **FASE 1: 🏗️ INFRAESTRUTURA BÁSICA**

#### **1.1 Testar Backend:**
```bash
# Terminal 1: Iniciar backend
cd leaf-websocket-backend
npm start

# Verificar logs:
# ✅ Servidor WebSocket iniciado na porta 3001
# ✅ Firebase Admin inicializado
# ✅ Redis conectado
# ✅ Todos os serviços inicializados
```

#### **1.2 Testar Health Check:**
```bash
# Terminal 2: Testar endpoints básicos
curl http://localhost:3001/health
curl http://localhost:3001/health/detailed

# Respostas esperadas:
# /health: {"status":"healthy","timestamp":"..."}
# /health/detailed: {"summary":"...","details":"..."}
```

#### **1.3 Testar Conexão Redis:**
```bash
# Terminal 3: Verificar Redis
redis-cli
> ping
PONG
> keys metrics:*
# Deve retornar chaves de cache (pode estar vazio inicialmente)
```

### **FASE 2: 📊 SISTEMA DE MÉTRICAS**

#### **2.1 Testar Endpoint Principal:**
```bash
# Testar métricas gerais
curl http://localhost:3001/metrics

# Verificar estrutura da resposta:
{
  "timestamp": "...",
  "userStats": { ... },
  "financialStats": { ... },
  "performanceStats": { ... },
  "approvalStats": { ... },
  "system": { ... }
}
```

#### **2.2 Testar Estatísticas de Usuários:**
```bash
# Testar estatísticas de usuários
curl http://localhost:3001/stats/users

# Verificar campos obrigatórios:
{
  "stats": {
    "totalUsers": 0,
    "totalCustomers": 0,
    "totalDrivers": 0,
    "onlineUsers": 0,
    "pendingApprovals": 0,
    "approvedDrivers": 0,
    "rejectedDrivers": 0
  }
}
```

#### **2.3 Testar Métricas Financeiras:**
```bash
# Testar métricas financeiras
curl http://localhost:3001/stats/financial

# Verificar campos obrigatórios:
{
  "financial": {
    "totalRevenue": 0,
    "totalCosts": 0,
    "totalProfit": 0,
    "totalTrips": 0,
    "averageTripValue": 0
  }
}
```

#### **2.4 Testar Métricas em Tempo Real:**
```bash
# Testar métricas em tempo real
curl http://localhost:3001/metrics/realtime

# Verificar campos obrigatórios:
{
  "timestamp": "...",
  "activeUsers": { ... },
  "activeTrips": { ... },
  "systemLoad": { ... },
  "alerts": []
}
```

### **FASE 3: 🚗 SISTEMA DE APROVAÇÃO**

#### **3.1 Testar Busca de Aprovações:**
```bash
# Testar busca de aprovações pendentes
curl "http://localhost:3001/driver-approvals?status=pending&page=0&limit=10"

# Resposta esperada:
{
  "result": {
    "approvals": [],
    "total": 0,
    "page": 0,
    "limit": 10,
    "hasMore": false
  }
}
```

#### **3.2 Testar Estatísticas de Aprovação:**
```bash
# Testar estatísticas de aprovação
curl http://localhost:3001/driver-approval-stats

# Resposta esperada:
{
  "stats": {
    "totalApprovals": 0,
    "pendingApprovals": 0,
    "approvedDrivers": 0,
    "rejectedDrivers": 0,
    "approvalRate": 0
  }
}
```

### **FASE 4: 📱 DASHBOARD FRONTEND**

#### **4.1 Iniciar Dashboard:**
```bash
# Terminal 4: Iniciar dashboard
cd leaf-dashboard
npm start

# Acessar: http://localhost:3002
```

#### **4.2 Verificar Carregamento:**
- ✅ Dashboard carrega sem erros
- ✅ Métricas são exibidas (mesmo que sejam zeros)
- ✅ Seção de aprovação de motoristas está visível
- ✅ Não há erros no console do navegador

#### **4.3 Testar Funcionalidades:**
- ✅ Filtros de aprovação funcionam
- ✅ Estatísticas são atualizadas
- ✅ Interface responsiva

---

## 🔌 **TESTES WEBSOCKET**

### **1. 📡 Testar Conexão WebSocket:**

```bash
# Usar ferramenta como wscat ou Postman
wscat -c ws://localhost:3001

# Enviar evento de teste:
{"type":"test","data":"hello"}
```

### **2. 🚗 Testar Eventos de Aprovação:**

```javascript
// Conectar via JavaScript
const socket = io('http://localhost:3001');

// Testar busca de aprovações
socket.emit('get_driver_approvals', { status: 'pending' });

// Escutar resposta
socket.on('driver_approvals_loaded', (data) => {
  console.log('Aprovações carregadas:', data);
});

// Testar estatísticas
socket.emit('get_driver_approval_stats');

socket.on('driver_approval_stats_loaded', (data) => {
  console.log('Estatísticas:', data);
});
```

---

## 📊 **VALIDAÇÃO DE DADOS**

### **1. 🔍 Verificar Estrutura das Respostas:**

#### **Métricas Gerais:**
```json
{
  "timestamp": "string (ISO 8601)",
  "userStats": {
    "totalUsers": "number",
    "totalCustomers": "number",
    "totalDrivers": "number",
    "onlineUsers": "number"
  },
  "financialStats": {
    "totalRevenue": "number",
    "totalTrips": "number",
    "profitMargin": "number"
  },
  "performanceStats": {
    "totalTrips": "number",
    "completionRate": "number",
    "averageWaitTime": "number"
  },
  "approvalStats": {
    "totalApprovals": "number",
    "pendingApprovals": "number",
    "approvalRate": "number"
  },
  "system": {
    "status": "string",
    "uptime": "number",
    "version": "string"
  }
}
```

#### **Estatísticas de Usuários:**
```json
{
  "stats": {
    "totalUsers": "number",
    "totalCustomers": "number",
    "totalDrivers": "number",
    "onlineUsers": "number",
    "pendingApprovals": "number",
    "approvedDrivers": "number",
    "rejectedDrivers": "number",
    "approvalRate": "number"
  }
}
```

### **2. 🔢 Validar Tipos de Dados:**

- ✅ **Números:** Todos os campos numéricos são números válidos
- ✅ **Strings:** Timestamps são strings ISO 8601 válidas
- ✅ **Objetos:** Estruturas aninhadas estão corretas
- ✅ **Arrays:** Listas estão vazias ou contêm objetos válidos

### **3. 📈 Validar Consistência:**

- ✅ **Total de usuários** = customers + drivers
- ✅ **Taxa de aprovação** = (approved / total) * 100
- ✅ **Margem de lucro** = (profit / revenue) * 100
- ✅ **Timestamps** são recentes (últimos 5 minutos)

---

## ⚡ **TESTES DE PERFORMANCE**

### **1. 🚀 Tempo de Resposta:**

```bash
# Testar performance dos endpoints
time curl http://localhost:3001/metrics
time curl http://localhost:3001/stats/users
time curl http://localhost:3001/stats/financial

# Tempos esperados:
# - Com cache: < 100ms
# - Sem cache: < 2000ms
# - Primeira requisição: < 5000ms
```

### **2. 📊 Teste de Carga Simples:**

```bash
# Testar múltiplas requisições simultâneas
for i in {1..10}; do
  curl http://localhost:3001/metrics &
done
wait

# Verificar se todas retornaram sucesso
```

### **3. 🔄 Teste de Cache:**

```bash
# Primeira requisição (sem cache)
time curl http://localhost:3001/metrics

# Segunda requisição (com cache)
time curl http://localhost:3001/metrics

# A segunda deve ser significativamente mais rápida
```

---

## 🚨 **TESTES DE ERRO E RECUPERAÇÃO**

### **1. ❌ Testar Cenários de Erro:**

```bash
# Testar endpoint inexistente
curl http://localhost:3001/endpoint-inexistente
# Deve retornar 404

# Testar parâmetros inválidos
curl "http://localhost:3001/driver-approvals?status=invalid"
# Deve retornar 400 ou 500 com mensagem de erro
```

### **2. 🔄 Testar Recuperação:**

```bash
# Parar Redis temporariamente
sudo systemctl stop redis

# Fazer requisição
curl http://localhost:3001/metrics
# Deve retornar erro apropriado

# Reiniciar Redis
sudo systemctl start redis

# Fazer requisição novamente
curl http://localhost:3001/metrics
# Deve funcionar normalmente
```

---

## 📱 **TESTES DE NOTIFICAÇÕES FCM**

### **1. 🔧 Configuração FCM:**

```bash
# Verificar arquivo de configuração
ls leaf-websocket-backend/config/firebase-service-account.json

# Verificar variáveis de ambiente
echo $FIREBASE_PROJECT_ID
echo $FIREBASE_DATABASE_URL
```

### **2. 📱 Testar Envio de Notificação:**

```javascript
// Via WebSocket
socket.emit('test_notification', {
  driverId: 'test_driver',
  title: 'Teste de Notificação',
  body: 'Esta é uma notificação de teste'
});
```

### **3. 📊 Verificar Histórico:**

```bash
# Verificar logs de notificação
grep "FCM" leaf-websocket-backend/logs/app.log

# Verificar Firebase Console
# Ir para: Firebase Console > Cloud Messaging > Reports
```

---

## 🔄 **TESTES DE SINCRONIZAÇÃO**

### **1. ⏰ Verificar Sincronização Automática:**

```bash
# Verificar logs de sincronização
grep "Sync Service" leaf-websocket-backend/logs/app.log

# Deve mostrar mensagens como:
# "🔄 Sincronização automática iniciada a cada 300 segundos"
# "✅ Sincronização completa concluída em Xms"
```

### **2. 🔄 Testar Sincronização Manual:**

```javascript
// Via WebSocket (se implementado)
socket.emit('force_sync');

// Ou via HTTP (se implementado)
curl -X POST http://localhost:3001/sync/force
```

### **3. 📊 Verificar Dados Sincronizados:**

```bash
# Verificar chaves Redis após sincronização
redis-cli keys "driver_approval:*"
redis-cli keys "metrics:*"

# Deve haver chaves de dados sincronizados
```

---

## 📋 **CHECKLIST DE VALIDAÇÃO**

### **✅ INFRAESTRUTURA:**
- [ ] Backend inicia sem erros
- [ ] Redis conecta corretamente
- [ ] Firebase Admin inicializa
- [ ] Todos os serviços estão ativos

### **✅ ENDPOINTS HTTP:**
- [ ] `/health` retorna status healthy
- [ ] `/metrics` retorna estrutura correta
- [ ] `/stats/users` retorna estatísticas
- [ ] `/stats/financial` retorna métricas financeiras
- [ ] `/metrics/realtime` retorna dados em tempo real

### **✅ SISTEMA DE APROVAÇÃO:**
- [ ] `/driver-approvals` retorna lista (mesmo vazia)
- [ ] `/driver-approval-stats` retorna estatísticas
- [ ] WebSocket responde a eventos de aprovação

### **✅ DASHBOARD:**
- [ ] Interface carrega sem erros
- [ ] Métricas são exibidas
- [ ] Seção de aprovação está visível
- [ ] Console do navegador sem erros

### **✅ PERFORMANCE:**
- [ ] Primeira requisição < 5s
- [ ] Requisições com cache < 100ms
- [ ] Sistema suporta múltiplas requisições
- [ ] Cache Redis está funcionando

### **✅ INTEGRAÇÃO:**
- [ ] Dados Firebase são carregados
- [ ] Cache Redis é preenchido
- [ ] Sincronização automática funciona
- [ ] Notificações FCM estão configuradas

---

## 🚨 **PROBLEMAS COMUNS E SOLUÇÕES**

### **1. ❌ Backend não inicia:**

**Sintomas:**
- Erro de porta em uso
- Erro de conexão Redis
- Erro de configuração Firebase

**Soluções:**
```bash
# Verificar porta
lsof -i :3001
kill -9 <PID>

# Verificar Redis
sudo systemctl status redis
sudo systemctl start redis

# Verificar Firebase
ls leaf-websocket-backend/firebase-config.js
```

### **2. ❌ Dashboard não carrega métricas:**

**Sintomas:**
- Loading infinito
- Erros 404/500
- Dados sempre vazios

**Soluções:**
```bash
# Verificar se backend está rodando
curl http://localhost:3001/health

# Verificar console do navegador
# Verificar Network tab para erros HTTP
```

### **3. ❌ Cache Redis não funciona:**

**Sintomas:**
- Todas as requisições são lentas
- Sem chaves metrics:* no Redis

**Soluções:**
```bash
# Verificar conexão Redis
redis-cli ping

# Verificar chaves
redis-cli keys "*"

# Limpar e recriar cache
redis-cli flushall
```

---

## 📊 **MÉTRICAS DE SUCESSO**

### **🎯 Critérios de Aprovação:**

- ✅ **100% dos endpoints** retornam respostas válidas
- ✅ **Tempo de resposta** < 100ms para dados em cache
- ✅ **Taxa de erro** < 1% em condições normais
- ✅ **Cache hit rate** > 80% após aquecimento
- ✅ **Dashboard** carrega e exibe dados corretamente
- ✅ **WebSocket** responde a eventos em < 500ms
- ✅ **Sincronização** completa em < 30 segundos

### **📈 KPIs de Performance:**

- **Latência P95:** < 200ms
- **Throughput:** > 100 req/s
- **Uptime:** > 99.9%
- **Error Rate:** < 0.1%
- **Cache Efficiency:** > 85%

---

## 🎉 **CONCLUSÃO DOS TESTES**

### **✅ SISTEMA APROVADO:**
- Todos os endpoints funcionando
- Performance dentro dos parâmetros
- Integração Firebase/Redis operacional
- Dashboard funcional
- WebSocket responsivo

### **⚠️ SISTEMA COM PROBLEMAS:**
- Verificar logs de erro
- Validar configurações
- Testar conectividade
- Verificar dependências

### **❌ SISTEMA NÃO FUNCIONAL:**
- Revisar implementação
- Verificar arquitetura
- Validar configurações
- Consultar documentação

---

## 📞 **SUPORTE E AJUDA**

### **🔧 Em caso de problemas:**
1. **Verificar logs** do backend
2. **Consultar documentação** técnica
3. **Executar testes** de diagnóstico
4. **Contatar equipe** de desenvolvimento

### **📚 Recursos adicionais:**
- **Logs do sistema:** `leaf-websocket-backend/logs/`
- **Documentação técnica:** `docs/`
- **Testes de diagnóstico:** `tests/`
- **Configurações:** `config/`

---

*Última atualização: Janeiro 2024*
*Versão: 1.0.0*
*Status: Completo e Testado*
