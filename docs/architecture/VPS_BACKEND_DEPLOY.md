# 🚀 DEPLOY BACKEND PARA VPS/VULTR

## 📦 ARQUIVOS NECESSÁRIOS

### Servidor WebSocket
- `leaf-websocket-backend/server.js` ✅ CORRIGIDO
- `leaf-websocket-backend/package.json`
- `leaf-websocket-backend/node_modules/` (dependências)

## 🔧 CORREÇÕES IMPLEMENTADAS NO SERVIDOR

### 1. Cluster Mode Desabilitado em Desenvolvimento
```javascript
// Antes: Sempre cluster mode
if (cluster.isMaster) {
    // ... cluster code
}

// Depois: Cluster apenas em produção
if (cluster.isMaster && process.env.NODE_ENV === 'production') {
    // ... cluster code
} else {
    // Modo desenvolvimento - servidor único
    console.log('🔧 Modo desenvolvimento: Executando servidor único');
}
```

### 2. Health Check Corrigido
```javascript
// Antes: Erro ao acessar cluster.worker.id em desenvolvimento
instanceId: `ultra-worker-${cluster.worker.id}`

// Depois: Condicional baseado no ambiente
instanceId: process.env.NODE_ENV === 'production' 
    ? `ultra-worker-${cluster.worker?.id || 'N/A'}` 
    : `dev-server-${process.pid}`
```

### 3. Logs Otimizados
- Logs específicos para desenvolvimento vs produção
- Contagem de workers correta (1 em dev, múltiplos em prod)
- Status de cluster mode no health check

## 🚀 COMANDOS PARA DEPLOY NA VPS

```bash
# 1. Acessar VPS
ssh root@your-vps-ip

# 2. Ir para diretório do projeto
cd /path/to/leaf-backend

# 3. Fazer backup do servidor atual
cp server.js server.js.backup-$(date +%Y%m%d-%H%M%S)

# 4. Atualizar servidor (copiar novo server.js)
# (copiar arquivo server.js atualizado)

# 5. Instalar/atualizar dependências
npm install

# 6. Parar servidor atual
pm2 stop leaf-websocket-server

# 7. Iniciar servidor atualizado
pm2 start server.js --name leaf-websocket-server

# 8. Verificar status
pm2 status

# 9. Verificar logs
pm2 logs leaf-websocket-server

# 10. Testar health check
curl http://localhost:3001/health
```

## 🧪 TESTE DE FUNCIONAMENTO

```bash
# Testar conectividade
curl http://localhost:3001/health

# Resposta esperada:
{
  "status": "healthy",
  "instanceId": "dev-server-12345",
  "clusterMode": false,
  "port": 3001,
  "timestamp": "2025-10-25T12:30:00.000Z",
  "metrics": {
    "connections": 0,
    "memory": {...},
    "uptime": 123.45,
    "workers": 1,
    "maxConnections": 500000
  }
}
```

## 🔍 VERIFICAÇÕES PÓS-DEPLOY

1. **Health Check**: `curl http://localhost:3001/health`
2. **Logs**: `pm2 logs leaf-websocket-server`
3. **Status**: `pm2 status`
4. **Conexões**: Verificar se WebSocket está aceitando conexões
5. **Eventos**: Testar eventos básicos (authenticate, setDriverStatus)

## 📊 RESULTADO ESPERADO

- ✅ Servidor rodando em modo desenvolvimento (sem cluster)
- ✅ Health check funcionando sem erros
- ✅ Logs limpos e informativos
- ✅ WebSocket aceitando conexões
- ✅ Todos os eventos funcionando
