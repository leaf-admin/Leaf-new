# 💰 RESUMO: CUSTO REAL DE UMA CORRIDA - PONTA A PONTA

**Data:** 29/01/2025  
**Status:** ✅ **BASEADO NO MODELO ATUAL IMPLEMENTADO**

---

## 🎯 FÓRMULA SIMPLIFICADA (RESUMO)

### **Para Leaf Plus:**
```
CUSTO = max(R$ 8,50, R$ 2,98 + (distância × R$ 1,22/km) + (tempo × R$ 0,25/min)) + pedágio + conveniência + (surge × total)
```

### **Para Leaf Elite:**
```
CUSTO = max(R$ 8,50, R$ 5,32 + (distância × R$ 2,18/km) + (tempo × R$ 0,29/min)) + pedágio + conveniência + (surge × total)
```

---

## 📊 COMPONENTES DO CUSTO

### **1. Tarifa Base (Bandeira)**
- **Leaf Plus:** R$ 2,98
- **Leaf Elite:** R$ 5,32

### **2. Tarifa por Distância**
- **Leaf Plus:** R$ 1,22/km
- **Leaf Elite:** R$ 2,18/km

### **3. Tarifa por Tempo**
- **Leaf Plus:** R$ 0,25/min (R$ 15,00/hora)
- **Leaf Elite:** R$ 0,29/min (R$ 17,40/hora)

### **4. Tarifa Mínima**
- **Ambos:** R$ 8,50 (garantido)

### **5. Pedágio**
- **Variável:** Baseado na rota ou valor externo
- **Quando:** Se a rota passar por pedágio

### **6. Taxa de Conveniência**
- **Status:** ⚠️ Configurável (pode ser percentual ou fixo)
- **Implementada:** Sim, mas valor não especificado nos parâmetros

### **7. Surge Pricing (Tarifa Dinâmica)**
- **Fórmula:** `fator = 1 + 0.3 × ((pedidos/motoristas) - 1)`
- **Limites:** 1.0x (mínimo) a 3.0x (máximo)
- **Aplicado:** Quando há alta demanda

---

## 💡 EXEMPLOS PRÁTICOS

### **Corrida Curta (3 km, 15 min) - Leaf Plus**
```
Base: R$ 2,98
Distância: 3 × R$ 1,22 = R$ 3,66
Tempo: 15 × R$ 0,25 = R$ 3,75
────────────────────────────────
Subtotal: R$ 10,39
Mínimo: max(10,39, 8,50) = R$ 10,39 ✅
────────────────────────────────
💰 CUSTO REAL: R$ 10,39 (+ pedágio se houver)
```

### **Corrida Média (10 km, 30 min) - Leaf Elite**
```
Base: R$ 5,32
Distância: 10 × R$ 2,18 = R$ 21,80
Tempo: 30 × R$ 0,29 = R$ 8,70
────────────────────────────────
Subtotal: R$ 35,82
Mínimo: max(35,82, 8,50) = R$ 35,82 ✅
────────────────────────────────
💰 CUSTO REAL: R$ 35,82 (+ pedágio se houver)
```

### **Corrida Longa (25 km, 45 min) - Leaf Plus com Surge 1.5x**
```
Base: R$ 2,98
Distância: 25 × R$ 1,22 = R$ 30,50
Tempo: 45 × R$ 0,25 = R$ 11,25
────────────────────────────────
Subtotal: R$ 44,73
Com Surge (1.5x): R$ 44,73 × 1.5 = R$ 67,10
────────────────────────────────
💰 CUSTO REAL: R$ 67,10 (+ pedágio se houver)
```

---

## ⚠️ OBSERVAÇÕES IMPORTANTES

### **1. Taxa de Conveniência**
- ✅ **Implementada no código**
- ⚠️ **Valor não especificado** nos parâmetros definidos
- **Pode ser:** Percentual (ex: 5%, 10%) ou valor fixo
- **Impacto:** Depende da configuração atual do sistema

### **2. Surge Pricing**
- ✅ **Implementado e funcionando**
- **Aplicado automaticamente** quando há alta demanda
- **Limites:** Nunca menos que 1.0x, nunca mais que 3.0x

### **3. Pedágio**
- ✅ **Implementado**
- **Cálculo:** Baseado na rota ou valor informado externamente
- **Impacto:** Variável conforme a rota

### **4. Opções Extras**
- ✅ **Implementado**
- **Quando:** Parcelas, entregas, opções especiais selecionadas
- **Impacto:** Adicionado ao total

---

## 📋 VALORES BASE (SEM SURGE, SEM PEDÁGIO, SEM CONVENIÊNCIA)

| Tipo | Mínimo | Base | Por Km | Por Min | Exemplo (5km, 20min) |
|------|--------|------|--------|---------|----------------------|
| **Leaf Plus** | R$ 8,50 | R$ 2,98 | R$ 1,22 | R$ 0,25 | R$ 13,18 |
| **Leaf Elite** | R$ 8,50 | R$ 5,32 | R$ 2,18 | R$ 0,29 | R$ 22,22 |

---

## ✅ CONCLUSÃO FINAL

**O custo real de uma corrida de ponta a ponta é:**

```
CUSTO = max(min_fare, base_fare + distância × rate_km + tempo × rate_min) 
      + pedágio 
      + taxa_conveniência 
      + opções_extras 
      + (surge × total_anterior)
```

**Valores confirmados:**
- ✅ **Leaf Plus:** R$ 2,98 + R$ 1,22/km + R$ 0,25/min (mín: R$ 8,50)
- ✅ **Leaf Elite:** R$ 5,32 + R$ 2,18/km + R$ 0,29/min (mín: R$ 8,50)
- ✅ **Surge:** 1.0x a 3.0x (conforme demanda)
- ✅ **Pedágio:** Variável (conforme rota)
- ⚠️ **Conveniência:** Configurável (valor não especificado)

**⚠️ ÚNICA INCERTEZA:** Valor da taxa de conveniência (se existe e quanto é)

---

**Documento criado em:** 29/01/2025


