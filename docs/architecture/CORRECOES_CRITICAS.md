# 🔧 CORREÇÕES CRÍTICAS NECESSÁRIAS

## Problemas Identificados:

1. **Handler de Localização:**
   - App envia: `updateLocation`
   - Servidor escuta: `location_update` ❌
   - Servidor não salva no Redis `driver_locations` ❌

2. **Redis vazio:**
   - `driver_locations` tem 0 motoristas
   - Motoristas não estão sendo salvos quando atualizam localização

3. **Eventos de Notificação:**
   - Dispatcher envia: `newRideRequest`
   - App escuta: `rideRequest` e `newBookingAvailable` ❌

## Correções Necessárias:

### 1. server.js - Linha ~377
Substituir handler `location_update` por `updateLocation` que salva no Redis:

```javascript
socket.on('updateLocation', async (data) => {
    try {
        const { lat, lng } = data;
        if (!lat || !lng || !socket.userId) {
            socket.emit('location_error', { message: 'Dados inválidos' });
            return;
        }
        
        // Se for motorista, salvar no Redis GEO
        if (socket.userType === 'driver') {
            const redis = redisPool.getConnection();
            if (!redis.isOpen) {
                await redis.connect();
            }
            
            // Salvar no Redis GEO (driver_locations)
            await redis.geoadd('driver_locations', lng, lat, socket.userId);
            
            // Atualizar timestamp
            const driverKey = 'driver:' + socket.userId;
            await redis.hset(driverKey, {
                lat: lat.toString(),
                lng: lng.toString(),
                lastUpdate: Date.now(),
                isOnline: 'true'
            });
            
            console.log('📍 Localização do motorista ' + socket.userId + ' atualizada: ' + lat + ', ' + lng);
        }
        
        socket.emit('location_updated', { success: true });
    } catch (error) {
        console.error('❌ Erro ao atualizar localização:', error);
        socket.emit('location_error', { message: error.message });
    }
});
```

### 2. services/driver-notification-dispatcher.js
Adicionar eventos `rideRequest` e `newBookingAvailable` além de `newRideRequest`:

```javascript
this.io.to(`driver_${driverId}`).emit('rideRequest', notificationData);
this.io.to(`driver_${driverId}`).emit('newBookingAvailable', notificationData);
this.io.to(`driver_${driverId}`).emit('newRideRequest', notificationData);
```

