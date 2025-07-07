# 🔴 Redis API Endpoints

Documentação completa dos endpoints da API Redis para o mobile app.

## 📍 **Base URL**
```
http://192.168.0.39:5001/leaf-app-91dfdce0/us-central1
```

## 🔐 **Autenticação**
Todos os endpoints aceitam requisições sem autenticação por enquanto. Para produção, considere adicionar autenticação via Firebase Auth.

---

## 📍 **Endpoints de Localização**

### 1. **Atualizar Localização do Usuário**
```http
POST /update_user_location
```

**Body:**
```json
{
  "userId": "user123",
  "latitude": -23.5505,
  "longitude": -46.6333,
  "timestamp": 1640995200000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Localização atualizada com sucesso",
  "data": {
    "userId": "user123",
    "latitude": -23.5505,
    "longitude": -46.6333,
    "timestamp": 1640995200000
  }
}
```

### 2. **Buscar Motoristas Próximos**
```http
POST /get_nearby_drivers
```

**Body:**
```json
{
  "latitude": -23.5505,
  "longitude": -46.6333,
  "radius": 5000
}
```

**Response:**
```json
{
  "success": true,
  "drivers": [
    {
      "uid": "driver123",
      "coordinates": {
        "lat": -23.5505,
        "lng": -46.6333
      },
      "distance": 1500,
      "timestamp": 1640995200000
    }
  ],
  "total": 1,
  "source": "redis"
}
```

### 3. **Obter Localização do Usuário**
```http
GET /get_user_location/{userId}
```

**Response:**
```json
{
  "success": true,
  "location": {
    "uid": "user123",
    "latitude": -23.5505,
    "longitude": -46.6333,
    "timestamp": 1640995200000,
    "updated_at": 1640995200000
  },
  "source": "redis"
}
```

---

## 🚗 **Endpoints de Tracking**

### 4. **Iniciar Tracking de Viagem**
```http
POST /start_trip_tracking
```

**Body:**
```json
{
  "tripId": "trip123",
  "driverId": "driver123",
  "passengerId": "passenger123",
  "initialLocation": {
    "latitude": -23.5505,
    "longitude": -46.6333
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Tracking iniciado com sucesso",
  "data": {
    "tripId": "trip123",
    "startTime": 1640995200000
  }
}
```

### 5. **Atualizar Localização da Viagem**
```http
POST /update_trip_location
```

**Body:**
```json
{
  "tripId": "trip123",
  "latitude": -23.5505,
  "longitude": -46.6333,
  "timestamp": 1640995200000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Localização da viagem atualizada",
  "data": {
    "tripId": "trip123",
    "location": {
      "latitude": -23.5505,
      "longitude": -46.6333
    },
    "timestamp": 1640995200000
  }
}
```

### 6. **Finalizar Tracking de Viagem**
```http
POST /end_trip_tracking
```

**Body:**
```json
{
  "tripId": "trip123",
  "endLocation": {
    "latitude": -23.5505,
    "longitude": -46.6333
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Tracking finalizado com sucesso",
  "data": {
    "tripId": "trip123",
    "endTime": 1640995200000
  }
}
```

### 7. **Obter Dados da Viagem**
```http
GET /get_trip_data/{tripId}
```

**Response:**
```json
{
  "success": true,
  "tripData": {
    "tripId": "trip123",
    "driverId": "driver123",
    "passengerId": "passenger123",
    "status": "active",
    "startTime": 1640995200000,
    "endTime": null,
    "startLocation": {
      "latitude": -23.5505,
      "longitude": -46.6333
    },
    "currentLocation": {
      "latitude": -23.5505,
      "longitude": -46.6333
    },
    "endLocation": null,
    "updated_at": 1640995200000
  },
  "lastPoint": {
    "latitude": -23.5505,
    "longitude": -46.6333,
    "timestamp": 1640995200000
  },
  "source": "redis"
}
```

### 8. **Cancelar Tracking de Viagem**
```http
POST /cancel_trip_tracking
```

**Body:**
```json
{
  "tripId": "trip123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Tracking cancelado com sucesso",
  "data": {
    "tripId": "trip123",
    "endTime": 1640995200000
  }
}
```

### 9. **Obter Histórico de Tracking**
```http
GET /get_trip_history/{tripId}?limit=50
```

**Response:**
```json
{
  "success": true,
  "history": [
    {
      "latitude": -23.5505,
      "longitude": -46.6333,
      "timestamp": 1640995200000
    }
  ],
  "total": 1,
  "source": "redis"
}
```

### 10. **Obter Viagens Ativas**
```http
GET /get_active_trips/{userId}
```

**Response:**
```json
{
  "success": true,
  "trips": [
    {
      "tripId": "trip123",
      "driverId": "driver123",
      "passengerId": "passenger123",
      "status": "active",
      "startTime": 1640995200000,
      "startLocation": {
        "latitude": -23.5505,
        "longitude": -46.6333
      },
      "currentLocation": {
        "latitude": -23.5505,
        "longitude": -46.6333
      },
      "updated_at": 1640995200000
    }
  ],
  "total": 1,
  "source": "redis"
}
```

### 11. **Desinscrever de Tracking**
```http
POST /unsubscribe_tracking
```

**Body:**
```json
{
  "tripId": "trip123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Desinscrito de tracking com sucesso",
  "data": {
    "tripId": "trip123"
  }
}
```

---

## 📊 **Endpoints de Estatísticas**

### 12. **Obter Estatísticas do Redis**
```http
GET /get_redis_stats
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "activeTrips": 5,
    "completedTrips": 150,
    "cancelledTrips": 10,
    "onlineUsers": 25,
    "totalTrips": 165,
    "redisConnected": true,
    "timestamp": 1640995200000
  },
  "source": "redis"
}
```

### 13. **Health Check**
```http
GET /health
```

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "redis": "connected",
  "timestamp": 1640995200000
}
```

---

## 🔄 **Fallback para Firebase**

Todos os endpoints têm fallback automático para Firebase quando o Redis não está disponível. O campo `source` na resposta indica a origem dos dados:
- `"redis"` - Dados vindos do Redis
- `"firebase"` - Dados vindos do Firebase (fallback)

---

## 📱 **Uso no Mobile App**

### Exemplo de uso no React Native:

```javascript
import { redisApiService } from '../services/RedisApiService';

// Atualizar localização
await redisApiService.updateUserLocation('user123', -23.5505, -46.6333);

// Buscar motoristas próximos
const drivers = await redisApiService.getNearbyDrivers(-23.5505, -46.6333, 5000);

// Iniciar tracking
await redisApiService.startTripTracking('trip123', 'driver123', 'passenger123', {
  latitude: -23.5505,
  longitude: -46.6333
});
```

---

## ⚠️ **Códigos de Erro**

- `400` - Dados inválidos ou obrigatórios faltando
- `404` - Recurso não encontrado
- `500` - Erro interno do servidor
- `503` - Redis não disponível (fallback para Firebase)

---

## 🚀 **Deploy**

Para fazer deploy das functions:

```bash
cd functions
npm run deploy
```

Os endpoints estarão disponíveis em:
```
https://us-central1-leaf-app-91dfdce0.cloudfunctions.net/{endpoint_name}
``` 