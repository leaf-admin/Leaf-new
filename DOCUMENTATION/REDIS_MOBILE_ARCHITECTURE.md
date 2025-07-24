# Arquitetura Redis para Mobile App - LEAF

## Visão Geral

Este documento explica como o Redis foi integrado ao mobile app LEAF usando uma arquitetura de APIs HTTP, já que o cliente Redis não pode ser usado diretamente no React Native.

## Por que não usar ioredis diretamente no mobile?

### Problemas Técnicos
1. **APIs do Node.js ausentes**: ioredis depende de módulos como `node:crypto`, `node:net`, `node:tls` que não existem no React Native
2. **Arquitetura de rede**: React Native usa APIs nativas diferentes para conexões de rede
3. **Segurança**: Aplicativos móveis não devem conectar diretamente a bancos de dados

### Solução
```
📱 Mobile App (React Native)
    ↓ HTTP/WebSocket
🌐 Backend API (Firebase Functions)
    ↓ Redis Client
🔴 Redis Server
```

## Arquitetura Implementada

### 1. Firebase Functions (Backend)
- **Arquivo**: `functions/redis-api.js`
- **Função**: Expor APIs HTTP para o mobile app acessar dados do Redis
- **Autenticação**: Firebase Auth tokens
- **Fallback**: Firebase Realtime Database quando Redis não está disponível

### 2. Mobile App (Frontend)
- **Serviço**: `mobile-app/src/services/RedisApiService.js`
- **Hook**: `mobile-app/src/hooks/useLocationWithRedis.js`
- **Função**: Consumir APIs HTTP e gerenciar estado local

## APIs Disponíveis

### 1. Salvar Localização
```javascript
// POST /saveUserLocation
{
  "lat": -23.5505,
  "lng": -46.6333,
  "timestamp": 1640995200000
}
```

### 2. Buscar Motoristas Próximos
```javascript
// GET /getNearbyDrivers?lat=-23.5505&lng=-46.6333&radius=5000&limit=10
{
  "success": true,
  "drivers": [
    {
      "uid": "driver123",
      "lat": -23.5505,
      "lng": -46.6333,
      "distance": 150,
      "timestamp": 1640995200000
    }
  ],
  "total": 1,
  "source": "redis"
}
```

### 3. Obter Localização do Usuário
```javascript
// GET /getUserLocation/{uid}
{
  "success": true,
  "location": {
    "uid": "user123",
    "lat": -23.5505,
    "lng": -46.6333,
    "timestamp": 1640995200000,
    "updated_at": 1640995200000
  },
  "source": "redis"
}
```

### 4. Atualizar Status do Motorista
```javascript
// POST /updateDriverStatus
{
  "status": "available",
  "isOnline": true
}
```

### 5. Estatísticas do Redis
```javascript
// GET /getRedisStats
{
  "success": true,
  "stats": {
    "online_users": 15,
    "offline_users": 5,
    "total_users": 20,
    "redis_info": "..."
  }
}
```

## Como Usar no Mobile App

### 1. Inicializar o Serviço
```javascript
import redisApiService from '../services/RedisApiService';

// Inicializar
await redisApiService.initialize();

// Verificar se está disponível
const isHealthy = await redisApiService.checkServiceHealth();
```

### 2. Usar o Hook de Localização
```javascript
import { useLocationWithRedis } from '../hooks/useLocationWithRedis';

const {
  location,
  redisAvailable,
  fetchNearbyDrivers,
  updateDriverStatus,
  startLocationTracking
} = useLocationWithRedis();

// Buscar motoristas próximos
const drivers = await fetchNearbyDrivers(lat, lng, 5000, 10);

// Atualizar status
await updateDriverStatus('available', true);
```

### 3. Usar o Serviço Diretamente
```javascript
// Salvar localização
await redisApiService.saveUserLocation(lat, lng, timestamp);

// Buscar motoristas
const response = await redisApiService.getNearbyDrivers(lat, lng, radius, limit);

// Obter estatísticas
const stats = await redisApiService.getRedisStats();
```

## Estratégia de Fallback

### 1. Redis Primário
- APIs tentam usar Redis primeiro
- Melhor performance para operações de localização
- Suporte a comandos GEO para busca por proximidade

### 2. Firebase Fallback
- Se Redis não estiver disponível, usa Firebase
- Garante que o app continue funcionando
- Dados são sincronizados entre Redis e Firebase

### 3. Detecção Automática
- O hook detecta automaticamente se Redis está disponível
- Muda dinamicamente entre Redis e Firebase
- Logs indicam qual fonte está sendo usada

## Configuração

### 1. Firebase Functions
```javascript
// functions/redis-api.js
const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || null,
    db: process.env.REDIS_DB || 0
};
```

### 2. Mobile App
```javascript
// mobile-app/src/services/RedisApiService.js
const API_BASE_URL = __DEV__ 
    ? 'http://localhost:5001/your-project/us-central1'  // Dev
    : 'https://us-central1-your-project.cloudfunctions.net'; // Prod
```

## Vantagens da Nova Arquitetura

### 1. Compatibilidade
- ✅ Funciona no React Native
- ✅ Sem problemas de bundling
- ✅ Sem dependências do Node.js

### 2. Segurança
- ✅ Autenticação via Firebase Auth
- ✅ APIs protegidas por tokens
- ✅ Sem exposição direta do Redis

### 3. Performance
- ✅ Redis para operações rápidas
- ✅ Firebase como fallback confiável
- ✅ Cache automático no mobile

### 4. Escalabilidade
- ✅ APIs podem ser escaladas independentemente
- ✅ Redis pode ser clusterizado
- ✅ Load balancing nas APIs

## Monitoramento e Debug

### 1. Logs
```javascript
// Logs automáticos em todas as operações
console.log('📍 Location saved to Redis via API');
console.log('⚠️ Redis API failed, falling back to Firebase');
console.log('🔍 Found 5 drivers via Redis API');
```

### 2. Status da API
```javascript
// Verificar saúde da API
const isHealthy = await redisApiService.checkServiceHealth();
```

### 3. Estatísticas
```javascript
// Obter estatísticas do sistema
const stats = await redisApiService.getRedisStats();
```

## Próximos Passos

1. **Deploy das APIs**: Fazer deploy das Firebase Functions
2. **Testes**: Testar todas as APIs no ambiente de desenvolvimento
3. **Monitoramento**: Implementar métricas e alertas
4. **Otimização**: Ajustar configurações de performance
5. **Documentação**: Criar documentação da API para desenvolvedores

## Conclusão

Esta arquitetura resolve os problemas de compatibilidade do Redis no React Native, mantendo a performance e adicionando segurança. O sistema é robusto com fallbacks automáticos e pode ser facilmente monitorado e escalado. 