# 🔧 Patch: Adicionar Redis Adapter ao server.js

## Localização

Adicionar **APÓS** a linha 361 (após criar `io`):

```javascript
    });

    // ✅ DEBUG: Log de conexões e erros
    io.engine.on('connection_error', (err) => {
```

## Código a Adicionar

```javascript
    });

    // ==================== SOCKET.IO REDIS ADAPTER ====================
    // Configurar Redis Adapter para escalabilidade horizontal
    // Isso permite que múltiplos servidores compartilhem conexões WebSocket
    if (process.env.SOCKET_IO_ADAPTER === 'redis' || process.env.NODE_ENV === 'production') {
        try {
            const SocketIORedisAdapter = require('./services/socket-io-adapter');
            const socketAdapter = new SocketIORedisAdapter(process.env.REDIS_URL);
            
            await socketAdapter.initialize(io);
            console.log('✅ Socket.IO Redis Adapter configurado - Sistema pronto para escalar horizontalmente');
            
            // Health check do adapter
            setInterval(async () => {
                const health = await socketAdapter.healthCheck();
                if (health.status !== 'healthy') {
                    console.warn('⚠️ [SocketIOAdapter] Health check falhou:', health);
                }
            }, 60000); // A cada 1 minuto
            
        } catch (error) {
            console.error('❌ Erro ao configurar Redis Adapter:', error);
            console.warn('⚠️ Sistema continuará funcionando, mas sem escalabilidade horizontal');
            console.warn('⚠️ Cluster mode permanecerá desabilitado');
        }
    } else {
        console.log('ℹ️ Redis Adapter desabilitado (modo desenvolvimento)');
        console.log('   Para ativar: SOCKET_IO_ADAPTER=redis');
    }
    // =================================================================

    // ✅ DEBUG: Log de conexões e erros
    io.engine.on('connection_error', (err) => {
```

## Nota Importante

O código usa `await`, então precisa estar dentro de uma função `async` ou usar `.then()`.

**Opção 1: Usar .then() (recomendado)**

```javascript
if (process.env.SOCKET_IO_ADAPTER === 'redis' || process.env.NODE_ENV === 'production') {
    const SocketIORedisAdapter = require('./services/socket-io-adapter');
    const socketAdapter = new SocketIORedisAdapter(process.env.REDIS_URL);
    
    socketAdapter.initialize(io)
        .then(() => {
            console.log('✅ Socket.IO Redis Adapter configurado');
        })
        .catch((error) => {
            console.error('❌ Erro ao configurar Redis Adapter:', error);
        });
}
```

**Opção 2: Wrapper async (se necessário)**

```javascript
(async () => {
    if (process.env.SOCKET_IO_ADAPTER === 'redis' || process.env.NODE_ENV === 'production') {
        try {
            const SocketIORedisAdapter = require('./services/socket-io-adapter');
            const socketAdapter = new SocketIORedisAdapter(process.env.REDIS_URL);
            await socketAdapter.initialize(io);
            console.log('✅ Socket.IO Redis Adapter configurado');
        } catch (error) {
            console.error('❌ Erro ao configurar Redis Adapter:', error);
        }
    }
})();
```

