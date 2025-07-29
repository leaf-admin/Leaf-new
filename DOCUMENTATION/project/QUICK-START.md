# 🍃 Leaf App - Guia de Uso Rápido

## 🚀 Início Rápido

### 1. Iniciar Todos os Serviços
```bash
./start-all-services.sh
```

### 2. Parar Todos os Serviços
```bash
./stop-all-services.sh
```

## 📊 Serviços Disponíveis

| Serviço | Porta | URL | Status |
|---------|-------|-----|--------|
| **Mobile App** | 8081 | http://localhost:8081 | 🟢 Metro Bundler |
| **WebSocket Backend** | 3001 | http://localhost:3001 | 🟢 Redis + WebSocket |
| **Firebase Functions** | 5001 | http://127.0.0.1:5001 | 🟢 Emulador |
| **Firebase Emulator UI** | 4000 | http://127.0.0.1:4000 | 🟢 Interface |
| **Web App** | 3000 | http://localhost:3000 | 🟢 React App |
| **Dashboard** | 3000 | http://localhost:3000 | 🟢 Admin Panel |

## 🔧 Comandos Úteis

### Verificar Status dos Serviços
```bash
ss -tlnp | grep -E "(3000|3001|5001|8081|4000)"
```

### Verificar Processos Ativos
```bash
ps aux | grep -E "(node|expo|yarn|npm)" | grep -v grep
```

### Testar Integração
```bash
# Firebase Functions Health
curl http://127.0.0.1:5001/leaf-reactnative/us-central1/health

# WebSocket Backend Health
curl http://localhost:3001/health

# Redis Stats
curl http://127.0.0.1:5001/leaf-reactnative/us-central1/get_redis_stats
```

## 📱 Mobile App

### QR Code
- Escaneie o QR code no terminal para abrir no dispositivo
- Use o Expo Go app ou development build

### Comandos do Metro
- `r` - Reload
- `m` - Toggle menu
- `j` - Debugger
- `a` - Android
- `w` - Web

## 🔥 Firebase Functions

### Endpoints Principais
- `/health` - Status do sistema
- `/get_redis_stats` - Estatísticas do Redis
- `/user_signup` - Cadastro de usuário
- `/get_nearby_drivers` - Motoristas próximos
- `/start_trip_tracking` - Iniciar rastreamento
- `/end_trip_tracking` - Finalizar rastreamento

### Emulador UI
- Acesse http://127.0.0.1:4000 para interface gráfica
- Visualize logs e teste funções

## 🛠️ Solução de Problemas

### Web App não inicia
```bash
cd web-app
export NODE_OPTIONS="--openssl-legacy-provider"
yarn start
```

### Redis não conecta
```bash
docker ps | grep redis-leaf
docker start redis-leaf
```

### Porta em uso
```bash
# Encontrar processo
ss -tlnp | grep :PORTA

# Matar processo
kill -9 PID
```

## 📁 Estrutura do Projeto

```
Sourcecode/
├── mobile-app/          # React Native App
├── web-app/            # React Web App
├── leaf-dashboard/     # Admin Dashboard
├── functions/          # Firebase Functions
├── leaf-websocket-backend/ # WebSocket Server
├── tests/              # Testes de Integração
└── scripts/            # Scripts de Automação
```

## 🎯 Próximos Passos

1. **Desenvolvimento**: Use os scripts para iniciar/parar serviços
2. **Testes**: Execute testes de integração
3. **Deploy**: Configure para produção
4. **Monitoramento**: Implemente logs e métricas

---

**💡 Dica**: Use `./start-all-services.sh` para iniciar tudo de uma vez! 