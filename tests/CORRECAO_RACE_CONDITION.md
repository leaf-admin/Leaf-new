# 🔧 CORREÇÃO: Race Condition em Eventos WebSocket

**Data:** 01/11/2025  
**Problema:** Eventos `tripStarted` e `tripCompleted` chegavam antes do listener ser registrado  
**Solução:** Verificar se evento já chegou antes de aguardar

---

## 📋 PROBLEMA IDENTIFICADO

### **Race Condition:**

```
1. driver.startTrip() → Emite para servidor [T+0ms]
2. Servidor processa e emite tripStarted para customer [T+5ms]
3. driver.startTrip() resolve (retorna) [T+10ms]
4. customer.waitForEvent('tripStarted') começa a ESCUTAR [T+11ms]
```

**Resultado:** Evento chega ANTES do listener ser registrado → evento PERDIDO

**Por que localmente funcionou:**
- Latência < 1ms mantém tudo em ordem
- Race condition não é visível

**Por que na VPS falhou:**
- Latência ~16ms aumenta janela de race condition
- Evento chega antes do listener estar pronto

---

## ✅ SOLUÇÃO IMPLEMENTADA (Solução 2)

### **Modificação em `websocket-client.js`:**

**Antes:**
```javascript
async waitForEvent(eventName, timeout = 30) {
    return TestHelpers.waitForEvent(this.socket, eventName, timeout);
}
```

**Depois:**
```javascript
async waitForEvent(eventName, timeout = 30) {
    // ✅ Verificar se evento já chegou ANTES de aguardar
    const lastEvent = this.getLastEvent(eventName);
    if (lastEvent) {
        // Evento já chegou, retornar imediatamente (apenas os dados)
        return lastEvent.data;
    }
    
    // Evento ainda não chegou, aguardar normalmente
    return TestHelpers.waitForEvent(this.socket, eventName, timeout);
}
```

---

## 🔍 COMO FUNCIONA

### **Fluxo Corrigido:**

```
1. driver.startTrip() → Emite para servidor [T+0ms]
2. Servidor processa e emite tripStarted para customer [T+5ms]
3. socket.onAny() captura evento e armazena em receivedEvents [T+5ms]
4. driver.startTrip() resolve (retorna) [T+10ms]
5. customer.waitForEvent('tripStarted') [T+11ms]
   ├─> Verifica getLastEvent('tripStarted') → ENCONTRA! ✅
   └─> Retorna evento imediatamente (sem aguardar)
```

**Resultado:** Evento não é perdido, mesmo se chegar antes do listener

---

## 📊 VANTAGENS DA SOLUÇÃO 2

### **1. Resolve Race Condition:**
- ✅ Verifica eventos já recebidos ANTES de aguardar
- ✅ Retorna imediatamente se evento já chegou
- ✅ Não depende de timing ou latência

### **2. Mantém Compatibilidade:**
- ✅ Se evento não chegou ainda, aguarda normalmente
- ✅ Não quebra código existente
- ✅ Funciona para todos os eventos

### **3. Simples e Robusto:**
- ✅ Usa infraestrutura já existente (`onAny` + `receivedEvents`)
- ✅ Não adiciona complexidade extra
- ✅ Funciona localmente E na VPS

---

## 🎯 EVENTOS PROTEGIDOS

Esta correção protege TODOS os eventos que usam `waitForEvent()`:

- ✅ `driverStatusUpdated`
- ✅ `rideAccepted`
- ✅ `tripStarted` ⭐ (principal problema)
- ✅ `tripCompleted` ⭐ (principal problema)
- ✅ Qualquer outro evento futuro

---

## ✅ TESTE

Para validar a correção:

```bash
cd tests
node run-complete-flow.js
```

**Resultado esperado:**
- ✅ `tripStarted` recebido pelo customer (mesmo com latência)
- ✅ `tripCompleted` recebido pelo customer (mesmo com latência)
- ✅ Teste passa localmente E na VPS

---

**Documento criado em:** 01/11/2025  
**Status:** ✅ Implementado


