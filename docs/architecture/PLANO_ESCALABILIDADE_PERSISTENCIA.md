# 📈 PLANO DE ESCALABILIDADE: PERSISTÊNCIA DE CORRIDAS

## 📅 Data: 16 de Dezembro de 2025

---

## 🎯 **ESTRATÉGIA DE ESCALABILIDADE GRADUAL**

### **Filosofia:**
> **"Comece simples, escale quando necessário"**
> 
> Não otimize prematuramente. A arquitetura deve permitir migração suave sem grandes refatorações.

---

## 📊 **LIMITES E PONTOS DE MIGRAÇÃO**

### **FASE 1: Redis Standalone (0 - 10k corridas/dia)** ⭐ ATUAL

#### **Capacidade:**
- **Corridas/dia**: 0 - 10.000
- **Corridas/hora**: 0 - 417
- **Corridas/minuto**: 0 - 7
- **Operações Redis/segundo**: ~50-100 ops/s
- **Memória Redis**: ~2-4 GB
- **CPU**: 2-4 cores

#### **Limites Técnicos:**
- ✅ **Memória**: Redis pode armazenar ~500k-1M chaves (depende do tamanho)
- ✅ **Throughput**: ~10k-50k operações/segundo (depende da VPS)
- ✅ **Concorrência**: Suporta centenas de conexões simultâneas
- ✅ **Latência**: < 5ms para operações locais

#### **Quando Migrar:**
- ⚠️ **Memória Redis > 80%**: Considerar upgrade ou migração
- ⚠️ **Latência > 10ms**: Indicador de sobrecarga
- ⚠️ **CPU > 80%**: Processador no limite
- ⚠️ **Falhas de conexão**: Redis não aguenta carga
- ⚠️ **Corridas/dia > 8k**: Próximo do limite, preparar migração

#### **Custo:**
- VPS: R$ 50-100/mês
- Firestore: ~R$ 1-2/mês
- **Total: ~R$ 51-102/mês**

---

### **FASE 2: Redis Replica (10k - 50k corridas/dia)** 🔄 MIGRAÇÃO

#### **Capacidade:**
- **Corridas/dia**: 10.000 - 50.000
- **Corridas/hora**: 417 - 2.083
- **Corridas/minuto**: 7 - 35
- **Operações Redis/segundo**: ~100-500 ops/s
- **Memória Redis**: ~4-16 GB (total)
- **CPU**: 4-8 cores

#### **Melhorias:**
- ✅ **Alta Disponibilidade**: Failover automático
- ✅ **Backup Automático**: Replicação em tempo real
- ✅ **Read Scaling**: Leitura distribuída (Master + Slave)
- ✅ **Durabilidade**: Dados em 2 instâncias

#### **Quando Migrar:**
- ⚠️ **Corridas/dia > 8k**: Iniciar planejamento
- ⚠️ **Downtime inaceitável**: Precisa de alta disponibilidade
- ⚠️ **Memória Redis > 6GB**: Necessário mais memória
- ⚠️ **Latência inconsistente**: Indicador de sobrecarga

#### **Custo:**
- VPS Master: R$ 100-200/mês
- VPS Slave: R$ 100-200/mês
- **OU** Redis Cloud (com replica): R$ 150-300/mês
- Firestore: ~R$ 5-10/mês
- **Total: ~R$ 205-410/mês (VPS) ou ~R$ 155-310/mês (Cloud)**

---

### **FASE 3: Redis Cluster (50k+ corridas/dia)** 🚀 ESCALA

#### **Capacidade:**
- **Corridas/dia**: 50.000+
- **Corridas/hora**: 2.083+
- **Corridas/minuto**: 35+
- **Operações Redis/segundo**: 500+ ops/s
- **Memória Redis**: 16+ GB (distribuída)
- **CPU**: 8+ cores

#### **Melhorias:**
- ✅ **Escalabilidade Horizontal**: Adicionar nós conforme necessário
- ✅ **Alta Disponibilidade**: Múltiplos nós, failover automático
- ✅ **Distribuição**: Dados distribuídos entre nós
- ✅ **Performance**: Mantém latência baixa mesmo com alta carga

#### **Quando Migrar:**
- ⚠️ **Corridas/dia > 40k**: Iniciar planejamento
- ⚠️ **Necessidade de múltiplas regiões**: Expansão geográfica
- ⚠️ **Memória > 16GB**: Necessário sharding
- ⚠️ **Throughput > 500 ops/s**: Necessário distribuição

#### **Custo:**
- Redis Cluster (3 nodes mínimo): R$ 300-600/mês
- Firestore: ~R$ 20-50/mês
- **Total: ~R$ 320-650/mês**

---

## 🔄 **PLANO DE MIGRAÇÃO SUAVE**

### **MIGRAÇÃO: FASE 1 → FASE 2 (Redis Standalone → Replica)**

#### **Pré-requisitos:**
- ✅ Código já preparado para múltiplas conexões Redis
- ✅ Serviço de persistência abstraído
- ✅ Monitoramento configurado

#### **Passo 1: Preparação (1-2 dias)**
```javascript
// 1. Atualizar configuração para suportar múltiplas conexões
const redisConfig = {
  master: {
    host: process.env.REDIS_MASTER_HOST,
    port: process.env.REDIS_MASTER_PORT
  },
  slave: {
    host: process.env.REDIS_SLAVE_HOST,
    port: process.env.REDIS_SLAVE_PORT
  }
};

// 2. Criar pool de conexões
const redisMaster = redis.createClient(redisConfig.master);
const redisSlave = redis.createClient(redisConfig.slave);
```

#### **Passo 2: Setup Redis Replica (2-4 horas)**
```bash
# 1. Instalar Redis Slave em nova VPS
# 2. Configurar replica no redis.conf do Slave:
replicaof <master-ip> <master-port>

# 3. Configurar Sentinel para failover automático
# 4. Testar replicação
```

#### **Passo 3: Migração Gradual (1-2 dias)**
```javascript
// 1. Modo Dual-Write (temporário)
async saveRide(rideData) {
  // Escrever no Master (principal)
  await redisMaster.hset(`booking:${rideData.rideId}`, rideData);
  
  // Escrever no Slave também (durante migração)
  try {
    await redisSlave.hset(`booking:${rideData.rideId}`, rideData);
  } catch (error) {
    // Não bloquear se Slave falhar
    logger.warn('Slave write failed, continuing with Master');
  }
}

// 2. Leitura do Slave (read scaling)
async getRide(rideId) {
  try {
    // Tentar ler do Slave primeiro (menos carga no Master)
    return await redisSlave.hgetall(`booking:${rideId}`);
  } catch (error) {
    // Fallback para Master
    return await redisMaster.hgetall(`booking:${rideId}`);
  }
}
```

#### **Passo 4: Validação (1 dia)**
- ✅ Verificar replicação funcionando
- ✅ Testar failover automático
- ✅ Validar performance
- ✅ Monitorar métricas

#### **Passo 5: Ativação Completa (1 dia)**
- ✅ Desativar modo dual-write
- ✅ Usar apenas Master para writes
- ✅ Usar Slave para reads
- ✅ Configurar Sentinel para failover

#### **Tempo Total: 5-7 dias**
#### **Downtime: 0 minutos** (migração sem interrupção)

---

### **MIGRAÇÃO: FASE 2 → FASE 3 (Redis Replica → Cluster)**

#### **Pré-requisitos:**
- ✅ Redis Replica funcionando estável
- ✅ Experiência com Redis avançado
- ✅ Necessidade comprovada de escala

#### **Passo 1: Planejamento (3-5 dias)**
- ✅ Analisar padrões de acesso
- ✅ Definir estratégia de sharding
- ✅ Planejar migração de dados
- ✅ Preparar infraestrutura

#### **Passo 2: Setup Cluster (1-2 dias)**
```bash
# 1. Criar 3+ instâncias Redis
# 2. Configurar Redis Cluster
redis-cli --cluster create \
  node1:6379 node2:6379 node3:6379 \
  --cluster-replicas 1

# 3. Configurar client para usar cluster mode
```

#### **Passo 3: Migração de Dados (2-3 dias)**
```javascript
// 1. Migrar dados existentes
async migrateToCluster() {
  const keys = await redisMaster.keys('booking:*');
  
  for (const key of keys) {
    const data = await redisMaster.hgetall(key);
    await redisCluster.hset(key, data);
  }
}

// 2. Validar migração
// 3. Atualizar código para usar cluster
```

#### **Passo 4: Validação e Ativação (2-3 dias)**
- ✅ Testar cluster completo
- ✅ Validar performance
- ✅ Monitorar métricas
- ✅ Ativar produção

#### **Tempo Total: 8-13 dias**
#### **Downtime: 0-30 minutos** (depende da estratégia)

---

## 📊 **INDICADORES DE PERFORMANCE**

### **Métricas para Monitorar:**

#### **Redis:**
- ✅ **Memória usada**: `INFO memory`
- ✅ **Conexões ativas**: `INFO clients`
- ✅ **Comandos/segundo**: `INFO stats`
- ✅ **Latência**: `redis-cli --latency`
- ✅ **Keys expiradas**: `INFO stats` → `expired_keys`

#### **Aplicação:**
- ✅ **Taxa de criação de corridas**: corridas/segundo
- ✅ **Taxa de finalização**: corridas/segundo
- ✅ **Latência de operações**: p50, p95, p99
- ✅ **Taxa de erro**: erros/operações

#### **Firestore:**
- ✅ **Writes/segundo**: Operações de escrita
- ✅ **Custo mensal**: R$ gastos
- ✅ **Latência de escrita**: Tempo de resposta

---

## 🚨 **ALERTAS E TRIGGERS**

### **Alertas para Migração FASE 1 → FASE 2:**

```javascript
const alerts = {
  memory: {
    threshold: 0.80, // 80% de memória usada
    action: 'Considerar upgrade de memória ou migração'
  },
  latency: {
    threshold: 10, // 10ms de latência
    action: 'Investigar causa e considerar migração'
  },
  cpu: {
    threshold: 0.80, // 80% de CPU
    action: 'Considerar upgrade ou migração'
  },
  ridesPerDay: {
    threshold: 8000, // 8k corridas/dia
    action: 'Iniciar planejamento de migração para Replica'
  },
  connectionErrors: {
    threshold: 10, // 10 erros/hora
    action: 'Investigar e considerar migração'
  }
};
```

### **Alertas para Migração FASE 2 → FASE 3:**

```javascript
const alerts = {
  ridesPerDay: {
    threshold: 40000, // 40k corridas/dia
    action: 'Iniciar planejamento de migração para Cluster'
  },
  memory: {
    threshold: 0.90, // 90% de memória
    action: 'Necessário sharding (Cluster)'
  },
  throughput: {
    threshold: 500, // 500 ops/s
    action: 'Considerar Cluster para distribuição'
  }
};
```

---

## 💰 **ANÁLISE DE CUSTO POR FASE**

### **FASE 1: Redis Standalone**
```
Corridas/dia: 10.000
Custo/mês: R$ 51-102
Custo/corrida: R$ 0.0051 - 0.0102
```

### **FASE 2: Redis Replica**
```
Corridas/dia: 50.000
Custo/mês: R$ 205-410 (VPS) ou R$ 155-310 (Cloud)
Custo/corrida: R$ 0.0041 - 0.0082 (VPS) ou R$ 0.0031 - 0.0062 (Cloud)
```

### **FASE 3: Redis Cluster**
```
Corridas/dia: 50.000+
Custo/mês: R$ 320-650
Custo/corrida: R$ 0.0064 - 0.013 (diminui com escala)
```

**Observação:** O custo por corrida diminui com escala devido à economia de escala.

---

## 🔧 **ARQUITETURA PREPARADA PARA ESCALA**

### **Abstração de Persistência:**

```javascript
// services/ride-persistence-service.js
class RidePersistenceService {
  constructor() {
    // Configuração dinâmica baseada em variáveis de ambiente
    this.redisMode = process.env.REDIS_MODE || 'standalone'; // standalone, replica, cluster
    this.redis = this.initializeRedis();
  }
  
  initializeRedis() {
    switch (this.redisMode) {
      case 'standalone':
        return redis.createClient({
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT
        });
        
      case 'replica':
        return {
          master: redis.createClient({
            host: process.env.REDIS_MASTER_HOST,
            port: process.env.REDIS_MASTER_PORT
          }),
          slave: redis.createClient({
            host: process.env.REDIS_SLAVE_HOST,
            port: process.env.REDIS_SLAVE_PORT
          })
        };
        
      case 'cluster':
        return new Redis.Cluster([
          { host: process.env.REDIS_CLUSTER_NODE1, port: 6379 },
          { host: process.env.REDIS_CLUSTER_NODE2, port: 6379 },
          { host: process.env.REDIS_CLUSTER_NODE3, port: 6379 }
        ]);
        
      default:
        throw new Error(`Redis mode ${this.redisMode} not supported`);
    }
  }
  
  async saveRide(rideData) {
    // Lógica unificada, funciona com qualquer modo
    if (this.redisMode === 'replica') {
      await this.redis.master.hset(`booking:${rideData.rideId}`, rideData);
    } else {
      await this.redis.hset(`booking:${rideData.rideId}`, rideData);
    }
  }
  
  async getRide(rideId) {
    // Lógica unificada
    if (this.redisMode === 'replica') {
      // Tentar Slave primeiro (read scaling)
      try {
        return await this.redis.slave.hgetall(`booking:${rideId}`);
      } catch (error) {
        return await this.redis.master.hgetall(`booking:${rideId}`);
      }
    } else {
      return await this.redis.hgetall(`booking:${rideId}`);
    }
  }
}
```

### **Vantagens desta Abstração:**
- ✅ **Migração sem mudança de código**: Apenas variáveis de ambiente
- ✅ **Testável**: Fácil testar diferentes modos
- ✅ **Flexível**: Suporta todos os modos
- ✅ **Manutenível**: Lógica centralizada

---

## 📋 **CHECKLIST DE MIGRAÇÃO**

### **Antes de Migrar FASE 1 → FASE 2:**
- [ ] Monitorar métricas por 1 semana
- [ ] Confirmar necessidade (corridas/dia > 8k)
- [ ] Preparar infraestrutura (VPS Slave)
- [ ] Atualizar código para suportar múltiplas conexões
- [ ] Criar plano de rollback
- [ ] Agendar janela de migração
- [ ] Notificar equipe

### **Durante Migração:**
- [ ] Configurar Redis Slave
- [ ] Testar replicação
- [ ] Ativar modo dual-write
- [ ] Validar dados
- [ ] Configurar Sentinel
- [ ] Testar failover
- [ ] Ativar produção

### **Após Migração:**
- [ ] Monitorar métricas por 1 semana
- [ ] Validar performance
- [ ] Documentar mudanças
- [ ] Treinar equipe
- [ ] Atualizar documentação

---

## 🎯 **RECOMENDAÇÃO FINAL**

### **Para Começar:**
✅ **FASE 1: Redis Standalone + Firestore (começo/fim)**

### **Quando Escalar:**
- **8k corridas/dia**: Iniciar planejamento FASE 2
- **10k corridas/dia**: Migrar para FASE 2
- **40k corridas/dia**: Iniciar planejamento FASE 3
- **50k corridas/dia**: Migrar para FASE 3

### **Vantagens desta Estratégia:**
- ✅ **Custo otimizado**: Paga apenas pelo que precisa
- ✅ **Migração suave**: Sem grandes refatorações
- ✅ **Escalável**: Suporta crescimento gradual
- ✅ **Flexível**: Arquitetura preparada para mudanças

---

## 📝 **CONCLUSÃO**

**Resposta à pergunta:**
> **"E quando passar de 10k corridas/dia?"**

**Resposta:**
1. ✅ **Arquitetura preparada**: Código já suporta migração
2. ✅ **Plano definido**: Migração suave para Redis Replica
3. ✅ **Sem refatoração**: Apenas mudança de configuração
4. ✅ **Downtime zero**: Migração sem interrupção
5. ✅ **Custo controlado**: Escala conforme necessidade

**A arquitetura atual é preparada para escalar. Quando chegar em 8-10k corridas/dia, a migração para Redis Replica é simples e rápida (5-7 dias).**

---

**Última atualização:** 16/12/2025



