# Configuração WebSocket para LEAF Mobile App

## 📋 Resumo

Este guia explica como configurar e usar o WebSocket no app mobile LEAF para comunicação em tempo real com o backend.

## 🚀 Arquivos Criados

### 1. **SocketService** (`src/services/SocketService.js`)
- Serviço principal para comunicação WebSocket
- Gerencia conexão, reconexão e eventos
- Métodos para enviar/receber dados

### 2. **useWebSocket Hook** (`src/hooks/useWebSocket.js`)
- Hook React para usar WebSocket facilmente
- Gerencia estado da conexão
- Integração com Redux para autenticação

### 3. **WebSocketDemo** (`src/components/WebSocketDemo.js`)
- Componente de demonstração/teste
- Interface para testar todas as funcionalidades

### 4. **Configuração** (`src/config/WebSocketConfig.js`)
- Configurações centralizadas
- URLs para desenvolvimento e produção

## ⚙️ Configuração Inicial

### 1. **Descobrir o IP da sua máquina**

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

### 2. **Atualizar a configuração**

Edite o arquivo `src/config/WebSocketConfig.js`:

```javascript
development: {
    url: 'http://SEU_IP_AQUI:3001', // Exemplo: http://192.168.1.50:3001
    timeout: 20000,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
}
```

### 3. **Instalar dependências**

```bash
npm install socket.io-client
```

## 🔧 Como Usar

### 1. **Usar o Hook em um Componente**

```javascript
import React from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

export default function MeuComponente() {
    const {
        isConnected,
        connectionStatus,
        lastError,
        updateLocation,
        findNearbyDrivers,
        updateDriverStatus
    } = useWebSocket();

    // O hook se conecta automaticamente quando o componente monta
    
    const handleUpdateLocation = () => {
        updateLocation(-23.5505, -46.6333);
    };

    const handleFindDrivers = () => {
        findNearbyDrivers(-23.5505, -46.6333, 5000, 10);
    };

    return (
        <View>
            <Text>Status: {connectionStatus}</Text>
            <Button title="Atualizar Localização" onPress={handleUpdateLocation} />
            <Button title="Buscar Motoristas" onPress={handleFindDrivers} />
        </View>
    );
}
```

### 2. **Usar o Serviço Diretamente**

```javascript
import socketService from '../services/SocketService';

// Conectar
socketService.connect();

// Enviar localização
socketService.updateLocation(-23.5505, -46.6333, 'user123');

// Buscar motoristas
socketService.findNearbyDrivers(-23.5505, -46.6333, 5000, 10);

// Escutar eventos
socketService.on('nearbyDrivers', (data) => {
    console.log('Motoristas encontrados:', data.drivers);
});

// Desconectar
socketService.disconnect();
```

## 📱 Testando

### 1. **Adicionar o WebSocketDemo ao seu app**

```javascript
// Em qualquer tela do seu app
import WebSocketDemo from '../components/WebSocketDemo';

// No render:
<WebSocketDemo />
```

### 2. **Verificar logs**

Abra o console do React Native para ver os logs:
- ✅ Conectado ao WebSocket
- 📤 Enviando evento: updateLocation
- 📍 Localização atualizada
- 🚗 Motoristas próximos recebidos

## 🔄 Eventos Disponíveis

### **Enviados pelo App:**
- `updateLocation` - Atualizar localização
- `findNearbyDrivers` - Buscar motoristas próximos
- `updateDriverStatus` - Atualizar status do motorista
- `getStats` - Obter estatísticas
- `ping` - Testar conexão
- `authenticate` - Autenticar usuário

### **Recebidos pelo App:**
- `locationUpdated` - Confirmação de localização atualizada
- `nearbyDrivers` - Lista de motoristas próximos
- `driverStatusUpdated` - Confirmação de status atualizado
- `stats` - Estatísticas do sistema
- `error` - Erro do servidor

## 🛠️ Próximos Passos

### 1. **Criar o Backend**
Você precisa criar um servidor Node.js com Socket.io que:
- Escute na porta 3001
- Processe os eventos enviados pelo app
- Conecte ao Redis
- Responda via WebSocket

### 2. **Exemplo de Backend Básico**

```javascript
const express = require('express');
const { Server } = require('socket.io');
const redis = require('redis');

const app = express();
const server = require('http').createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const redisClient = redis.createClient();
redisClient.connect();

io.on('connection', (socket) => {
    console.log('Cliente conectado:', socket.id);

    socket.on('updateLocation', async (data) => {
        // Salvar no Redis
        await redisClient.hSet(`locations:${data.uid}`, {
            lat: data.lat,
            lng: data.lng,
            timestamp: data.timestamp
        });
        
        // Confirmar para o cliente
        socket.emit('locationUpdated', { success: true });
    });

    socket.on('findNearbyDrivers', async (data) => {
        // Buscar no Redis
        const drivers = []; // Implementar lógica de busca
        socket.emit('nearbyDrivers', { drivers });
    });
});

server.listen(3001, () => {
    console.log('Servidor WebSocket rodando na porta 3001');
});
```

### 3. **Deploy do Backend**
- Railway, Render, Heroku, AWS, etc.
- Atualizar URL na configuração de produção

## 🐛 Troubleshooting

### **Problema: "Connection refused"**
- Verifique se o backend está rodando
- Confirme o IP está correto
- Teste se a porta 3001 está aberta

### **Problema: "Network request failed"**
- Use o IP real da máquina, não localhost
- Verifique se o dispositivo está na mesma rede
- Teste conectividade com `ping SEU_IP`

### **Problema: "Socket not connected"**
- O hook se conecta automaticamente
- Verifique logs de erro
- Tente reconectar manualmente

## 📚 Recursos Adicionais

- [Socket.io Documentation](https://socket.io/docs/)
- [React Native WebSocket](https://reactnative.dev/docs/network#websocket-support)
- [Redis Documentation](https://redis.io/documentation)

## ✅ Checklist

- [ ] Descobrir IP da máquina
- [ ] Atualizar configuração no `WebSocketConfig.js`
- [ ] Instalar `socket.io-client`
- [ ] Testar conexão com `WebSocketDemo`
- [ ] Criar backend Node.js + Socket.io
- [ ] Conectar backend ao Redis
- [ ] Testar comunicação completa
- [ ] Fazer deploy do backend
- [ ] Atualizar URL de produção 