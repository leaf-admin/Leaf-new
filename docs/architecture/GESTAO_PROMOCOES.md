# 🎁 GESTÃO DE PROMOÇÕES PARA MOTORISTAS

**Data:** 25/01/2025  
**Objetivo:** Sistema completo de gestão de promoções via dashboard

---

## 📋 VISÃO GERAL

O sistema permite criar e gerenciar promoções para motoristas diretamente pelo dashboard, com verificação automática de elegibilidade e aplicação de benefícios.

### **Tipos de Promoções Suportadas:**

1. **Assinatura Grátis** (`free_subscription`)
   - Período sem cobrança semanal
   - Exemplo: "Assinatura grátis até 31/01/2026"

2. **Desconto** (`discount`)
   - Desconto percentual ou fixo
   - Exemplo: "50% de desconto na primeira semana"

3. **Extensão de Trial** (`trial_extension`)
   - Estender período de trial existente
   - Exemplo: "+30 dias de trial"

---

## 🎯 CRITÉRIOS DE ELEGIBILIDADE

### **1. Primeiros N Motoristas** (`first_n_drivers`)
```json
{
  "criteria": "first_n_drivers",
  "value": 500,
  "endDate": "2025-12-31T23:59:59Z"
}
```
- Motoristas que estão entre os primeiros N cadastrados
- Opcionalmente, com data limite de cadastro

### **2. Período de Cadastro** (`registration_date_range`)
```json
{
  "criteria": "registration_date_range",
  "startDate": "2025-01-01T00:00:00Z",
  "endDate": "2025-12-31T23:59:59Z"
}
```
- Motoristas que se cadastraram em um período específico

### **3. Todos os Motoristas** (`all_drivers`)
```json
{
  "criteria": "all_drivers"
}
```
- Todos os motoristas são elegíveis

### **4. Lista Específica** (`specific_drivers`)
```json
{
  "criteria": "specific_drivers",
  "driverIds": ["driver1", "driver2", "driver3"]
}
```
- Lista específica de IDs de motoristas

---

## 📡 ENDPOINTS DA API

### **1. Criar Promoção**
```http
POST /api/promotions
Content-Type: application/json

{
  "name": "Promoção Primeiros 500",
  "description": "Assinatura grátis para os primeiros 500 motoristas",
  "type": "free_subscription",
  "benefit": {
    "type": "free_subscription",
    "duration": 31,
    "unit": "days"
  },
  "eligibility": {
    "criteria": "first_n_drivers",
    "value": 500,
    "endDate": "2025-12-31T23:59:59Z"
  },
  "startDate": "2025-01-01T00:00:00Z",
  "endDate": "2025-12-31T23:59:59Z",
  "maxRedemptions": 500,
  "createdBy": "admin"
}
```

**Resposta:**
```json
{
  "success": true,
  "promotion": {
    "id": "promo_1737820800000_abc123",
    "name": "Promoção Primeiros 500",
    "status": "active",
    "currentRedemptions": 0,
    "createdAt": "2025-01-25T10:00:00Z"
  }
}
```

---

### **2. Listar Promoções**
```http
GET /api/promotions?status=active&type=free_subscription
```

**Resposta:**
```json
{
  "success": true,
  "promotions": [
    {
      "id": "promo_123",
      "name": "Promoção Primeiros 500",
      "type": "free_subscription",
      "status": "active",
      "currentRedemptions": 45,
      "maxRedemptions": 500
    }
  ],
  "count": 1
}
```

---

### **3. Verificar Elegibilidade**
```http
GET /api/promotions/:promotionId/check-eligibility/:driverId
```

**Resposta:**
```json
{
  "eligible": true,
  "promotion": {
    "id": "promo_123",
    "name": "Promoção Primeiros 500"
  }
}
```

ou

```json
{
  "eligible": false,
  "reason": "Motorista já resgatou esta promoção"
}
```

---

### **4. Aplicar Promoção Manualmente**
```http
POST /api/promotions/:promotionId/apply/:driverId
```

**Resposta:**
```json
{
  "success": true,
  "redemption": {
    "driverId": "driver123",
    "promotionId": "promo_123",
    "redeemedAt": "2025-01-25T10:00:00Z"
  },
  "benefit": {
    "type": "free_subscription",
    "startDate": "2025-01-25T10:00:00Z",
    "endDate": "2025-02-25T10:00:00Z"
  }
}
```

---

### **5. Verificar e Aplicar Promoções Elegíveis**
```http
POST /api/promotions/check-driver/:driverId
```

**Resposta:**
```json
{
  "success": true,
  "results": [
    {
      "promotionId": "promo_123",
      "promotionName": "Promoção Primeiros 500",
      "success": true
    }
  ]
}
```

---

### **6. Estatísticas de Promoções**
```http
GET /api/promotions/stats
```

**Resposta:**
```json
{
  "success": true,
  "stats": {
    "total": 5,
    "active": 3,
    "completed": 1,
    "expired": 1,
    "totalRedemptions": 245,
    "byType": {
      "free_subscription": 3,
      "discount": 2
    }
  }
}
```

---

## 💡 EXEMPLO PRÁTICO: PROMOÇÃO DOS PRIMEIROS 500

### **Cenário:**
Criar promoção para os primeiros 500 motoristas que se cadastrarem até 31/12/2025, com benefício de assinatura grátis até 31/01/2026.

### **1. Criar Promoção via API:**

```bash
curl -X POST https://seu-backend.com/api/promotions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Primeiros 500 - Assinatura Grátis",
    "description": "Os primeiros 500 motoristas cadastrados até 31/12/2025 ganham assinatura grátis até 31/01/2026",
    "type": "free_subscription",
    "benefit": {
      "type": "free_subscription",
      "duration": 31,
      "unit": "days"
    },
    "eligibility": {
      "criteria": "first_n_drivers",
      "value": 500,
      "endDate": "2025-12-31T23:59:59Z"
    },
    "startDate": "2025-01-25T00:00:00Z",
    "endDate": "2025-12-31T23:59:59Z",
    "maxRedemptions": 500,
    "createdBy": "admin"
  }'
```

### **2. Como Funciona:**

1. **Motorista se cadastra** → Sistema verifica automaticamente se é elegível
2. **Se elegível** → Promoção é aplicada automaticamente
3. **Benefício aplicado** → Campo `promotion_free_end` é atualizado no perfil do motorista
4. **Durante período grátis** → Sistema não cobra assinatura semanal
5. **Após período** → Cobrança semanal inicia normalmente

### **3. Verificação Automática:**

O sistema verifica promoções elegíveis:
- Quando motorista se cadastra
- Quando promoção é criada (para motoristas já cadastrados)
- Quando motorista acessa a tela de assinatura

---

## 🔄 INTEGRAÇÃO COM SISTEMA DE COBRANÇA

### **Verificação de Período Grátis:**

O sistema de cobrança semanal verifica automaticamente:

```javascript
// No backend, antes de processar cobrança:
const freePeriod = await promotionService.checkFreePeriod(driverId);

if (freePeriod.isFree) {
  // NÃO COBRA - período grátis ativo
  console.log(`Motorista ${driverId} está em período grátis até ${freePeriod.freeUntil}`);
} else {
  // COBRA normalmente
  processWeeklyCharge(driverId);
}
```

### **Campos no Perfil do Motorista:**

Após aplicar promoção, os seguintes campos são atualizados:

```javascript
{
  "promotion_free_start": "2025-01-25T10:00:00Z",
  "promotion_free_end": "2025-02-25T10:00:00Z",
  "promotion_active": true
}
```

---

## 📊 GESTÃO VIA DASHBOARD

### **Interface Sugerida:**

1. **Lista de Promoções**
   - Status (ativa, pausada, completada, expirada)
   - Resgates (atual / máximo)
   - Ações (editar, pausar, ver detalhes)

2. **Criar Nova Promoção**
   - Formulário com todos os campos
   - Preview de elegibilidade
   - Estimativa de motoristas elegíveis

3. **Detalhes da Promoção**
   - Estatísticas de resgates
   - Lista de motoristas que resgataram
   - Histórico de aplicações

4. **Aplicação Manual**
   - Buscar motorista por ID
   - Verificar elegibilidade
   - Aplicar promoção manualmente (se elegível)

---

## 🎯 EXEMPLOS DE PROMOÇÕES

### **Exemplo 1: Primeiros 500 Motoristas**
```json
{
  "name": "Pioneiros Leaf - Assinatura Grátis",
  "type": "free_subscription",
  "benefit": {
    "type": "free_subscription",
    "duration": 31,
    "unit": "days"
  },
  "eligibility": {
    "criteria": "first_n_drivers",
    "value": 500,
    "endDate": "2025-12-31T23:59:59Z"
  },
  "maxRedemptions": 500
}
```

### **Exemplo 2: Promoção de Fim de Ano**
```json
{
  "name": "Natal 2025 - Assinatura Grátis",
  "type": "free_subscription",
  "benefit": {
    "type": "free_subscription",
    "duration": 30,
    "unit": "days"
  },
  "eligibility": {
    "criteria": "registration_date_range",
    "startDate": "2025-12-01T00:00:00Z",
    "endDate": "2025-12-31T23:59:59Z"
  },
  "maxRedemptions": null
}
```

### **Exemplo 3: Desconto para Motoristas Específicos**
```json
{
  "name": "Programa VIP - 50% Desconto",
  "type": "discount",
  "benefit": {
    "type": "discount",
    "discount": 50,
    "unit": "percent"
  },
  "eligibility": {
    "criteria": "specific_drivers",
    "driverIds": ["driver1", "driver2", "driver3"]
  }
}
```

---

## ✅ FLUXO COMPLETO

### **1. Admin cria promoção no dashboard:**
```
POST /api/promotions
→ Promoção criada e ativada
```

### **2. Motorista se cadastra:**
```
Motorista completa cadastro
→ Sistema chama: POST /api/promotions/check-driver/:driverId
→ Verifica todas as promoções ativas
→ Aplica promoções elegíveis automaticamente
```

### **3. Benefício aplicado:**
```
Campo promotion_free_end atualizado no perfil
→ Sistema de cobrança verifica antes de cobrar
→ Durante período grátis: NÃO COBRA
→ Após período: COBRA normalmente
```

### **4. Visualização no App:**
```
Tela de Gestão do Plano mostra:
- Dias restantes de período grátis
- Data de término do benefício
- Próximo pagamento (após período grátis)
```

---

## 🔧 MANUTENÇÃO

### **Verificar Status de Promoções:**
```bash
GET /api/promotions/stats
```

### **Pausar/Reativar Promoção:**
```bash
PATCH /api/promotions/:promotionId
{
  "status": "paused" // ou "active"
}
```

### **Aplicar Promoção Manualmente:**
```bash
POST /api/promotions/:promotionId/apply/:driverId
```

---

## 📝 NOTAS IMPORTANTES

1. **Verificação Automática:** Promoções são verificadas automaticamente quando motorista se cadastra
2. **Aplicação Única:** Cada motorista pode resgatar cada promoção apenas uma vez
3. **Limite de Resgates:** Quando `maxRedemptions` é atingido, promoção é marcada como `completed`
4. **Prioridade de Benefícios:** Se motorista tem múltiplos períodos grátis, o sistema usa o mais longo
5. **Integração com Cobrança:** Sistema de cobrança verifica automaticamente períodos grátis antes de cobrar

---

**Documento criado em:** 25/01/2025  
**Sistema implementado:** Backend + App Mobile

