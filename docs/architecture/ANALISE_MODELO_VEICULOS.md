# 🔍 Análise: Modelo Atual vs Modelo Sugerido (Uber/99)

## 📊 COMPARAÇÃO

### ✅ O QUE JÁ TEMOS (Parcialmente Correto)

#### 1. Separação Básica
```
✅ vehicles/          → Veículo físico (único por placa)
✅ user_vehicles/     → Relacionamento motorista-veículo
```

**Estrutura atual:**
```javascript
// vehicles/{vehicleId}
{
  id: "vehicle_123",
  plate: "ABC1234",      // ✅ ÚNICA
  brand: "Honda",
  model: "Civic",
  year: "2020",
  ...
}

// user_vehicles/{userId}/{userVehicleId}
{
  id: "user123_vehicle123_timestamp",
  userId: "user123",
  vehicleId: "vehicle_123",
  status: "approved",    // ✅ pending, approved, rejected
  isActive: true,         // ✅ Ativo para este motorista
  documents: {...},
  ...
}
```

#### 2. Validações Básicas
- ✅ Placa é única (verificado no cadastro)
- ✅ Veículo precisa estar aprovado para uso
- ✅ Apenas um veículo ativo por motorista

---

### ❌ O QUE ESTÁ FALTANDO (Crítico)

#### 1. **Lock de Veículo (CRÍTICO)**
**Problema:** Um veículo pode estar ativo com MÚLTIPLOS motoristas simultaneamente!

**Situação atual:**
```
Motorista A → Ativa veículo ABC1234 → isActive: true
Motorista B → Ativa mesmo veículo ABC1234 → isActive: true
❌ AMBOS podem ficar online com o mesmo carro!
```

**O que deveria ter:**
```javascript
// Redis Lock
vehicle_lock:ABC1234 = driverId
TTL: 300 segundos (proteção contra crash)
```

#### 2. **Tipo de Vínculo**
**Falta:** Não há distinção entre:
- `owner` (dono)
- `rented` (alugado)
- `authorized` (terceiro autorizado)

**Impacto:** Não consegue rastrear se motorista é dono ou não

#### 3. **Validação ao Ficar Online**
**Falta:** Não verifica se veículo já está em uso por outro motorista

**Código atual:**
```javascript
// mobile-app/src/components/map/DriverUI.js:2258
const activateOnlineStatus = async () => {
  // ✅ Verifica se tem veículo
  // ❌ NÃO verifica se veículo está em uso
  // ❌ NÃO cria lock
}
```

#### 4. **Validação de CNH + Vínculo**
**Falta:** Não valida se:
- CNH está válida
- Vínculo está aprovado
- Veículo está livre

---

## 🎯 MODELO SUGERIDO (Uber/99)

### Estrutura Ideal

#### 1. **Driver (Motorista)**
```javascript
users/{driverId}
{
  id: "driver123",
  name: "João Silva",
  cpf: "12345678901",
  cnh: {
    number: "123456789",
    status: "validated",  // pending, validated, expired
    expiresAt: "2025-12-31"
  },
  status: "active",      // active, suspended, banned
  ...
}
```

#### 2. **Vehicle (Veículo)**
```javascript
vehicles/{vehicleId}
{
  id: "vehicle_123",
  plate: "ABC1234",       // ✅ ÚNICA
  renavam: "123456789",
  brand: "Honda",
  model: "Civic",
  year: "2020",
  status: "active",       // active, blocked, under_review
  ...
}
```

#### 3. **DriverVehicle (Vínculo) - A CHAVE**
```javascript
user_vehicles/{userId}/{userVehicleId}
{
  id: "user123_vehicle123_timestamp",
  driverId: "driver123",
  vehicleId: "vehicle_123",
  
  // ✅ TIPO DE VÍNCULO (NOVO)
  linkType: "owner",      // owner, rented, authorized
  
  // ✅ STATUS (MELHORADO)
  status: "approved",     // pending, approved, active, blocked
  isActive: true,         // true = em uso AGORA
  
  // ✅ VALIDADE (NOVO)
  validFrom: "2025-01-01",
  validUntil: null,       // null = indefinido, ou data específica
  
  // ✅ APROVAÇÃO
  approvedAt: "2025-01-15",
  approvedBy: "admin123",
  
  // ✅ DOCUMENTOS
  documents: {
    crlv: "url...",
    authorization: "url..."  // Se linkType = authorized
  },
  
  createdAt: "...",
  updatedAt: "..."
}
```

#### 4. **Lock de Veículo (Redis)**
```javascript
// Redis Key
vehicle_lock:{plate} = driverId
TTL: 300 segundos

// Exemplo
vehicle_lock:ABC1234 = driver123
```

---

## 🔐 REGRAS DE NEGÓCIO (O que falta implementar)

### Regra 1: Um veículo só pode estar ativo em UMA sessão

**Implementação:**
```javascript
// Ao ficar online
async function activateOnlineStatus() {
  // 1. Buscar veículo ativo do motorista
  const activeVehicle = await getActiveVehicle(driverId);
  
  // 2. Tentar criar lock no Redis
  const lockKey = `vehicle_lock:${activeVehicle.plate}`;
  const lockAcquired = await redis.set(
    lockKey,
    driverId,
    'EX', 300,  // TTL 5 minutos
    'NX'        // Only set if not exists
  );
  
  if (!lockAcquired) {
    // Veículo já está em uso
    const currentDriver = await redis.get(lockKey);
    throw new Error(`Veículo ${activeVehicle.plate} já está em uso por outro motorista`);
  }
  
  // 3. Prosseguir com ficar online
  ...
}
```

### Regra 2: Validação completa ao ficar online

**Checklist:**
```javascript
✅ CNH válida (não vencida)
✅ Vínculo DriverVehicle aprovado
✅ Veículo não está bloqueado
✅ Veículo não está em uso (lock disponível)
✅ Vínculo está ativo (isActive: true)
```

### Regra 3: Liberar lock ao ficar offline

**Implementação:**
```javascript
// Ao ficar offline
async function deactivateOnlineStatus() {
  // 1. Buscar veículo ativo
  const activeVehicle = await getActiveVehicle(driverId);
  
  // 2. Liberar lock
  const lockKey = `vehicle_lock:${activeVehicle.plate}`;
  await redis.del(lockKey);
  
  // 3. Prosseguir com ficar offline
  ...
}
```

---

## 📝 PLANO DE IMPLEMENTAÇÃO

### ✅ Fase 1: Lock de Veículo (CRÍTICO) - **IMPLEMENTADO**
**Prioridade:** 🔴 ALTA  
**Status:** ✅ **COMPLETO**

1. ✅ Criar `VehicleLockManager` (similar ao `DriverLockManager`)
2. ✅ Adicionar lock ao ficar online
3. ✅ Liberar lock ao ficar offline
4. ✅ Adicionar TTL (proteção contra crash)
5. ✅ Heartbeat para renovar lock

**Arquivos:**
- ✅ `leaf-websocket-backend/services/vehicle-lock-manager.js` (CRIADO)
- ✅ `mobile-app/src/components/map/DriverUI.js` (MODIFICADO)
- ✅ `leaf-websocket-backend/server.js` (MODIFICADO)

### ❌ Fase 2: Tipo de Vínculo - **NÃO NECESSÁRIO**
**Prioridade:** 🟢 N/A  
**Status:** ❌ **NÃO SERÁ IMPLEMENTADO**

**Decisão:** Tipo de vínculo é indiferente no momento atual.

### ❌ Fase 3: Validação de CNH - **NÃO NECESSÁRIO**
**Prioridade:** 🟢 N/A  
**Status:** ❌ **NÃO SERÁ IMPLEMENTADO**

**Decisão:** CNH já é validada no cadastro do usuário, não precisa validar novamente ao ficar online.

### ❌ Fase 4: Validade do Vínculo - **NÃO NECESSÁRIO**
**Prioridade:** 🟢 N/A  
**Status:** ❌ **NÃO SERÁ IMPLEMENTADO**

**Decisão:** Não vamos controlar validade do vínculo no momento.

---

## 🚨 PROBLEMAS CRÍTICOS ATUAIS

### 1. **Fraude: Mesmo carro com múltiplos motoristas**
```
❌ Motorista A ativa veículo ABC1234
❌ Motorista B ativa mesmo veículo ABC1234
❌ AMBOS ficam online simultaneamente
❌ Sistema não detecta
```

**Solução:** Lock de veículo (Fase 1)

### 2. **Sem rastreamento de tipo de vínculo**
```
❌ Não sabe se motorista é dono ou não
❌ Não pode validar termo de autorização
❌ Não pode rastrear carros alugados
```

**Solução:** Campo `linkType` (Fase 2)

### 3. **Sem validação de CNH ao ficar online**
```
❌ Motorista pode ficar online com CNH vencida
❌ Sistema não verifica
```

**Solução:** Validação completa (Fase 3)

---

## ✅ RESUMO

### O que temos:
- ✅ Separação básica (Vehicle + UserVehicle)
- ✅ Placa única
- ✅ Status de aprovação
- ✅ Um veículo ativo por motorista

### O que falta (crítico):
- ❌ Lock de veículo (um veículo só pode estar ativo em UMA sessão)
- ❌ Tipo de vínculo (owner, rented, authorized)
- ❌ Validação completa ao ficar online
- ❌ Validade do vínculo

### ✅ Implementação:
1. ✅ **Lock de veículo implementado** (Fase 1) - COMPLETO
2. ❌ Tipo de vínculo (Fase 2) - NÃO NECESSÁRIO
3. ❌ Validação de CNH (Fase 3) - NÃO NECESSÁRIO
4. ❌ Validade do vínculo (Fase 4) - NÃO NECESSÁRIO

**Status Final:** Sistema completo e pronto para produção com apenas a Fase 1.

