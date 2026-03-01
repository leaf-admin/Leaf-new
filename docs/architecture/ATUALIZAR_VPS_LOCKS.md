# 📋 Arquivos para Atualizar na VPS - Sistema de Locks

## Arquivos Modificados

### 1. `leaf-websocket-backend/server.js`
**Mudança:** Liberação automática de lock ao finalizar viagem

**Localização:** Linhas ~1286-1299 (handler `completeTrip`)

**O que foi adicionado:**
```javascript
// ✅ Liberar lock do motorista quando viagem é finalizada
if (driverId) {
    try {
        const driverLockManager = require('./services/driver-lock-manager');
        const lockStatus = await driverLockManager.isDriverLocked(driverId);
        
        if (lockStatus.isLocked) {
            await driverLockManager.releaseLock(driverId);
            console.log(`🔓 [completeTrip] Lock liberado para driver ${driverId} após finalizar viagem ${bookingId}`);
        }
    } catch (lockError) {
        console.error(`❌ [completeTrip] Erro ao liberar lock:`, lockError);
    }
}
```

---

### 2. `leaf-websocket-backend/routes/driver-status-check.js`
**Mudança:** Novos endpoints para gerenciar locks

**Endpoints adicionados:**

#### a) `POST /:driverId/clear-lock` (linhas 173-211)
- Limpa lock de um motorista específico

#### b) `GET /:driverId/lock` (linhas 214-243)
- Verifica status do lock de um motorista

#### c) `POST /clear-all-locks` (linhas 246-299)
- Limpa locks de todos os drivers conectados

#### d) `GET /locks/all` (linhas 302-316)
- Lista todos os locks ativos no sistema

---

## 📦 Como Atualizar na VPS

### Opção 1: Copiar arquivos manualmente
```bash
# 1. Copiar server.js
scp leaf-websocket-backend/server.js usuario@vps:/caminho/para/leaf-websocket-backend/

# 2. Copiar driver-status-check.js
scp leaf-websocket-backend/routes/driver-status-check.js usuario@vps:/caminho/para/leaf-websocket-backend/routes/
```

### Opção 2: Usar script de deploy existente
```bash
# Se houver script de deploy, atualizar e executar
./deploy-to-vps.sh
```

### Opção 3: Editar diretamente na VPS
1. Conectar via SSH
2. Editar os arquivos conforme as mudanças acima
3. Reiniciar o servidor

---

## 🔄 Após Atualizar

**Reiniciar o servidor:**
```bash
# Via PM2
pm2 restart leaf-websocket-backend

# Via systemctl
systemctl restart leaf-websocket-backend

# Ou manualmente
pkill -f "node.*server.js"
cd /caminho/para/leaf-websocket-backend
nohup node server.js > server.log 2>&1 &
```

---

## ✅ Testar Endpoints

Após atualizar, testar os novos endpoints:

```bash
# 1. Verificar locks ativos
curl http://SEU_SERVIDOR:8081/api/driver-status/locks/all

# 2. Limpar locks de todos os drivers conectados
curl -X POST http://SEU_SERVIDOR:8081/api/driver-status/clear-all-locks

# 3. Verificar lock de um motorista específico
curl http://SEU_SERVIDOR:8081/api/driver-status/DRIVER_ID/lock

# 4. Limpar lock de um motorista específico
curl -X POST http://SEU_SERVIDOR:8081/api/driver-status/DRIVER_ID/clear-lock
```

---

## 📝 Resumo das Mudanças

1. **Liberação automática:** Lock é liberado automaticamente quando motorista finaliza viagem
2. **Endpoints de gerenciamento:** 4 novos endpoints para verificar e limpar locks
3. **Limpeza em massa:** Endpoint para limpar locks de todos os drivers conectados











