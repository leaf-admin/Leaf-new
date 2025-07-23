# Monitoramento Baseado no Docker - Leaf Dashboard

## 🐳 Mudanças Implementadas

### 1. **Monitoramento Docker**
- ✅ Substituído monitoramento do sistema host por monitoramento do container Docker
- ✅ Métricas de CPU, memória e rede do container
- ✅ Status do container (running, stopped, error)
- ✅ Uptime do container

### 2. **Sistema de Alertas Inteligente**
- ✅ Alertas de sincronização só gerados quando há conexões ativas
- ✅ Verificação automática de conexões WebSocket, Redis e Firebase
- ✅ Status "idle" quando não há conexões ativas
- ✅ Redução de alertas desnecessários

### 3. **Métricas do Redis no Docker**
- ✅ Monitoramento do Redis dentro do container Docker
- ✅ Conexões ativas, uso de memória, operações
- ✅ Latência de resposta
- ✅ Status de conectividade

### 4. **Recursos do Sistema Docker**
- ✅ Total de containers e imagens
- ✅ Containers em execução
- ✅ Uso de disco do Docker
- ✅ Estatísticas do sistema Docker

## 📊 Novas Métricas Disponíveis

### Container Metrics
```json
{
  "container": {
    "name": "leaf-backend",
    "status": "running",
    "cpu": 0.5,
    "memory": {
      "usage": 52428800,
      "limit": 1073741824,
      "percentage": 4.9
    },
    "network": {
      "rx": 1024000,
      "tx": 512000
    },
    "uptime": 3600,
    "lastCheck": 1640995200000
  }
}
```

### Redis Metrics (Docker)
```json
{
  "redis": {
    "status": "connected",
    "connections": 5,
    "memory": 1048576,
    "operations": 1000,
    "errors": 0,
    "latency": 2,
    "lastCheck": 1640995200000
  }
}
```

### System Resources (Docker)
```json
{
  "system": {
    "totalContainers": 3,
    "runningContainers": 2,
    "totalImages": 15,
    "diskUsage": 2147483648,
    "lastCheck": 1640995200000
  }
}
```

## 🔧 Arquivos Modificados

### Backend
- `leaf-websocket-backend/monitoring/docker-monitor.js` - Novo módulo de monitoramento Docker
- `leaf-websocket-backend/monitoring/smart-sync-alert-system.js` - Sistema de alertas inteligente
- `leaf-websocket-backend/server.js` - Atualizado para usar novos módulos

### Frontend
- `leaf-dashboard/src/types/metrics.ts` - Tipos atualizados para Docker
- `leaf-dashboard/src/components/Dashboard.tsx` - Interface atualizada

## 🚀 Como Usar

### 1. Verificar Status do Docker
```bash
test-docker-metrics.bat
```

### 2. Iniciar Backend
```bash
cd leaf-websocket-backend
node server.js
```

### 3. Iniciar Dashboard
```bash
cd leaf-dashboard
start-dashboard.bat
```

## 📈 Benefícios

### Performance
- ✅ Monitoramento mais preciso do ambiente real
- ✅ Métricas baseadas no container em execução
- ✅ Redução de overhead de monitoramento

### Alertas
- ✅ Alertas relevantes apenas quando há atividade
- ✅ Status "idle" quando sistema está ocioso
- ✅ Menos ruído nos logs

### Recursos
- ✅ Uso real de CPU e memória do container
- ✅ Status do Redis dentro do Docker
- ✅ Métricas de rede do container

## 🔍 Troubleshooting

### Container não encontrado
```bash
# Verificar nome do container
docker ps

# Ajustar nome no arquivo .env
CONTAINER_NAME=seu-container-name
```

### Redis não acessível
```bash
# Verificar se Redis está rodando
docker exec leaf-redis redis-cli ping

# Verificar nome do container Redis
docker ps | grep redis
```

### Métricas não aparecem
```bash
# Verificar se backend está rodando
curl http://localhost:3001/health

# Verificar logs do backend
docker logs leaf-backend
```

## 📝 Próximos Passos

1. **Gráficos Interativos** - Implementar gráficos com Recharts
2. **WebSocket Real-time** - Atualizações em tempo real
3. **Export de Relatórios** - PDF/Excel das métricas
4. **Alertas por Email** - Notificações por email
5. **Configuração Avançada** - Painel de configurações

## 🎯 Resultado Esperado

- **CPU**: ~0.5% (baixo uso)
- **Memória**: ~5% (pouco uso)
- **Redis**: Conectado e responsivo
- **Alertas**: Apenas quando há atividade real
- **Status**: "healthy" quando tudo funcionando 

## 🐳 Mudanças Implementadas

### 1. **Monitoramento Docker**
- ✅ Substituído monitoramento do sistema host por monitoramento do container Docker
- ✅ Métricas de CPU, memória e rede do container
- ✅ Status do container (running, stopped, error)
- ✅ Uptime do container

### 2. **Sistema de Alertas Inteligente**
- ✅ Alertas de sincronização só gerados quando há conexões ativas
- ✅ Verificação automática de conexões WebSocket, Redis e Firebase
- ✅ Status "idle" quando não há conexões ativas
- ✅ Redução de alertas desnecessários

### 3. **Métricas do Redis no Docker**
- ✅ Monitoramento do Redis dentro do container Docker
- ✅ Conexões ativas, uso de memória, operações
- ✅ Latência de resposta
- ✅ Status de conectividade

### 4. **Recursos do Sistema Docker**
- ✅ Total de containers e imagens
- ✅ Containers em execução
- ✅ Uso de disco do Docker
- ✅ Estatísticas do sistema Docker

## 📊 Novas Métricas Disponíveis

### Container Metrics
```json
{
  "container": {
    "name": "leaf-backend",
    "status": "running",
    "cpu": 0.5,
    "memory": {
      "usage": 52428800,
      "limit": 1073741824,
      "percentage": 4.9
    },
    "network": {
      "rx": 1024000,
      "tx": 512000
    },
    "uptime": 3600,
    "lastCheck": 1640995200000
  }
}
```

### Redis Metrics (Docker)
```json
{
  "redis": {
    "status": "connected",
    "connections": 5,
    "memory": 1048576,
    "operations": 1000,
    "errors": 0,
    "latency": 2,
    "lastCheck": 1640995200000
  }
}
```

### System Resources (Docker)
```json
{
  "system": {
    "totalContainers": 3,
    "runningContainers": 2,
    "totalImages": 15,
    "diskUsage": 2147483648,
    "lastCheck": 1640995200000
  }
}
```

## 🔧 Arquivos Modificados

### Backend
- `leaf-websocket-backend/monitoring/docker-monitor.js` - Novo módulo de monitoramento Docker
- `leaf-websocket-backend/monitoring/smart-sync-alert-system.js` - Sistema de alertas inteligente
- `leaf-websocket-backend/server.js` - Atualizado para usar novos módulos

### Frontend
- `leaf-dashboard/src/types/metrics.ts` - Tipos atualizados para Docker
- `leaf-dashboard/src/components/Dashboard.tsx` - Interface atualizada

## 🚀 Como Usar

### 1. Verificar Status do Docker
```bash
test-docker-metrics.bat
```

### 2. Iniciar Backend
```bash
cd leaf-websocket-backend
node server.js
```

### 3. Iniciar Dashboard
```bash
cd leaf-dashboard
start-dashboard.bat
```

## 📈 Benefícios

### Performance
- ✅ Monitoramento mais preciso do ambiente real
- ✅ Métricas baseadas no container em execução
- ✅ Redução de overhead de monitoramento

### Alertas
- ✅ Alertas relevantes apenas quando há atividade
- ✅ Status "idle" quando sistema está ocioso
- ✅ Menos ruído nos logs

### Recursos
- ✅ Uso real de CPU e memória do container
- ✅ Status do Redis dentro do Docker
- ✅ Métricas de rede do container

## 🔍 Troubleshooting

### Container não encontrado
```bash
# Verificar nome do container
docker ps

# Ajustar nome no arquivo .env
CONTAINER_NAME=seu-container-name
```

### Redis não acessível
```bash
# Verificar se Redis está rodando
docker exec leaf-redis redis-cli ping

# Verificar nome do container Redis
docker ps | grep redis
```

### Métricas não aparecem
```bash
# Verificar se backend está rodando
curl http://localhost:3001/health

# Verificar logs do backend
docker logs leaf-backend
```

## 📝 Próximos Passos

1. **Gráficos Interativos** - Implementar gráficos com Recharts
2. **WebSocket Real-time** - Atualizações em tempo real
3. **Export de Relatórios** - PDF/Excel das métricas
4. **Alertas por Email** - Notificações por email
5. **Configuração Avançada** - Painel de configurações

## 🎯 Resultado Esperado

- **CPU**: ~0.5% (baixo uso)
- **Memória**: ~5% (pouco uso)
- **Redis**: Conectado e responsivo
- **Alertas**: Apenas quando há atividade real
- **Status**: "healthy" quando tudo funcionando 

## 🐳 Mudanças Implementadas

### 1. **Monitoramento Docker**
- ✅ Substituído monitoramento do sistema host por monitoramento do container Docker
- ✅ Métricas de CPU, memória e rede do container
- ✅ Status do container (running, stopped, error)
- ✅ Uptime do container

### 2. **Sistema de Alertas Inteligente**
- ✅ Alertas de sincronização só gerados quando há conexões ativas
- ✅ Verificação automática de conexões WebSocket, Redis e Firebase
- ✅ Status "idle" quando não há conexões ativas
- ✅ Redução de alertas desnecessários

### 3. **Métricas do Redis no Docker**
- ✅ Monitoramento do Redis dentro do container Docker
- ✅ Conexões ativas, uso de memória, operações
- ✅ Latência de resposta
- ✅ Status de conectividade

### 4. **Recursos do Sistema Docker**
- ✅ Total de containers e imagens
- ✅ Containers em execução
- ✅ Uso de disco do Docker
- ✅ Estatísticas do sistema Docker

## 📊 Novas Métricas Disponíveis

### Container Metrics
```json
{
  "container": {
    "name": "leaf-backend",
    "status": "running",
    "cpu": 0.5,
    "memory": {
      "usage": 52428800,
      "limit": 1073741824,
      "percentage": 4.9
    },
    "network": {
      "rx": 1024000,
      "tx": 512000
    },
    "uptime": 3600,
    "lastCheck": 1640995200000
  }
}
```

### Redis Metrics (Docker)
```json
{
  "redis": {
    "status": "connected",
    "connections": 5,
    "memory": 1048576,
    "operations": 1000,
    "errors": 0,
    "latency": 2,
    "lastCheck": 1640995200000
  }
}
```

### System Resources (Docker)
```json
{
  "system": {
    "totalContainers": 3,
    "runningContainers": 2,
    "totalImages": 15,
    "diskUsage": 2147483648,
    "lastCheck": 1640995200000
  }
}
```

## 🔧 Arquivos Modificados

### Backend
- `leaf-websocket-backend/monitoring/docker-monitor.js` - Novo módulo de monitoramento Docker
- `leaf-websocket-backend/monitoring/smart-sync-alert-system.js` - Sistema de alertas inteligente
- `leaf-websocket-backend/server.js` - Atualizado para usar novos módulos

### Frontend
- `leaf-dashboard/src/types/metrics.ts` - Tipos atualizados para Docker
- `leaf-dashboard/src/components/Dashboard.tsx` - Interface atualizada

## 🚀 Como Usar

### 1. Verificar Status do Docker
```bash
test-docker-metrics.bat
```

### 2. Iniciar Backend
```bash
cd leaf-websocket-backend
node server.js
```

### 3. Iniciar Dashboard
```bash
cd leaf-dashboard
start-dashboard.bat
```

## 📈 Benefícios

### Performance
- ✅ Monitoramento mais preciso do ambiente real
- ✅ Métricas baseadas no container em execução
- ✅ Redução de overhead de monitoramento

### Alertas
- ✅ Alertas relevantes apenas quando há atividade
- ✅ Status "idle" quando sistema está ocioso
- ✅ Menos ruído nos logs

### Recursos
- ✅ Uso real de CPU e memória do container
- ✅ Status do Redis dentro do Docker
- ✅ Métricas de rede do container

## 🔍 Troubleshooting

### Container não encontrado
```bash
# Verificar nome do container
docker ps

# Ajustar nome no arquivo .env
CONTAINER_NAME=seu-container-name
```

### Redis não acessível
```bash
# Verificar se Redis está rodando
docker exec leaf-redis redis-cli ping

# Verificar nome do container Redis
docker ps | grep redis
```

### Métricas não aparecem
```bash
# Verificar se backend está rodando
curl http://localhost:3001/health

# Verificar logs do backend
docker logs leaf-backend
```

## 📝 Próximos Passos

1. **Gráficos Interativos** - Implementar gráficos com Recharts
2. **WebSocket Real-time** - Atualizações em tempo real
3. **Export de Relatórios** - PDF/Excel das métricas
4. **Alertas por Email** - Notificações por email
5. **Configuração Avançada** - Painel de configurações

## 🎯 Resultado Esperado

- **CPU**: ~0.5% (baixo uso)
- **Memória**: ~5% (pouco uso)
- **Redis**: Conectado e responsivo
- **Alertas**: Apenas quando há atividade real
- **Status**: "healthy" quando tudo funcionando 