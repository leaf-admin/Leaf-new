# 🚗 LEAF WebSocket Backend

Backend Node.js com WebSocket para aplicação de taxi/ridesharing usando **Redis para tempo real** e **Firebase para dados consolidados**.

## 🏗️ Arquitetura Otimizada

### 📊 Sincronização Seletiva
- **Redis**: Tracking em tempo real (localização, status, busca)
- **Firebase**: Apenas dados consolidados (viagens finalizadas, relatórios)
- **Economia**: 70-80% redução nos custos do Firebase

### 🔄 Fluxo de Dados
```
App Mobile → WebSocket → Backend → Redis (tempo real)
                           ↓
                    Firebase (dados consolidados)
```

## 🚀 Instalação

```bash
# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas configurações

# Iniciar servidor
npm start
```

## 🐳 Docker

```bash
# Redis (necessário)
docker run -d --name redis-taxi-app -p 6379:6379 redis:7-alpine

# Backend
docker build -t leaf-backend .
docker run -p 3001:3001 leaf-backend
```

## 🧪 Testes

```bash
# Teste básico de conexão
npm run test:basic

# Teste da arquitetura completa
npm run test:architecture

# Teste de múltiplos motoristas
npm run test:multiple-drivers
```

## 📡 Eventos WebSocket

### 🔐 Autenticação
```javascript
socket.emit('authenticate', { uid: 'user_123' });
socket.on('authenticated', (data) => console.log(data));
```

### 📍 Tracking em Tempo Real (Redis)
```javascript
// Atualizar localização
socket.emit('updateLocation', { lat: -23.5505, lng: -46.6333 });

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
    tripData: { startTime, startLocation, endLocation, distance, fare }
});

// Cancelar viagem
socket.emit('cancelTrip', { tripId: 'trip_123', reason: 'driver_unavailable' });
```

## 💰 Benefícios de Custos

| Operação | Antes (Firebase) | Agora (Redis) | Economia |
|----------|------------------|---------------|----------|
| Localização (100k/dia) | $0.18 | $0.05 | 72% |
| Busca motoristas | $0.18 | $0.05 | 72% |
| Status updates | $0.18 | $0.05 | 72% |
| **Total/mês** | **$16.20** | **$4.50** | **72%** |

## 🔧 Configuração

### Variáveis de Ambiente
```env
PORT=3001
REDIS_URL=redis://localhost:6379
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
```

### Firebase
- Adicione o arquivo de credenciais: `leaf-reactnative-firebase-adminsdk-fbsvc-94a09a2472.json`
- Configure as regras de segurança no Firestore

## 📊 Monitoramento

### Logs
- Conexões WebSocket
- Operações Redis
- Sincronização Firebase
- Erros e performance

### Métricas
- Usuários online
- Latência Redis
- Taxa de sincronização
- Uso de memória

## 🚨 Cuidados Importantes

1. **Não sincronize tudo** entre Redis e Firebase
2. **Use Redis** para tracking em tempo real
3. **Use Firebase** apenas para dados consolidados
4. **Monitore** performance e custos
5. **Configure backup** de dados críticos

## 🔄 Migração

Se seu app já usa Realtime Database:
- ✅ Continue usando para dados existentes
- ✅ Use Redis para novo tracking
- ✅ Sincronize apenas dados consolidados
- ✅ Migre gradualmente se necessário

## 📝 Próximos Passos

- [ ] Implementar JWT Authentication
- [ ] Adicionar Rate Limiting
- [ ] Configurar Logs Estruturados
- [ ] Implementar Métricas Prometheus
- [ ] Criar Docker Images
- [ ] Configurar CI/CD

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. 