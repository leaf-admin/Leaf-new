# 🚗 Endpoints de Gestão Completa de Motoristas

## 📋 Lista de Endpoints

### 1. **Lista Completa de Motoristas**
```
GET /api/drivers/complete
```

**Query Parameters:**
- `status` - Filtro por status: `active`, `pending`, `suspended`, `expired`, `all`
- `planType` - Filtro por plano: `plus`, `elite`, `none`, `all`
- `approvalStatus` - Filtro por aprovação: `approved`, `pending`, `rejected`, `all`
- `search` - Busca por nome, email, telefone ou ID
- `page` - Página (padrão: 1)
- `limit` - Itens por página (padrão: 50)

**Resposta:**
```json
{
  "success": true,
  "drivers": [
    {
      "id": "driver-id",
      "name": "Nome Completo",
      "email": "email@example.com",
      "phone": "+5511999999999",
      "profileImage": "url",
      "registrationDate": "2025-01-01T00:00:00.000Z",
      "lastActivity": "2025-01-15T10:30:00.000Z",
      
      "approvalStatus": "approved",
      "approved": true,
      "kycStatus": "approved",
      "documents": {
        "license": "uploaded",
        "vehicle": "uploaded",
        "verified": true
      },
      
      "plan": {
        "type": "plus",
        "name": "Leaf Plus",
        "weeklyFee": 49.90,
        "status": "active",
        "isFree": false,
        "freeReason": null,
        "freeUntil": null,
        "nextRenewal": "2025-01-22T00:00:00.000Z",
        "daysUntilRenewal": 5
      },
      
      "vehicle": {
        "make": "Toyota",
        "model": "Corolla",
        "plate": "ABC1234",
        "color": "Branco",
        "type": "Sedan",
        "year": "2020"
      },
      
      "stats": {
        "totalTrips": 150,
        "completedTrips": 145,
        "totalEarnings": "12500.00",
        "averageRating": "4.8",
        "walletBalance": "500.00"
      },
      
      "online": {
        "isOnline": true,
        "lastSeen": "2025-01-20T15:30:00.000Z"
      },
      
      "status": "active",
      "suspended": false
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 250,
    "totalPages": 5
  }
}
```

---

### 2. **Detalhes Completos de um Motorista**
```
GET /api/drivers/:driverId/complete
```

**Resposta:** Mesma estrutura do item da lista, mas com informações adicionais:
- `paymentHistory` - Histórico completo de pagamentos de assinatura
- `stats.cancelledTrips` - Corridas canceladas
- `stats.totalWithdrawals` - Total de saques
- `suspendedAt`, `suspendReason`, `suspendedUntil` - Detalhes de suspensão

---

### 3. **Atualizar Plano do Motorista**
```
PATCH /api/drivers/:driverId/plan
```

**Body:**
```json
{
  "planType": "plus" // ou "elite" ou "none"
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Plano atualizado para plus",
  "driverId": "driver-id",
  "planType": "plus"
}
```

---

### 4. **Atualizar Status de Assinatura**
```
PATCH /api/drivers/:driverId/subscription
```

**Body:**
```json
{
  "status": "active", // ou "suspended" ou "cancelled"
  "billing_status": "active" // ou "overdue" ou "suspended"
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Status de assinatura atualizado",
  "driverId": "driver-id",
  "status": "active",
  "billing_status": "active"
}
```

---

### 5. **Estender Período Grátis**
```
POST /api/drivers/:driverId/extend-free
```

**Body:**
```json
{
  "type": "trial", // ou "months" ou "promotion"
  "days": 30,
  "reason": "Promoção especial de aniversário"
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Período grátis estendido até 2025-02-20",
  "driverId": "driver-id",
  "type": "trial",
  "freeUntil": "2025-02-20T00:00:00.000Z",
  "reason": "Promoção especial de aniversário"
}
```

---

### 6. **Aprovar Motorista**
```
POST /api/drivers/:driverId/approve
```

**Resposta:**
```json
{
  "success": true,
  "message": "Motorista aprovado com sucesso",
  "driverId": "driver-id"
}
```

**Nota:** Automaticamente verifica e aplica promoções elegíveis após aprovação.

---

### 7. **Suspender Motorista**
```
POST /api/drivers/:driverId/suspend
```

**Body:**
```json
{
  "reason": "Violação dos termos de uso",
  "duration": 7 // opcional: dias de suspensão
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Motorista suspenso com sucesso",
  "driverId": "driver-id",
  "suspended": true,
  "suspendedAt": "2025-01-20T10:00:00.000Z",
  "suspendReason": "Violação dos termos de uso",
  "suspendedUntil": "2025-01-27T10:00:00.000Z" // se duration foi fornecido
}
```

---

### 8. **Reativar Motorista Suspenso**
```
POST /api/drivers/:driverId/unsuspend
```

**Resposta:**
```json
{
  "success": true,
  "message": "Motorista reativado com sucesso",
  "driverId": "driver-id"
}
```

---

## 📊 Informações Incluídas na Lista

Cada motorista na lista inclui:

### ✅ Informações Básicas
- Nome completo
- Email
- Telefone
- Foto de perfil
- Data de registro
- Última atividade

### ✅ Status de Aprovação
- Status de aprovação (`approved`, `pending`, `not_submitted`)
- Status KYC
- Status dos documentos (CNH, veículo)
- Data de aprovação

### ✅ Plano e Assinatura
- Tipo de plano (`plus`, `elite`, `none`)
- Nome do plano
- Taxa semanal
- Status da assinatura (`active`, `free`, `overdue`, `suspended`)
- Se está em período grátis
- Motivo do período grátis (trial, indicação, promoção)
- Data de término do período grátis
- Próxima renovação
- Dias até a renovação

### ✅ Veículo
- Marca, modelo, placa
- Cor, tipo, ano
- Imagem do veículo

### ✅ Estatísticas
- Total de corridas
- Corridas completadas
- Ganhos totais
- Avaliação média
- Saldo na carteira

### ✅ Status Online
- Se está online
- Última vez visto

### ✅ Status Geral
- Status do motorista (`active`, `pending`, `suspended`)
- Se está suspenso
- Detalhes de suspensão (se aplicável)

---

## 🔍 Filtros Disponíveis

- **Por Status:** `active`, `pending`, `suspended`, `expired`
- **Por Plano:** `plus`, `elite`, `none`
- **Por Aprovação:** `approved`, `pending`, `rejected`
- **Busca:** Nome, email, telefone ou ID do motorista
- **Paginação:** Suporte completo com `page` e `limit`

---

## 🎯 Casos de Uso

1. **Listar todos os motoristas com plano Plus:**
   ```
   GET /api/drivers/complete?planType=plus
   ```

2. **Buscar motoristas pendentes de aprovação:**
   ```
   GET /api/drivers/complete?approvalStatus=pending
   ```

3. **Buscar motorista específico:**
   ```
   GET /api/drivers/complete?search=email@example.com
   ```

4. **Listar motoristas suspensos:**
   ```
   GET /api/drivers/complete?status=suspended
   ```

5. **Ver detalhes completos de um motorista:**
   ```
   GET /api/drivers/{driverId}/complete
   ```

---

## 📝 Notas Importantes

- Todos os endpoints retornam dados em tempo real do Firebase
- Os cálculos de período grátis consideram: `free_trial_end`, `free_months_end`, `promotion_free_end`
- A próxima renovação é calculada automaticamente (toda quarta-feira)
- O status de assinatura considera o `billing_status` do motorista
- Aprovação de motorista automaticamente verifica promoções elegíveis

