# 🎯 Melhores Práticas para Correção do WebSocketManager

## 📋 Princípios Fundamentais

### 1. **Separação de Responsabilidades (Single Responsibility)**
- **WebSocketManager**: Gerencia apenas a conexão e transporte de eventos
- **EventEmitter Pattern**: Gerencia distribuição de eventos para componentes
- **Componentes**: Apenas consomem eventos, não gerenciam conexão

### 2. **Fonte Única de Verdade (Single Source of Truth)**
- Apenas UM caminho para receber eventos do servidor
- Evitar duplicação de listeners no mesmo evento
- Centralizar toda lógica de eventos no WebSocketManager

### 3. **Lifecycle Management**
- Listeners devem ser registrados apenas quando componentes estão montados
- Cleanup automático ao desmontar componentes
- Tratamento adequado de reconexões

---

## 🏗️ Arquitetura Recomendada

### Padrão: EventEmitter + Singleton

```
┌─────────────────────────────────────────┐
│         WebSocketManager                 │
│  (Singleton - Gerencia Conexão)        │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │  Socket.IO Client                │  │
│  │  (Recebe eventos do servidor)    │  │
│  └──────────────────────────────────┘  │
│              │                          │
│              ▼                          │
│  ┌──────────────────────────────────┐  │
│  │  EventEmitter Interno             │  │
│  │  (Distribui para componentes)    │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
              │
              ▼
    ┌─────────────────────┐
    │   Componentes       │
    │  (DriverUI, etc)    │
    └─────────────────────┘
```

---

## ✅ Solução 1: EventEmitter Pattern Completo (RECOMENDADO)

### Vantagens:
- ✅ Elimina duplicação de listeners
- ✅ Gerencia lifecycle automaticamente
- ✅ Evita race conditions
- ✅ Fácil de testar
- ✅ Padrão consolidado na comunidade

### Implementação:

```javascript
// WebSocketManager.js
class WebSocketManager {
    constructor() {
        // ... código existente ...
        
        // EventEmitter interno (não usar socket.io diretamente)
        this.eventEmitter = new EventEmitter();
        this.socketListeners = new Set(); // Rastrear listeners do socket.io
    }
    
    // Método único para registrar eventos do servidor
    setupListeners() {
        if (!this.socket) return;
        
        // Registrar APENAS uma vez por tipo de evento do servidor
        const serverEvents = ['rideRequest', 'newBookingAvailable', 'authenticated'];
        
        serverEvents.forEach(eventName => {
            // Evitar duplicação - só registrar se ainda não está registrado
            if (!this.socketListeners.has(eventName)) {
                this.socket.on(eventName, (data) => {
                    // Retransmitir através do EventEmitter interno
                    this.eventEmitter.emit(eventName, data);
                });
                this.socketListeners.add(eventName);
            }
        });
    }
    
    // Método público para componentes registrarem listeners
    on(event, callback) {
        // SEMPRE usar o EventEmitter interno, nunca o socket.io diretamente
        this.eventEmitter.on(event, callback);
        
        // Garantir que o evento do servidor está sendo capturado
        if (!this.socketListeners.has(event)) {
            this.setupListeners(); // Configurar automaticamente
        }
    }
    
    // Método público para remover listeners
    off(event, callback) {
        this.eventEmitter.off(event, callback);
    }
}
```

### Uso nos Componentes:

```javascript
// DriverUI.js
useEffect(() => {
    const wsManager = WebSocketManager.getInstance();
    
    const handleRideRequest = (data) => {
        console.log('📋 Nova reserva:', data);
        // ... lógica do componente ...
    };
    
    // Registrar listener - SEMPRE passa pelo EventEmitter interno
    wsManager.on('rideRequest', handleRideRequest);
    
    // Cleanup
    return () => {
        wsManager.off('rideRequest', handleRideRequest);
    };
}, []);
```

---

## ✅ Solução 2: Hook Customizado (ALTERNATIVA)

### Vantagens:
- ✅ Integração nativa com React lifecycle
- ✅ Cleanup automático
- ✅ Type-safe com TypeScript

### Implementação:

```javascript
// hooks/useWebSocketEvent.js
import { useEffect, useRef } from 'react';
import WebSocketManager from '../services/WebSocketManager';

export function useWebSocketEvent(eventName, callback, deps = []) {
    const callbackRef = useRef(callback);
    const wsManager = WebSocketManager.getInstance();
    
    // Atualizar callback ref quando muda
    useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);
    
    useEffect(() => {
        const stableCallback = (data) => {
            callbackRef.current(data);
        };
        
        wsManager.on(eventName, stableCallback);
        
        return () => {
            wsManager.off(eventName, stableCallback);
        };
    }, [eventName, ...deps]);
}
```

### Uso:

```javascript
// DriverUI.js
import { useWebSocketEvent } from '../hooks/useWebSocketEvent';

function DriverUI() {
    // Cleanup automático, sem necessidade de useEffect manual
    useWebSocketEvent('rideRequest', (data) => {
        console.log('📋 Nova reserva:', data);
        setAvailableBookings(prev => [...prev, data]);
    });
    
    // ... resto do componente ...
}
```

---

## ✅ Solução 3: Remover Duplicação Atual (SOLUÇÃO RÁPIDA)

### Passos:

1. **Remover listener duplicado no setupListeners():**
   ```javascript
   // ❌ REMOVER estas linhas (125-128):
   // this.socket.on('rideRequest', (data) => {
   //     console.log('🚗 Nova solicitação de corrida recebida:', data);
   //     this.emit('rideRequest', data);
   // });
   ```

2. **Usar apenas o caminho direto:**
   ```javascript
   // ✅ Componentes registram diretamente e recebem do servidor
   // Sem retransmissão intermediária
   ```

3. **Melhorar verificação de estado:**
   ```javascript
   on(event, callback) {
       // Verificar se socket está completamente pronto
       if (!this.socket || !this.socket.connected) {
           // Adicionar a pendingListeners
           this.pendingListeners.push({ event, callback });
           return;
       }
       
       // Verificar se estrutura interna está pronta
       try {
           this.socket.on(event, callback);
       } catch (error) {
           console.warn(`Erro ao registrar ${event}, tentando novamente...`, error);
           // Retry após delay
           setTimeout(() => this.on(event, callback), 100);
       }
   }
   ```

---

## 🔒 Melhores Práticas de Segurança e Robustez

### 1. **Guards em Todos os Métodos**

```javascript
on(event, callback) {
    // Guard 1: Validar parâmetros
    if (!event || typeof callback !== 'function') {
        console.error('on() requer event (string) e callback (function)');
        return;
    }
    
    // Guard 2: Inicializar estruturas
    if (!this.eventListeners) {
        this.eventListeners = new Map();
    }
    
    // Guard 3: Validar socket
    if (!this.socket) {
        this.pendingListeners.push({ event, callback });
        return;
    }
    
    // ... resto do código ...
}
```

### 2. **Tratamento de Erros Robusto**

```javascript
setupListeners() {
    if (!this.socket) return;
    
    // Wrapper para capturar erros
    const safeListener = (eventName) => (data) => {
        try {
            this.eventEmitter.emit(eventName, data);
        } catch (error) {
            console.error(`Erro ao processar evento ${eventName}:`, error);
        }
    };
    
    // Aplicar wrapper em todos os eventos
    this.socket.on('rideRequest', safeListener('rideRequest'));
}
```

### 3. **State Machine para Estados de Conexão**

```javascript
const ConnectionState = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    ERROR: 'error'
};

// Usar state machine previne race conditions
setConnectionState(newState) {
    this.state = newState;
    // Ações baseadas em estado
    if (newState === ConnectionState.CONNECTED) {
        this.processPendingListeners();
    }
}
```

---

## 📝 Padrões de Uso Recomendados

### ✅ BOM: Uso Correto

```javascript
// Componente
useEffect(() => {
    const wsManager = WebSocketManager.getInstance();
    
    // 1. Garantir conexão
    if (!wsManager.isConnected()) {
        wsManager.connect();
    }
    
    // 2. Registrar listener após conexão confirmada
    const handleConnect = () => {
        wsManager.on('rideRequest', handleRideRequest);
        wsManager.authenticate(userId, 'driver');
    };
    
    wsManager.on('connect', handleConnect);
    
    // 3. Cleanup completo
    return () => {
        wsManager.off('connect', handleConnect);
        wsManager.off('rideRequest', handleRideRequest);
    };
}, [userId]);
```

### ❌ RUIM: Uso a Evitar

```javascript
// ❌ NÃO fazer: Registrar múltiplas vezes
useEffect(() => {
    wsManager.on('rideRequest', handler1);
    wsManager.on('rideRequest', handler2); // Duplicação!
}, []);

// ❌ NÃO fazer: Não fazer cleanup
useEffect(() => {
    wsManager.on('rideRequest', handler);
    // Sem return () => cleanup - MEMORY LEAK!
}, []);

// ❌ NÃO fazer: Registrar antes da conexão sem tratamento
useEffect(() => {
    wsManager.on('rideRequest', handler); // Pode falhar se não conectado
}, []);
```

---

## 🎯 Recomendação Final

**Para sua arquitetura atual, recomendo: Solução 3 (Remover Duplicação) + Melhorias de Guards**

**Razões:**
1. ✅ Mudança mínima no código existente
2. ✅ Resolve o problema imediatamente
3. ✅ Mantém compatibilidade com código existente
4. ✅ Pode evoluir para Solução 1 depois

**Implementação em fases:**
1. **Fase 1 (Urgente):** Remover duplicação + adicionar guards
2. **Fase 2 (Curto prazo):** Implementar EventEmitter pattern interno
3. **Fase 3 (Médio prazo):** Criar hooks customizados para simplificar uso

---

## 📚 Referências e Recursos

- [Socket.IO Client Best Practices](https://socket.io/docs/v4/client-api/)
- [React Native WebSocket Guide](https://reactnative.dev/docs/network)
- [EventEmitter Pattern](https://nodejs.org/api/events.html)
- [Singleton Pattern in JavaScript](https://www.patterns.dev/vanilla/singleton-pattern)





