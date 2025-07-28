# WebSocket Service - Configuração e Uso

## 📋 Visão Geral

Este serviço de WebSocket foi criado para integração em tempo real entre o app mobile e o backend Redis. Ele permite:

- ✅ Conexão em tempo real com o backend
- ✅ Atualização de localização em tempo real
- ✅ Busca de motoristas próximos
- ✅ Atualização de status do motorista
- ✅ Reconexão automática
- ✅ Suporte a Android e iOS

## 🚀 Configuração Inicial

### 1. Instalar Dependências

```bash
npm install socket.io-client
```

### 2. Configurar IP do Backend

Edite o arquivo `src/config/WebSocketConfig.js`:

```javascript
// Para dispositivo físico, altere o IP para o da sua máquina
DEVICE: 'http://SEU_IP_AQUI:3001', // Exemplo: 'http://192.168.1.50:3001'
```

### 3. Descobrir seu IP

**Windows:**
```cmd
ipconfig
```
Procure por "IPv4 Address" na sua rede Wi-Fi.

**Mac/Linux:**
```bash
ifconfig
# ou
ip addr show
```

## 🔧 Configurações por Ambiente

### Desenvolvimento Local

| Plataforma | URL | Observação |
|------------|-----|------------|
| Android Emulator | `http://10.0.2.2:3001` | Automático |
| iOS Simulator | `http://localhost:3001` | Automático |
| Dispositivo Físico | `http://SEU_IP:3001` | **ALTERAR** |

### Produção

```javascript
PRODUCTION: {
  URL: 'https://seu-dominio.com',
}
```

## 📱 Como Usar

### 1. Hook React (Recomendado)

```javascript
import useWebSocket from '../hooks/useWebSocket';

const MyComponent = () => {
  const {
    connectionStatus,
    data,
    connect,
    disconnect,
    updateLocation,
    findNearbyDrivers,
    updateDriverStatus,
    startLocationUpdates,
    stopLocationUpdates,
  } = useWebSocket('user123');

  // Conectar automaticamente
  useEffect(() => {
    connect('user123');
  }, []);

  // Atualizar localização
  const handleLocationUpdate = () => {
    updateLocation(-23.5505, -46.6333);
  };

  // Buscar motoristas próximos
  const handleFindDrivers = () => {
    findNearbyDrivers(-23.5505, -46.6333, 5000, 10);
  };

  return (
    <View>
      <Text>Status: {connectionStatus.isConnected ? 'Conectado' : 'Desconectado'}</Text>
      <Text>Motoristas: {data.nearbyDrivers.length}</Text>
    </View>
  );
};
```

### 2. Serviço Direto

```javascript
import webSocketService from '../services/WebSocketService';

// Conectar
await webSocketService.connect('user123');

// Configurar callbacks
webSocketService.onConnect(() => {
  console.log('Conectado!');
});

webSocketService.onNearbyDrivers((data) => {
  console.log('Motoristas:', data.drivers);
});

// Atualizar localização
webSocketService.updateLocation(-23.5505, -46.6333);

// Buscar motoristas
webSocketService.findNearbyDrivers(-23.5505, -46.6333, 5000, 10);
```

## 🎮 Componente de Demonstração

Use o componente `WebSocketDemo` para testar todas as funcionalidades:

```javascript
import WebSocketDemo from '../components/WebSocketDemo';

// No seu app
<WebSocketDemo />
```

## 📊 Eventos Disponíveis

### Eventos de Conexão
- `onConnect` - Conectado ao servidor
- `onDisconnect` - Desconectado do servidor
- `onAuthenticated` - Usuário autenticado
- `onError` - Erro de conexão

### Eventos de Dados
- `onLocationUpdated` - Localização atualizada
- `onNearbyDrivers` - Motoristas próximos encontrados
- `onDriverStatusUpdated` - Status do motorista atualizado

## 🔄 Funcionalidades

### Atualização Automática de Localização

```javascript
// Iniciar atualizações automáticas
startLocationUpdates(latitude, longitude, 2000); // 2 segundos

// Parar atualizações
stopLocationUpdates();
```

### Reconexão Automática

O serviço reconecta automaticamente em caso de perda de conexão.

### Busca de Motoristas

```javascript
findNearbyDrivers(
  latitude,    // Latitude atual
  longitude,   // Longitude atual
  5000,        // Raio em metros (5km)
  10           // Limite de resultados
);
```

## 🛠️ Solução de Problemas

### Erro de Conexão

1. **Verificar se o backend está rodando:**
   ```bash
   # No backend
   npm start
   ```

2. **Verificar IP correto:**
   - Use `ipconfig` (Windows) ou `ifconfig` (Mac/Linux)
   - Altere o IP em `WebSocketConfig.js`

3. **Verificar firewall:**
   - Porta 3001 deve estar liberada
   - Antivírus pode bloquear conexões

### Erro no Emulador

- **Android:** Use `10.0.2.2:3001`
- **iOS:** Use `localhost:3001`

### Erro em Dispositivo Físico

1. **Verificar rede:**
   - Dispositivo e computador na mesma rede Wi-Fi
   - IP correto configurado

2. **Testar conectividade:**
   ```javascript
   import { testServerConnection } from '../utils/NetworkUtils';
   
   const isConnected = await testServerConnection('http://SEU_IP:3001');
   console.log('Conectado:', isConnected);
   ```

## 📝 Logs de Debug

O serviço gera logs detalhados:

```
✅ WebSocket conectado
🔐 Autenticando usuário: user123
📍 Enviando localização: {...}
🚗 Motoristas próximos: [...]
🔌 WebSocket desconectado: transport close
```

## 🔒 Segurança

- ✅ Conexão WebSocket segura
- ✅ Autenticação por userId
- ✅ Timeout de conexão
- ✅ Reconexão limitada

## 📈 Performance

- ✅ Atualização de localização a cada 2 segundos
- ✅ Busca de motoristas otimizada
- ✅ Reconexão automática inteligente
- ✅ Limpeza automática de dados antigos

## 🚀 Próximos Passos

1. **Configurar IP correto** em `WebSocketConfig.js`
2. **Iniciar o backend** na porta 3001
3. **Testar conexão** com o componente `WebSocketDemo`
4. **Integrar** o hook `useWebSocket` no seu app

## 📞 Suporte

Se encontrar problemas:

1. Verifique os logs no console
2. Teste com o componente `WebSocketDemo`
3. Verifique se o backend está rodando
4. Confirme o IP está correto

---

**Nota:** Para produção, configure o domínio correto em `WebSocketConfig.js`. 