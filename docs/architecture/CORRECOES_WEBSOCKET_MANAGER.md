# 🔧 Correções Necessárias: WebSocketManager

## 🔴 Problemas Críticos Encontrados

### 1. DUPLICAÇÃO DE `updateDriverLocation`

**Problema:** Dois métodos com mesmo nome mas parâmetros diferentes:
- Linha 286: `updateDriverLocation(bookingId, lat, lng, heading = 0, speed = 0)`
- Linha 721: `updateDriverLocation(driverId, lat, lng, heading = 0, speed = 0)`

**Solução:** Renomear e separar claramente:
```javascript
// Linha 286 → updateTripLocation (durante corrida)
async updateTripLocation(bookingId, lat, lng, heading = 0, speed = 0) {
    if (!this.socket?.connected) {
        throw new Error('WebSocket não conectado');
    }
    
    this.socket.emit('updateTripLocation', { 
        bookingId, 
        lat, 
        lng, 
        heading, 
        speed 
    });
}

// Linha 721 → updateDriverLocation (localização geral do driver)
async updateDriverLocation(driverId, lat, lng, heading = 0, speed = 0) {
    // Mantém como está
}
```

### 2. ADICIONAR MÉTODOS CORE FALTANTES

**Problema:** Falta métodos essenciais para o fluxo de corridas:
- `acceptRide()` - Motorista aceitar corrida
- `rejectRide()` - Motorista rejeitar corrida
- `arriveAtPickup()` - Motorista chegou no pickup

**Solução:** Adicionar na seção de métodos de corridas:

```javascript
// ==================== RIDE MANAGEMENT METHODS ====================

// Motorista aceitar corrida
async acceptRide(rideId, driverData = {}) {
    if (!this.socket?.connected) {
        throw new Error('WebSocket não conectado');
    }
    
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Accept ride timeout'));
        }, 15000);
        
        this.socket.emit('acceptRide', { rideId, ...driverData });
        this.socket.once('rideAccepted', (data) => {
            clearTimeout(timeout);
            if (data.success) {
                resolve(data);
            } else {
                reject(new Error(data.error || 'Accept ride failed'));
            }
        });
    });
}

// Motorista rejeitar corrida
async rejectRide(rideId, reason = 'Motorista indisponível') {
    if (!this.socket?.connected) {
        throw new Error('WebSocket não conectado');
    }
    
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Reject ride timeout'));
        }, 10000);
        
        this.socket.emit('rejectRide', { rideId, reason });
        this.socket.once('rideRejected', (data) => {
            clearTimeout(timeout);
            if (data.success) {
                resolve(data);
            } else {
                reject(new Error(data.error || 'Reject ride failed'));
            }
        });
    });
}

// Motorista chegou ao pickup
async arriveAtPickup(rideId, location) {
    if (!this.socket?.connected) {
        throw new Error('WebSocket não conectado');
    }
    
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Arrive at pickup timeout'));
        }, 10000);
        
        this.socket.emit('arriveAtPickup', { rideId, location });
        this.socket.once('arrivedAtPickup', (data) => {
            clearTimeout(timeout);
            if (data.success) {
                resolve(data);
            } else {
                reject(new Error(data.error || 'Arrive at pickup failed'));
            }
        });
    });
}
```

### 3. ADICIONAR RETRY PARA OPERAÇÕES CRÍTICAS

**Problema:** Não há retry automático. Se falhar, falhou.

**Solução:** Adicionar helper de retry:

```javascript
// ==================== HELPER METHODS ====================

// Executar com retry automático
async _executeWithRetry(operation, maxRetries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            console.warn(`⚠️ Tentativa ${attempt}/${maxRetries} falhou, tentando novamente...`);
            await new Promise(resolve => setTimeout(resolve, delay * attempt));
        }
    }
}

// Método crítico com retry
async createBooking(bookingData) {
    if (!this.socket?.connected) {
        throw new Error('WebSocket não conectado');
    }
    
    return this._executeWithRetry(() => {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Create booking timeout'));
            }, 15000);
            
            this.socket.emit('createBooking', bookingData);
            
            this.socket.once('bookingCreated', (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || 'Create booking failed'));
                }
            });
        });
    }, 3);
}
```

## 📋 Ordem de Implementação

### PRIORIDADE 1 (Crítico)
1. ✅ Renomear `updateDriverLocation` da linha 286 para `updateTripLocation`
2. ✅ Adicionar métodos core faltantes (`acceptRide`, `rejectRide`, `arriveAtPickup`)
3. ✅ Implementar helper de retry

### PRIORIDADE 2 (Importante)
4. Adicionar timeouts adaptativos por tipo de operação
5. Documentar métodos com JSDoc
6. Adicionar logging estruturado

### PRIORIDADE 3 (Nice to have)
7. Métricas de performance
8. Cache de eventos
9. Queue offline

