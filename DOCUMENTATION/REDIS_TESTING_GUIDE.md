# 🧪 Guia Completo de Testes Redis

## 🎯 **Visão Geral dos Testes**

Este guia cobre todos os testes necessários para validar a implementação Redis completa, desde o banco de dados até as APIs e integração com o frontend.

---

## 📋 **Checklist de Testes**

### **Fase 1: Infraestrutura Redis**
- [ ] Banco de dados Redis
- [ ] Configuração Docker
- [ ] Conectividade básica
- [ ] Comandos GEO
- [ ] Persistência de dados

### **Fase 2: APIs Backend**
- [ ] Autenticação Firebase
- [ ] APIs de localização
- [ ] APIs de tracking
- [ ] Tratamento de erros
- [ ] Performance

### **Fase 3: Integração Frontend**
- [ ] Hooks React Native
- [ ] Actions Redux
- [ ] Serviços Redis
- [ ] Feature flags
- [ ] Fallback Firebase

### **Fase 4: Cenários Completos**
- [ ] Fluxo de viagem completo
- [ ] Múltiplos usuários
- [ ] Performance em carga
- [ ] Recuperação de falhas

---

## 🗄️ **Fase 1: Testes de Infraestrutura**

### **1.1 Teste de Inicialização do Banco**

```bash
# Executar script de inicialização
quick-start-redis.bat

# Verificar se o container está rodando
docker ps | grep redis

# Testar conectividade básica
docker exec redis-taxi-app redis-cli ping
```

**Resultado Esperado:**
```
✅ Redis iniciado com sucesso!
✅ Container rodando
✅ PONG
```

### **1.2 Teste de Configuração**

```bash
# Verificar configurações
docker exec redis-taxi-app redis-cli CONFIG GET maxmemory
docker exec redis-taxi-app redis-cli CONFIG GET appendonly
docker exec redis-taxi-app redis-cli CONFIG GET port
```

**Resultado Esperado:**
```
maxmemory: 268435456 (256MB)
appendonly: yes
port: 6379
```

### **1.3 Teste de Comandos GEO**

```bash
# Teste GEOADD
docker exec redis-taxi-app redis-cli GEOADD test_geo 13.361389 38.115556 "Palermo" 15.087269 37.502669 "Catania"

# Teste GEORADIUS
docker exec redis-taxi-app redis-cli GEORADIUS test_geo 13.361389 38.115556 100 km WITHCOORD WITHDIST

# Teste GEODIST
docker exec redis-taxi-app redis-cli GEODIST test_geo "Palermo" "Catania" km

# Limpar teste
docker exec redis-taxi-app redis-cli DEL test_geo
```

**Resultado Esperado:**
```
✅ GEOADD: 2
✅ GEORADIUS: retorna coordenadas e distâncias
✅ GEODIST: ~166.2742 km
```

### **1.4 Teste de Persistência**

```bash
# Salvar dados
docker exec redis-taxi-app redis-cli SET test_persistence "Hello Redis"
docker exec redis-taxi-app redis-cli SAVE

# Verificar arquivos de persistência
docker exec redis-taxi-app ls -la /data/

# Reiniciar container
    docker-compose restart redis

# Verificar se dados persistiram
docker exec redis-taxi-app redis-cli GET test_persistence

# Limpar
docker exec redis-taxi-app redis-cli DEL test_persistence
```

**Resultado Esperado:**
```
✅ Dados salvos
✅ Arquivos AOF/RDB presentes
✅ Dados persistiram após restart
```

---

## 🔌 **Fase 2: Testes das APIs Backend**

### **2.1 Teste de Autenticação**

```bash
# Obter token Firebase (substitua com token real)
TOKEN="your_firebase_token_here"

# Teste sem token
curl -X GET "http://localhost:5001/your-project/us-central1/get_redis_stats"

# Teste com token válido
curl -X GET "http://localhost:5001/your-project/us-central1/get_redis_stats" \
  -H "Authorization: Bearer $TOKEN"
```

**Resultado Esperado:**
```
❌ Sem token: 401 Unauthorized
✅ Com token: 200 OK + dados Redis
```

### **2.2 Teste de APIs de Localização**

```bash
# 1. Salvar localização
curl -X POST "http://localhost:5001/your-project/us-central1/save_user_location" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "lat": -22.9068,
    "lng": -43.1729,
    "timestamp": 1640995200000
  }'

# 2. Obter localização
curl -X GET "http://localhost:5001/your-project/us-central1/get_user_location" \
  -H "Authorization: Bearer $TOKEN"

# 3. Buscar usuários próximos
curl -X GET "http://localhost:5001/your-project/us-central1/get_nearby_users?lat=-22.9068&lng=-43.1729&radius=5&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

**Resultado Esperado:**
```
✅ POST: 200 OK + dados salvos
✅ GET: 200 OK + localização atual
✅ Nearby: 200 OK + lista de usuários
```

### **2.3 Teste de APIs de Tracking**

```bash
TRIP_ID="test-trip-$(date +%s)"

# 1. Iniciar tracking
curl -X POST "http://localhost:5001/your-project/us-central1/start_trip_tracking" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tripId": "'$TRIP_ID'",
    "driverId": "driver-123",
    "passengerId": "passenger-456",
    "initialLocation": {
      "lat": -22.9068,
      "lng": -43.1729
    }
  }'

# 2. Atualizar localização
curl -X POST "http://localhost:5001/your-project/us-central1/update_trip_location" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tripId": "'$TRIP_ID'",
    "lat": -22.9100,
    "lng": -43.1750,
    "timestamp": 1640995260000
  }'

# 3. Obter dados da viagem
curl -X GET "http://localhost:5001/your-project/us-central1/get_trip_data?tripId=$TRIP_ID" \
  -H "Authorization: Bearer $TOKEN"

# 4. Finalizar tracking
curl -X POST "http://localhost:5001/your-project/us-central1/end_trip_tracking" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tripId": "'$TRIP_ID'",
    "endLocation": {
      "lat": -22.9200,
      "lng": -43.1800
    }
  }'
```

**Resultado Esperado:**
```
✅ Start: 200 OK + trip iniciado
✅ Update: 200 OK + localização atualizada
✅ Get Data: 200 OK + dados completos da viagem
✅ End: 200 OK + trip finalizado
```

### **2.4 Teste de Performance**

```bash
# Script de teste de performance
node test-redis-apis.js
```

**Métricas Esperadas:**
```
✅ Latência média: < 100ms
✅ Throughput: > 100 req/s
✅ Taxa de erro: < 1%
```

---

## 📱 **Fase 3: Testes de Integração Frontend**

### **3.1 Teste dos Hooks React Native**

```javascript
// Teste do hook useRedisLocation
import { useRedisLocation } from '../hooks/useRedisLocation';

const TestComponent = () => {
  const { 
    saveLocation, 
    getLocation, 
    nearbyUsers, 
    loading, 
    error 
  } = useRedisLocation();

  // Teste de salvamento
  const testSaveLocation = async () => {
    const result = await saveLocation({
      lat: -22.9068,
      lng: -43.1729
    });
    console.log('Save result:', result);
  };

  // Teste de busca
  const testGetNearby = async () => {
    const users = await nearbyUsers({
      lat: -22.9068,
      lng: -43.1729,
      radius: 5
    });
    console.log('Nearby users:', users);
  };

  return (
    <View>
      <Button title="Test Save" onPress={testSaveLocation} />
      <Button title="Test Nearby" onPress={testGetNearby} />
    </View>
  );
};
```

### **3.2 Teste dos Hooks de Tracking**

```javascript
// Teste do hook useRedisTracking
import { useRedisTracking } from '../hooks/useRedisTracking';

const TestTrackingComponent = () => {
  const { 
    startTrip, 
    updateLocation, 
    endTrip, 
    tripData, 
    loading 
  } = useRedisTracking();

  const testCompleteTrip = async () => {
    const tripId = `test-${Date.now()}`;
    
    // 1. Iniciar viagem
    await startTrip(tripId, {
      driverId: 'driver-123',
      passengerId: 'passenger-456',
      initialLocation: { lat: -22.9068, lng: -43.1729 }
    });

    // 2. Atualizar localizações
    await updateLocation(tripId, { lat: -22.9100, lng: -43.1750 });
    await updateLocation(tripId, { lat: -22.9150, lng: -43.1770 });

    // 3. Finalizar viagem
    await endTrip(tripId, { lat: -22.9200, lng: -43.1800 });

    // 4. Verificar dados
    console.log('Trip data:', tripData);
  };

  return (
    <View>
      <Button title="Test Complete Trip" onPress={testCompleteTrip} />
    </View>
  );
};
```

### **3.3 Teste das Actions Redux**

```javascript
// Teste das actions de localização
import { 
  saveUserLocation, 
  getUserLocation, 
  getNearbyDrivers 
} from '../actions/locationactions';

// Teste de dispatch
const testReduxActions = async () => {
  // Salvar localização
  await dispatch(saveUserLocation({
    lat: -22.9068,
    lng: -43.1729
  }));

  // Obter localização
  await dispatch(getUserLocation());

  // Buscar motoristas próximos
  await dispatch(getNearbyDrivers({
    lat: -22.9068,
    lng: -43.1729,
    radius: 5
  }));
};
```

### **3.4 Teste dos Serviços Redis**

```javascript
// Teste dos serviços Redis
import redisLocationService from '../services/redisLocationService';
import redisTrackingService from '../services/redisTrackingService';

const testRedisServices = async () => {
  // Teste serviço de localização
  await redisLocationService.initialize();
  await redisLocationService.saveUserLocation('user123', {
    lat: -22.9068,
    lng: -43.1729
  });

  // Teste serviço de tracking
  await redisTrackingService.initialize();
  await redisTrackingService.startTripTracking('trip123', 'driver123', 'passenger123', {
    lat: -22.9068,
    lng: -43.1729
  });
};
```

---

## 🔄 **Fase 4: Testes de Cenários Completos**

### **4.1 Cenário de Viagem Completa**

```bash
# Script de teste completo
node test-complete-integration.cjs
```

**Fluxo Testado:**
1. ✅ Usuário faz login
2. ✅ Motorista aceita corrida
3. ✅ Inicia tracking da viagem
4. ✅ Atualiza localizações em tempo real
5. ✅ Passageiro acompanha viagem
6. ✅ Finaliza viagem
7. ✅ Dados migrados para Firestore

### **4.2 Teste de Múltiplos Usuários**

```javascript
// Simular múltiplos usuários
const simulateMultipleUsers = async () => {
  const users = [
    { uid: 'user1', lat: -22.9068, lng: -43.1729 },
    { uid: 'user2', lat: -22.9100, lng: -43.1750 },
    { uid: 'user3', lat: -22.9150, lng: -43.1770 }
  ];

  // Salvar localizações simultaneamente
  await Promise.all(users.map(user => 
    saveUserLocation(user.lat, user.lng, user.uid)
  ));

  // Buscar usuários próximos
  const nearby = await getNearbyUsers(-22.9068, -43.1729, 5);
  console.log('Nearby users:', nearby);
};
```

### **4.3 Teste de Performance em Carga**

```bash
# Teste de carga com Apache Bench
ab -n 1000 -c 10 -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5001/your-project/us-central1/save_user_location"

# Teste de carga com Node.js
node test-load.js
```

**Métricas de Carga:**
```
✅ 1000 requisições simultâneas
✅ Latência média < 200ms
✅ Taxa de erro < 5%
✅ Redis mantém performance
```

### **4.4 Teste de Recuperação de Falhas**

```bash
# 1. Parar Redis
docker-compose stop redis

# 2. Tentar operações (devem falhar para Firebase)
curl -X POST "http://localhost:5001/your-project/us-central1/save_user_location" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lat": -22.9068, "lng": -43.1729}'

# 3. Reiniciar Redis
docker-compose start redis

# 4. Verificar se sistema volta ao normal
curl -X GET "http://localhost:5001/your-project/us-central1/get_redis_stats" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 📊 **Fase 5: Testes de Monitoramento**

### **5.1 Teste de Logs**

```bash
# Verificar logs do Redis
docker-compose logs redis

# Verificar logs das APIs
firebase functions:log

# Verificar logs do frontend
# (no console do React Native)
```

### **5.2 Teste de Métricas**

```bash
# Estatísticas do Redis
docker exec redis-taxi-app redis-cli INFO

# Estatísticas das APIs
curl -X GET "http://localhost:5001/your-project/us-central1/get_redis_stats" \
  -H "Authorization: Bearer $TOKEN"
```

### **5.3 Teste de Interface Web**

```bash
# Iniciar Redis Commander
docker-compose --profile tools up -d redis-commander

# Acessar interface
# http://localhost:8081
```

---

## 🚨 **Testes de Validação de Erros**

### **6.1 Teste de Dados Inválidos**

```bash
# Teste sem latitude/longitude
curl -X POST "http://localhost:5001/your-project/us-central1/save_user_location" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# Teste com coordenadas inválidas
curl -X POST "http://localhost:5001/your-project/us-central1/save_user_location" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lat": "invalid", "lng": "invalid"}'
```

**Resultado Esperado:**
```
❌ 400 Bad Request
❌ Mensagem de erro clara
```

### **6.2 Teste de Token Inválido**

```bash
# Teste sem token
curl -X GET "http://localhost:5001/your-project/us-central1/get_user_location"

# Teste com token inválido
curl -X GET "http://localhost:5001/your-project/us-central1/get_user_location" \
  -H "Authorization: Bearer invalid_token"
```

**Resultado Esperado:**
```
❌ 401 Unauthorized
❌ Mensagem de erro de autenticação
```

---

## 📝 **Checklist Final de Validação**

### **Infraestrutura**
- [ ] Redis inicia corretamente
- [ ] Configurações aplicadas
- [ ] GEO commands funcionam
- [ ] Persistência funciona
- [ ] Backup/restore funciona

### **APIs**
- [ ] Autenticação funciona
- [ ] Todas as 8 APIs respondem
- [ ] Validação de dados funciona
- [ ] Tratamento de erros funciona
- [ ] Performance está adequada

### **Frontend**
- [ ] Hooks funcionam
- [ ] Actions Redux funcionam
- [ ] Serviços Redis funcionam
- [ ] Feature flags funcionam
- [ ] Fallback funciona

### **Integração**
- [ ] Fluxo completo funciona
- [ ] Múltiplos usuários funcionam
- [ ] Performance em carga adequada
- [ ] Recuperação de falhas funciona
- [ ] Monitoramento funciona

---

## 🎯 **Comandos de Execução Rápida**

```bash
# 1. Iniciar infraestrutura
quick-start-redis.bat

# 2. Testar APIs
node test-redis-apis.js

# 3. Testar integração completa
node test-complete-integration.cjs

# 4. Testar performance
node test-load.js

# 5. Verificar logs
docker-compose logs -f redis
```

---

## ✅ **Critérios de Sucesso**

### **Funcionalidade**
- ✅ Todas as APIs respondem corretamente
- ✅ Dados são salvos e recuperados
- ✅ GEO commands funcionam
- ✅ Tracking funciona em tempo real

### **Performance**
- ✅ Latência < 100ms para APIs
- ✅ Suporta 1000+ usuários simultâneos
- ✅ Redis mantém performance sob carga

### **Confiabilidade**
- ✅ Fallback para Firebase funciona
- ✅ Recuperação de falhas funciona
- ✅ Dados persistem corretamente
- ✅ Logs são gerados adequadamente

### **Segurança**
- ✅ Autenticação funciona
- ✅ Validação de dados funciona
- ✅ CORS está configurado
- ✅ Tokens são validados

**Se todos os testes passarem, a implementação Redis está pronta para produção!** 🚀 