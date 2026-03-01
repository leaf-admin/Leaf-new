# 🚀 PLANO - DASHBOARD WEBSOCKET (FASE 2)

**Data:** 16/12/2025  
**Status:** Em Implementação

---

## 🎯 **OBJETIVO**

Implementar atualizações em tempo real no Dashboard Admin via WebSocket, substituindo o polling atual por eventos push.

---

## 📋 **O QUE SERÁ IMPLEMENTADO**

### **1. Backend - Melhorias no Dashboard WebSocket** ✅

**Arquivo:** `leaf-websocket-backend/services/dashboard-websocket.js`

**Melhorias:**
- ✅ Suportar autenticação JWT (além de Firebase Auth)
- ✅ Emitir eventos de métricas atualizadas automaticamente
- ✅ Broadcast de estatísticas em tempo real
- ✅ Eventos específicos por tipo de métrica

**Eventos a Emitir:**
- `metrics:updated` - Métricas gerais atualizadas
- `users:stats:updated` - Estatísticas de usuários
- `rides:stats:updated` - Estatísticas de corridas
- `revenue:stats:updated` - Estatísticas financeiras
- `system:status:updated` - Status do sistema
- `activity:new` - Nova atividade

---

### **2. Frontend - Cliente WebSocket** ✅

**Arquivo:** `leaf-dashboard/src/services/websocket-service.ts`

**Funcionalidades:**
- ✅ Conexão ao namespace `/dashboard`
- ✅ Autenticação com JWT token
- ✅ Reconexão automática
- ✅ Gerenciamento de estado de conexão
- ✅ Event listeners para métricas

---

### **3. Frontend - Hook de WebSocket** ✅

**Arquivo:** `leaf-dashboard/src/hooks/useWebSocketMetrics.ts`

**Funcionalidades:**
- ✅ Hook para conectar ao WebSocket
- ✅ Hook para escutar eventos específicos
- ✅ Integração com hooks existentes
- ✅ Fallback para polling se WebSocket falhar

---

### **4. Frontend - React Query (Opcional)** ⏭️

**Arquivo:** `leaf-dashboard/src/hooks/useReactQuery.ts`

**Funcionalidades:**
- ✅ Cache inteligente de métricas
- ✅ Refetch automático
- ✅ Invalidação de cache
- ✅ Otimização de requisições

---

## 🔧 **IMPLEMENTAÇÃO DETALHADA**

### **Backend - Atualizar Dashboard WebSocket**

1. **Adicionar suporte JWT:**
```javascript
socket.on('authenticate', async (data) => {
  const { firebaseToken, jwtToken } = data;
  
  // Tentar JWT primeiro (prioridade)
  if (jwtToken) {
    // Verificar JWT
    const decoded = jwt.verify(jwtToken, JWT_SECRET);
    // ... validar usuário admin
  } else if (firebaseToken) {
    // Fallback para Firebase Auth
    // ... código existente
  }
});
```

2. **Emitir eventos periódicos:**
```javascript
startPeriodicUpdates() {
  setInterval(async () => {
    const metrics = await this.getCurrentMetrics();
    this.dashboardNamespace.emit('metrics:updated', metrics);
  }, 5000); // A cada 5 segundos
}
```

---

### **Frontend - Serviço WebSocket**

```typescript
class WebSocketService {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  
  connect(token: string) {
    this.socket = io(`${WS_URL}/dashboard`, {
      auth: { jwtToken: token },
      transports: ['websocket']
    });
    
    this.socket.on('connect', () => {
      this.reconnectAttempts = 0;
    });
    
    this.socket.on('disconnect', () => {
      this.reconnect();
    });
  }
  
  on(event: string, callback: Function) {
    this.socket?.on(event, callback);
  }
  
  off(event: string, callback: Function) {
    this.socket?.off(event, callback);
  }
}
```

---

### **Frontend - Hook de Métricas**

```typescript
export function useWebSocketMetrics() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState(null);
  const [connected, setConnected] = useState(false);
  
  useEffect(() => {
    if (!user) return;
    
    const token = authService.getAccessToken();
    if (!token) return;
    
    wsService.connect(token);
    
    wsService.on('metrics:updated', (data) => {
      setMetrics(data);
    });
    
    wsService.on('connect', () => {
      setConnected(true);
    });
    
    return () => {
      wsService.disconnect();
    };
  }, [user]);
  
  return { metrics, connected };
}
```

---

## 📊 **EVENTOS WEBSOCKET**

### **Eventos do Cliente → Servidor:**
- `authenticate` - Autenticar com JWT ou Firebase token
- `request_live_data` - Solicitar dados em tempo real
- `request_user_stats` - Solicitar estatísticas de usuários
- `request_rides_stats` - Solicitar estatísticas de corridas
- `request_revenue_stats` - Solicitar estatísticas financeiras

### **Eventos do Servidor → Cliente:**
- `metrics:updated` - Métricas gerais atualizadas
- `users:stats:updated` - Estatísticas de usuários atualizadas
- `rides:stats:updated` - Estatísticas de corridas atualizadas
- `revenue:stats:updated` - Estatísticas financeiras atualizadas
- `system:status:updated` - Status do sistema atualizado
- `activity:new` - Nova atividade registrada
- `connected` - Conexão estabelecida
- `authentication_error` - Erro de autenticação

---

## 🎯 **BENEFÍCIOS**

1. **Performance:**
   - Reduz requisições HTTP (de polling para push)
   - Atualizações instantâneas
   - Menor latência

2. **Experiência do Usuário:**
   - Dados sempre atualizados
   - Sem necessidade de refresh manual
   - Indicador de conexão em tempo real

3. **Escalabilidade:**
   - Menor carga no servidor
   - Conexões persistentes
   - Broadcast eficiente

---

## ⚠️ **FALLBACK**

Se WebSocket falhar:
- Voltar para polling HTTP
- Mostrar aviso ao usuário
- Tentar reconectar automaticamente

---

**Última atualização:** 16/12/2025



