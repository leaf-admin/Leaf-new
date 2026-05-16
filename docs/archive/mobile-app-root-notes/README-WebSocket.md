# 🌐 Integração WebSocket + Redis

Este documento explica como usar a integração WebSocket com Redis no app mobile LEAF.

## 📋 Visão Geral

A integração permite:
- ✅ Conexão em tempo real com o backend Redis
- ✅ Atualização de localização em tempo real
- ✅ Busca de motoristas próximos
- ✅ Estatísticas do sistema
- ✅ Reconexão automática
- ✅ Fallback para Firebase quando necessário

## 🏗️ Arquitetura

```
📱 App Mobile (React Native)
    ↓ WebSocket
🌐 Backend Node.js + Socket.io
    ↓ Redis Client
🔴 Redis Database
    ↓ Sincronização
🔥 Firebase (Firestore + Realtime DB)
```

## 📁 Estrutura de Arquivos

```
mobile-app/src/
├── services/
│   └── WebSocketService.js      # Serviço principal WebSocket
├── hooks/
│   └── useWebSocket.js          # Hook React para WebSocket
├── components/
│   └── WebSocketDemo.js         # Componente de demonstração
└── config/
    └── WebSocketConfig.js       # Configurações
```

## 🚀 Como Usar

### 1. Importar o Hook

```javascript
import { useWebSocket } from '../hooks/useWebSocket';

const MyComponent = () => {
    const userId = 'user-123';
    const {
        isConnected,
        socketId,
        error,
        nearbyDrivers,
        stats,
        locationUpdateStatus,
        connect,
        disconnect,
        updateLocation,
        findNearbyDrivers,
        getStats,
        ping
    } = useWebSocket(userId);

    // ... resto do componente
};
```

### 2. Conectar ao WebSocket

```javascript
// Conectar automaticamente (recomendado)
const { connect } = useWebSocket(userId);

// Ou conectar manualmente
const handleConnect = () => {
    connect(userId);
};
```

### 3. Atualizar Localização

```javascript
const { updateLocation } = useWebSocket(userId);

const handleLocationUpdate = (lat, lng) => {
    updateLocation(lat, lng, userId);
};
```

### 4. Buscar Motoristas Próximos

```javascript
const { findNearbyDrivers, nearbyDrivers } = useWebSocket(userId);

const handleSearchDrivers = (lat, lng) => {
    findNearbyDrivers(lat, lng, 5000, 10); // raio 5km, limite 10
};

// Os motoristas serão atualizados automaticamente em nearbyDrivers
```

### 5. Obter Estatísticas

```javascript
const { getStats, stats } = useWebSocket(userId);

const handleGetStats = () => {
    getStats();
};

// As estatísticas serão atualizadas automaticamente em stats
```

## 📊 Estados Disponíveis

### Conexão
- `isConnected`: Boolean - Status da conexão
- `socketId`: String - ID do socket
- `error`: String - Mensagem de erro (se houver)

### Localização
- `locationUpdateStatus`: String - 'updating' | 'success' | 'error' | null

### Dados
- `nearbyDrivers`: Array - Lista de motoristas próximos
- `stats`: Object - Estatísticas do sistema

## 🔧 Configuração

### WebSocketConfig.js

```javascript
const WebSocketConfig = {
    // URLs
    localUrl: 'http://localhost:3001',
    productionUrl: 'https://your-production-server.com',
    
    // Configurações de conexão
    connectionOptions: {
        transports: ['websocket', 'polling'],
        timeout: 20000,
        reconnection: true,
        reconnectionAttempts: 5,
        // ...
    },
    
    // Configurações de localização
    location: {
        updateInterval: 5000,
        accuracy: 'high',
        distanceFilter: 10
    },
    
    // Configurações de busca
    driverSearch: {
        defaultRadius: 5000,
        maxRadius: 50000,
        defaultLimit: 10,
        maxLimit: 50
    }
};
```

## 🧪 Testando

### 1. Componente de Demonstração

Use o componente `WebSocketDemo` para testar todas as funcionalidades:

```javascript
import WebSocketDemo from '../components/WebSocketDemo';

// No seu app
<WebSocketDemo />
```

### 2. Backend de Teste

Execute o backend de teste:

```bash
cd leaf-websocket-backend
node server-fixed.js
```

### 3. Teste de Múltiplos Motoristas

```bash
cd leaf-websocket-backend
node test-multiple-drivers.js
```

## 📱 Integração no App Principal

### 1. Adicionar à Navegação

```javascript
// Em AppNavigator.js ou similar
import WebSocketDemo from '../components/WebSocketDemo';

// Adicionar à stack de navegação
<Stack.Screen name="WebSocketDemo" component={WebSocketDemo} />
```

### 2. Integrar com Redux

```javascript
// Em um reducer
const initialState = {
    nearbyDrivers: [],
    websocketStatus: 'disconnected',
    // ...
};

// Em um action
export const updateNearbyDrivers = (drivers) => ({
    type: 'UPDATE_NEARBY_DRIVERS',
    payload: drivers
});
```

### 3. Usar em Telas Existentes

```javascript
// Em uma tela de mapa
const MapScreen = () => {
    const { nearbyDrivers, updateLocation } = useWebSocket(userId);
    
    useEffect(() => {
        // Atualizar localização quando o usuário se move
        if (userLocation) {
            updateLocation(userLocation.lat, userLocation.lng, userId);
        }
    }, [userLocation]);
    
    // Renderizar motoristas no mapa
    return (
        <MapView>
            {nearbyDrivers.map(driver => (
                <Marker
                    key={driver.uid}
                    coordinate={{
                        latitude: driver.lat,
                        longitude: driver.lng
                    }}
                    title={`Motorista ${driver.uid}`}
                    description={`${driver.distance}m de distância`}
                />
            ))}
        </MapView>
    );
};
```

## 🔄 Eventos WebSocket

### Eventos Recebidos
- `wsConnected`: Conexão estabelecida
- `wsDisconnected`: Conexão perdida
- `wsError`: Erro de conexão
- `authenticated`: Usuário autenticado
- `locationUpdated`: Localização atualizada
- `nearbyDrivers`: Motoristas próximos encontrados
- `stats`: Estatísticas recebidas
- `pong`: Resposta do ping

### Eventos Enviados
- `authenticate`: Autenticar usuário
- `updateLocation`: Atualizar localização
- `findNearbyDrivers`: Buscar motoristas próximos
- `getStats`: Obter estatísticas
- `ping`: Testar conexão

## 🚨 Tratamento de Erros

### Reconexão Automática
O sistema tenta reconectar automaticamente após 5 segundos em caso de desconexão.

### Fallback Firebase
Se o Redis não estiver disponível, o sistema usa Firebase como fallback.

### Logs Detalhados
Todos os eventos são logados no console para debug.

## 📈 Performance

### Otimizações
- Reconexão inteligente
- Cache de dados
- Debounce em atualizações de localização
- Limite de tentativas de reconexão

### Monitoramento
- Status da conexão em tempo real
- Latência de resposta
- Taxa de sucesso das operações

## 🔒 Segurança

### Autenticação
- Cada usuário deve se autenticar com um ID único
- O ID é validado no backend

### Validação
- Coordenadas são validadas antes do envio
- Limites de raio e quantidade são aplicados

## 🐛 Debug

### Logs
```javascript
// Ativar logs detalhados
console.log('WebSocket Status:', isConnected);
console.log('Nearby Drivers:', nearbyDrivers);
console.log('Error:', error);
```

### Teste de Conexão
```javascript
const { ping } = useWebSocket(userId);

// Testar conexão
ping('test message');
```

## 📞 Suporte

Para problemas ou dúvidas:
1. Verificar logs do console
2. Testar com o componente WebSocketDemo
3. Verificar se o backend está rodando
4. Verificar se o Redis está conectado

---

**Nota**: Esta integração substitui gradualmente o sistema Firebase existente, oferecendo melhor performance e menor custo para operações em tempo real. 