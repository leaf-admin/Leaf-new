# Arquitetura LEAF WebSocket Backend

## 🏗️ Visão Geral

O backend implementa uma arquitetura híbrida que combina as melhores características de diferentes tecnologias para otimizar performance, custo e funcionalidade.

## 📊 Componentes da Arquitetura

### 1. **Redis (Tempo Real)**
- **Função:** Armazenamento de dados voláteis e consultas geoespaciais
- **Dados:** Localização em tempo real, status online/offline, tracking de viagens
- **Vantagens:** Extremamente rápido, baixo custo, consultas geoespaciais nativas
- **TTL:** 30 minutos para localizações

### 2. **Firestore (Persistência)**
- **Função:** Armazenamento de dados estruturados e históricos
- **Dados:** Perfis de usuários, histórico de viagens, configurações, relatórios
- **Vantagens:** Consultas avançadas, escalabilidade, segurança granular
- **Sincronização:** Automática via backend

### 3. **Realtime Database (Compatibilidade)**
- **Função:** Sincronização para clientes legados e fallback
- **Dados:** Localização e status (sincronizados do Redis)
- **Vantagens:** Compatibilidade com apps existentes, sincronização automática
- **Sincronização:** Automática via backend

## 🔄 Fluxo de Dados

### Localização em Tempo Real
```
App Mobile → WebSocket → Backend → Redis (primário)
                           ↓
                    Firestore + Realtime DB (backup)
```

### Busca de Motoristas
```
App Mobile → WebSocket → Backend → Redis (consulta geoespacial)
                           ↓
                    Retorna resultados ordenados por distância
```

### Gerenciamento de Viagens
```
App Mobile → WebSocket → Backend → Redis (tracking)
                           ↓
                    Firestore (persistência)
```

## 🎯 Estratégia de Sincronização

### **Sincronização Automática**
- **Trigger:** Eventos WebSocket
- **Escopo:** Dados críticos (localização, status, viagens)
- **Estratégia:** Write-through (Redis + Firebase simultaneamente)

### **Fallback Strategy**
- **Primário:** Redis para operações em tempo real
- **Secundário:** Firebase para persistência e consultas históricas
- **Recovery:** Dados podem ser recuperados do Firebase se Redis falhar

## 📈 Benefícios da Arquitetura

### **Performance**
- Redis: < 1ms para consultas geoespaciais
- WebSocket: Comunicação bidirecional em tempo real
- Firestore: Consultas complexas otimizadas

### **Custo**
- Redis: Baixo custo para dados voláteis
- Firestore: Pay-per-use para dados persistentes
- Realtime DB: Gratuito para volumes pequenos

### **Escalabilidade**
- Redis: Cluster horizontal
- Firestore: Escala automática
- WebSocket: Load balancing nativo

### **Confiabilidade**
- Múltiplas camadas de backup
- Sincronização automática
- Fallback transparente

## 🔧 Configuração de Produção

### **Redis Cluster**
```bash
# Configuração recomendada
redis-cluster:
  - master: 3 nodes
  - replica: 3 nodes
  - persistence: RDB + AOF
```

### **Firebase**
```javascript
// Configuração de segurança
firestore.rules:
  - Autenticação obrigatória
  - Validação de dados
  - Rate limiting
```

### **WebSocket**
```javascript
// Configuração de produção
socket.io:
  - Transports: ['websocket']
  - CORS: Configurado
  - Rate limiting: Implementado
```

## 🚀 Deploy

### **Docker**
```dockerfile
FROM node:18-alpine
COPY . /app
WORKDIR /app
RUN npm install --production
EXPOSE 3001
CMD ["npm", "start"]
```

### **Kubernetes**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: leaf-websocket-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: leaf-websocket-backend
  template:
    metadata:
      labels:
        app: leaf-websocket-backend
    spec:
      containers:
      - name: backend
        image: leaf-websocket-backend:latest
        ports:
        - containerPort: 3001
        env:
        - name: REDIS_URL
          value: "redis://redis-cluster:6379"
        - name: FIREBASE_DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: firebase-config
              key: database-url
```

## 📊 Monitoramento

### **Métricas Chave**
- Conexões WebSocket ativas
- Latência Redis
- Taxa de sincronização Firebase
- Erros de conexão
- Uso de memória

### **Alertas**
- Redis offline
- Firebase sync falhando
- Alta latência
- Muitas conexões simultâneas

## 🔒 Segurança

### **Autenticação**
- JWT tokens
- Rate limiting por IP
- Validação de dados

### **Dados**
- Criptografia em trânsito (TLS)
- Validação de entrada
- Sanitização de dados

### **Infraestrutura**
- VPC isolada
- Firewall configurado
- Logs de auditoria

## 📝 Próximos Passos

1. **Implementar JWT Authentication**
2. **Adicionar Rate Limiting**
3. **Configurar Logs Estruturados**
4. **Implementar Métricas Prometheus**
5. **Criar Docker Images**
6. **Configurar CI/CD**
7. **Implementar Backup Automático**
8. **Adicionar Monitoramento Avançado**

# 🏗️ Arquitetura: Redis + Firebase (Sincronização Seletiva)

## 📋 Visão Geral

Esta arquitetura otimiza custos e performance usando **Redis para dados em tempo real** e **Firebase apenas para dados consolidados**.

## 🔄 Fluxo de Dados

### 🚀 Tempo Real (Redis)
- **Localização dos motoristas** (atualizada a cada 2-5 segundos)
- **Status online/offline**
- **Busca de motoristas próximos** (GEO commands)
- **WebSocket connections**

### 💾 Dados Consolidados (Firebase)
- **Viagens finalizadas** (ao completar corrida)
- **Cancelamentos** (ao cancelar corrida)
- **Relatórios e analytics**
- **Dados históricos**

## 🎯 Eventos WebSocket

### 📍 Tracking em Tempo Real (Redis)
```javascript
// Atualizar localização
socket.emit('updateLocation', { lat, lng });

// Buscar motoristas próximos
socket.emit('findNearbyDrivers', { lat, lng, radius: 5000 });

// Atualizar status
socket.emit('updateDriverStatus', { status: 'available' });
```

### 🏁 Dados Consolidados (Firebase)
```javascript
// Finalizar viagem
socket.emit('finishTrip', {
    tripId: 'trip_123',
    tripData: {
        startTime: 1640995200000,
        startLocation: { lat: -23.5505, lng: -46.6333 },
        endLocation: { lat: -23.5505, lng: -46.6333 },
        distance: 5000,
        fare: 25.50
    }
});

// Cancelar viagem
socket.emit('cancelTrip', {
    tripId: 'trip_123',
    reason: 'driver_unavailable'
});
```

## 💰 Benefícios de Custos

### ❌ Antes (Sincronização Total)
- Firebase: ~$0.18 por 100k leituras
- Firebase: ~$0.18 por 100k escritas
- **Custo alto** para tracking em tempo real

### ✅ Agora (Sincronização Seletiva)
- Redis: ~$0.05 por 100k operações
- Firebase: apenas dados consolidados
- **Economia de 70-80%** nos custos

## 🔧 Configuração

### Redis (Docker)
```bash
docker run -d --name redis-taxi-app -p 6379:6379 redis:7-alpine
```

### Firebase
- Firestore: para dados consolidados
- Realtime Database: backup (opcional)

## 📊 Estrutura de Dados

### Redis
```
drivers:geo          # GEOADD para localização
drivers:status       # HSET para status
```

### Firebase Firestore
```
trips/
  ├── trip_123/
  │   ├── tripId: "trip_123"
  │   ├── driverId: "driver_456"
  │   ├── startTime: 1640995200000
  │   ├── endTime: 1640995800000
  │   ├── distance: 5000
  │   ├── fare: 25.50
  │   └── status: "completed"
```

## 🚨 Cuidados

1. **Não sincronize tudo** entre Redis e Firebase
2. **Use Redis** para tracking em tempo real
3. **Use Firebase** apenas para dados consolidados
4. **Mantenha backup** de dados críticos no Firebase
5. **Monitore** performance e custos

## 🔄 Migração

Se seu app já usa Realtime Database:
- ✅ Continue usando para dados existentes
- ✅ Use Redis para novo tracking
- ✅ Sincronize apenas dados consolidados
- ✅ Migre gradualmente se necessário 