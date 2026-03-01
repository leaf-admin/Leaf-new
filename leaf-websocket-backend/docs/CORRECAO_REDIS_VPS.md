# 🔧 CORREÇÃO: Redis na VPS

**Data:** 2025-01-29  
**Problema:** Erro "Erro ao conectar ao Redis" durante criação de booking

---

## 🔍 PROBLEMA IDENTIFICADO

### **Sintoma:**
- Teste de criação de booking falhava com erro: "Erro ao conectar ao Redis"
- Redis não estava conectando automaticamente

### **Causa Raiz:**
1. **Configuração incorreta do host:** O código estava usando `host: 'redis'` (para Docker) ao invés de `localhost` na VPS
2. **Lazy Connect:** Redis estava configurado com `lazyConnect: true`, não conectando automaticamente
3. **Falta de verificação de conexão:** Código não garantia conexão antes de usar

---

## ✅ CORREÇÕES APLICADAS

### **1. Configuração do Host (`utils/redis-pool.js`)**

**Antes:**
```javascript
host: process.env.REDIS_HOST || 'redis', // ❌ 'redis' é para Docker
```

**Depois:**
```javascript
// ✅ CORREÇÃO: Na VPS, usar localhost ao invés de 'redis'
const defaultHost = process.env.NODE_ENV === 'production' ? 'localhost' : (process.env.REDIS_HOST || 'localhost');
host: defaultHost,
```

### **2. Conexão Automática (`utils/redis-pool.js`)**

**Antes:**
```javascript
lazyConnect: true, // ❌ Não conecta automaticamente
```

**Depois:**
```javascript
lazyConnect: false, // ✅ Conectar imediatamente
```

### **3. Método `ensureConnection()` (`utils/redis-pool.js`)**

**Novo método adicionado:**
```javascript
async ensureConnection() {
    try {
        if (!this.pool) {
            throw new Error('Redis pool não inicializado');
        }
        
        if (this.pool.status === 'ready') {
            return true;
        }
        
        if (this.pool.status === 'end' || this.pool.status === 'close') {
            logger.info('🔄 Reconectando Redis...');
            await this.pool.connect();
            return true;
        }
        
        // Se está conectando, aguardar
        if (this.pool.status === 'connecting' || this.pool.status === 'connect') {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout aguardando conexão Redis'));
                }, 10000);
                
                this.pool.once('ready', () => {
                    clearTimeout(timeout);
                    resolve(true);
                });
                
                this.pool.once('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            });
        }
        
        return false;
    } catch (error) {
        logger.error(`❌ Erro ao garantir conexão Redis: ${error.message}`);
        throw error;
    }
}
```

### **4. Uso no `createBooking` (`server.js`)**

**Antes:**
```javascript
const redis = redisPool.getConnection();

// Garantir conexão Redis
if (redis.status !== 'ready' && redis.status !== 'connect') {
    try {
        await redis.connect();
    } catch (connectError) {
        // ...
    }
}
```

**Depois:**
```javascript
// ✅ CORREÇÃO: Garantir conexão Redis antes de usar
try {
    await redisPool.ensureConnection();
} catch (redisError) {
    console.error('❌ Erro ao garantir conexão Redis:', redisError);
    socket.emit('bookingError', { 
        error: 'Erro ao conectar ao Redis',
        message: redisError.message 
    });
    return;
}

const redis = redisPool.getConnection();
```

### **5. Melhorias no Tratamento de Erros**

- ✅ Logs mais detalhados
- ✅ Retry strategy aumentada (3 → 10 tentativas)
- ✅ Melhor tratamento de erros de conexão

---

## 🧪 TESTE

Para testar se a correção funcionou:

```bash
cd leaf-websocket-backend
node scripts/tests/test-eventos-listeners-completo.js
```

**Resultado esperado:**
- ✅ Autenticação: PASSED
- ✅ Status do Motorista: (pode falhar se motorista não tiver veículo - esperado)
- ✅ Criação de Booking: **PASSED** (não deve mais dar erro de Redis)

---

## 📋 CHECKLIST DE VERIFICAÇÃO

- [x] Host do Redis corrigido para `localhost` na VPS
- [x] `lazyConnect` alterado para `false`
- [x] Método `ensureConnection()` implementado
- [x] `createBooking` usando `ensureConnection()`
- [x] Logs melhorados
- [x] Retry strategy aumentada

---

## 🔄 PRÓXIMOS PASSOS

1. **Aplicar em outros lugares:** Verificar outros pontos do código que usam Redis e aplicar `ensureConnection()`

2. **Monitoramento:** Adicionar métricas de conexão Redis no dashboard

3. **Health Check:** Melhorar o endpoint `/health` para incluir status do Redis

---

**Status:** ✅ **CORRIGIDO**

