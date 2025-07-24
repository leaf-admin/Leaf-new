# 📚 Documentação das APIs Redis

## 🎯 Visão Geral

Este documento descreve as APIs Redis implementadas no backend Firebase Functions para suportar localização em tempo real e tracking de viagens.

## 🚀 APIs Disponíveis

### 1. **POST** `/save_user_location`
**Salva a localização atual do usuário no Redis**

**Headers:**
```
Authorization: Bearer <firebase_token>
Content-Type: application/json
```

**Body:**
```json
{
  "lat": -22.9068,
  "lng": -43.1729,
  "timestamp": 1640995200000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Localização salva com sucesso",
  "data": {
    "uid": "user123",
    "lat": -22.9068,
    "lng": -43.1729,
    "timestamp": 1640995200000,
    "updatedAt": "2024-01-01T12:00:00.000Z"
  }
}
```

---

### 2. **GET** `/get_user_location`
**Obtém a localização atual do usuário**

**Headers:**
```
Authorization: Bearer <firebase_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "lat": -22.9068,
    "lng": -43.1729,
    "timestamp": 1640995200000,
    "updatedAt": "2024-01-01T12:00:00.000Z"
  }
}
```

---

### 3. **GET** `/get_nearby_users`
**Busca usuários próximos a uma localização**

**Headers:**
```
Authorization: Bearer <firebase_token>
```

**Query Parameters:**
- `lat` (required): Latitude
- `lng` (required): Longitude
- `radius` (optional): Raio em km (default: 5)
- `limit` (optional): Limite de resultados (default: 10)
- `userType` (optional): Tipo de usuário (driver, passenger)

**Example:**
```
GET /get_nearby_users?lat=-22.9068&lng=-43.1729&radius=3&limit=5&userType=driver
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "uid": "driver123",
      "lat": -22.9100,
      "lng": -43.1750,
      "distance": 0.5
    }
  ],
  "count": 1
}
```

---

### 4. **POST** `/start_trip_tracking`
**Inicia o tracking de uma viagem**

**Headers:**
```
Authorization: Bearer <firebase_token>
Content-Type: application/json
```

**Body:**
```json
{
  "tripId": "trip_123",
  "driverId": "driver_456",
  "passengerId": "passenger_789",
  "initialLocation": {
    "lat": -22.9068,
    "lng": -43.1729
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Tracking iniciado com sucesso",
  "data": {
    "tripId": "trip_123",
    "status": "active"
  }
}
```

---

### 5. **POST** `/update_trip_location`
**Atualiza a localização de uma viagem em andamento**

**Headers:**
```
Authorization: Bearer <firebase_token>
Content-Type: application/json
```

**Body:**
```json
{
  "tripId": "trip_123",
  "lat": -22.9100,
  "lng": -43.1750,
  "timestamp": 1640995200000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Localização atualizada com sucesso",
  "data": {
    "tripId": "trip_123",
    "location": {
      "lat": -22.9100,
      "lng": -43.1750
    }
  }
}
```

---

### 6. **POST** `/end_trip_tracking`
**Finaliza o tracking de uma viagem**

**Headers:**
```
Authorization: Bearer <firebase_token>
Content-Type: application/json
```

**Body:**
```json
{
  "tripId": "trip_123",
  "endLocation": {
    "lat": -22.9200,
    "lng": -43.1800
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Tracking finalizado com sucesso",
  "data": {
    "tripId": "trip_123",
    "status": "completed"
  }
}
```

---

### 7. **GET** `/get_trip_data`
**Obtém dados completos de uma viagem**

**Headers:**
```
Authorization: Bearer <firebase_token>
```

**Query Parameters:**
- `tripId` (required): ID da viagem

**Example:**
```
GET /get_trip_data?tripId=trip_123
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tripId": "trip_123",
    "driverId": "driver_456",
    "passengerId": "passenger_789",
    "status": "active",
    "startTime": 1640995200000,
    "startLocation": {
      "lat": -22.9068,
      "lng": -43.1729
    },
    "currentLocation": {
      "lat": -22.9100,
      "lng": -43.1750
    },
    "endLocation": null,
    "endTime": null,
    "path": [
      {
        "lat": -22.9068,
        "lng": -43.1729,
        "timestamp": 1640995200000
      },
      {
        "lat": -22.9100,
        "lng": -43.1750,
        "timestamp": 1640995260000
      }
    ],
    "updatedAt": "2024-01-01T12:00:00.000Z"
  }
}
```

---

### 8. **GET** `/get_redis_stats`
**Obtém estatísticas do Redis**

**Headers:**
```
Authorization: Bearer <firebase_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "redisInfo": "Redis server info...",
    "activeTrips": 5,
    "completedTrips": 25,
    "onlineUsers": 12,
    "isConnected": true
  }
}
```

## 🔧 Configuração

### Variáveis de Ambiente

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Feature Flags
ENABLE_REDIS=true
REDIS_PRIMARY=true
FIREBASE_FALLBACK=true
FIRESTORE_PERSISTENCE=true
```

### Instalação de Dependências

```bash
cd functions
npm install redis@4.6.10
```

## 🗂️ Estrutura de Dados Redis

### Chaves de Localização
- `user:location:{uid}` - Localização atual do usuário
- `users:online` - Set de usuários online
- `locations:geo` - Dados geoespaciais (se GEO disponível)

### Chaves de Tracking
- `trip:{tripId}` - Dados da viagem
- `trip_path:{tripId}` - Histórico de localizações
- `active_trips` - Set de viagens ativas
- `completed_trips` - Set de viagens finalizadas

### TTL (Time To Live)
- Localização do usuário: 30 minutos
- Dados de viagem: 24 horas
- Histórico de tracking: 24 horas

## 🔒 Autenticação

Todas as APIs requerem autenticação via Firebase Auth:

1. Obter token do Firebase Auth
2. Incluir no header: `Authorization: Bearer <token>`
3. O backend valida o token e extrai o UID do usuário

## 🚨 Tratamento de Erros

### Códigos de Erro Comuns

- `400` - Dados inválidos ou faltando
- `401` - Token inválido ou não fornecido
- `500` - Erro interno do servidor ou Redis indisponível

### Exemplo de Erro
```json
{
  "success": false,
  "error": "Latitude e longitude são obrigatórios"
}
```

## 📊 Monitoramento

### Logs
- Todas as operações são logadas no Firebase Functions
- Logs incluem: operação, usuário, timestamp, resultado

### Métricas
- Número de viagens ativas
- Usuários online
- Viagens finalizadas
- Status de conexão Redis

## 🔄 Estratégia Híbrida

### Fallback para Firebase
- Se Redis falhar, usa Firebase Realtime Database
- Dados são migrados automaticamente para Firestore
- Garantia de disponibilidade de dados

### Migração Gradual
- Feature flags controlam o uso do Redis
- Migração pode ser ativada/desativada por funcionalidade
- Compatibilidade total com sistema existente

## 🧪 Testes

### Teste de Conectividade
```bash
curl -X GET "https://your-project.cloudfunctions.net/get_redis_stats" \
  -H "Authorization: Bearer <token>"
```

### Teste de Localização
```bash
curl -X POST "https://your-project.cloudfunctions.net/save_user_location" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"lat": -22.9068, "lng": -43.1729}'
```

## 📈 Performance

### Otimizações
- Conexão Redis singleton
- TTL automático para limpeza
- Limite de pontos de tracking (100 por viagem)
- Fallback para busca sem GEO

### Benchmarks Esperados
- Latência de localização: < 50ms
- Atualização de tracking: < 100ms
- Busca de usuários próximos: < 200ms

## 🔮 Roadmap

### Próximas Funcionalidades
- [ ] Pub/Sub para notificações em tempo real
- [ ] Cache de dados de usuário
- [ ] Analytics de viagens
- [ ] Otimização de rotas
- [ ] Backup automático para Firestore

### Melhorias Planejadas
- [ ] Clustering Redis
- [ ] Compressão de dados
- [ ] Cache inteligente
- [ ] Métricas avançadas 