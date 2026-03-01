# 🔍 Análise de Race Conditions em Handlers WebSocket

**Data**: 2026-01-02  
**Análise**: `scripts/analysis/analyze-handlers-race-conditions.js`

## 📊 Resumo Executivo

### Problemas Encontrados
- **38 Race Conditions** detectadas
- **0 Handlers Duplicados**
- **Ordem de Handlers**: OK (authenticate é o primeiro)

### Causa Raiz

**Problema Principal:**
Todos os handlers (exceto `authenticate`) estão sendo registrados **DEPOIS** do handler `authenticate` ser definido. Como o handler `authenticate` contém muitas operações assíncronas (Redis, FCM, etc.), os outros handlers só são registrados após essas operações completarem.

**Impacto:**
- Se um evento chegar antes do handler `authenticate` terminar de processar, o handler correspondente pode não estar registrado ainda
- Eventos podem ser perdidos ou ignorados
- Timeouts em testes

## 🔴 Handlers com Race Condition (38)

### Handlers Críticos (Alta Prioridade)
1. `disconnect` - Linha 1088
2. `createBooking` - Linha 1171
3. `confirmPayment` - Linha 1426
4. `acceptRide` - Linha 1636
5. `rejectRide` - Linha 1729
6. `startTrip` - Linha 1831
7. `completeTrip` - Linha 2178
8. `cancelRide` - Linha 3206

### Handlers de Localização
9. `location_update` - Linha 1071
10. `updateDriverLocation` - Linha 2864
11. `driverHeartbeat` - Linha 2919
12. `updateLocation` - Linha 2978
13. `updateTripLocation` - Linha 2134

### Handlers de Notificação
14. `notificationAction` - Linha 2513
15. `registerFCMToken` - Linha 4184
16. `unregisterFCMToken` - Linha 4309
17. `sendNotification` - Linha 4345
18. `sendNotificationToUser` - Linha 4383
19. `sendNotificationToUserType` - Linha 4421

### Outros Handlers
20-38. Vários outros handlers menos críticos

## ✅ Solução

### Estratégia de Correção

1. **Registrar TODOS os handlers críticos ANTES de qualquer operação assíncrona**
2. **Mover operações assíncronas do handler `authenticate` para DENTRO do handler**
3. **Manter handlers não críticos após operações assíncronas (OK para eles)**

### Ordem Recomendada de Registro

```javascript
io.on('connection', async (socket) => {
    // 1. Registrar handlers CRÍTICOS imediatamente (antes de qualquer await)
    socket.on('authenticate', ...);
    socket.on('disconnect', ...);
    socket.on('createBooking', ...);
    socket.on('acceptRide', ...);
    socket.on('rejectRide', ...);
    socket.on('startTrip', ...);
    socket.on('completeTrip', ...);
    socket.on('cancelRide', ...);
    
    // 2. Registrar handlers de localização (críticos para GPS)
    socket.on('updateLocation', ...);
    socket.on('updateDriverLocation', ...);
    socket.on('driverHeartbeat', ...);
    socket.on('updateTripLocation', ...);
    
    // 3. AGORA fazer operações assíncronas (rate limiting, etc.)
    const rateLimitCheck = await websocketRateLimiter.checkConnection(socket);
    // ...
    
    // 4. Registrar handlers menos críticos (podem vir depois)
    socket.on('submitRating', ...);
    socket.on('sendMessage', ...);
    // ...
});
```

## 📝 Próximos Passos

1. ✅ Reorganizar ordem de registro dos handlers
2. ✅ Mover operações assíncronas para dentro dos handlers quando possível
3. ✅ Testar após correções
4. ✅ Validar que não há mais race conditions

