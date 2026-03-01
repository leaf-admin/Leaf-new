# 🚗 Fluxo Completo de Veículos para Motoristas

## 📋 Visão Geral

Este documento explica como funciona o sistema de veículos no Leaf App, desde o cadastro até o uso durante as corridas.

---

## 🔄 FLUXO COMPLETO

### 1️⃣ **CADASTRO DE VEÍCULO**

**Onde:** Tela `AddVehicleScreen` (`mobile-app/src/screens/AddVehicleScreen.js`)

**Processo:**
1. Motorista preenche dados do veículo:
   - Placa
   - Marca
   - Modelo
   - Ano
   - Tipo (carro/moto)
   - VIN (opcional)
   - Documentos (CRLV, seguro, comprovante de posse)

2. Sistema chama `VehicleService.registerVehicleForUser()`:
   ```javascript
   // mobile-app/src/services/VehicleService.js:29
   async registerVehicleForUser(vehicleData, documents = {})
   ```

3. **O que acontece:**
   - ✅ Verifica se veículo já existe no sistema (por placa)
   - ✅ Cria veículo em `vehicles/{vehicleId}` (se não existir)
   - ✅ Faz upload dos documentos para Firebase Storage
   - ✅ Cria relacionamento em `user_vehicles/{userId}/{userVehicleId}`
   - ✅ Status inicial: `pending`, `isActive: false`

**Estrutura criada:**
```
vehicles/
  └── {vehicleId}/
      ├── plate: "ABC1234"
      ├── brand: "Honda"
      ├── model: "Civic"
      ├── year: "2020"
      └── ...

user_vehicles/
  └── {userId}/
      └── {userVehicleId}/
          ├── vehicleId: "{vehicleId}"
          ├── status: "pending"  ⚠️ AGUARDANDO APROVAÇÃO
          ├── isActive: false     ⚠️ NÃO ESTÁ ATIVO
          ├── documents: {...}
          └── ...
```

---

### 2️⃣ **APROVAÇÃO DO VEÍCULO**

**Quem aprova:** Admin via Dashboard

**Onde:** 
- Dashboard admin (`leaf-dashboard`)
- Backend API (`leaf-websocket-backend/routes/drivers.js`)

**Processo:**
1. Admin visualiza veículos pendentes no dashboard
2. Admin analisa documentos (CRLV, seguro, etc.)
3. Admin aprova ou rejeita:
   ```javascript
   // mobile-app/common/common-packages/src/config/vehicleConfig.js:198
   approveVehicle: async (vehicleId, approvedBy)
   ```

4. **O que acontece:**
   - ✅ Status muda de `pending` → `approved`
   - ✅ Campo `approved: true` é setado
   - ✅ Campo `approvedAt` é preenchido
   - ✅ Campo `approvedBy` registra quem aprovou

**Status possíveis:**
- `pending` - Em análise (aguardando aprovação)
- `approved` - Aprovado ✅
- `rejected` - Rejeitado ❌
- `needs_info` - Precisa de informações adicionais
- `inactive` - Inativo

---

### 3️⃣ **ATIVAÇÃO DO VEÍCULO**

**Onde:** Tela `MyVehiclesScreen` (`mobile-app/src/screens/MyVehiclesScreen.js`)

**Processo:**
1. Motorista acessa "Meus Veículos"
2. Visualiza lista de veículos cadastrados
3. Seleciona qual veículo quer usar (ativar):
   ```javascript
   // mobile-app/src/screens/MyVehiclesScreen.js:124
   const selectActiveVehicle = async (vehicleId)
   ```

4. **O que acontece:**
   - ✅ Sistema chama `VehicleService.setActiveVehicle()`
   - ✅ Desativa TODOS os outros veículos do motorista
   - ✅ Ativa APENAS o veículo selecionado
   - ✅ Campo `isActive: true` é setado no `user_vehicles`

**Importante:**
- ⚠️ Apenas UM veículo pode estar ativo por vez
- ⚠️ Veículo precisa estar `approved` para poder ser ativado
- ⚠️ Se motorista tiver múltiplos veículos, precisa escolher qual usar

---

### 4️⃣ **FICAR ONLINE**

**Onde:** `DriverUI.js` - Botão "Ficar Online"

**Processo:**
1. Motorista clica em "Ficar Online"
2. Sistema valida se tem veículo:
   ```javascript
   // mobile-app/src/components/map/DriverUI.js:2186
   const checkDriverHasVehicle = async (userId)
   ```

3. **Validações atuais:**
   - ✅ Verifica se tem veículos em `user_vehicles`
   - ✅ Verifica se tem pelo menos um veículo aprovado/ativo
   - ✅ Fallback: Verifica dados no perfil (`carType`, `carPlate`)

4. **Se passar na validação:**
   - ✅ Motorista fica online
   - ✅ Sistema usa o veículo ATIVO (`isActive: true`)
   - ✅ Envia localização para o servidor

**Problema atual:**
- ⚠️ **NÃO há seleção de veículo ao ficar online**
- ⚠️ Sistema usa o veículo que está `isActive: true`
- ⚠️ Se motorista tiver múltiplos veículos aprovados, precisa ativar antes

---

## 🔍 ESTRUTURA DE DADOS

### **Tabela `vehicles/`**
Armazena dados do veículo (único por placa):
```javascript
{
  id: "vehicle_123",
  plate: "ABC1234",
  brand: "Honda",
  model: "Civic",
  year: "2020",
  vehicleType: "carro",
  createdAt: "...",
  updatedAt: "..."
}
```

### **Tabela `user_vehicles/`**
Armazena relacionamento usuário-veículo:
```javascript
{
  id: "{userId}_{vehicleId}_{timestamp}",
  userId: "user123",
  vehicleId: "vehicle_123",
  status: "approved",        // pending, approved, rejected
  isActive: true,            // true = veículo ativo (em uso)
  approved: true,
  documents: {
    crlv: "url...",
    insurance: "url..."
  },
  createdAt: "...",
  updatedAt: "..."
}
```

### **Perfil do Usuário (`users/{userId}`)**
Armazena dados do veículo ativo (para compatibilidade):
```javascript
{
  vehicleId: "vehicle_123",
  carType: "Leaf Plus",
  carPlate: "ABC1234",
  vehicleNumber: "ABC1234",
  carApproved: true,
  ...
}
```

---

## ⚠️ PROBLEMAS IDENTIFICADOS

### 1. **Não há seleção de veículo ao ficar online**
- **Situação:** Motorista pode ter múltiplos veículos aprovados
- **Problema:** Sistema usa o que está `isActive: true`, mas não há como escolher na hora
- **Solução sugerida:** Adicionar modal de seleção ao ficar online (se tiver múltiplos)

### 2. **Validação não verifica se veículo está ativo**
- **Situação:** Validação atual aceita qualquer veículo aprovado
- **Problema:** Pode ter veículo aprovado mas não ativo
- **Solução:** Melhorar validação para verificar `isActive: true` E `status: 'approved'`

### 3. **Veículo pode estar aprovado mas não ativo**
- **Situação:** Motorista cadastra veículo, admin aprova, mas motorista não ativa
- **Problema:** Motorista não consegue ficar online (não tem veículo ativo)
- **Solução:** Auto-ativar primeiro veículo aprovado se não tiver nenhum ativo

---

## ✅ MELHORIAS SUGERIDAS

### 1. **Melhorar validação ao ficar online**
```javascript
// Verificar se tem veículo APROVADO E ATIVO
const hasActiveApprovedVehicle = userVehicles.some(v => 
  v.status === 'approved' && 
  v.isActive === true
);
```

### 2. **Adicionar seleção de veículo ao ficar online**
- Se motorista tiver múltiplos veículos aprovados
- Mostrar modal para escolher qual usar
- Ativar o veículo selecionado automaticamente

### 3. **Auto-ativar primeiro veículo aprovado**
- Se motorista não tiver nenhum veículo ativo
- Mas tiver veículo aprovado
- Auto-ativar o primeiro veículo aprovado

---

## 📝 RESUMO

1. **Cadastro:** Motorista cadastra → Status `pending`
2. **Aprovação:** Admin aprova → Status `approved`
3. **Ativação:** Motorista ativa → `isActive: true`
4. **Ficar Online:** Sistema valida → Usa veículo ativo

**Fluxo ideal:**
```
Cadastrar → Aguardar Aprovação → Ativar → Ficar Online
```

**Problema atual:**
- Não há seleção ao ficar online
- Validação não verifica se está ativo
- Pode ter veículo aprovado mas não ativo

